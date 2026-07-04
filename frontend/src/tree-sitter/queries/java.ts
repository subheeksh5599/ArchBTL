/**
 * Tree-sitter S-expression queries for Java.
 * Java exports via public visibility modifier.
 */

/** Method declarations (Java has no free functions — everything is in a class) */
export const FUNCTION_QUERY = `
    (method_declaration
        name: (identifier) @name
        parameters: (formal_parameters) @params) @method

    (constructor_declaration
        name: (identifier) @name
        parameters: (formal_parameters) @params) @method
`;

/**
 * Method invocations.
 * Java uses method_invocation with separate object and name fields.
 * The extractor handles reconstruction of the call chain.
 */
export const CALL_QUERY = `
    (method_invocation
        name: (identifier) @callee) @call

    (method_invocation
        object: (_) @object
        name: (identifier) @callee) @call
`;

/** Import declarations */
export const IMPORT_QUERY = `
    (import_declaration
        (scoped_identifier) @source) @import
`;

/** All methods treated as exported (public checking done in code) */
export const EXPORT_QUERY = `
    (method_declaration
        name: (identifier) @name) @method
`;

/** Import specifiers — extract class name from fully qualified import */
export const IMPORT_SPECIFIERS_QUERY = `
    (import_declaration
        (scoped_identifier
            name: (identifier) @symbol) @source)
`;
