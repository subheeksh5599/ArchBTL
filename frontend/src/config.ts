/**
 * Centralized configuration constants for the Codag extension
 *
 * All magic numbers and configurable values should be defined here.
 * This makes the codebase easier to tune and maintain.
 */

export const CONFIG = {
    /**
     * Batch processing limits
     */
    BATCH: {
        /** Maximum number of files to include in a single analysis batch */
        MAX_SIZE: 5,
        /** Maximum tokens per batch (limits output size - Gemini output capped at 65k tokens) */
        MAX_TOKENS: 100_000,
    },

    /**
     * API concurrency settings (Gemini Flash: 1500 RPM, 4M TPM)
     */
    CONCURRENCY: {
        /** Maximum parallel Gemini API requests */
        MAX_PARALLEL: 10,
    },

    /**
     * File watching and debouncing
     */
    WATCHER: {
        /** Debounce delay in milliseconds before triggering re-analysis */
        DEBOUNCE_MS: 2000,
    },

    /**
     * Import analysis settings
     */
    IMPORTS: {
        /** Maximum depth to follow when expanding imports */
        MAX_DEPTH: 3,
        /** Maximum number of importers to expand when finding related files */
        MAX_IMPORTERS: 20,
    },

    /**
     * Gemini 2.5 Flash pricing (per 1M tokens)
     * Source: https://ai.google.dev/pricing
     */
    PRICING: {
        /** Input token cost per 1M tokens (prompts ≤128K) */
        INPUT_PER_1M: 0.075,
        /** Output token cost per 1M tokens (prompts ≤128K) */
        OUTPUT_PER_1M: 0.30,
    },

    /**
     * Edge resolution settings
     */
    EDGE_RESOLUTION: {
        /** How many directory levels to try when fuzzy matching cross-file edges */
        PATH_MATCHING_DEPTH: 4,
    },

    /**
     * HTTP endpoint detection settings
     */
    HTTP_DETECTION: {
        /** Minimum path segment length to be considered a valid endpoint (filters form fields) */
        MIN_PATH_SEGMENT_LENGTH: 10,
        /** Lines to search around a URL pattern to find the handler function */
        HANDLER_SEARCH_LINES: 5,
    },

    /**
     * Cache settings
     */
    CACHE: {
        /** Cache format version - increment when format changes (v13: filter symbolic nodes, non-LLM workflows) */
        VERSION: 13,
        /** Debounce delay for saving cache to disk */
        SAVE_DEBOUNCE_MS: 500,
    },

    /**
     * Analyzer limits
     */
    ANALYZER: {
        /** Maximum number of files to find when searching for LLM files */
        MAX_FILE_FIND: 10000,
        /** Lines of context to search around AI patterns */
        AI_PATTERN_CONTEXT_LINES: 5,
    },

    /**
     * Workflow detection settings
     */
    WORKFLOW: {
        /** Minimum nodes for initial workflow detection */
        MIN_NODES_INITIAL: 5,
        /** Minimum nodes for rendered workflow */
        MIN_NODES_RENDERED: 3,
        /** Files targeted by edges from N+ distinct workflow groups become shared service hubs */
        HUB_FILE_THRESHOLD: 3,
        /** Maximum nodes in a merged workflow (prevents blobbing) */
        MAX_MERGED_NODES: 20,
    },
} as const;

/**
 * Supported file extensions for analysis
 * Add new languages here to support them across the codebase
 */
export const SUPPORTED_EXTENSIONS = [
    '.py', '.ts', '.tsx', '.js', '.jsx',
    '.go', '.rs', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp',
    '.swift', '.java', '.lua',
] as const;

/**
 * Extended file extensions (including less common variants)
 */
export const ALL_EXTENSIONS = [
    '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.go', '.rs', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh',
    '.swift', '.java', '.lua',
] as const;

/**
 * File/directory patterns to exclude from analysis
 * Based on gitdiagram's aggressive filtering + common patterns
 */
export const EXCLUDE_PATTERNS = [
    // Hidden directories (dotfiles)
    '**/.*/**',

    // Package managers & dependencies
    '**/node_modules/**',
    '**/vendor/**',
    '**/bower_components/**',
    '**/.pnpm/**',

    // Build outputs
    '**/out/**',
    '**/dist/**',
    '**/build/**',
    '**/target/**',
    '**/bin/**',
    '**/obj/**',
    '**/_build/**',

    // Framework build directories
    '**/.next/**',
    '**/.nuxt/**',
    '**/.vitepress/**',
    '**/.docusaurus/**',
    '**/.svelte-kit/**',
    '**/.vercel/**',
    '**/.netlify/**',
    '**/.turbo/**',
    '**/.parcel-cache/**',

    // Caches
    '**/.cache/**',
    '**/__pycache__/**',
    '**/.ruff_cache/**',
    '**/.mypy_cache/**',
    '**/.pytest_cache/**',
    '**/.tox/**',
    '**/.nox/**',
    '**/*.egg-info/**',

    // Virtual environments
    '**/venv/**',
    '**/.venv/**',
    '**/env/**',
    '**/virtualenv/**',
    '**/.virtualenv/**',

    // Version control
    '**/.git/**',
    '**/.svn/**',
    '**/.hg/**',

    // IDE/Editor directories
    '**/.idea/**',
    '**/.vscode/**',
    '**/.vscode-test/**',
    '**/.vs/**',
    '**/*.xcodeproj/**',
    '**/*.xcworkspace/**',

    // Test coverage
    '**/coverage/**',
    '**/htmlcov/**',
    '**/.nyc_output/**',

    // Test directories (usually not part of main workflow)
    '**/__tests__/**',
    '**/test/**',
    '**/tests/**',
    '**/spec/**',
    '**/__mocks__/**',
    '**/fixtures/**',

    // Test file patterns (filename-based, not just directory-based)
    '**/test_*.py',
    '**/*_test.py',
    '**/*.test.ts',
    '**/*.test.js',
    '**/*.test.tsx',
    '**/*.test.jsx',
    '**/*.spec.ts',
    '**/*.spec.js',
    '**/*.spec.tsx',
    '**/*.spec.jsx',
    '**/*_test.go',
    '**/conftest.py',

    // Generated/compiled files
    '**/*.min.js',
    '**/*.min.css',
    '**/*.map',
    '**/*.d.ts',

    // Documentation
    '**/docs/**',
    '**/doc/**',
    '**/documentation/**',

    // Logs
    '**/logs/**',
    '**/log/**',
    '**/*.log',

    // Temporary files
    '**/tmp/**',
    '**/temp/**',
    '**/.tmp/**',

    // Migrations (usually boilerplate)
    '**/migrations/**',
    '**/alembic/**',
] as const;

/**
 * Keywords to filter out when extracting function calls
 * These are language builtins/keywords that shouldn't be treated as function calls
 */
export const KEYWORD_BLACKLISTS = {
    /** Python builtins and keywords to ignore */
    python: [
        'if', 'for', 'while', 'with', 'print', 'len', 'str', 'int',
        'list', 'dict', 'range', 'type', 'set', 'tuple', 'bool',
        'float', 'open', 'input', 'isinstance', 'hasattr', 'getattr',
    ],
    /** JavaScript/TypeScript keywords to ignore */
    javascript: [
        'if', 'else', 'for', 'while', 'switch', 'catch', 'return',
        'const', 'let', 'var', 'new', 'await', 'this', 'constructor',
        'super', 'typeof', 'instanceof', 'delete', 'void',
    ],
    /** Go builtins to ignore */
    go: [
        'fmt', 'log', 'make', 'len', 'cap', 'append', 'delete',
        'copy', 'close', 'panic', 'recover', 'new', 'error',
        'print', 'println',
    ],
    /** Rust builtins/macros to ignore */
    rust: [
        'println', 'eprintln', 'format', 'vec', 'panic', 'todo',
        'unimplemented', 'assert', 'debug_assert', 'dbg', 'write',
        'writeln', 'unreachable', 'cfg',
    ],
    /** C/C++ builtins to ignore */
    c: [
        'printf', 'fprintf', 'sprintf', 'snprintf', 'scanf',
        'malloc', 'calloc', 'realloc', 'free',
        'memcpy', 'memset', 'memmove', 'strlen', 'strcmp', 'strcat',
        'strcpy', 'sizeof', 'assert', 'exit', 'abort',
    ],
    /** Swift builtins to ignore */
    swift: [
        'print', 'debugPrint', 'fatalError', 'precondition',
        'preconditionFailure', 'assert', 'assertionFailure',
        'type', 'Mirror', 'dump',
    ],
    /** Java builtins to ignore */
    java: [
        'System', 'String', 'Integer', 'Boolean', 'Double', 'Float',
        'Long', 'Short', 'Byte', 'Character', 'Math', 'Objects',
        'Arrays', 'Collections', 'Optional',
    ],
    /** Lua builtins to ignore */
    lua: [
        'print', 'type', 'tostring', 'tonumber', 'error', 'assert',
        'pcall', 'xpcall', 'select', 'pairs', 'ipairs', 'next',
        'rawget', 'rawset', 'rawequal', 'rawlen', 'setmetatable',
        'getmetatable', 'require', 'unpack', 'table', 'string',
        'math', 'io', 'os', 'coroutine', 'debug',
    ],
} as const;

/**
 * Common form field names to filter out in HTTP endpoint detection
 * These often appear in URLs but aren't actual API endpoints
 */
export const FORM_FIELD_BLACKLIST = [
    'email', 'name', 'password', 'username', 'phone', 'address',
    'message', 'comment', 'title', 'description', 'value', 'data',
    'id', 'type', 'status', 'token', 'key', 'code',
] as const;

/**
 * HTTP methods for endpoint detection
 */
export const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;
