/**
 * Tree-sitter helper utilities for working with syntax nodes.
 */

import type { Node } from 'web-tree-sitter';

/**
 * Extract full dotted member expression chain from a tree-sitter node.
 * e.g., `client.chat.completions.create` → "client.chat.completions.create"
 *
 * Works for both JS/TS (member_expression) and Python (attribute) nodes.
 */
export function getMemberChain(node: Node): string {
    // node.text gives the full source text which includes whitespace/newlines
    // Clean it up for reliable matching
    return node.text.replace(/\s+/g, '').replace(/\(.*$/, '');
}

/**
 * Get function parameter names from a parameters/formal_parameters node.
 * Strips type annotations, default values, and `self`/`cls` for Python.
 */
export function getParams(paramsNode: Node | null, language: string): string[] {
    if (!paramsNode) return [];
    const params: string[] = [];

    for (const child of paramsNode.namedChildren) {
        let name: string | null = null;

        switch (child.type) {
            // JS/TS
            case 'identifier':
                name = child.text;
                break;
            case 'required_parameter':
            case 'optional_parameter': {
                const pattern = child.childForFieldName('pattern');
                name = pattern?.text || child.namedChildren[0]?.text || null;
                break;
            }
            case 'assignment_pattern':
            case 'rest_element': {
                const left = child.namedChildren[0];
                name = left?.text || null;
                break;
            }
            // Python
            case 'typed_parameter':
            case 'typed_default_parameter':
            case 'default_parameter': {
                const nameNode = child.childForFieldName('name') || child.namedChildren[0];
                name = nameNode?.text || null;
                break;
            }
            case 'dictionary_splat_pattern':
            case 'list_splat_pattern': {
                name = child.namedChildren[0]?.text || null;
                break;
            }
            // Go: parameter_declaration has name field
            // C/C++: parameter_declaration has declarator field
            case 'parameter_declaration': {
                const nameNode = child.childForFieldName('name');
                if (nameNode) {
                    name = nameNode.text;
                } else {
                    const decl = child.childForFieldName('declarator');
                    if (decl) {
                        name = extractCFunctionName(decl);
                    }
                }
                break;
            }
            // Rust: parameter has pattern + type
            case 'parameter': {
                const pat = child.childForFieldName('pattern');
                name = pat?.text || child.namedChildren[0]?.text || null;
                break;
            }
            // Java: formal_parameter has name and dimensions
            case 'formal_parameter':
            case 'spread_parameter': {
                const nameNode = child.childForFieldName('name');
                name = nameNode?.text || null;
                break;
            }
            default: {
                // Fall back to first named child or the text itself
                name = child.namedChildren[0]?.text || child.text?.split(/[=:,]/)[0]?.trim() || null;
                break;
            }
        }

        if (name && name !== 'self' && name !== 'cls') {
            params.push(name);
        }
    }

    return params;
}

/**
 * Check if a function node is async.
 * Works for both JS/TS and Python (both use 'async' keyword before the function).
 */
export function isAsync(node: Node): boolean {
    // Check for 'async' keyword in the node's text prefix
    const text = node.text.trimStart();
    return text.startsWith('async ') || text.startsWith('async\n');
}

/**
 * Find the name of the enclosing function for a given node.
 * Walks up the parent chain until a function definition is found.
 * Returns 'global' if no enclosing function exists.
 */
export function findEnclosingFunction(node: Node): string {
    let current: Node | null = node.parent;
    while (current) {
        switch (current.type) {
            // JS/TS
            case 'function_declaration':
            case 'function_definition':  // Python, C, C++
            case 'function_item':        // Rust
            case 'function_definition_statement':        // Lua (global)
            case 'local_function_definition_statement':  // Lua (local)
            {
                const nameNode = current.childForFieldName('name');
                if (nameNode) return nameNode.text;
                // C: name is inside nested declarators
                const declarator = current.childForFieldName('declarator');
                if (declarator) {
                    const name = extractCFunctionName(declarator);
                    if (name) return name;
                }
                break;
            }
            case 'method_definition':     // JS/TS
            case 'method_declaration':    // Go, Java
            case 'constructor_declaration': // Java
            {
                const nameNode = current.childForFieldName('name');
                if (nameNode) return nameNode.text;
                break;
            }
            case 'arrow_function':
            case 'function_expression': {
                if (current.parent?.type === 'variable_declarator') {
                    const nameNode = current.parent.childForFieldName('name');
                    if (nameNode) return nameNode.text;
                }
                break;
            }
        }
        // Python decorated_definition
        if (current.type === 'decorated_definition') {
            const funcDef = current.childForFieldName('definition');
            if (funcDef) {
                const nameNode = funcDef.childForFieldName('name');
                if (nameNode) return nameNode.text;
            }
        }
        current = current.parent;
    }
    return 'global';
}

/**
 * Extract function name from a C/C++ declarator chain.
 * C function names are nested inside function_declarator, possibly
 * wrapped in pointer_declarator or reference_declarator.
 */
function extractCFunctionName(declarator: Node): string | null {
    if (declarator.type === 'identifier') return declarator.text;
    if (declarator.type === 'field_identifier') return declarator.text;
    if (declarator.type === 'function_declarator') {
        const inner = declarator.childForFieldName('declarator');
        if (inner) return extractCFunctionName(inner);
    }
    if (declarator.type === 'pointer_declarator' || declarator.type === 'reference_declarator') {
        const inner = declarator.childForFieldName('declarator');
        if (inner) return extractCFunctionName(inner);
    }
    if (declarator.type === 'qualified_identifier') {
        const nameNode = declarator.childForFieldName('name');
        if (nameNode) return nameNode.text;
    }
    return null;
}

/**
 * Get the start and end line numbers (1-indexed) for a function node.
 * Handles both direct function nodes and decorated definitions.
 */
export function getFunctionRange(node: Node): { startLine: number; endLine: number } {
    return {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
    };
}
