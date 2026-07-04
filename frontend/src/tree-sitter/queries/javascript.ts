/**
 * Tree-sitter S-expression queries for JavaScript/JSX.
 * These are used by extractors.ts to find functions, calls, imports, exports, etc.
 */

/** Function declarations and arrow/expression functions assigned to variables */
export const FUNCTION_QUERY = `
    (function_declaration
        name: (identifier) @name) @func

    (variable_declarator
        name: (identifier) @name
        value: [(function_expression) (arrow_function)] @func_body) @var_func

    (method_definition
        name: (property_identifier) @name) @method
`;

/** All function calls — simple identifiers, member expression chains, and new expressions */
export const CALL_QUERY = `
    (call_expression
        function: (identifier) @callee) @call

    (call_expression
        function: (member_expression) @callee) @call

    (new_expression
        constructor: (identifier) @callee) @call

    (new_expression
        constructor: (member_expression) @callee) @call
`;

/** Import declarations */
export const IMPORT_QUERY = `
    (import_statement
        source: (string (string_fragment) @source)) @import
`;

/** Export declarations */
export const EXPORT_QUERY = `
    (export_statement
        declaration: (function_declaration
            name: (identifier) @name)) @export_func

    (export_statement
        declaration: (lexical_declaration
            (variable_declarator
                name: (identifier) @name))) @export_var

    (export_statement
        (export_clause
            (export_specifier
                name: (identifier) @name))) @export_spec
`;

/** Default export */
export const DEFAULT_EXPORT_QUERY = `
    (export_statement "default" (identifier) @name) @default_export

    (export_statement "default"
        (function_declaration
            name: (identifier) @name)) @default_export_func
`;

/** Named import specifiers (for cross-file resolution) */
export const IMPORT_SPECIFIERS_QUERY = `
    (import_statement
        (import_clause
            (named_imports
                (import_specifier
                    name: (identifier) @symbol)))
        source: (string (string_fragment) @source))

    (import_statement
        (import_clause
            (namespace_import (identifier) @symbol))
        source: (string (string_fragment) @source))

    (import_statement
        (import_clause
            (identifier) @symbol)
        source: (string (string_fragment) @source))
`;
