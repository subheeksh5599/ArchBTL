/**
 * Repo Structure Extractor
 *
 * Extracts structural information from all files in the repo for cross-batch context.
 * Uses tree-sitter for parsing all supported languages.
 * HTTP endpoint extraction is AST-based for reliability.
 */

import { ParserManager } from './tree-sitter/parser-manager';
import { extractFileStructureFromTree } from './tree-sitter/extractors';
import type { HttpCallInfo, HttpRouteInfo, ImportInfo, ExtractedFunctionDef } from './tree-sitter/extractors';

// Re-export types for compatibility
export interface HttpClientCall {
    file: string;
    line: number;
    function: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | string;
    endpoint: string;
    normalizedPath: string;
}

export interface HttpRouteHandler {
    file: string;
    line: number;
    function: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | string;
    path: string;
}

export interface HttpConnection {
    client: HttpClientCall;
    handler: HttpRouteHandler;
    confidence: 'exact' | 'fuzzy';
}

export interface FunctionDef {
    name: string;
    line: number;
    calls: string[];
    isExported: boolean;
    hasLLMCall: boolean;
    params: string[];
    isAsync: boolean;
    httpCalls: HttpClientCall[];  // HTTP client calls made by this function
}

export interface FileStructure {
    path: string;
    functions: FunctionDef[];
    exports: string[];
    imports: ImportDef[];
    httpRouteHandlers: HttpRouteHandler[];  // Route handlers defined in this file
}

export interface ImportDef {
    source: string;
    symbols: string[];
}

/**
 * A cross-file function call detected via static analysis
 */
export interface CrossFileCall {
    caller: {
        file: string;
        function: string;
        line: number;
    };
    callee: {
        file: string;        // Resolved file path
        function: string;
        module?: string;     // Original module/object name (e.g., "gemini_client")
    };
}

export interface RawRepoStructure {
    files: FileStructure[];
    httpClientCalls: HttpClientCall[];
    httpRouteHandlers: HttpRouteHandler[];
    httpConnections: HttpConnection[];
    crossFileCalls: CrossFileCall[];
}

/**
 * Match paths for HTTP connection detection
 */
function matchPaths(
    clientPath: string,
    handlerPath: string,
    clientMethod: string,
    handlerMethod: string
): 'exact' | 'fuzzy' | null {
    // Methods must match
    if (clientMethod.toUpperCase() !== handlerMethod.toUpperCase()) {
        return null;
    }

    // Normalize paths
    const normClient = clientPath.replace(/\/+$/, '') || '/';
    const normHandler = handlerPath.replace(/\/+$/, '') || '/';

    // Exact match
    if (normClient === normHandler) {
        return 'exact';
    }

    // Fuzzy match: handler has path params like /users/:id or /users/{id}
    const handlerRegex = normHandler
        .replace(/:[^/]+/g, '[^/]+')
        .replace(/\{[^}]+\}/g, '[^/]+');

    if (new RegExp(`^${handlerRegex}$`).test(normClient)) {
        return 'fuzzy';
    }

    return null;
}

/**
 * Resolve import source to a file path
 * Handles: './api', '../utils', 'gemini_client', '@/components/Button'
 */
function resolveImportPath(importSource: string, currentFile: string, allFiles: string[]): string | null {
    // Get directory of current file
    const currentDir = currentFile.split('/').slice(0, -1).join('/');

    // Handle relative imports: ./foo, ../bar
    if (importSource.startsWith('./') || importSource.startsWith('../')) {
        // Resolve relative path
        const parts = [...currentDir.split('/'), ...importSource.split('/')];
        const resolved: string[] = [];
        for (const part of parts) {
            if (part === '.' || part === '') continue;
            if (part === '..') {
                resolved.pop();
            } else {
                resolved.push(part);
            }
        }
        const basePath = resolved.join('/');

        // Try with various extensions
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.swift', '.java', '.lua', ''];
        for (const ext of extensions) {
            const fullPath = basePath + ext;
            if (allFiles.some(f => f === fullPath || f.endsWith('/' + fullPath))) {
                return fullPath;
            }
            // Also try index files
            const indexPath = basePath + '/index' + ext;
            if (allFiles.some(f => f === indexPath || f.endsWith('/' + indexPath))) {
                return indexPath;
            }
        }
    }

    // Handle Python imports: gemini_client, backend.gemini_client
    if (!importSource.includes('/') && !importSource.startsWith('@')) {
        // Convert dots to slashes for Python module notation
        const modulePath = importSource.replace(/\./g, '/');
        const extensions = ['.py', '.ts', '.js', '.go', '.rs', '.c', '.cpp', '.swift', '.java', '.lua', ''];
        for (const ext of extensions) {
            const fullPath = modulePath + ext;
            // Check if any file matches this path (could be in same dir or nested)
            const match = allFiles.find(f =>
                f === fullPath ||
                f.endsWith('/' + fullPath) ||
                f === currentDir + '/' + fullPath
            );
            if (match) return match;
        }
    }

    return null;
}

/**
 * Resolve cross-file function calls using import information
 * For each function call like "gemini_client.analyze_workflow", checks if
 * "gemini_client" was imported and resolves to the target file.
 */
function resolveCrossFileCalls(files: FileStructure[]): CrossFileCall[] {
    const crossFileCalls: CrossFileCall[] = [];
    const allFilePaths = files.map(f => f.path);

    // Build map of all exported functions per file
    const exportedFunctions = new Map<string, Set<string>>();
    for (const file of files) {
        const funcs = new Set<string>();
        for (const fn of file.functions) {
            funcs.add(fn.name);
        }
        // Also add exports
        for (const exp of file.exports) {
            funcs.add(exp);
        }
        exportedFunctions.set(file.path, funcs);
    }

    for (const file of files) {
        // Build import map for this file: importName -> resolvedFilePath
        const importMap = new Map<string, string>();

        for (const imp of file.imports) {
            const resolvedPath = resolveImportPath(imp.source, file.path, allFilePaths);
            if (resolvedPath) {
                // Map each imported symbol to the resolved file
                for (const symbol of imp.symbols) {
                    importMap.set(symbol, resolvedPath);
                }
                // Also map the module name itself (for "import foo" style)
                const moduleName = imp.source.split('/').pop()?.replace(/\.[^.]+$/, '') || imp.source;
                importMap.set(moduleName, resolvedPath);
            }
        }

        // Check each function's calls
        for (const fn of file.functions) {
            for (const call of fn.calls) {
                // Parse call: "gemini_client.analyze_workflow" -> module="gemini_client", func="analyze_workflow"
                const dotIndex = call.indexOf('.');
                if (dotIndex === -1) {
                    // Direct function call — check if imported from another file
                    // e.g., import { analyzeWorkflow } from './gemini_client'
                    // then analyzeWorkflow() should resolve cross-file
                    const targetFile = importMap.get(call);
                    if (targetFile && targetFile !== file.path) {
                        const targetFuncs = exportedFunctions.get(targetFile);
                        if (targetFuncs && (targetFuncs.has(call) || targetFuncs.size === 0)) {
                            crossFileCalls.push({
                                caller: {
                                    file: file.path,
                                    function: fn.name,
                                    line: fn.line
                                },
                                callee: {
                                    file: targetFile,
                                    function: call
                                }
                            });
                        }
                    }
                    continue;
                }

                const moduleName = call.substring(0, dotIndex);
                const funcName = call.substring(dotIndex + 1).split('(')[0]; // Remove args if present

                // Check if this module was imported
                const targetFile = importMap.get(moduleName);
                if (targetFile && targetFile !== file.path) {
                    // Verify the function exists in target file
                    const targetFuncs = exportedFunctions.get(targetFile);
                    if (targetFuncs && (targetFuncs.has(funcName) || targetFuncs.size === 0)) {
                        crossFileCalls.push({
                            caller: {
                                file: file.path,
                                function: fn.name,
                                line: fn.line
                            },
                            callee: {
                                file: targetFile,
                                function: funcName,
                                module: moduleName
                            }
                        });
                    }
                }
            }
        }
    }

    return crossFileCalls;
}

/**
 * Convert tree-sitter extracted structure to FileStructure interface
 */
function toFileStructure(
    filePath: string,
    extracted: {
        functions: ExtractedFunctionDef[];
        exports: string[];
        imports: ImportInfo[];
        httpRouteHandlers: HttpRouteInfo[];
    }
): FileStructure {
    return {
        path: filePath,
        functions: extracted.functions.map(f => ({
            name: f.name,
            line: f.line,
            calls: f.calls,
            isExported: f.isExported,
            hasLLMCall: f.hasLLMCall,
            params: f.params,
            isAsync: f.isAsync,
            httpCalls: f.httpCalls as HttpClientCall[],
        })),
        exports: extracted.exports,
        imports: extracted.imports,
        httpRouteHandlers: extracted.httpRouteHandlers as HttpRouteHandler[],
    };
}

/**
 * Extract structure from a single file using tree-sitter
 */
export function extractFileStructure(code: string, filePath: string): FileStructure {
    const language = ParserManager.getLanguageForFile(filePath);
    if (!language || !ParserManager.isAvailable()) {
        return { path: filePath, functions: [], exports: [], imports: [], httpRouteHandlers: [] };
    }

    try {
        const manager = ParserManager.get();
        const tree = manager.parse(code, language, filePath);
        const result = extractFileStructureFromTree(tree, language, filePath);
        tree.delete();
        return toFileStructure(filePath, result);
    } catch (error) {
        console.warn(`Failed to parse ${filePath}:`, error);
        return { path: filePath, functions: [], exports: [], imports: [], httpRouteHandlers: [] };
    }
}

/**
 * Propagate LLM call flags transitively through the call graph.
 * If function A calls function B, and B has LLM calls, mark A as LLM-related too.
 * This catches chains like: main() → helper() → llm_call()
 */
function propagateLLMCalls(fileStructures: FileStructure[]): void {
    // Build a map of function name → file::function for cross-file resolution
    const funcLocations = new Map<string, { file: string; func: FunctionDef }[]>();
    const allFunctions = new Map<string, FunctionDef>(); // file::func → FunctionDef

    for (const file of fileStructures) {
        for (const func of file.functions) {
            const key = `${file.path}::${func.name}`;
            allFunctions.set(key, func);

            // Also index by just function name for simple lookups
            if (!funcLocations.has(func.name)) {
                funcLocations.set(func.name, []);
            }
            funcLocations.get(func.name)!.push({ file: file.path, func });
        }
    }

    // Build reverse call graph (who calls whom)
    // callee → [callers]
    const callers = new Map<string, Set<string>>();

    for (const file of fileStructures) {
        for (const func of file.functions) {
            const callerKey = `${file.path}::${func.name}`;

            for (const callName of func.calls) {
                // Try to resolve the call to a known function
                const targets = funcLocations.get(callName) || [];

                for (const target of targets) {
                    const targetKey = `${target.file}::${target.func.name}`;

                    if (!callers.has(targetKey)) {
                        callers.set(targetKey, new Set());
                    }
                    callers.get(targetKey)!.add(callerKey);
                }
            }
        }
    }

    // Propagate LLM flags using BFS from functions that have direct LLM calls
    const queue: string[] = [];
    const visited = new Set<string>();

    // Find all functions with direct LLM calls
    for (const [key, func] of allFunctions) {
        if (func.hasLLMCall) {
            queue.push(key);
            visited.add(key);
        }
    }

    // BFS: propagate LLM flag to all callers
    while (queue.length > 0) {
        const current = queue.shift()!;
        const callerSet = callers.get(current);

        if (callerSet) {
            for (const caller of callerSet) {
                if (!visited.has(caller)) {
                    visited.add(caller);
                    const callerFunc = allFunctions.get(caller);
                    if (callerFunc) {
                        callerFunc.hasLLMCall = true;  // Mark as transitively LLM-related
                        queue.push(caller);
                    }
                }
            }
        }
    }
}

/**
 * Extract structure from multiple files
 */
export function extractRepoStructure(files: { path: string; content: string }[]): RawRepoStructure {
    const fileStructures: FileStructure[] = [];
    const allHttpClientCalls: HttpClientCall[] = [];
    const allHttpRouteHandlers: HttpRouteHandler[] = [];

    for (const file of files) {
        const structure = extractFileStructure(file.content, file.path);
        if (structure.functions.length > 0 || structure.exports.length > 0) {
            fileStructures.push(structure);

            // Collect HTTP client calls from all functions (AST-extracted)
            for (const func of structure.functions) {
                if (func.httpCalls && func.httpCalls.length > 0) {
                    allHttpClientCalls.push(...func.httpCalls);
                }
            }

            // Collect route handlers from file structure (AST-extracted)
            if (structure.httpRouteHandlers && structure.httpRouteHandlers.length > 0) {
                allHttpRouteHandlers.push(...structure.httpRouteHandlers);
            }
        }
    }

    // Propagate LLM flags transitively through call graph
    // This marks functions as LLM-related if they call other LLM functions
    propagateLLMCalls(fileStructures);

    // Match HTTP client calls to route handlers using AST-extracted data
    const httpConnections: HttpConnection[] = [];
    for (const clientCall of allHttpClientCalls) {
        for (const handler of allHttpRouteHandlers) {
            const matchResult = matchPaths(
                clientCall.normalizedPath,
                handler.path,
                clientCall.method,
                handler.method
            );
            if (matchResult) {
                httpConnections.push({
                    client: clientCall,
                    handler,
                    confidence: matchResult
                });
            }
        }
    }

    // Resolve cross-file function calls using import information
    const crossFileCalls = resolveCrossFileCalls(fileStructures);

    return {
        files: fileStructures,
        httpClientCalls: allHttpClientCalls,
        httpRouteHandlers: allHttpRouteHandlers,
        httpConnections,
        crossFileCalls
    };
}

/**
 * Format raw structure as JSON for LLM condensation
 */
export function formatStructureForLLM(structure: RawRepoStructure): string {
    const simplified = structure.files.map(file => ({
        path: file.path,
        functions: file.functions.map(f => ({
            name: f.name,
            line: f.line,
            calls: f.calls.slice(0, 10), // Limit calls to reduce tokens
            exported: f.isExported,
            hasLLM: f.hasLLMCall,
            async: f.isAsync
        })),
        exports: file.exports,
        imports: file.imports.map(i => i.source)
    }));

    // Include HTTP connections for cross-service workflow detection
    const httpConnections = structure.httpConnections.map(conn => ({
        client: {
            file: conn.client.file,
            function: conn.client.function,
            line: conn.client.line,
            method: conn.client.method,
            endpoint: conn.client.normalizedPath
        },
        handler: {
            file: conn.handler.file,
            function: conn.handler.function,
            line: conn.handler.line,
            method: conn.handler.method,
            path: conn.handler.path
        },
        confidence: conn.confidence
    }));

    return JSON.stringify({
        files: simplified,
        httpConnections
    }, null, 2);
}

/**
 * Format HTTP connections as human-readable text for workflow context
 */
export function formatHttpConnectionsForPrompt(structure: RawRepoStructure): string {
    if (structure.httpConnections.length === 0) {
        return '';
    }

    // Deduplicate connections by unique client→handler pair
    const seen = new Set<string>();
    const dedupedConnections = structure.httpConnections.filter(conn => {
        const key = `${conn.client.file}::${conn.client.function}→${conn.handler.file}::${conn.handler.function}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    let output = '\n## Cross-Service HTTP Connections\n';
    output += 'These HTTP client calls connect to route handlers in other files:\n\n';

    for (const conn of dedupedConnections) {
        output += `- ${conn.client.file}::${conn.client.function} `;
        output += `--(${conn.client.method} ${conn.client.normalizedPath})--> `;
        output += `${conn.handler.file}::${conn.handler.function}\n`;
    }

    return output;
}
