/**
 * Tree-sitter S-expression queries for Rust.
 * Rust exports via `pub` visibility modifier.
 */

/** Function declarations (including in impl blocks) */
export const FUNCTION_QUERY = `
    (function_item
        name: (identifier) @name
        parameters: (parameters) @params) @func
`;

/** Function calls — identifiers, field expressions (a.b()), scoped (a::b()) */
export const CALL_QUERY = `
    (call_expression
        function: (identifier) @callee) @call

    (call_expression
        function: (field_expression) @callee) @call

    (call_expression
        function: (scoped_identifier) @callee) @call
`;

/** Use declarations (imports) */
export const IMPORT_QUERY = `
    (use_declaration
        argument: (scoped_identifier) @source) @import

    (use_declaration
        argument: (use_as_clause
            path: (scoped_identifier) @source)) @import

    (use_declaration
        argument: (use_as_clause
            path: (identifier) @source)) @import

    (use_declaration
        argument: (scoped_use_list
            path: (scoped_identifier) @source)) @import

    (use_declaration
        argument: (scoped_use_list
            path: (identifier) @source)) @import
`;

/** Public function exports */
export const EXPORT_QUERY = `
    (function_item
        (visibility_modifier)
        name: (identifier) @name) @func
`;

/** Import specifiers — specific symbols from use statements */
export const IMPORT_SPECIFIERS_QUERY = `
    (use_declaration
        argument: (scoped_identifier
            path: (identifier) @source
            name: (identifier) @symbol))

    (use_declaration
        argument: (scoped_identifier
            path: (scoped_identifier) @source
            name: (identifier) @symbol))

    (use_declaration
        argument: (scoped_use_list
            path: (identifier) @source
            list: (use_list
                (identifier) @symbol)))

    (use_declaration
        argument: (scoped_use_list
            path: (scoped_identifier) @source
            list: (use_list
                (identifier) @symbol)))
`;
