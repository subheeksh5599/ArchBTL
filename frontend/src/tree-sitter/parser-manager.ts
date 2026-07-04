/**
 * Tree-sitter Parser Manager
 *
 * Singleton that manages WASM initialization, language loading, and tree caching
 * for incremental parsing. All structural parsing in the extension goes through here.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Language, Tree } from 'web-tree-sitter';
const TreeSitterModule = require('web-tree-sitter');
const TreeSitterParser = TreeSitterModule.Parser;
const TreeSitterLanguage = TreeSitterModule.Language;
type Parser = InstanceType<typeof TreeSitterParser>;

export type SupportedLanguage =
    | 'javascript' | 'typescript' | 'tsx' | 'python'
    | 'go' | 'rust' | 'c' | 'cpp' | 'swift' | 'java'
    | 'lua';

const GRAMMAR_FILES: Record<SupportedLanguage, string> = {
    javascript: 'tree-sitter-javascript.wasm',
    typescript: 'tree-sitter-typescript.wasm',
    tsx: 'tree-sitter-tsx.wasm',
    python: 'tree-sitter-python.wasm',
    go: 'tree-sitter-go.wasm',
    rust: 'tree-sitter-rust.wasm',
    c: 'tree-sitter-c.wasm',
    cpp: 'tree-sitter-cpp.wasm',
    swift: 'tree-sitter-swift.wasm',
    java: 'tree-sitter-java.wasm',
    lua: 'tree-sitter-lua.wasm',
};

export class ParserManager {
    private static instance: ParserManager | null = null;
    private initialized = false;
    private parsers = new Map<SupportedLanguage, Parser>();
    private languages = new Map<SupportedLanguage, Language>();

    /** Cached parse trees per file path for incremental parsing */
    private treeCache = new Map<string, Tree>();

    private constructor(private wasmDir: string) {}

    /**
     * Create the singleton. Must be called once during extension activation
     * with the extension's URI to locate WASM files.
     */
    static create(extensionUri: vscode.Uri): ParserManager {
        if (!ParserManager.instance) {
            const wasmDir = vscode.Uri.joinPath(extensionUri, 'media', 'tree-sitter').fsPath;
            ParserManager.instance = new ParserManager(wasmDir);
        }
        return ParserManager.instance;
    }

    /** Get the singleton. Throws if not yet created. */
    static get(): ParserManager {
        if (!ParserManager.instance) {
            throw new Error('ParserManager not initialized. Call create() first in activate().');
        }
        return ParserManager.instance;
    }

    /** Check if initialized */
    static isAvailable(): boolean {
        return ParserManager.instance !== null && ParserManager.instance.initialized;
    }

    /**
     * Initialize the WASM runtime and load all language grammars.
     * Must be awaited before any parsing.
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        const runtimeWasm = path.join(this.wasmDir, 'tree-sitter.wasm');
        await TreeSitterParser.init({
            locateFile: () => runtimeWasm,
        });

        for (const [lang, file] of Object.entries(GRAMMAR_FILES) as [SupportedLanguage, string][]) {
            const wasmPath = path.join(this.wasmDir, file);
            const language = await TreeSitterLanguage.load(wasmPath);
            this.languages.set(lang, language);

            const parser = new TreeSitterParser();
            parser.setLanguage(language);
            this.parsers.set(lang, parser);
        }

        this.initialized = true;
    }

    /**
     * Apply a text edit to the cached tree for a file.
     * This keeps the tree in sync with document changes so that the next
     * parse() call can do incremental parsing (reuse unchanged subtrees).
     *
     * Should be called from onDidChangeTextDocument for each content change.
     */
    applyEdit(filePath: string, change: {
        rangeOffset: number;
        rangeLength: number;
        text: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
    }): void {
        const tree = this.treeCache.get(filePath);
        if (!tree) return;

        const startIndex = change.rangeOffset;
        const oldEndIndex = change.rangeOffset + change.rangeLength;
        const newEndIndex = change.rangeOffset + change.text.length;

        const startPosition = { row: change.range.start.line, column: change.range.start.character };
        const oldEndPosition = { row: change.range.end.line, column: change.range.end.character };

        // Compute new end position from inserted text
        const newLines = change.text.split('\n');
        const newEndRow = change.range.start.line + newLines.length - 1;
        const newEndColumn = newLines.length === 1
            ? change.range.start.character + change.text.length
            : newLines[newLines.length - 1].length;
        const newEndPosition = { row: newEndRow, column: newEndColumn };

        tree.edit({
            startIndex,
            oldEndIndex,
            newEndIndex,
            startPosition,
            oldEndPosition,
            newEndPosition
        });
    }

    /**
     * Parse source code into a syntax tree.
     *
     * If filePath is provided and a cached tree exists (kept in sync via
     * applyEdit), tree-sitter performs incremental parsing — reusing unchanged
     * subtrees for much faster re-parsing on small edits.
     */
    parse(code: string, language: SupportedLanguage, filePath?: string): Tree {
        if (!this.initialized) {
            throw new Error('ParserManager not initialized');
        }

        const parser = this.parsers.get(language);
        if (!parser) {
            throw new Error(`Language ${language} not loaded`);
        }

        // Use cached tree for incremental parsing when available.
        // The tree is kept in sync with edits via applyEdit() calls from
        // onDidChangeTextDocument, so tree-sitter knows which regions changed.
        const oldTree = filePath ? this.treeCache.get(filePath) : undefined;
        const tree = parser.parse(code, oldTree);

        if (!tree) {
            throw new Error(`Failed to parse ${filePath || 'code'} as ${language}`);
        }

        // Cache the new tree (replace old one)
        if (filePath) {
            if (oldTree) {
                oldTree.delete();
            }
            this.treeCache.set(filePath, tree.copy());
        }

        return tree;
    }

    /** Get the Language object for running queries */
    getLanguage(lang: SupportedLanguage): Language {
        const language = this.languages.get(lang);
        if (!language) {
            throw new Error(`Language ${lang} not loaded`);
        }
        return language;
    }

    /** Clear cached tree for a file (e.g., when file is deleted) */
    clearTreeCache(filePath: string): void {
        const tree = this.treeCache.get(filePath);
        if (tree) {
            tree.delete();
            this.treeCache.delete(filePath);
        }
    }

    /**
     * Create the singleton for standalone (non-VSCode) use.
     * Takes a direct path to the WASM directory.
     */
    static createWithPath(wasmDir: string): ParserManager {
        if (!ParserManager.instance) {
            ParserManager.instance = new ParserManager(wasmDir);
        }
        return ParserManager.instance;
    }

    /** Map file extension to tree-sitter language */
    static getLanguageForFile(filePath: string): SupportedLanguage | null {
        if (filePath.endsWith('.py')) return 'python';
        if (filePath.endsWith('.tsx')) return 'tsx';
        if (filePath.endsWith('.jsx')) return 'tsx'; // JSX uses TSX grammar (superset)
        if (filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')) return 'typescript';
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return 'javascript';
        if (filePath.endsWith('.go')) return 'go';
        if (filePath.endsWith('.rs')) return 'rust';
        if (filePath.endsWith('.c') || filePath.endsWith('.h')) return 'c';
        if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.cxx') ||
            filePath.endsWith('.hpp') || filePath.endsWith('.hxx') || filePath.endsWith('.hh')) return 'cpp';
        if (filePath.endsWith('.swift')) return 'swift';
        if (filePath.endsWith('.java')) return 'java';
        if (filePath.endsWith('.lua')) return 'lua';
        return null;
    }

    /** Clean up all resources */
    dispose(): void {
        for (const tree of this.treeCache.values()) {
            tree.delete();
        }
        this.treeCache.clear();
        for (const parser of this.parsers.values()) {
            parser.delete();
        }
        this.parsers.clear();
        this.languages.clear();
        this.initialized = false;
        ParserManager.instance = null;
    }
}
