/**
 * Tree-sitter S-expression queries for Go.
 * Go exports are determined by capitalization (uppercase = exported).
 */

/** Function and method declarations */
export const FUNCTION_QUERY = `
    (function_declaration
        name: (identifier) @name
        parameters: (parameter_list) @params) @func

    (method_declaration
        name: (field_identifier) @name
        parameters: (parameter_list) @params) @method
`;

/** Function calls — simple identifiers and selector expressions (a.b()) */
export const CALL_QUERY = `
    (call_expression
        function: (identifier) @callee) @call

    (call_expression
        function: (selector_expression) @callee) @call
`;

/** Import declarations */
export const IMPORT_QUERY = `
    (import_spec
        path: (interpreted_string_literal) @source) @import
`;

/**
 * Export query — Go exports via capitalization, not syntax.
 * Returns all functions; extractor code checks first letter.
 */
export const EXPORT_QUERY = `
    (function_declaration
        name: (identifier) @name) @func

    (method_declaration
        name: (field_identifier) @name) @method
`;

/** Import specifiers — Go imports entire packages */
export const IMPORT_SPECIFIERS_QUERY = `
    (import_spec
        path: (interpreted_string_literal) @source)

    (import_spec
        name: (package_identifier) @symbol
        path: (interpreted_string_literal) @source)
`;
