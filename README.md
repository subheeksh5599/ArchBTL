# ArchBTL

**LLM Architecture Visualizer powered by BTL Runtime**

A VSCode extension that scans your codebase, identifies AI/LLM call chains, and renders them as interactive DAG graphs inside your editor.

## How It Works

1. Open any workspace with AI/LLM code
2. Run `ArchBTL: Open` from the command palette
3. The extension analyzes your codebase using BTL Runtime and visualizes all LLM workflows

## Setup

### Prerequisites
- Python 3.11+
- Node.js 20+
- BTL Runtime API key

### Install
```bash
make setup
```

### Run
1. Create `backend/.env` with `BTL_API_KEY=your-key`
2. `make run`
3. Run `ArchBTL: Open` in VSCode

## Architecture

```
frontend/          VSCode extension (TypeScript + D3.js)
backend/           Python FastAPI server (BTL Runtime client)
packages/mcp-server/  MCP server for agent integration
```

## Powered by

[BTL Runtime](https://badtheorylabs.com/runtime) — the LLM inference gateway from Bad Theory Labs
