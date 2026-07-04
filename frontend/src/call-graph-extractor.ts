/**
 * Call Graph Extractor
 *
 * Extracts function definitions and call relationships for local graph updates.
 * Uses tree-sitter for parsing all supported languages.
 */

import { ParserManager } from './tree-sitter/parser-manager';
import { extractCallGraphFromTree } from './tree-sitter/extractors';

export interface FunctionInfo {
    name: string;
    startLine: number;
    endLine: number;
    decorators: string[];
    isAsync: boolean;
    params: string[];
}

export interface CallInfo {
    callee: string;         // Function/method being called
    line: number;
    isLLMCall: boolean;     // Is this a known LLM API call?
}

export interface ExtractedCallGraph {
    filePath: string;
    functions: Map<string, FunctionInfo>;       // function name → info
    callGraph: Map<string, string[]>;           // function → functions it calls
    llmCalls: Map<string, CallInfo[]>;          // function → LLM calls within it
    imports: string[];
    hash: string;                               // Structural hash for change detection
}

/**
 * Create a structural hash for change detection.
 * Only includes function names and call relationships, not line numbers.
 */
function createStructuralHash(
    functions: Map<string, FunctionInfo>,
    callGraph: Map<string, string[]>
): string {
    const parts: string[] = [];

    const sortedFunctions = Array.from(functions.keys()).sort();
    for (const fn of sortedFunctions) {
        const calls = callGraph.get(fn) || [];
        parts.push(`${fn}:[${calls.sort().join(',')}]`);
    }

    let hash = 0;
    const str = parts.join('|');
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

/**
 * Main entry point: extract call graph from any supported file.
 * Uses tree-sitter with incremental parsing (cached tree per file).
 */
export function extractCallGraph(code: string, filePath: string): ExtractedCallGraph {
    const language = ParserManager.getLanguageForFile(filePath);
    if (!language || !ParserManager.isAvailable()) {
        return {
            filePath,
            functions: new Map(),
            callGraph: new Map(),
            llmCalls: new Map(),
            imports: [],
            hash: '0'
        };
    }

    try {
        const manager = ParserManager.get();
        // filePath enables tree caching for incremental parsing (hot path)
        const tree = manager.parse(code, language, filePath);
        const result = extractCallGraphFromTree(tree, language, filePath);
        tree.delete();

        return {
            filePath,
            ...result,
            hash: createStructuralHash(result.functions, result.callGraph)
        };
    } catch (error) {
        console.warn(`Failed to parse ${filePath}:`, error);
        return {
            filePath,
            functions: new Map(),
            callGraph: new Map(),
            llmCalls: new Map(),
            imports: [],
            hash: '0'
        };
    }
}

/**
 * Compute diff between two call graphs
 */
export interface CallGraphDiff {
    addedFunctions: string[];
    removedFunctions: string[];
    modifiedFunctions: string[];  // Functions whose calls changed
    addedEdges: { from: string; to: string }[];
    removedEdges: { from: string; to: string }[];
}

export function diffCallGraphs(
    oldGraph: ExtractedCallGraph,
    newGraph: ExtractedCallGraph
): CallGraphDiff {
    const addedFunctions: string[] = [];
    const removedFunctions: string[] = [];
    const modifiedFunctions: string[] = [];
    const addedEdges: { from: string; to: string }[] = [];
    const removedEdges: { from: string; to: string }[] = [];

    const oldFuncs = new Set(oldGraph.functions.keys());
    const newFuncs = new Set(newGraph.functions.keys());

    for (const fn of newFuncs) {
        if (!oldFuncs.has(fn)) {
            addedFunctions.push(fn);
        }
    }

    for (const fn of oldFuncs) {
        if (!newFuncs.has(fn)) {
            removedFunctions.push(fn);
        }
    }

    for (const fn of newFuncs) {
        if (oldFuncs.has(fn)) {
            const oldCalls = new Set(oldGraph.callGraph.get(fn) || []);
            const newCalls = new Set(newGraph.callGraph.get(fn) || []);

            let modified = false;

            for (const call of newCalls) {
                if (!oldCalls.has(call)) {
                    addedEdges.push({ from: fn, to: call });
                    modified = true;
                }
            }

            for (const call of oldCalls) {
                if (!newCalls.has(call)) {
                    removedEdges.push({ from: fn, to: call });
                    modified = true;
                }
            }

            if (modified) {
                modifiedFunctions.push(fn);
            }
        }
    }

    return {
        addedFunctions,
        removedFunctions,
        modifiedFunctions,
        addedEdges,
        removedEdges
    };
}

/**
 * Check if structure has changed (quick hash comparison)
 */
export function hasStructureChanged(oldHash: string, newHash: string): boolean {
    return oldHash !== newHash;
}
