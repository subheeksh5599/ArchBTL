<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/archbtl-logo.svg">
    <img src="media/archbtl-logo.svg" alt="ArchBTL" width="360">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Powered_by-BTL_Runtime-38bdf8?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2UyZThmMCIgZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==">
  <img src="https://img.shields.io/badge/VSCode-Extension-0f172a?style=for-the-badge&logo=visualstudio">
  <img src="https://img.shields.io/badge/50%2B_Languages-Supported-475569?style=for-the-badge">
</p>

<h1 align="center">ArchBTL</h1>
<h3 align="center"><em>Visualize every AI call chain.<br>Ship with confidence.</em></h3>

<p align="center">
  <strong>AI workflow architecture visualizer for VSCode.<br>Detects LLM calls, MCP servers, agents — and renders every chain as an interactive DAG.<br>Powered by BTL Runtime.</strong>
</p>

<p align="center">
  <a href="#the-problem">Problem</a> &bull;
  <a href="#the-solution">Solution</a> &bull;
  <a href="#installation">Install</a> &bull;
  <a href="#usage">Usage</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#faq">FAQ</a>
</p>

---

## The Problem

Modern codebases are full of invisible AI pipelines. Your team adds LLM calls across 40 files over 6 months. A frontend call to `/api/analyze` triggers a chain that hits 4 services, 3 models, and a vector database. Nobody has the full picture.

| Problem | Impact |
|---------|--------|
| **AI code is scattered** | LLM calls hide in utility modules, middleware, event handlers — invisible to code review |
| **No visual map exists** | Architecture diagrams are hand-drawn once and rot immediately |
| **Service-to-service LLM chains are opaque** | Frontend → API → orchestration → model — nobody knows the full path |
| **Onboarding takes forever** | New engineers spend days tracing AI call chains through the codebase |
| **Dependency blind spots** | Changing a shared AI utility breaks 8 workflows you didn't know existed |

---

## The Solution

ArchBTL scans your codebase, identifies every AI/LLM call chain, and renders them as interactive DAG graphs inside VSCode. Open, render, understand — in under a minute.

```
Workspace Load ──> Static Analysis ──> BTL Runtime ──> DAG Graph
                        │                    │              │
                  tree-sitter AST       LLM identifies    Interactive
                  finds call chains     workflows &       visualization
                                        metadata          in VSCode
```

### What you get

- **Auto-detected workflows** — Entry points, LLM API calls, routing decisions, and outputs
- **LLM call identification** — 50+ providers detected (OpenAI, Anthropic, BTL, Gemini, Ollama, LlamaCpp, MCP servers, and more)
- **Service-to-service edges** — HTTP connections between services traced automatically
- **Interactive graph** — Zoom, pan, click nodes to jump to source, collapse/expand groups
- **Metadata enrichment** — Human-readable labels and descriptions on every node via BTL Runtime
- **Live updates** — File watcher re-analyzes changed files on save
- **Export** — PNG/JPEG export of full graphs or individual workflows
- **MCP server** — Auto-registered so coding agents (Cursor, Claude Code) get workflow context

---

## Installation

### Prerequisites

- [VSCode](https://code.visualstudio.com) 1.95+
- Python 3.11+ (for the backend)
- Node.js 20+ (for the frontend)
- [BTL Runtime API key](https://runtime.badtheorylabs.com)

### 1. Clone and setup

```bash
git clone https://github.com/subheeksh5599/ArchBTL.git
cd ArchBTL
make setup
```

### 2. Add your BTL API key

```bash
echo "BTL_API_KEY=gw_subheeks_your_key_here" > backend/.env
```

### 3. Launch

```bash
make run
```

This compiles the frontend, starts the backend on port 52104, and opens a VSCode window with ArchBTL loaded.

Or run in a settled VSCode window:

```bash
make debug
```

### 4. Open ArchBTL

Inside VSCode, open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:

```
ArchBTL: Open
```

---

## Usage

### First launch

Open ArchBTL in a workspace with AI/LLM code. It scans every supported file, identifies LLM call chains, and renders the graph.

### Graph controls

| Control | Action |
|---------|--------|
| Scroll | Zoom in/out |
| Drag background | Pan canvas |
| Click node | Open source file at exact line |
| Click edge | Show data contracts between nodes |
| Click workflow title | Collapse/expand workflow |
| `+` / `-` buttons | Zoom controls |
| `[ ]` button | Fit to screen |
| Folder button | Re-analyze selected files |
| Share button | Export as PNG/JPEG |

### Live updates

Save any supported file (`.py`, `.ts`, `.js`, `.go`, `.rs`, etc.) and ArchBTL automatically re-analyzes it. Changed nodes get a subtle pulse animation.

### Supported languages

Python, TypeScript, JavaScript (JSX, TSX, MJS, CJS), Go, Rust, C, C++, Swift, Java, Lua

### Detected LLM patterns

OpenAI, Anthropic, BTL Runtime, Google Gemini (genai + vertex), Ollama, Cohere, HuggingFace, xAI/Grok, Mistral, Together, Replicate, Fireworks, Bedrock, Azure OpenAI, AI21, DeepSeek, OpenRouter, LlamaCpp/GGUF, LangChain, LangGraph, Mastra, CrewAI, LlamaIndex, AutoGen, Haystack, SemanticKernel, PydanticAI, Instructor, MCP servers (JS/TS, Python, Go, Rust, C++)

---

## How It Works

### Static analysis pass (tree-sitter)

ArchBTL uses [tree-sitter](https://tree-sitter.github.io) to parse every supported file into an AST. It extracts:
- Function definitions with line numbers
- Call graphs (which function calls which)
- Import/require statements
- HTTP endpoint declarations
- LLM API call patterns

### LLM enrichment pass (BTL Runtime)

The extracted code structure is sent to **BTL Runtime** via `/v1/chat/completions`. The BTL-2 model:
1. Identifies which functions form end-to-end workflows
2. Generates Mermaid flowchart syntax describing each chain
3. Produces human-readable labels and descriptions for every node
4. Detects service-to-service HTTP connections

The Mermaid output is parsed, resolved against tree-sitter source locations, and rendered as an interactive DAG with D3.js.

### Local-first with smart caching

Analysis results are cached locally. Re-analysis only happens when code changes. Metadata (labels/descriptions) is incrementally updated. Nothing leaves your machine except the code snippets sent to BTL Runtime for analysis.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    VSCode Extension                       │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────────────┐ │
│  │ tree-sitter  │  │ D3.js    │  │  MCP Server         │ │
│  │ AST parsing  │  │ Graphs   │  │  (agent context)    │ │
│  └──────┬───────┘  └────▲─────┘  └──────────┬──────────┘ │
│         │               │                    │            │
│         │    Extension Host                │            │
│         │               │                    │            │
│  ┌──────▼───────────────▼────────────────────▼──────────┐ │
│  │              Backend (FastAPI :52104)                 │ │
│  │  ┌───────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ /analyze  │  │ /metadata    │  │ /condense    │  │ │
│  │  └─────┬─────┘  └──────┬───────┘  └──────┬───────┘  │ │
│  │        │               │                  │          │ │
│  │  ┌─────▼───────────────▼──────────────────▼───────┐  │ │
│  │  │           BTL Runtime Client                 │  │ │
│  │  │     /v1/chat/completions  (btl-2 model)      │  │ │
│  │  └──────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## FAQ

<details>
<summary><strong>Does ArchBTL send my code anywhere?</strong></summary>

Yes — the code you choose to analyze is sent to the BTL Runtime API for LLM-powered workflow detection. The analysis is stateless; BTL does not store your code. Only the files in your analysis scope are transmitted.
</details>

<details>
<summary><strong>Which BTL Runtime endpoints does ArchBTL use?</strong></summary>

`/v1/chat/completions` — for workflow analysis, metadata generation, and structure condensation. All requests use the `btl-2` model with temperature 0.0 for deterministic output.
</details>

<details>
<summary><strong>Can I use this without BTL Runtime?</strong></summary>

No — the LLM-powered workflow detection is the core feature. Static analysis alone can find LLM call patterns, but can't group them into meaningful workflows or generate human-readable labels.
</details>

<details>
<summary><strong>How much does analysis cost?</strong></summary>

A typical analysis of 10 files (~50K total tokens) costs approximately $0.01–0.03 in BTL Runtime credits. Metadata-only updates for changed files are even cheaper (~1-2K tokens per file).
</details>

<details>
<summary><strong>What happens when I save a file?</strong></summary>

ArchBTL watches for file saves. Changed files are re-analyzed individually (metadata-only pass) or in small batches. The graph updates incrementally with a smooth transition — no full re-render.
</details>

<details>
<summary><strong>Does this work in monorepos?</strong></summary>

Yes. ArchBTL auto-detects your workspace root and analyzes the full tree. You can use the file picker to scope analysis to specific directories if you prefer.
</details>

<details>
<summary><strong>What's the MCP server for?</strong></summary>

ArchBTL automatically registers an MCP server in `.mcp.json` (or `.cursor/mcp.json` for Cursor). This lets AI coding agents query your workflow graph — they can ask "what workflows touch this file?" or "show me the full pipeline for the analyze endpoint." The MCP tools are read-only and use locally cached data.
</details>

<details>
<summary><strong>Can I export the graph?</strong></summary>

Yes — click the share button to export as PNG or JPEG. Individual workflows can be exported from their title bar, or export the entire visible graph. Exports include a watermark with your workspace name and timestamp.
</details>

---

## Powered by

<p align="center">
  <strong><a href="https://badtheorylabs.com/runtime">BTL Runtime</a></strong> — the LLM inference gateway from Bad Theory Labs.<br>
  <em>Cheaper. Faster. Multi-provider. OpenAI-compatible.</em>
</p>

---

## License

MIT. Build whatever you want with it.
