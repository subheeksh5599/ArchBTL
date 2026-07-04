/**
 * Helper functions used across analysis operations.
 */

import { WorkflowGraph } from '../api';
import { addHttpConnectionEdges, addCrossFileCallEdges, addHttpCallerEdges } from '../edge-resolver';
import { getHttpConnections, getCrossFileCalls, getRepoFiles } from './state';
import { RawRepoStructure, FileStructure } from '../repo-structure';

/**
 * Run tasks with bounded concurrency using a worker pool pattern.
 * Unlike Promise.all on chunks, this immediately starts the next task
 * when any worker finishes - no waiting for all N to complete.
 *
 * @param tasks - Array of async task functions to execute
 * @param maxConcurrency - Maximum parallel tasks
 * @returns Array of results in same order as tasks
 */
export async function runWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    maxConcurrency: number
): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            results[index] = await tasks[index]();
        }
    }

    // Spawn up to maxConcurrency workers, each pulls from shared queue
    await Promise.all(
        Array.from({ length: Math.min(maxConcurrency, tasks.length) }, worker)
    );

    return results;
}

/**
 * Add statically-detected edges (HTTP connections + cross-file calls) to a graph.
 * This should be called before ANY graph display to ensure static edges are included.
 */
export function withHttpEdges(
    graph: WorkflowGraph | null,
    log: (msg: string) => void
): WorkflowGraph | null {
    if (!graph) return null;

    let result = graph;
    const httpConnections = getHttpConnections();
    const crossFileCalls = getCrossFileCalls();
    const repoFiles = getRepoFiles();

    // Add HTTP connection edges (client → backend handler)
    if (httpConnections.length > 0) {
        const httpResult = addHttpConnectionEdges(result, httpConnections, log);
        result = httpResult.graph;

        // Add HTTP caller edges (frontend caller → client)
        if (repoFiles.length > 0) {
            const callerResult = addHttpCallerEdges(result, httpConnections, repoFiles, log);
            result = callerResult.graph;
        }
    }

    // Add cross-file call edges
    if (crossFileCalls.length > 0) {
        const callResult = addCrossFileCallEdges(result, crossFileCalls, log);
        result = callResult.graph;
    }

    // Ensure ALL nodes referenced by edges are in a workflow group.
    // Without a workflow, ELK layout crashes ("Referenced shape does not exist").
    // This covers both new stub nodes AND existing nodes that gained edges
    // (e.g. addHttpCallerEdges linking to nodes filtered out of workflows).
    if (result.workflows) {
        const workflowNodeIds = new Set(result.workflows.flatMap(wf => wf.nodeIds));
        const nodeById = new Map(result.nodes.map(n => [n.id, n]));

        // Find all node IDs referenced by edges
        const referencedIds = new Set<string>();
        for (const edge of result.edges) {
            referencedIds.add(edge.source);
            referencedIds.add(edge.target);
        }

        // Orphan nodes (referenced by edges but not in any workflow) are adopted
        // by detectWorkflowGroups() via edge-based adoption — no need to create
        // synthetic workflows here.
    }

    // Safety net: drop any edges referencing nodes that don't exist.
    // Prevents ELK crash "Referenced shape does not exist".
    {
        const allNodeIds = new Set(result.nodes.map(n => n.id));
        const before = result.edges.length;
        result = {
            ...result,
            edges: result.edges.filter(e => allNodeIds.has(e.source) && allNodeIds.has(e.target))
        };
        const dropped = before - result.edges.length;
        if (dropped > 0) {
            log(`[HTTP] Dropped ${dropped} edges referencing non-existent nodes`);
        }
    }

    return result;
}

/**
 * Trace call graph from seed files to find all files with LLM calls.
 * Uses imports and function calls to find transitively connected LLM code.
 *
 * @param repoStructure - The extracted repo structure with functions, imports, and calls
 * @param seedFiles - Starting files (e.g., HTTP handlers) to trace from
 * @returns Set of file paths that are connected to LLM calls
 */
export function traceCallGraphToLLM(repoStructure: RawRepoStructure, seedFiles: Set<string>): Set<string> {
    const result = new Set<string>();

    // Build lookup maps for efficient resolution
    const fileByPath = new Map<string, FileStructure>();
    const fileByBasename = new Map<string, FileStructure[]>();
    const exportedSymbolToFile = new Map<string, string>();

    for (const file of repoStructure.files) {
        fileByPath.set(file.path, file);

        // Index by basename for fuzzy matching
        const basename = file.path.split('/').pop() || file.path;
        const basenameNoExt = basename.replace(/\.(py|ts|js|tsx|jsx)$/, '');
        if (!fileByBasename.has(basenameNoExt)) {
            fileByBasename.set(basenameNoExt, []);
        }
        fileByBasename.get(basenameNoExt)!.push(file);

        // Index exported symbols
        for (const exp of file.exports) {
            exportedSymbolToFile.set(exp, file.path);
        }
        for (const func of file.functions) {
            if (func.isExported) {
                exportedSymbolToFile.set(func.name, file.path);
            }
        }
    }

    // Resolve import source to actual file path
    function resolveImport(importSource: string, fromFile: string): string | null {
        // Handle relative imports (./foo, ../bar)
        if (importSource.startsWith('.')) {
            const fromDir = fromFile.split('/').slice(0, -1).join('/');
            const parts = importSource.split('/');
            let resolved = fromDir.split('/');

            for (const part of parts) {
                if (part === '.') continue;
                if (part === '..') {
                    resolved.pop();
                } else {
                    resolved.push(part);
                }
            }

            const basePath = resolved.join('/');
            // Try with different extensions
            for (const ext of ['', '.py', '.ts', '.js', '.tsx', '.jsx', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.swift', '.java', '.lua']) {
                const tryPath = basePath + ext;
                if (fileByPath.has(tryPath)) {
                    return tryPath;
                }
            }
            // Try as directory with index
            for (const idx of ['index.ts', 'index.js', '__init__.py']) {
                const tryPath = basePath + '/' + idx;
                if (fileByPath.has(tryPath)) {
                    return tryPath;
                }
            }
        }

        // Handle Python module notation (from gemini_client import ...)
        const moduleBasename = importSource.split('.').pop() || importSource;
        const candidates = fileByBasename.get(moduleBasename);
        if (candidates && candidates.length > 0) {
            // Prefer file in same directory as fromFile
            const fromDir = fromFile.split('/').slice(0, -1).join('/');
            const sameDir = candidates.find(c => c.path.startsWith(fromDir + '/'));
            if (sameDir) return sameDir.path;
            return candidates[0].path;
        }

        return null;
    }

    // For each seed file, BFS to check if it's connected to any LLM calls
    // If connected, add the seed file to results (the seed file is what we care about)
    for (const seedFile of seedFiles) {
        const localVisited = new Set<string>();
        const queue = [seedFile];
        let foundLLM = false;

        while (queue.length > 0 && !foundLLM) {
            const filePath = queue.shift()!;
            if (localVisited.has(filePath)) continue;
            localVisited.add(filePath);

            const file = fileByPath.get(filePath);
            if (!file) continue;

            // Check if this file has LLM calls
            if (file.functions.some(f => f.hasLLMCall)) {
                foundLLM = true;
                break;
            }

            // Trace imports to find more files
            for (const imp of file.imports) {
                const resolvedPath = resolveImport(imp.source, filePath);
                if (resolvedPath && !localVisited.has(resolvedPath)) {
                    queue.push(resolvedPath);
                }
            }

            // Trace function calls to find more files
            for (const func of file.functions) {
                for (const call of func.calls) {
                    // Check if call matches an exported symbol
                    const callName = call.split('.').pop() || call;
                    const targetFile = exportedSymbolToFile.get(callName);
                    if (targetFile && !localVisited.has(targetFile)) {
                        queue.push(targetFile);
                    }
                }
            }
        }

        // If this seed file is connected to LLM calls, add it to results
        if (foundLLM) {
            result.add(seedFile);
            // Also add all files in the trace path (they're all part of the LLM chain)
            for (const visitedFile of localVisited) {
                result.add(visitedFile);
            }
        }
    }

    return result;
}
