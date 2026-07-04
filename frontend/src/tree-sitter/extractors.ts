/**
 * Unified Tree-sitter Extractors
 *
 * Replaces 9 separate language-specific parser functions (3 files x 3 languages)
 * with a single set of extraction functions that work across all languages.
 *
 * Each extraction function takes a parsed Tree and produces the same interfaces
 * that downstream consumers expect.
 */

import type { Tree, Node, Query, QueryMatch } from 'web-tree-sitter';
import { ParserManager, SupportedLanguage } from './parser-manager';
import { getMemberChain, getParams, isAsync, findEnclosingFunction, getFunctionRange } from './helpers';
import { isLLMCall as checkLLMCall, mightContainLLM, ROUTER_OBJECT_NAMES, matchRouteFileConvention } from '../providers';
import { KEYWORD_BLACKLISTS } from '../config';

/**
 * Check if a callee string represents an LLM-related call.
 * Handles the `(` suffix needed by some ALL_CALL_PATTERNS (e.g., /\.sendRequest\s*\(/).
 * Also falls back to provider-name matching (e.g., openai.*, gemini.*) like the old code.
 */
function isLLMRelatedCall(callee: string): boolean {
    // Append '(' so patterns requiring it (e.g., /\.sendRequest\s*\(/) can match
    return checkLLMCall(callee + '(') || checkLLMCall(callee);
}

// Re-export query modules so they can be imported from here
import * as jsQueries from './queries/javascript';
import * as tsQueries from './queries/typescript';
import * as pyQueries from './queries/python';
import * as goQueries from './queries/go';
import * as rustQueries from './queries/rust';
import * as cQueries from './queries/c';
import * as cppQueries from './queries/cpp';
import * as swiftQueries from './queries/swift';
import * as javaQueries from './queries/java';
import * as luaQueries from './queries/lua';

// Import types from the consumer files (we keep these interfaces unchanged)
import type { FunctionInfo, CallInfo } from '../call-graph-extractor';

// Types used by repo-structure.ts (replicated here to avoid circular deps)
export interface ExtractedFunctionDef {
    name: string;
    line: number;
    calls: string[];
    isExported: boolean;
    hasLLMCall: boolean;
    params: string[];
    isAsync: boolean;
    httpCalls: HttpCallInfo[];
}

export interface HttpCallInfo {
    file: string;
    line: number;
    function: string;
    method: string;
    endpoint: string;
    normalizedPath: string;
}

export interface HttpRouteInfo {
    file: string;
    line: number;
    function: string;
    method: string;
    path: string;
}

export interface ImportInfo {
    source: string;
    symbols: string[];
}

// Types used by static-analyzer.ts
export interface CodeLocationInfo {
    line: number;
    column: number;
    type: string;
    description: string;
    function: string;
    variable?: string;
}

// ─── Query cache (compiled once per language) ────────────────────────────

interface CompiledQueries {
    functions: Query;
    calls: Query;
    imports: Query;
    importSpecifiers: Query;
    exports: Query;
    defaultExports?: Query;
    // Python-specific
    decoratedFunctions?: Query;
    decorators?: Query;
    allExport?: Query;
}

const queryCache = new Map<SupportedLanguage, CompiledQueries>();

function getQueriesForLang(lang: SupportedLanguage): { q: Record<string, string>; extras?: Record<string, string> } {
    switch (lang) {
        case 'python':
            return {
                q: {
                    functions: pyQueries.FUNCTION_QUERY,
                    calls: pyQueries.CALL_QUERY,
                    imports: pyQueries.IMPORT_QUERY,
                    importSpecifiers: pyQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: pyQueries.FUNCTION_QUERY,
                },
                extras: {
                    decoratedFunctions: pyQueries.DECORATED_FUNCTION_QUERY,
                    decorators: pyQueries.DECORATOR_QUERY,
                    allExport: pyQueries.ALL_EXPORT_QUERY,
                }
            };
        case 'go':
            return {
                q: {
                    functions: goQueries.FUNCTION_QUERY,
                    calls: goQueries.CALL_QUERY,
                    imports: goQueries.IMPORT_QUERY,
                    importSpecifiers: goQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: goQueries.EXPORT_QUERY,
                }
            };
        case 'rust':
            return {
                q: {
                    functions: rustQueries.FUNCTION_QUERY,
                    calls: rustQueries.CALL_QUERY,
                    imports: rustQueries.IMPORT_QUERY,
                    importSpecifiers: rustQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: rustQueries.EXPORT_QUERY,
                }
            };
        case 'c':
            return {
                q: {
                    functions: cQueries.FUNCTION_QUERY,
                    calls: cQueries.CALL_QUERY,
                    imports: cQueries.IMPORT_QUERY,
                    importSpecifiers: cQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: cQueries.EXPORT_QUERY,
                }
            };
        case 'cpp':
            return {
                q: {
                    functions: cppQueries.FUNCTION_QUERY,
                    calls: cppQueries.CALL_QUERY,
                    imports: cppQueries.IMPORT_QUERY,
                    importSpecifiers: cppQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: cppQueries.EXPORT_QUERY,
                }
            };
        case 'swift':
            return {
                q: {
                    functions: swiftQueries.FUNCTION_QUERY,
                    calls: swiftQueries.CALL_QUERY,
                    imports: swiftQueries.IMPORT_QUERY,
                    importSpecifiers: swiftQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: swiftQueries.EXPORT_QUERY,
                }
            };
        case 'java':
            return {
                q: {
                    functions: javaQueries.FUNCTION_QUERY,
                    calls: javaQueries.CALL_QUERY,
                    imports: javaQueries.IMPORT_QUERY,
                    importSpecifiers: javaQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: javaQueries.EXPORT_QUERY,
                }
            };
        case 'lua':
            return {
                q: {
                    functions: luaQueries.FUNCTION_QUERY,
                    calls: luaQueries.CALL_QUERY,
                    imports: luaQueries.IMPORT_QUERY,
                    importSpecifiers: luaQueries.IMPORT_SPECIFIERS_QUERY,
                    exports: luaQueries.EXPORT_QUERY,
                }
            };
        default: {
            const jsOrTs = lang === 'javascript' ? jsQueries : tsQueries;
            return {
                q: {
                    functions: jsOrTs.FUNCTION_QUERY,
                    calls: jsOrTs.CALL_QUERY,
                    imports: jsOrTs.IMPORT_QUERY,
                    importSpecifiers: jsOrTs.IMPORT_SPECIFIERS_QUERY,
                    exports: jsOrTs.EXPORT_QUERY,
                    defaultExports: jsOrTs.DEFAULT_EXPORT_QUERY,
                }
            };
        }
    }
}

function getQueries(lang: SupportedLanguage): CompiledQueries {
    const cached = queryCache.get(lang);
    if (cached) return cached;

    const { Query } = require('web-tree-sitter');
    const language = ParserManager.get().getLanguage(lang);
    const { q, extras } = getQueriesForLang(lang);

    const queries: CompiledQueries = {
        functions: new Query(language, q.functions),
        calls: new Query(language, q.calls),
        imports: new Query(language, q.imports),
        importSpecifiers: new Query(language, q.importSpecifiers),
        exports: new Query(language, q.exports),
        defaultExports: q.defaultExports ? new Query(language, q.defaultExports) : undefined,
    };

    if (extras) {
        if (extras.decoratedFunctions) queries.decoratedFunctions = new Query(language, extras.decoratedFunctions);
        if (extras.decorators) queries.decorators = new Query(language, extras.decorators);
        if (extras.allExport) queries.allExport = new Query(language, extras.allExport);
    }

    queryCache.set(lang, queries);
    return queries;
}

// ─── Python keyword blacklist ────────────────────────────────────────────

const PYTHON_BLACKLIST = new Set(KEYWORD_BLACKLISTS.python as readonly string[]);
const JS_BLACKLIST = new Set(KEYWORD_BLACKLISTS.javascript as readonly string[]);
const GO_BLACKLIST = new Set(KEYWORD_BLACKLISTS.go as readonly string[]);
const RUST_BLACKLIST = new Set(KEYWORD_BLACKLISTS.rust as readonly string[]);
const C_BLACKLIST = new Set(KEYWORD_BLACKLISTS.c as readonly string[]);
const SWIFT_BLACKLIST = new Set(KEYWORD_BLACKLISTS.swift as readonly string[]);
const JAVA_BLACKLIST = new Set(KEYWORD_BLACKLISTS.java as readonly string[]);
const LUA_BLACKLIST = new Set(KEYWORD_BLACKLISTS.lua as readonly string[]);

function isBlacklisted(callee: string, lang: SupportedLanguage): boolean {
    const simpleName = callee.split('.')[0];
    switch (lang) {
        case 'python': return PYTHON_BLACKLIST.has(simpleName);
        case 'go': return GO_BLACKLIST.has(simpleName);
        case 'rust': return RUST_BLACKLIST.has(simpleName);
        case 'c': case 'cpp': return C_BLACKLIST.has(simpleName);
        case 'swift': return SWIFT_BLACKLIST.has(simpleName);
        case 'java': return JAVA_BLACKLIST.has(simpleName);
        case 'lua': return LUA_BLACKLIST.has(simpleName);
        default: return JS_BLACKLIST.has(simpleName);
    }
}

// ─── HTTP detection helpers ──────────────────────────────────────────────

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function normalizeEndpoint(endpoint: string): string {
    try {
        if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
            const url = new URL(endpoint);
            return url.pathname;
        }
        const fstringMatch = endpoint.match(/\{[^}]+\}(.+)/);
        if (fstringMatch && fstringMatch[1]) {
            endpoint = fstringMatch[1];
        }
        endpoint = endpoint.replace(/\$\{[^}]+\}/g, ':param');
        if (!endpoint.startsWith('/')) {
            endpoint = '/' + endpoint;
        }
        return endpoint.replace(/\/+$/, '') || '/';
    } catch {
        return endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    }
}

function isValidHttpPath(normalizedPath: string, originalEndpoint: string): boolean {
    // Real HTTP paths start with / or http in source code.
    // dict.get('key'), data.get('field') etc. don't — reject them early.
    if (!originalEndpoint.startsWith('/') && !originalEndpoint.startsWith('http')) {
        return false;
    }
    if (!normalizedPath.includes('/')) return false;
    const segments = normalizedPath.split('/').filter(s => s.length > 0);
    if (segments.length === 0) return true; // "/" is valid
    return true;
}

// ─── Export detection per language ────────────────────────────────────────

function determineExported(funcName: string, lang: SupportedLanguage, exportedNames: Set<string>): boolean {
    switch (lang) {
        case 'python':
            // Python: non-underscore or explicitly in __all__
            return !funcName.startsWith('_') || exportedNames.has(funcName);
        case 'go':
            // Go: capitalized first letter = exported
            return funcName.length > 0 && funcName[0] === funcName[0].toUpperCase() && funcName[0] !== funcName[0].toLowerCase();
        case 'c': case 'cpp':
            // C/C++: no module system — all functions effectively exported
            return true;
        case 'lua':
            // Lua: global functions are exported, local functions are not
            return exportedNames.has(funcName);
        case 'swift':
            // Swift: default is internal (module-visible), treat as exported
            return true;
        case 'java':
            // Java: ideally check for 'public' modifier, but query returns all methods
            // exportedNames from the export query contains all methods — treat as exported
            return true;
        case 'rust':
            // Rust: pub functions are in exportedNames from the export query
            return exportedNames.has(funcName);
        default:
            // JS/TS: explicit export syntax
            return exportedNames.has(funcName);
    }
}

// ─── Core extraction: find all calls within a function body ──────────────

/** Node types that represent member/field access (language-dependent) */
const MEMBER_TYPES = new Set([
    'member_expression',    // JS/TS
    'attribute',            // Python
    'selector_expression',  // Go
    'field_expression',     // Rust, C, C++
    'navigation_expression', // Swift
    'scoped_identifier',    // Rust (a::b)
    'qualified_identifier', // C++ (ns::func)
    'field_access',         // Java (a.b)
]);

function getCallNodeTypes(lang: SupportedLanguage): string[] {
    if (lang === 'python' || lang === 'lua') return ['call'];
    if (lang === 'java') return ['method_invocation', 'object_creation_expression'];
    return ['call_expression', 'new_expression'];
}

/**
 * Extract the property/method name from a member-like node.
 * Different languages use different field names for the property.
 */
function getMemberPropertyName(node: Node): string | null {
    return node.childForFieldName('property')?.text    // JS/TS member_expression
        || node.childForFieldName('attribute')?.text   // Python attribute
        || node.childForFieldName('field')?.text       // Go selector, Rust/C field, Java field_access, Lua variable
        || node.childForFieldName('name')?.text        // Rust/C++ scoped/qualified
        || null;
}

function extractCallsInNode(bodyNode: Node, lang: SupportedLanguage): {
    calls: string[];
    llmCalls: CallInfo[];
    httpCalls: HttpCallInfo[];
} {
    const calls: string[] = [];
    const llmCalls: CallInfo[] = [];
    const httpCalls: HttpCallInfo[] = [];

    const callTypes = getCallNodeTypes(lang);
    const callNodes = bodyNode.descendantsOfType(callTypes);

    for (const callNode of callNodes) {
        let callee = '';
        let memberNode: Node | null = null; // The member expression node for HTTP detection

        if (lang === 'java') {
            // Java method_invocation has object + name fields (not function)
            const nameNode = callNode.childForFieldName('name');
            const objectNode = callNode.childForFieldName('object');
            if (!nameNode) continue;

            if (objectNode) {
                callee = getMemberChain(objectNode) + '.' + nameNode.text;
                memberNode = callNode; // Use the invocation itself for HTTP detection
            } else {
                callee = nameNode.text;
            }
        } else if (lang === 'lua') {
            // Lua: call has function: (variable ...) with name or table+field
            const funcNode = callNode.childForFieldName('function');
            if (!funcNode) continue;

            const nameNode = funcNode.childForFieldName('name');
            const tableNode = funcNode.childForFieldName('table');
            const fieldNode = funcNode.childForFieldName('field');
            if (tableNode && fieldNode) {
                callee = tableNode.text + '.' + fieldNode.text;
                memberNode = funcNode;
            } else if (nameNode) {
                callee = nameNode.text;
            }
        } else {
            // Standard: call_expression has 'function' field, new_expression has 'constructor'
            const funcNode = callNode.childForFieldName('function')
                || callNode.childForFieldName('constructor');
            if (!funcNode) continue;

            if (funcNode.type === 'identifier' || funcNode.type === 'field_identifier') {
                callee = funcNode.text;
            } else if (MEMBER_TYPES.has(funcNode.type)) {
                callee = getMemberChain(funcNode);
                memberNode = funcNode;
            }
        }

        if (!callee || isBlacklisted(callee, lang)) continue;

        if (!calls.includes(callee)) {
            calls.push(callee);
        }

        // Check for LLM calls (append '(' for patterns that require it)
        if (isLLMRelatedCall(callee)) {
            llmCalls.push({
                callee,
                line: callNode.startPosition.row + 1,
                isLLMCall: true,
            });
        }

        // Check for HTTP client calls (e.g., client.post('/path'), requests.get('/path'))
        if (memberNode) {
            let methodName: string | null;
            if (lang === 'java') {
                methodName = callNode.childForFieldName('name')?.text || null;
            } else {
                methodName = getMemberPropertyName(memberNode);
            }

            if (methodName && HTTP_METHODS.has(methodName.toLowerCase())) {
                const args = callNode.childForFieldName('arguments');
                const firstArg = args?.namedChildren[0];
                let endpoint = '';

                if (firstArg) {
                    // Accept various string literal types across languages
                    const stringTypes = ['string', 'template_string', 'interpreted_string_literal',
                                        'raw_string_literal', 'string_literal'];
                    if (stringTypes.includes(firstArg.type)) {
                        const content = firstArg.namedChildren.find(
                            c => c.type === 'string_fragment' || c.type === 'string_content'
                        );
                        endpoint = content?.text || firstArg.text.replace(/^['"`]|['"`]$/g, '');
                    }
                }

                if (endpoint) {
                    const normalizedPath = normalizeEndpoint(endpoint);
                    if (isValidHttpPath(normalizedPath, endpoint)) {
                        httpCalls.push({
                            file: '',  // Filled in by caller
                            line: callNode.startPosition.row + 1,
                            function: '', // Filled in by caller
                            method: methodName.toUpperCase(),
                            endpoint,
                            normalizedPath,
                        });
                    }
                }
            }
        }
    }

    return { calls, llmCalls, httpCalls };
}

// ─── Extract function body node ──────────────────────────────────────────

function getFunctionBody(node: Node, nodeType: string): Node | null {
    if (nodeType === 'method') {
        // JS/TS method_definition, Go method_declaration, Java method_declaration
        return node.childForFieldName('body')
            || node.namedChildren.find(c =>
                c.type === 'statement_block' || c.type === 'block' ||
                c.type === 'compound_statement' || c.type === 'constructor_body')
            || null;
    }
    if (nodeType === 'var_func') {
        // JS/TS variable_declarator → the value (arrow_function/function_expression) has a body
        const funcBody = node.childForFieldName('value');
        return funcBody?.childForFieldName('body') || null;
    }
    // function_declaration / function_definition / function_item
    return node.childForFieldName('body') || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR 1: Call Graph (for call-graph-extractor.ts → local updates)
// ═══════════════════════════════════════════════════════════════════════════

export function extractCallGraphFromTree(
    tree: Tree,
    lang: SupportedLanguage,
    filePath: string,
): {
    functions: Map<string, FunctionInfo>;
    callGraph: Map<string, string[]>;
    llmCalls: Map<string, CallInfo[]>;
    imports: string[];
} {
    const functions = new Map<string, FunctionInfo>();
    const callGraph = new Map<string, string[]>();
    const llmCalls = new Map<string, CallInfo[]>();
    const imports: string[] = [];
    const queries = getQueries(lang);
    const root = tree.rootNode;

    // Extract imports
    const importMatches = queries.imports.matches(root);
    for (const match of importMatches) {
        const sourceCapture = match.captures.find(c => c.name === 'source');
        if (sourceCapture) {
            imports.push(sourceCapture.node.text);
        }
    }

    // Extract functions
    const funcMatches = queries.functions.matches(root);
    for (const match of funcMatches) {
        const nameCapture = match.captures.find(c => c.name === 'name');
        if (!nameCapture) continue;

        const funcName = nameCapture.node.text;
        // Use the outermost capture (func/var_func/method) for the function range
        const funcCapture = match.captures.find(c => c.name === 'func' || c.name === 'var_func' || c.name === 'method');
        const funcNode = funcCapture?.node || match.captures[0].node;
        const paramsCapture = match.captures.find(c => c.name === 'params');

        functions.set(funcName, {
            name: funcName,
            startLine: funcNode.startPosition.row + 1,
            endLine: funcNode.endPosition.row + 1,
            decorators: [],
            isAsync: isAsync(funcNode),
            params: getParams(paramsCapture?.node || null, lang),
        });

        // Extract calls within this function's body
        const body = getFunctionBody(funcNode, match.captures.find(c => c.name === 'func' || c.name === 'method' || c.name === 'var_func')?.name || 'func');
        if (body) {
            const { calls, llmCalls: funcLlmCalls } = extractCallsInNode(body, lang);
            callGraph.set(funcName, calls);
            if (funcLlmCalls.length > 0) {
                llmCalls.set(funcName, funcLlmCalls);
            }
        } else {
            callGraph.set(funcName, []);
        }
    }

    // For Python: also handle decorated functions
    if (lang === 'python' && queries.decoratedFunctions) {
        const decoratedMatches = queries.decoratedFunctions.matches(root);
        for (const match of decoratedMatches) {
            const nameCapture = match.captures.find(c => c.name === 'name');
            if (!nameCapture) continue;

            const funcName = nameCapture.node.text;
            if (functions.has(funcName)) continue; // Already found by direct query

            const outerNode = match.captures.find(c => c.name === 'decorated_func')?.node;
            const paramsCapture = match.captures.find(c => c.name === 'params');
            const decoratorCapture = match.captures.find(c => c.name === 'decorator');

            if (outerNode) {
                functions.set(funcName, {
                    name: funcName,
                    startLine: outerNode.startPosition.row + 1,
                    endLine: outerNode.endPosition.row + 1,
                    decorators: decoratorCapture ? [decoratorCapture.node.text] : [],
                    isAsync: isAsync(outerNode),
                    params: getParams(paramsCapture?.node || null, lang),
                });

                // Find the function_definition child for body extraction
                const funcDef = outerNode.childForFieldName('definition');
                const body = funcDef?.childForFieldName('body') || null;
                if (body) {
                    const { calls, llmCalls: funcLlmCalls } = extractCallsInNode(body, lang);
                    callGraph.set(funcName, calls);
                    if (funcLlmCalls.length > 0) {
                        llmCalls.set(funcName, funcLlmCalls);
                    }
                } else {
                    callGraph.set(funcName, []);
                }
            }
        }
    }

    return { functions, callGraph, llmCalls, imports };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR 2: File Structure (for repo-structure.ts → cross-batch context)
// ═══════════════════════════════════════════════════════════════════════════

export function extractFileStructureFromTree(
    tree: Tree,
    lang: SupportedLanguage,
    filePath: string,
): {
    functions: ExtractedFunctionDef[];
    exports: string[];
    imports: ImportInfo[];
    httpRouteHandlers: HttpRouteInfo[];
} {
    const functions: ExtractedFunctionDef[] = [];
    const exports: string[] = [];
    const imports: ImportInfo[] = [];
    const httpRouteHandlers: HttpRouteInfo[] = [];
    const exportedNames = new Set<string>();
    const queries = getQueries(lang);
    const root = tree.rootNode;

    // Extract exports first
    if (lang !== 'python') {
        const exportMatches = queries.exports.matches(root);
        for (const match of exportMatches) {
            const nameCapture = match.captures.find(c => c.name === 'name');
            if (nameCapture) {
                exportedNames.add(nameCapture.node.text);
            }
        }
        if (queries.defaultExports) {
            const defaultMatches = queries.defaultExports.matches(root);
            for (const match of defaultMatches) {
                const nameCapture = match.captures.find(c => c.name === 'name');
                if (nameCapture) {
                    exportedNames.add(nameCapture.node.text);
                }
                exportedNames.add('default');
            }
        }
    } else {
        // Python: check __all__, and treat non-underscore functions as exported
        if (queries.allExport) {
            const allMatches = queries.allExport.matches(root);
            for (const match of allMatches) {
                const nameCapture = match.captures.find(c => c.name === 'name');
                const itemsCapture = match.captures.find(c => c.name === 'items');
                if (nameCapture?.node.text === '__all__' && itemsCapture) {
                    // Extract string items from the list
                    const stringNodes = itemsCapture.node.descendantsOfType(['string']);
                    for (const s of stringNodes) {
                        const content = s.namedChildren.find(c => c.type === 'string_content');
                        if (content) exportedNames.add(content.text);
                    }
                }
            }
        }
    }

    // Extract imports with symbols
    const importSpecMatches = queries.importSpecifiers.matches(root);
    const importMap = new Map<string, string[]>(); // source → symbols
    for (const match of importSpecMatches) {
        const sourceCapture = match.captures.find(c => c.name === 'source');
        const symbolCapture = match.captures.find(c => c.name === 'symbol');
        if (sourceCapture) {
            const source = sourceCapture.node.text;
            const symbols = importMap.get(source) || [];
            if (symbolCapture) {
                symbols.push(symbolCapture.node.text);
            }
            importMap.set(source, symbols);
        }
    }
    for (const [source, symbols] of importMap) {
        imports.push({ source, symbols });
    }

    // Extract Python route handlers from decorators
    if (lang === 'python' && queries.decorators) {
        const decoratorMatches = queries.decorators.matches(root);
        for (const match of decoratorMatches) {
            const objCapture = match.captures.find(c => c.name === 'obj');
            const methodCapture = match.captures.find(c => c.name === 'method');
            const pathCapture = match.captures.find(c => c.name === 'path');

            if (objCapture && methodCapture && pathCapture) {
                const obj = objCapture.node.text;
                const method = methodCapture.node.text;
                if (ROUTER_OBJECT_NAMES.has(obj) && HTTP_METHODS.has(method.toLowerCase())) {
                    // Find the function this decorates
                    const decoratorNode = match.captures.find(c => c.name === 'decorator_call')?.node;
                    const decoratedDef = decoratorNode?.parent;
                    const funcDef = decoratedDef?.childForFieldName('definition');
                    const funcName = funcDef?.childForFieldName('name')?.text || 'unknown';

                    httpRouteHandlers.push({
                        file: filePath,
                        line: decoratorNode?.startPosition.row ? decoratorNode.startPosition.row + 1 : 0,
                        function: funcName,
                        method: method.toUpperCase(),
                        path: pathCapture.node.text,
                    });
                }
            }
        }
    }

    // Extract method-call route handlers (Express, Hono, Fastify, Gin, etc.)
    // Pattern: app.get('/path', handler) or router.post('/path', async (req, res) => {})
    // Only for non-Python languages (Python uses decorator detection above)
    if (lang !== 'python') {
        const routeCallTypes = getCallNodeTypes(lang);
        const routeCallNodes = root.descendantsOfType(routeCallTypes);

        for (const callNode of routeCallNodes) {
            const funcNode = callNode.childForFieldName('function')
                || callNode.childForFieldName('constructor');
            if (!funcNode || !MEMBER_TYPES.has(funcNode.type)) continue;

            const methodName = getMemberPropertyName(funcNode);
            if (!methodName || !HTTP_METHODS.has(methodName.toLowerCase())) continue;

            const objectNode = funcNode.childForFieldName('object');
            if (!objectNode) continue;
            const objectName = objectNode.type === 'identifier' ? objectNode.text : null;
            if (!objectName || !ROUTER_OBJECT_NAMES.has(objectName)) continue;

            // First arg must be a string literal (route path)
            const args = callNode.childForFieldName('arguments');
            const firstArg = args?.namedChildren[0];
            if (!firstArg) continue;

            const stringTypes = ['string', 'template_string', 'interpreted_string_literal',
                                'raw_string_literal', 'string_literal'];
            if (!stringTypes.includes(firstArg.type)) continue;

            const content = firstArg.namedChildren.find(
                c => c.type === 'string_fragment' || c.type === 'string_content'
            );
            const routePath = content?.text || firstArg.text.replace(/^['"`]|['"`]$/g, '');
            if (!routePath || !isValidHttpPath(routePath, routePath)) continue;

            // Handler name: second arg if identifier, else enclosing function
            const secondArg = args?.namedChildren[1];
            let handlerName = 'handler';
            if (secondArg?.type === 'identifier') {
                handlerName = secondArg.text;
            } else {
                const enclosing = findEnclosingFunction(callNode, lang);
                if (enclosing) handlerName = enclosing;
            }

            httpRouteHandlers.push({
                file: filePath,
                line: callNode.startPosition.row + 1,
                function: handlerName,
                method: methodName.toUpperCase(),
                path: routePath,
            });
        }
    }

    // Extract functions
    const funcMatches = queries.functions.matches(root);
    for (const match of funcMatches) {
        const nameCapture = match.captures.find(c => c.name === 'name');
        if (!nameCapture) continue;

        const funcName = nameCapture.node.text;
        // Use the outermost capture (func/var_func/method) for the function range
        const funcCapture = match.captures.find(c => c.name === 'func' || c.name === 'var_func' || c.name === 'method');
        const funcNode = funcCapture?.node || match.captures[0].node;
        const paramsCapture = match.captures.find(c => c.name === 'params');

        const body = getFunctionBody(funcNode, funcCapture?.name || 'func');
        const { calls, llmCalls, httpCalls } = body
            ? extractCallsInNode(body, lang)
            : { calls: [], llmCalls: [], httpCalls: [] };

        // Fill in file/function for HTTP calls
        for (const hc of httpCalls) {
            hc.file = filePath;
            hc.function = funcName;
        }

        const isExported = determineExported(funcName, lang, exportedNames);

        // hasLLMCall: true if direct LLM API call detected OR if any callee name matches
        // LLM identifier patterns (provider names like openai, gemini, etc.)
        // Note: do NOT check full body text — matches docstrings/string literals (false positives)
        const hasLLM = llmCalls.length > 0
            || calls.some(c => mightContainLLM(c));

        functions.push({
            name: funcName,
            line: funcNode.startPosition.row + 1,
            calls,
            isExported,
            hasLLMCall: hasLLM,
            params: getParams(paramsCapture?.node || null, lang),
            isAsync: isAsync(funcNode),
            httpCalls,
        });

        if (isExported && !exports.includes(funcName)) {
            exports.push(funcName);
        }
    }

    // For Python: also handle decorated functions not caught by basic query
    if (lang === 'python' && queries.decoratedFunctions) {
        const existingNames = new Set(functions.map(f => f.name));
        const decoratedMatches = queries.decoratedFunctions.matches(root);
        for (const match of decoratedMatches) {
            const nameCapture = match.captures.find(c => c.name === 'name');
            if (!nameCapture) continue;
            const funcName = nameCapture.node.text;
            if (existingNames.has(funcName)) continue;

            const outerNode = match.captures.find(c => c.name === 'decorated_func')?.node;
            const paramsCapture = match.captures.find(c => c.name === 'params');

            if (!outerNode) continue;

            const funcDef = outerNode.childForFieldName('definition');
            const body = funcDef?.childForFieldName('body') || null;
            const { calls, llmCalls, httpCalls } = body
                ? extractCallsInNode(body, lang)
                : { calls: [], llmCalls: [], httpCalls: [] };

            for (const hc of httpCalls) {
                hc.file = filePath;
                hc.function = funcName;
            }

            // Decorated functions with route handlers are always exported
            const hasRouteDecorator = httpRouteHandlers.some(h => h.function === funcName);
            const isExported = !funcName.startsWith('_') || exportedNames.has(funcName) || hasRouteDecorator;

            const hasLLM = llmCalls.length > 0
                || calls.some(c => mightContainLLM(c));

            functions.push({
                name: funcName,
                line: outerNode.startPosition.row + 1,
                calls,
                isExported,
                hasLLMCall: hasLLM,
                params: getParams(paramsCapture?.node || null, lang),
                isAsync: isAsync(outerNode),
                httpCalls,
            });

            if (isExported && !exports.includes(funcName)) {
                exports.push(funcName);
            }
        }
    }

    // File-convention route detection (Next.js App Router, SvelteKit, etc.)
    // Exported functions named GET/POST/etc. in route files become route handlers
    const routeConvention = matchRouteFileConvention(filePath);
    if (routeConvention) {
        const routeExportSet = new Set(routeConvention.exportNames);
        for (const exp of exports) {
            if (routeExportSet.has(exp) || routeExportSet.has(exp.toUpperCase())) {
                const routePath = routeConvention.deriveRoute(filePath);
                if (routePath) {
                    const method = exp.toUpperCase();
                    httpRouteHandlers.push({
                        file: filePath,
                        line: functions.find(f => f.name === exp)?.line || 0,
                        function: exp,
                        method: HTTP_METHODS.has(method.toLowerCase()) ? method : 'POST',
                        path: routePath,
                    });
                }
            }
        }
    }

    return { functions, exports, imports, httpRouteHandlers };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR 3: File Analysis (for static-analyzer.ts → metadata enrichment)
// ═══════════════════════════════════════════════════════════════════════════

export function extractFileAnalysisFromTree(
    tree: Tree,
    lang: SupportedLanguage,
    filePath: string,
    code: string,
    isLLMIdentifier: (name: string) => boolean,
): {
    locations: CodeLocationInfo[];
    imports: string[];
    exports: string[];
    llmRelatedVariables: Set<string>;
} {
    const locations: CodeLocationInfo[] = [];
    const imports: string[] = [];
    const exports: string[] = [];
    const llmRelatedVariables = new Set<string>();
    const queries = getQueries(lang);
    const root = tree.rootNode;

    // Extract imports
    const importMatches = queries.imports.matches(root);
    for (const match of importMatches) {
        const sourceCapture = match.captures.find(c => c.name === 'source');
        if (sourceCapture) {
            const source = sourceCapture.node.text;
            imports.push(source);
            if (isLLMIdentifier(source)) {
                llmRelatedVariables.add(source);
            }
        }
    }

    // Extract exports
    if (lang !== 'python') {
        const exportMatches = queries.exports.matches(root);
        for (const match of exportMatches) {
            const nameCapture = match.captures.find(c => c.name === 'name');
            if (nameCapture) exports.push(nameCapture.node.text);
        }
    }

    // Extract functions as locations
    const funcMatches = queries.functions.matches(root);
    for (const match of funcMatches) {
        const nameCapture = match.captures.find(c => c.name === 'name');
        if (!nameCapture) continue;
        const funcName = nameCapture.node.text;
        const funcCapture = match.captures.find(c => c.name === 'func' || c.name === 'var_func' || c.name === 'method');
        const funcNode = funcCapture?.node || match.captures[0].node;

        locations.push({
            line: funcNode.startPosition.row + 1,
            column: funcNode.startPosition.column,
            type: 'step',
            description: `Function ${funcName}`,
            function: funcName,
        });
    }

    // Track LLM-related variables through imports (like old analyzer)
    const importSpecMatches = queries.importSpecifiers.matches(root);
    for (const match of importSpecMatches) {
        const sourceCapture = match.captures.find(c => c.name === 'source');
        const symbolCapture = match.captures.find(c => c.name === 'symbol');
        if (sourceCapture && isLLMIdentifier(sourceCapture.node.text)) {
            if (symbolCapture) {
                llmRelatedVariables.add(symbolCapture.node.text);
            }
        }
    }

    // Track LLM client variables through `new` expressions and assignments
    // e.g., `const client = new OpenAI()` → track 'client' as LLM-related
    // e.g., `model = genai.GenerativeModel(...)` → track 'model'
    for (const child of root.descendantsOfType(['variable_declarator', 'assignment_expression', 'assignment'])) {
        const nameNode = child.childForFieldName('name') || child.childForFieldName('left');
        const valueNode = child.childForFieldName('value') || child.childForFieldName('right');
        if (!nameNode || !valueNode) continue;

        const varName = nameNode.type === 'identifier' ? nameNode.text : null;
        if (!varName) continue;

        // For `new X()`, extract the constructor name
        if (valueNode.type === 'new_expression') {
            const ctorNode = valueNode.childForFieldName('constructor');
            if (ctorNode) {
                const ctorName = ctorNode.type === 'identifier' ? ctorNode.text : getMemberChain(ctorNode);
                if (isLLMIdentifier(ctorName) || llmRelatedVariables.has(ctorName)) {
                    llmRelatedVariables.add(varName);
                }
            }
        }
        // For `x = llm_module.Client(...)` or `x = genai.GenerativeModel(...)`
        else if (valueNode.type === 'call_expression' || valueNode.type === 'call') {
            const funcNode = valueNode.childForFieldName('function');
            if (funcNode) {
                const callText = funcNode.type === 'identifier' ? funcNode.text : getMemberChain(funcNode);
                if (isLLMIdentifier(callText) || isLLMRelatedCall(callText) || llmRelatedVariables.has(callText)) {
                    llmRelatedVariables.add(varName);
                }
            }
        }
    }

    // Extract calls as locations (deduplicate by line:callee)
    const seenLocations = new Set<string>();
    const callMatches = queries.calls.matches(root);
    for (const match of callMatches) {
        const calleeCapture = match.captures.find(c => c.name === 'callee');
        if (!calleeCapture) continue;

        const callee = calleeCapture.node.type === 'identifier'
            ? calleeCapture.node.text
            : getMemberChain(calleeCapture.node);

        if (!callee || isBlacklisted(callee, lang)) continue;

        const callNode = match.captures.find(c => c.name === 'call')?.node || calleeCapture.node;
        const enclosingFunc = findEnclosingFunction(callNode);

        // Check: direct LLM API call pattern, OR callee uses tracked LLM variable,
        // OR callee matches broad LLM identifier patterns (matching old analyzer behavior)
        const isDirectLLMCall = isLLMRelatedCall(callee);
        const matchesLLMIdentifier = isLLMIdentifier(callee);

        // Variable tracking: check if callee object (not root namespace) is LLM-related
        // e.g., if 'client' is tracked from `const client = new OpenAI()`,
        // then `client.chat.completions.create` matches via 'client'
        const parts = callee.split('.');
        const hasLLMVariable = parts.length > 1 && llmRelatedVariables.has(parts[0])
            && !['vscode', 'window', 'document', 'console', 'process', 'module', 'exports'].includes(parts[0]);

        if (isDirectLLMCall || hasLLMVariable || matchesLLMIdentifier) {
            const line = callNode.startPosition.row + 1;
            const locKey = `${line}:${callee}`;
            if (seenLocations.has(locKey)) continue;
            seenLocations.add(locKey);
            locations.push({
                line,
                column: callNode.startPosition.column,
                type: 'llm',
                description: `LLM call: ${callee}`,
                function: enclosingFunc,
            });
        }
    }

    return { locations, imports, exports, llmRelatedVariables };
}
