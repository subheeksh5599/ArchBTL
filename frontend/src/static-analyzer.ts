import { QUICK_SCAN_PATTERNS } from './providers';
import { ParserManager } from './tree-sitter/parser-manager';
import { extractFileAnalysisFromTree } from './tree-sitter/extractors';

export interface CodeLocation {
    line: number;
    column: number;
    type: 'trigger' | 'llm' | 'tool' | 'decision' | 'integration' | 'memory' | 'parser' | 'output';
    description: string;
    function: string;
    variable?: string;
}

export interface FileAnalysis {
    filePath: string;
    locations: CodeLocation[];
    imports: string[];
    exports: string[];
    llmRelatedVariables: Set<string>;
}

// LLM identifier patterns - imported from centralized providers.ts
const LLM_PATTERNS = QUICK_SCAN_PATTERNS;

export class StaticAnalyzer {
    /**
     * Check if an identifier name is LLM-related
     */
    private isLLMIdentifier(name: string): boolean {
        return LLM_PATTERNS.some(pattern => pattern.test(name));
    }

    /**
     * Parse file and extract LLM workflow locations using tree-sitter
     */
    analyze(code: string, filePath: string): FileAnalysis {
        const language = ParserManager.getLanguageForFile(filePath);
        if (!language || !ParserManager.isAvailable()) {
            console.warn(`Unsupported file type or parser unavailable for: ${filePath}`);
            return {
                filePath,
                locations: [],
                imports: [],
                exports: [],
                llmRelatedVariables: new Set()
            };
        }

        try {
            const manager = ParserManager.get();
            const tree = manager.parse(code, language, filePath);
            const result = extractFileAnalysisFromTree(
                tree,
                language,
                filePath,
                code,
                (name: string) => this.isLLMIdentifier(name),
            );
            tree.delete();

            return {
                filePath,
                locations: result.locations as CodeLocation[],
                imports: result.imports,
                exports: result.exports,
                llmRelatedVariables: result.llmRelatedVariables,
            };
        } catch (error) {
            console.error(`Failed to parse ${filePath}:`, error);
            if (error instanceof Error) {
                console.error(`Error details: ${error.message}`);
            }
            return {
                filePath,
                locations: [],
                imports: [],
                exports: [],
                llmRelatedVariables: new Set()
            };
        }
    }
}

export const staticAnalyzer = new StaticAnalyzer();
