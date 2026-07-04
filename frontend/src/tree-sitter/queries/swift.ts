/**
 * Tree-sitter S-expression queries for Swift.
 * Swift functions are internal (module-visible) by default.
 */

/** Function declarations */
export const FUNCTION_QUERY = `
    (function_declaration
        name: (simple_identifier) @name) @func
`;

/** Function calls */
export const CALL_QUERY = `
    (call_expression
        (simple_identifier) @callee) @call

    (call_expression
        (navigation_expression) @callee) @call
`;

/** Import declarations */
export const IMPORT_QUERY = `
    (import_declaration
        (identifier) @source) @import
`;

/** All functions treated as exported (Swift default is internal) */
export const EXPORT_QUERY = `
    (function_declaration
        name: (simple_identifier) @name) @func
`;

/** Import specifiers — Swift imports entire modules */
export const IMPORT_SPECIFIERS_QUERY = `
    (import_declaration
        (identifier) @source) @import
`;
