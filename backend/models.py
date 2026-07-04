from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class LocationMetadata(BaseModel):
    line: int
    type: str
    description: str
    function: str
    variable: Optional[str] = None


class FileMetadata(BaseModel):
    file: str
    locations: List[LocationMetadata]
    relatedFiles: List[str]


class AnalyzeRequest(BaseModel):
    code: str
    file_paths: List[str]
    framework_hint: Optional[str] = None
    metadata: List[FileMetadata] = []
    http_connections: Optional[str] = None


class CompareRequest(BaseModel):
    code: str
    file_paths: List[str]
    metadata: List[FileMetadata] = []
    http_connections: Optional[str] = None


class SearchRequest(BaseModel):
    query: str
    limit: int = 10


class SearchResult(BaseModel):
    node_id: str
    label: str
    node_type: str
    file: str
    line: int
    workflow: str
    similarity: float


class SearchResponse(BaseModel):
    results: List[SearchResult]


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]


class CompareResult(BaseModel):
    model: str
    graph: Optional[Any] = None
    raw_output: str
    usage: Optional[Any] = None
    cost: Optional[Any] = None
    error: Optional[str] = None


class CompareResponse(BaseModel):
    results: List[CompareResult]
    consensus_score: float
    disagreements: List[str]


class SourceLocation(BaseModel):
    file: str
    line: int
    function: Optional[str] = None


class EdgePayload(BaseModel):
    name: str
    type: str
    description: str


class GraphEdge(BaseModel):
    source: str
    target: str
    label: Optional[str] = None
    payload: Optional[EdgePayload] = None
    condition: Optional[str] = None


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    description: Optional[str] = None
    source: Optional[SourceLocation] = None
    model: Optional[str] = None
    temperature: Optional[float] = None


class ComponentMetadata(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    nodeIds: List[str]


class WorkflowMetadata(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    nodeIds: List[str]
    components: List[ComponentMetadata] = []


class WorkflowGraph(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    llms_detected: List[str] = []
    workflows: List[WorkflowMetadata] = []


class FunctionContext(BaseModel):
    name: str
    line: int
    type: str
    calls: List[str]
    code: Optional[str] = None


class FileStructureContext(BaseModel):
    filePath: str
    functions: List[FunctionContext]
    imports: List[str]


class MetadataRequest(BaseModel):
    files: List[FileStructureContext]
    code: Optional[str] = None


class FunctionMetadata(BaseModel):
    name: str
    label: str
    description: str


class FileMetadataResult(BaseModel):
    filePath: str
    functions: List[FunctionMetadata]
    edgeLabels: Dict[str, str] = {}


class CondenseRequest(BaseModel):
    raw_structure: str


class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cached_tokens: int = 0


class CostData(BaseModel):
    input_cost: float
    output_cost: float
    total_cost: float


class AnalyzeResponse(BaseModel):
    graph: WorkflowGraph
    usage: Optional[TokenUsage] = None
    cost: Optional[CostData] = None
