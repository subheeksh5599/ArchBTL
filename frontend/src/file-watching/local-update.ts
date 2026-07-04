/**
 * Instant local graph updates using tree-sitter diff (no LLM).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { CacheManager } from '../cache';
import { extractCallGraph, diffCallGraphs } from '../call-graph-extractor';
import { applyLocalUpdate, LocalUpdateResult, createGraphFromCallGraph } from '../local-graph-updater';
import { getCachedCallGraph, setCachedCallGraph, getRepoFiles, setRepoFiles, getCrossFileCalls, setCrossFileCalls } from '../analysis/state';
import { WorkflowDetector } from '../analyzer';
import { extractFileStructure, CrossFileCall } from '../repo-structure';

/**
 * Context needed for local updates.
 */
export interface LocalUpdateContext {
    cache: CacheManager;
    log: (msg: string) => void;
}

/**
 * Perform instant local structure update (no LLM).
 * Uses tree-sitter to diff call graphs and apply changes.
 *
 * @param ctx - Context with cache and log
 * @param uri - URI of the file that changed
 * @returns LocalUpdateResult or null if update wasn't possible
 */
export async function performLocalUpdate(
    ctx: LocalUpdateContext,
    uri: vscode.Uri
): Promise<LocalUpdateResult | null> {
    const { cache, log } = ctx;
    const filePath = uri.fsPath;
    const relativePath = vscode.workspace.asRelativePath(filePath);

    try {
        // Read file content
        const content = fs.readFileSync(filePath, 'utf-8');

        // Extract call graph (uses tree-sitter for all languages)
        const newCallGraph = extractCallGraph(content, filePath);

        // Get cached call graph for comparison
        const oldCallGraph = getCachedCallGraph(filePath);

        // Get this file's cached graph
        const fileGraph = await cache.getMergedGraph([filePath]);

        if (oldCallGraph && fileGraph) {
            // Compute diff
            const diff = diffCallGraphs(oldCallGraph, newCallGraph);

            // Check if structure actually changed
            const hasChanges = diff.addedFunctions.length > 0 ||
                               diff.removedFunctions.length > 0 ||
                               diff.modifiedFunctions.length > 0 ||
                               diff.addedEdges.length > 0 ||
                               diff.removedEdges.length > 0;

            if (!hasChanges) {
                log(`No structural changes in ${filePath}`);
                const mergedGraph = await cache.getMergedGraph();
                return {
                    graph: mergedGraph!,
                    nodesAdded: [],
                    nodesRemoved: [],
                    nodesUpdated: [],
                    edgesAdded: 0,
                    edgesRemoved: 0,
                    needsMetadata: [],
                    changedFunctions: []
                };
            }

            // Apply local update to this file's graph (not merged)
            const result = applyLocalUpdate(fileGraph, diff, newCallGraph, relativePath);
            log(`Local update: +${result.nodesAdded.length} nodes, -${result.nodesRemoved.length} nodes, +${result.edgesAdded} edges`);

            // Populate changedFunctions from diff
            result.changedFunctions = [
                ...diff.addedFunctions,
                ...diff.removedFunctions,
                ...diff.modifiedFunctions
            ];

            // Update caches with the file-specific graph
            setCachedCallGraph(filePath, newCallGraph);
            await cache.setAnalysisResult(result.graph, { [relativePath]: content });

            // Update cross-file call state for edge detection
            updateCrossFileState(content, relativePath, log);

            // Get merged graph for display
            const mergedGraph = await cache.getMergedGraph();
            result.graph = mergedGraph!;

            return result;
        } else {
            // No cached call graph - first access or new file
            setCachedCallGraph(filePath, newCallGraph);

            // Check if file already has cached analysis results
            const existingGraph = await cache.getMergedGraph([filePath]);
            if (existingGraph && existingGraph.nodes.length > 0) {
                // File was previously analyzed - just return existing graph
                const mergedGraph = await cache.getMergedGraph();
                return {
                    graph: mergedGraph!,
                    nodesAdded: [],
                    nodesRemoved: [],
                    nodesUpdated: [],
                    edgesAdded: 0,
                    edgesRemoved: 0,
                    needsMetadata: [],
                    changedFunctions: []
                };
            }

            // No cached graph - check if this is an LLM file worth visualizing
            const isLLMFile = WorkflowDetector.detectWorkflow(content, filePath);

            if (isLLMFile && newCallGraph.functions.size > 0) {
                // Create initial graph from call graph (pending metadata)
                log(`New LLM file detected: ${relativePath} - creating instant graph`);
                const newGraph = createGraphFromCallGraph(newCallGraph, relativePath);

                // Mark all nodes as pending metadata
                const pendingNodeIds = newGraph.nodes.map(n => n.id);

                // Cache the new graph
                await cache.setAnalysisResult(newGraph, { [relativePath]: content });

                // Update cross-file call state for edge detection
                updateCrossFileState(content, relativePath, log);

                // Get merged graph for display
                const mergedGraph = await cache.getMergedGraph();

                return {
                    graph: mergedGraph!,
                    nodesAdded: newGraph.nodes.map(n => n.id),
                    nodesRemoved: [],
                    nodesUpdated: [],
                    edgesAdded: newGraph.edges.length,
                    edgesRemoved: 0,
                    needsMetadata: pendingNodeIds,
                    changedFunctions: Array.from(newCallGraph.functions.keys())
                };
            }

            return null;
        }
    } catch (error) {
        log(`Local update failed: ${error}`);
        return null;
    }
}

/**
 * Resolve an import source to a file path from the known repo files.
 */
function resolveImportToRepoFile(
    importSource: string,
    currentFile: string,
    allPaths: string[]
): string | null {
    const currentDir = currentFile.split('/').slice(0, -1).join('/');

    if (importSource.startsWith('./') || importSource.startsWith('../')) {
        const parts = [...currentDir.split('/'), ...importSource.split('/')];
        const resolved: string[] = [];
        for (const part of parts) {
            if (part === '.' || part === '') continue;
            if (part === '..') resolved.pop();
            else resolved.push(part);
        }
        const basePath = resolved.join('/');
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.swift', '.java', '.lua', '']) {
            const fullPath = basePath + ext;
            if (allPaths.includes(fullPath)) return fullPath;
        }
    }

    if (!importSource.includes('/') && !importSource.startsWith('@')) {
        const modulePath = importSource.replace(/\./g, '/');
        for (const ext of ['.py', '.ts', '.js', '.go', '.rs', '.c', '.cpp', '.swift', '.java', '.lua', '']) {
            const fullPath = modulePath + ext;
            const match = allPaths.find(f => f === fullPath || f.endsWith('/' + fullPath));
            if (match) return match;
        }
    }

    return null;
}

/**
 * Update cross-file call state after a local file change.
 * Extracts the file's imports/calls and resolves cross-file references
 * against known repo files, so withHttpEdges() picks them up.
 */
function updateCrossFileState(
    content: string,
    relativePath: string,
    log: (msg: string) => void
): void {
    const repoFiles = getRepoFiles();
    if (repoFiles.length === 0) return;

    const fileStructure = extractFileStructure(content, relativePath);

    // Update repoFiles with this file's data
    const updatedRepoFiles = repoFiles.filter(f => f.path !== relativePath);
    updatedRepoFiles.push({
        path: relativePath,
        functions: fileStructure.functions.map(f => ({
            name: f.name,
            calls: f.calls,
            line: f.line
        }))
    });
    setRepoFiles(updatedRepoFiles);

    // Remove old cross-file calls where this file is the caller
    const existingCalls = getCrossFileCalls();
    const otherCalls = existingCalls.filter(c => c.caller.file !== relativePath);

    // Build exported functions map for target resolution
    const exportedFunctions = new Map<string, Set<string>>();
    for (const file of updatedRepoFiles) {
        exportedFunctions.set(file.path, new Set(file.functions.map(f => f.name)));
    }

    // Build import map for this file
    const allFilePaths = updatedRepoFiles.map(f => f.path);
    const importMap = new Map<string, string>();
    for (const imp of fileStructure.imports) {
        const resolvedPath = resolveImportToRepoFile(imp.source, relativePath, allFilePaths);
        if (resolvedPath) {
            for (const symbol of imp.symbols) {
                importMap.set(symbol, resolvedPath);
            }
            const moduleName = imp.source.split('/').pop()?.replace(/\.[^.]+$/, '') || imp.source;
            importMap.set(moduleName, resolvedPath);
        }
    }

    // Resolve cross-file calls from this file
    const newCalls: CrossFileCall[] = [];
    for (const fn of fileStructure.functions) {
        for (const call of fn.calls) {
            const dotIndex = call.indexOf('.');
            if (dotIndex === -1) continue;

            const moduleName = call.substring(0, dotIndex);
            const funcName = call.substring(dotIndex + 1).split('(')[0];

            const targetFile = importMap.get(moduleName);
            if (targetFile && targetFile !== relativePath) {
                const targetFuncs = exportedFunctions.get(targetFile);
                if (targetFuncs && (targetFuncs.has(funcName) || targetFuncs.size === 0)) {
                    newCalls.push({
                        caller: { file: relativePath, function: fn.name, line: fn.line },
                        callee: { file: targetFile, function: funcName, module: moduleName }
                    });
                }
            }
        }
    }

    setCrossFileCalls([...otherCalls, ...newCalls]);
    if (newCalls.length > 0) {
        log(`[CROSS-FILE] Updated: ${newCalls.length} calls from ${relativePath}`);
    }
}
