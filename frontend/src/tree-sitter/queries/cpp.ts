/**
 * Tree-sitter S-expression queries for C++.
 * Extends C with classes, namespaces, templates.
 */

/** Function definitions — free functions and methods */
export const FUNCTION_QUERY = `
    (function_definition
        declarator: (function_declarator
            declarator: (identifier) @name
            parameters: (parameter_list) @params)) @func

    (function_definition
        declarator: (function_declarator
            declarator: (qualified_identifier
                name: (identifier) @name)
            parameters: (parameter_list) @params)) @func

    (function_definition
        declarator: (pointer_declarator
            declarator: (function_declarator
                declarator: (identifier) @name
                parameters: (parameter_list) @params))) @func

    (function_definition
        declarator: (reference_declarator
            (function_declarator
                declarator: (identifier) @name
                parameters: (parameter_list) @params))) @func
`;

/** Function calls — direct, member (a.b()), scoped (ns::func()), pointer (a->b()) */
export const CALL_QUERY = `
    (call_expression
        function: (identifier) @callee) @call

    (call_expression
        function: (field_expression) @callee) @call

    (call_expression
        function: (qualified_identifier) @callee) @call
`;

/** Include directives and using declarations */
export const IMPORT_QUERY = `
    (preproc_include
        path: (string_literal) @source) @import

    (preproc_include
        path: (system_lib_string) @source) @import
`;

/** All non-static functions are effectively exported */
export const EXPORT_QUERY = `
    (function_definition
        declarator: (function_declarator
            declarator: (identifier) @name)) @func

    (function_definition
        declarator: (function_declarator
            declarator: (qualified_identifier
                name: (identifier) @name))) @func
`;

/** Import specifiers */
export const IMPORT_SPECIFIERS_QUERY = `
    (preproc_include
        path: (string_literal) @source) @import

    (preproc_include
        path: (system_lib_string) @source) @import
`;
