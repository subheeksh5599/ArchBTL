from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json

from models import (
    AnalyzeRequest, WorkflowGraph,
    MetadataRequest, FileMetadataResult, FunctionMetadata,
    CondenseRequest,
    TokenUsage, CostData, AnalyzeResponse,
    SearchRequest, SearchResult, SearchResponse,
    CompareRequest, CompareResult, CompareResponse,
)
from prompts import build_metadata_only_prompt, USE_MERMAID_FORMAT
from mermaid_parser import parse_mermaid_response
from btl_client import btl_client
from config import settings

app = FastAPI(title="ArchBTL")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_workflow(
    request: AnalyzeRequest,
):
    if not settings.btl_api_key:
        raise HTTPException(status_code=503, detail="BTL API key not configured")

    total_usage = TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0, cached_tokens=0)
    total_cost = CostData(input_cost=0.0, output_cost=0.0, total_cost=0.0)

    MAX_CODE_SIZE = 5_000_000
    MAX_FILES = 50

    if len(request.code) > MAX_CODE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Code size ({len(request.code)} bytes) exceeds maximum allowed size ({MAX_CODE_SIZE} bytes)."
        )
    if request.file_paths and len(request.file_paths) > MAX_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"Number of files ({len(request.file_paths)}) exceeds maximum allowed ({MAX_FILES})."
        )

    metadata_dicts = [m.model_dump() for m in request.metadata] if request.metadata else None

    def accumulate_cost(usage: TokenUsage, cost: CostData):
        nonlocal total_usage, total_cost
        total_usage = TokenUsage(
            input_tokens=total_usage.input_tokens + usage.input_tokens,
            output_tokens=total_usage.output_tokens + usage.output_tokens,
            total_tokens=total_usage.total_tokens + usage.total_tokens,
            cached_tokens=total_usage.cached_tokens + usage.cached_tokens,
        )
        total_cost = CostData(
            input_cost=total_cost.input_cost + cost.input_cost,
            output_cost=total_cost.output_cost + cost.output_cost,
            total_cost=total_cost.total_cost + cost.total_cost,
        )

    try:
        result, usage, cost = await btl_client.analyze_workflow(
            request.code,
            metadata_dicts,
            http_connections=request.http_connections,
        )
        accumulate_cost(usage, cost)
        result = result.strip()

        def fix_file_path(path: str, file_paths: list) -> str:
            if not path:
                return path
            if path in file_paths:
                return path
            filename = path.split('/')[-1]
            for input_path in file_paths:
                if input_path.endswith('/' + filename):
                    return input_path
            return path

        if USE_MERMAID_FORMAT:
            MAX_RETRIES = 2
            for attempt in range(MAX_RETRIES + 1):
                clean_result = result
                if clean_result.startswith("```"):
                    clean_result = clean_result.split("\n", 1)[1] if "\n" in clean_result else clean_result[3:]
                if clean_result.endswith("```"):
                    clean_result = clean_result.rsplit("```", 1)[0]

                try:
                    graph = parse_mermaid_response(clean_result.strip())
                    break
                except ValueError as e:
                    if attempt < MAX_RETRIES:
                        correction_prompt = f"""Your previous response could not be parsed. Error: {str(e)[:200]}

CRITICAL FORMAT REMINDER:
1. Output RAW TEXT only - NO markdown backticks
2. Mermaid diagram(s) FIRST, then "---" separator, then "metadata:" section
3. The metadata section must be valid YAML

Example format:
flowchart TD
    %% Workflow: Example
    A[Step] --> B([LLM])

---
metadata:
A: {{file: "file.py", line: 1, function: "func", type: "step"}}
B: {{file: "file.py", line: 10, function: "llm", type: "llm"}}

Please re-analyze the code and output in the CORRECT format."""
                        try:
                            result, retry_usage, retry_cost = await btl_client.analyze_workflow(
                                request.code,
                                metadata_dicts,
                                correction_prompt,
                            )
                            accumulate_cost(retry_usage, retry_cost)
                            result = result.strip()
                        except Exception as retry_err:
                            raise HTTPException(status_code=500, detail=f"Analysis failed after retry: {str(e)}")
                    else:
                        raise HTTPException(status_code=500, detail=f"Analysis failed after {MAX_RETRIES + 1} attempts: {str(e)}")

            if not graph.nodes:
                return AnalyzeResponse(graph=graph, usage=total_usage, cost=total_cost)

            # Store nodes for semantic search
            _stored_nodes.clear()
            for node in graph.nodes:
                f = node.source.file if node.source else "unknown"
                ln = node.source.line if node.source else 0
                _stored_nodes.append({
                    "node_id": node.id,
                    "label": node.label,
                    "node_type": node.type,
                    "file": f,
                    "line": ln,
                    "description": node.description or "",
                    "workflow": graph.workflows[0].name if graph.workflows else "",
                })
                if node.source and node.source.file:
                    node.source.file = fix_file_path(node.source.file, request.file_paths)

            return AnalyzeResponse(graph=graph, usage=total_usage, cost=total_cost)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/analyze/metadata-only")
async def analyze_metadata_only(request: MetadataRequest):
    if not settings.btl_api_key:
        raise HTTPException(status_code=503, detail="BTL API key not configured")

    files_data = [f.model_dump() for f in request.files]
    prompt = build_metadata_only_prompt(files_data)
    if request.code:
        prompt += f"\n\nFull code for context:\n{request.code[:8000]}"

    try:
        result, usage, cost = await btl_client.generate_metadata(prompt)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:]
        if result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]

        try:
            metadata_data = json.loads(result.strip())
        except json.JSONDecodeError:
            result_clean = result.strip()
            open_braces = result_clean.count('{') - result_clean.count('}')
            open_brackets = result_clean.count('[') - result_clean.count(']')
            result_clean += ']' * max(0, open_brackets)
            result_clean += '}' * max(0, open_braces)
            metadata_data = json.loads(result_clean)

        files_result = []
        for file_data in metadata_data.get('files', []):
            functions = [
                FunctionMetadata(
                    name=f.get('name', ''),
                    label=f.get('label', f.get('name', '')),
                    description=f.get('description', '')
                )
                for f in file_data.get('functions', [])
            ]
            files_result.append(FileMetadataResult(
                filePath=file_data.get('filePath', ''),
                functions=functions,
                edgeLabels=file_data.get('edgeLabels', {})
            ))

        return {
            "files": [f.model_dump() for f in files_result],
            "usage": usage.model_dump(),
            "cost": cost.model_dump()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Metadata analysis failed: {str(e)}")


@app.post("/condense-structure")
async def condense_structure(request: CondenseRequest):
    if not settings.btl_api_key:
        raise HTTPException(status_code=503, detail="BTL API key not configured")

    try:
        condensed, usage, cost = await btl_client.condense_repo_structure(request.raw_structure)
        return {
            "condensed_structure": condensed,
            "usage": usage.model_dump(),
            "cost": cost.model_dump()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Structure condensation failed: {str(e)}")


# ── In-memory search index ──────────────────────────────────
_stored_nodes: list[dict] = []


@app.post("/search", response_model=SearchResponse)
async def search_workflows(request: SearchRequest):
    if not settings.btl_api_key:
        raise HTTPException(status_code=503, detail="BTL API key not configured")
    if not _stored_nodes:
        return SearchResponse(results=[])

    try:
        matches = await btl_client.semantic_search(request.query, _stored_nodes, request.limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

    results = []
    for doc in matches:
        results.append(SearchResult(
            node_id=doc.get("node_id", ""),
            label=doc.get("label", ""),
            node_type=doc.get("node_type", ""),
            file=doc.get("file", "unknown"),
            line=doc.get("line", 0),
            workflow=doc.get("workflow", ""),
            similarity=1.0,
        ))
    return SearchResponse(results=results)


def _strip_mermaid(result: str) -> str:
    clean = result.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
    if clean.endswith("```"):
        clean = clean.rsplit("```", 1)[0]
    return clean.strip()


@app.post("/analyze/compare", response_model=CompareResponse)
async def analyze_compare(request: CompareRequest):
    if not settings.btl_api_key:
        raise HTTPException(status_code=503, detail="BTL API key not configured")

    metadata_dicts = [m.model_dump() for m in request.metadata] if request.metadata else None

    try:
        raw_results = await btl_client.analyze_workflow_compare(
            request.code, metadata_dicts, request.http_connections
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Compare analysis failed: {str(e)}")

    compare_results = []
    disagreements = []
    parsed_graphs = []

    for model_name, text, usage, cost, error in raw_results:
        graph = None
        if not error and text:
            try:
                cleaned = _strip_mermaid(text)
                graph = parse_mermaid_response(cleaned)
                parsed_graphs.append(graph)
            except Exception:
                pass

        compare_results.append(CompareResult(
            model=model_name,
            graph=graph.model_dump() if graph else None,
            raw_output=text,
            usage=usage.model_dump(),
            cost=cost.model_dump(),
            error=error,
        ))

    # Compute consensus: compare node counts across successful parses
    if len(parsed_graphs) >= 2:
        node_counts = [len(g.nodes) for g in parsed_graphs]
        nc_set = set(node_counts)
        consensus_score = 1.0 - (len(nc_set) - 1) / max(1, len(parsed_graphs))
        if len(nc_set) > 1:
            for i, (c, g) in enumerate(zip(node_counts, parsed_graphs)):
                if c != max(set(node_counts), key=node_counts.count):
                    disagreements.append(
                        f"{compare_results[i].model}: {c} nodes (majority has {max(set(node_counts), key=node_counts.count)})"
                    )
    else:
        consensus_score = 1.0 if len(parsed_graphs) == 1 else 0.0

    # Store nodes for search after analyze
    if parsed_graphs:
        _stored_nodes.clear()
        for g in parsed_graphs[:1]:
            for node in g.nodes:
                f = node.source.file if node.source else "unknown"
                ln = node.source.line if node.source else 0
                _stored_nodes.append({
                    "node_id": node.id,
                    "label": node.label,
                    "node_type": node.type,
                    "file": f,
                    "line": ln,
                    "description": node.description or "",
                    "workflow": g.workflows[0].name if g.workflows else "",
                })

    return CompareResponse(
        results=compare_results,
        consensus_score=round(consensus_score, 2),
        disagreements=disagreements,
    )


@app.get("/health")
async def health():
    if not settings.btl_api_key:
        return {"status": "ok", "api_key_status": "missing"}

    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.badtheorylabs.com/v1/models",
                headers={"Authorization": f"Bearer {settings.btl_api_key}"},
                timeout=10.0,
            )
            if resp.status_code == 200:
                return {"status": "ok", "api_key_status": "valid"}
            return {"status": "ok", "api_key_status": "invalid"}
    except Exception as e:
        print(f"[HEALTH] BTL API key invalid: {e}")
        return {"status": "ok", "api_key_status": "invalid"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=52104)
