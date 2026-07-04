/**
 * Tree-sitter S-expression queries for Python.
 */

/** Function definitions (including async, nested, class methods) */
export const FUNCTION_QUERY = `
    (function_definition
        name: (identifier) @name
        parameters: (parameters) @params) @func
`;

/** Decorated function definitions (for route handlers etc.) */
export const DECORATED_FUNCTION_QUERY = `
    (decorated_definition
        (decorator) @decorator
        definition: (function_definition
            name: (identifier) @name
            parameters: (parameters) @params)) @decorated_func
`;

/** All function calls */
export const CALL_QUERY = `
    (call
        function: (identifier) @callee) @call

    (call
        function: (attribute) @callee) @call
`;

/** Import statements */
export const IMPORT_QUERY = `
    (import_statement
        name: (dotted_name) @source) @import

    (import_from_statement
        module_name: (dotted_name) @source) @import_from
`;

/** Import-from with specific symbols */
export const IMPORT_SPECIFIERS_QUERY = `
    (import_from_statement
        module_name: (dotted_name) @source
        name: (dotted_name (identifier) @symbol))

    (import_statement
        name: (dotted_name) @source)

    (import_from_statement
        module_name: (dotted_name) @source
        name: (aliased_import
            name: (dotted_name (identifier) @symbol)))
`;

/** __all__ export list */
export const ALL_EXPORT_QUERY = `
    (expression_statement
        (assignment
            left: (identifier) @name
            right: (list) @items)) @assignment
`;

/** Decorator calls (for HTTP route detection) */
export const DECORATOR_QUERY = `
    (decorator
        (call
            function: (attribute
                object: (identifier) @obj
                attribute: (identifier) @method)
            arguments: (argument_list
                (string (string_content) @path)))) @decorator_call

    (decorator
        (attribute
            object: (identifier) @obj
            attribute: (identifier) @method)) @decorator_attr
`;
