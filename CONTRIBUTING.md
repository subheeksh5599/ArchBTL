# Contributing to Codag

Thanks for your interest in contributing to Codag! This document covers the development workflow.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/michaelzixizhou/codag.git
cd codag

# Install dependencies (backend + frontend)
make setup

# Add your Gemini API key
echo "GEMINI_API_KEY=your-key-here" > backend/.env

# Run everything (compile, start backend, launch extension)
make run
```

## Project Structure

- `backend/` - Python/FastAPI server using Gemini for code analysis
- `frontend/` - VSCode extension (TypeScript, D3.js, Dagre)
- `frontend/src/webview-client/` - Webview visualization code

## Development Workflow

1. **Fork** the repo and create a feature branch from `main`
2. Make your changes
3. Compile the frontend: `cd frontend && npm run compile`
4. Test the extension: `make run`
5. Submit a pull request

## Available Commands

```bash
make run          # Compile + start backend + launch extension
make stop         # Stop backend
make debug        # Launch extension without backend
make setup        # Install all dependencies
make docker-up    # Start backend with Docker
make docker-down  # Stop Docker backend
```

## Troubleshooting

**Backend won't start:** `lsof -i :52104` to check for port conflicts, `make stop` to kill it.

**Extension not loading:** Run `npm run compile` in `frontend/`, check the "Codag" output panel in VSCode.

**Backend doesn't hot-reload.** After Python changes: `make stop && make run`. Frontend supports `npm run watch`.

## Adding a Provider

Add an entry to the `LLM_PROVIDERS` array in [`frontend/src/providers.ts`](frontend/src/providers.ts):

```ts
{
    id: 'new-provider',
    displayName: 'New Provider',
    identifiers: ['newprovider'],
    importPatterns: [/from\s+newprovider/i],
    callPatterns: [/\.generate\s*\(/],
},
```

Then run `cd frontend && npm run compile`. No backend changes needed.

## Adding a Language

Three files to touch:

**1. `frontend/src/tree-sitter/parser-manager.ts`** — register the grammar:

```ts
// Add to SupportedLanguage type
export type SupportedLanguage = ... | 'ruby';

// Add to GRAMMAR_FILES
ruby: 'tree-sitter-ruby.wasm',

// Add to getLanguageForFile()
if (filePath.endsWith('.rb')) return 'ruby';
```

**2. `frontend/src/tree-sitter/extractors.ts`** — add extraction queries:

```ts
// Add a case in getLanguageQueries() with tree-sitter node types
case 'ruby':
    return {
        q: {
            funcDef: '(method name: (identifier) @name)',
            funcCall: '(call method: (identifier) @name)',
            import: '(call method: (identifier) @name (#eq? @name "require"))',
            export: '(method name: (identifier) @name)',
        }
    };

// Add a stdlib blacklist
const RUBY_BLACKLIST = new Set(['puts', 'print', 'require', 'raise', ...]);

// Add export heuristic in isExportedFunction()
case 'ruby':
    return true; // Ruby methods are visible by default
```

**3. Get the WASM grammar:**

```bash
cd frontend
npm install tree-sitter-ruby
```

Add the copy line in `frontend/scripts/copy-wasm.js`, then `npm run compile`.

No backend changes needed. No changes to consumer code (call graph, cache, webview).

## Code Style

- **TypeScript**: Follow existing patterns, use strict types
- **Python**: Follow PEP 8, use type hints
- **Commits**: Use clear, descriptive commit messages

## Pull Requests

- Keep PRs focused on a single change
- Include a description of what changed and why
- Ensure the frontend compiles without errors
- Test the extension end-to-end if possible

## Reporting Issues

Use [GitHub Issues](https://github.com/michaelzixizhou/codag/issues) with the provided templates for bugs and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
