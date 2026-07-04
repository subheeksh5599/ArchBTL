/**
 * Tree-sitter S-expression queries for C.
 * C has no module/export system — all functions are effectively exported.
 */

/** Function definitions */
export const FUNCTION_QUERY = `
    (function_definition
        declarator: (function_declarator
            declarator: (identifier) @name
            parameters: (parameter_list) @params)) @func

    (function_definition
        declarator: (pointer_declarator
            declarator: (function_declarator
                declarator: (identifier) @name
                parameters: (parameter_list) @params))) @func
`;

/** Function calls — direct and via struct member access */
export const CALL_QUERY = `
    (call_expression
        function: (identifier) @callee) @call

    (call_expression
        function: (field_expression) @callee) @call
`;

/** #include directives */
export const IMPORT_QUERY = `
    (preproc_include
        path: (string_literal) @source) @import

    (preproc_include
        path: (system_lib_string) @source) @import
`;

/** All functions are "exported" in C (no module system) */
export const EXPORT_QUERY = `
    (function_definition
        declarator: (function_declarator
            declarator: (identifier) @name)) @func
`;

/** Include specifiers — C includes whole files, no specific symbols */
export const IMPORT_SPECIFIERS_QUERY = `
    (preproc_include
        path: (string_literal) @source) @import

    (preproc_include
        path: (system_lib_string) @source) @import
`;
