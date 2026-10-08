"""Structured, JSON-schema-compatible tool-call payloads. A proposal's `payload` IS the tool call, so the human
signature (which covers the proposal hash) binds the exact code / path / SQL that will run."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Tuple, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

MAX_CODE_CHARS = 20_000
MAX_FILE_BYTES = 1_000_000


class _ToolBase(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    evidence_chunk_hashes: List[str] = Field(default_factory=list, description="Vector-store chunk hashes cited.")


class PythonSandboxTool(_ToolBase):
    tool: Literal["python_sandbox"] = "python_sandbox"
    code: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    timeout_s: float = Field(default=5.0, gt=0, le=30)


class FileSystemTool(_ToolBase):
    tool: Literal["filesystem"] = "filesystem"
    op: Literal["read", "write", "list"]
    path: str = Field(min_length=1, description="Relative to the workspace root, or under /workspace/.")
    content: Optional[str] = Field(default=None, max_length=MAX_FILE_BYTES)


class DatabaseQueryTool(_ToolBase):
    tool: Literal["database"] = "database"
    db_path: str = Field(min_length=1, description="SQLite file inside the workspace.")
    sql: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    params: List[Any] = Field(default_factory=list)
    mode: Literal["read", "write"] = "read"


ToolCall = Union[PythonSandboxTool, FileSystemTool, DatabaseQueryTool]
_ADAPTER: TypeAdapter = TypeAdapter(Union[PythonSandboxTool, FileSystemTool, DatabaseQueryTool])


def parse_tool_call(data: Dict[str, Any]) -> ToolCall:
    """Strict parse; unknown tools or extra fields raise pydantic.ValidationError."""
    return _ADAPTER.validate_python(data)


def tool_json_schemas() -> Dict[str, Dict[str, Any]]:
    return {m.model_fields["tool"].default: m.model_json_schema()
            for m in (PythonSandboxTool, FileSystemTool, DatabaseQueryTool)}


def to_proposal_args(call: ToolCall) -> Tuple[str, str, Dict[str, Any]]:
    """(action_type, target_system, payload). The target is deliberately NOT `sandbox:*`, so Tier-0 auto-approval
    never applies: every tool call needs at least one human steward signature."""
    return f"tool:{call.tool}", f"workspace:{call.tool}", call.model_dump(mode="json")
