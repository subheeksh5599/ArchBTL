/**
 * Tree-sitter S-expression queries for Lua.
 * Lua has global functions, local functions, and method definitions (Obj:method).
 * Imports use require('module').
 */

/** Function definitions — global, local, and method (Table:method) */
export const FUNCTION_QUERY = `
    (function_definition_statement
        name: (identifier) @name
        parameters: (parameter_list) @params) @func

    (local_function_definition_statement
        name: (identifier) @name
        parameters: (parameter_list) @params) @func

    (function_definition_statement
        name: (variable
            method: (identifier) @name)
        parameters: (parameter_list) @params) @func
`;

/** Function calls — simple identifiers and member access */
export const CALL_QUERY = `
    (call
        function: (variable
            name: (identifier) @callee)) @call

    (call
        function: (variable
            table: (identifier)
            field: (identifier) @callee)) @call
`;

/** Require-based imports: local foo = require('bar') */
export const IMPORT_QUERY = `
    (local_variable_declaration
        (variable_list
            (variable
                name: (identifier) @local_name))
        (expression_list
            value: (call
                function: (variable
                    name: (identifier) @_req)
                arguments: (argument_list
                    (expression_list
                        (string) @source))))
        (#eq? @_req "require")) @import
`;

/** Exports — Lua doesn't have a formal export system.
 *  Global functions are effectively exported. */
export const EXPORT_QUERY = `
    (function_definition_statement
        name: (identifier) @name) @func
`;

/** Import specifiers — the local variable name from require */
export const IMPORT_SPECIFIERS_QUERY = `
    (local_variable_declaration
        (variable_list
            (variable
                name: (identifier) @symbol))
        (expression_list
            value: (call
                function: (variable
                    name: (identifier) @_req)
                arguments: (argument_list
                    (expression_list
                        (string) @source))))
        (#eq? @_req "require"))
`;
