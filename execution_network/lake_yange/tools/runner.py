"""Local tool execution engine.

HONEST LIMITS: the Python sandbox is process isolation with best-effort hardening (isolated mode, empty env,
cwd in the workspace, CPU/file-size rlimits, wall-clock timeout, socket disabled in-process). It is NOT a
security boundary against hostile code (no seccomp/namespaces/containers). The real control is that nothing runs
without a human-signed, single-use token; humans must read the code they sign.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional
from urllib.parse import quote

from lake_yange.middleware.auth_gate import AgentActionProposal
from lake_yange.tools.schemas import (MAX_FILE_BYTES, DatabaseQueryTool, FileSystemTool, PythonSandboxTool,
                                      parse_tool_call)

MAX_OUTPUT_CHARS = 4000
MAX_ROWS = 1000
VIRTUAL_ROOT = "/workspace"


class ToolRefused(Exception):
    pass


class PathViolation(ToolRefused):
    pass


def resolve_in_workspace(root: Path, user_path: str) -> Path:
    """Map a user path into the workspace; reject traversal, absolute escapes and symlink escapes."""
    if "\x00" in user_path:
        raise PathViolation("NUL in path.")
    p = user_path
    if p == VIRTUAL_ROOT:
        p = "."
    elif p.startswith(VIRTUAL_ROOT + "/"):
        p = p[len(VIRTUAL_ROOT) + 1:]
    if os.path.isabs(p) or ".." in Path(p).parts:
        raise PathViolation(f"Path {user_path!r} escapes the workspace.")
    real_root = root.resolve()
    target = (real_root / p).resolve()  # resolves symlinks of existing components
    if target != real_root and real_root not in target.parents:
        raise PathViolation(f"Path {user_path!r} resolves outside the workspace.")
    return target


def workspace_state_hash(root: Path) -> str:
    h = hashlib.sha256()
    base = root.resolve()
    for path in sorted(base.rglob("*")):
        if path.is_file() and not path.is_symlink():
            h.update(str(path.relative_to(base)).encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


_BOOTSTRAP = (
    "import sys, socket\n"
    "def _blocked(*a, **k): raise OSError('network disabled in sandbox')\n"
    "socket.socket = _blocked; socket.create_connection = _blocked; socket.getaddrinfo = _blocked\n"
    "exec(compile(sys.stdin.read(), '<sandbox>', 'exec'), {'__name__': '__main__'})\n"
)


def _limits() -> None:  # pragma: no cover - runs in the child
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES * 10, MAX_FILE_BYTES * 10))


class ToolRunner:
    """Executor for the gateway. Direct calls are refused: only an `ArmedExecutor` from adapters.py (which the
    gateway invokes after redeeming the human token) arms it for one proposal hash."""

    def __init__(self, workspace: Path) -> None:
        self.workspace = Path(workspace)
        self.workspace.mkdir(parents=True, exist_ok=True)
        self._armed: Optional[str] = None
        self.last_io: dict = {}

    @contextmanager
    def _arm(self, p_hash: str) -> Iterator[None]:
        self._armed = p_hash
        try:
            yield
        finally:
            self._armed = None

    def __call__(self, proposal: AgentActionProposal) -> str:
        from lake_yange.middleware.auth_gate import proposal_hash
        if self._armed is None or self._armed != proposal_hash(proposal):
            raise ToolRefused("Tool runner refuses direct invocation: no token-authorized call in progress.")
        call = parse_tool_call(proposal.payload)
        if proposal.action_type != f"tool:{call.tool}":
            raise ToolRefused("action_type does not match the tool payload.")
        pre = workspace_state_hash(self.workspace)
        if isinstance(call, PythonSandboxTool):
            out = self._python(call)
        elif isinstance(call, FileSystemTool):
            out = self._fs(call)
        else:
            out = self._db(call)
        post = workspace_state_hash(self.workspace)
        return json.dumps({"tool": call.tool, "pre_state_hash": pre, "post_state_hash": post,
                           "output": out[:MAX_OUTPUT_CHARS]}, sort_keys=True)

    def _python(self, call: PythonSandboxTool) -> str:
        try:
            r = subprocess.run([sys.executable, "-I", "-c", _BOOTSTRAP], input=call.code, capture_output=True,
                               text=True, cwd=str(self.workspace.resolve()), env={}, timeout=call.timeout_s,
                               preexec_fn=_limits)
        except subprocess.TimeoutExpired:
            raise ToolRefused(f"Python sandbox timed out after {call.timeout_s}s.")
        self.last_io = {"stdout": r.stdout[-4000:], "stderr": r.stderr[-4000:], "returncode": r.returncode}
        if r.returncode != 0:
            raise ToolRefused(f"Python exited {r.returncode}: {r.stderr[-800:]}")
        return r.stdout

    def _fs(self, call: FileSystemTool) -> str:
        target = resolve_in_workspace(self.workspace, call.path)
        if call.op == "list":
            if not target.is_dir():
                raise ToolRefused("Not a directory.")
            return json.dumps(sorted(p.name for p in target.iterdir()))
        if call.op == "read":
            if not target.is_file() or target.stat().st_size > MAX_FILE_BYTES:
                raise ToolRefused("Not a readable file within size limit.")
            return target.read_text(encoding="utf-8")
        if call.content is None:
            raise ToolRefused("write requires content.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(call.content, encoding="utf-8")
        return f"wrote {len(call.content.encode())} bytes"

    def _db(self, call: DatabaseQueryTool) -> str:
        path = resolve_in_workspace(self.workspace, call.db_path)
        read = call.mode == "read"
        if read and not path.is_file():
            raise ToolRefused("Database does not exist.")
        uri = f"file:{quote(str(path))}?mode={'ro' if read else 'rwc'}"
        conn = sqlite3.connect(uri, uri=True)

        def authorizer(action: int, *_: Any) -> int:
            if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_PRAGMA):
                return sqlite3.SQLITE_DENY
            if read and action not in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION,
                                       sqlite3.SQLITE_RECURSIVE):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        conn.set_authorizer(authorizer)
        try:
            cur = conn.execute(call.sql, call.params)  # single statement only (sqlite3 enforces)
            rows = cur.fetchmany(MAX_ROWS) if cur.description else []
            if not read:
                conn.commit()
            return json.dumps({"rows": rows, "rowcount": cur.rowcount}, default=str)
        except sqlite3.Error as exc:
            raise ToolRefused(f"SQL refused/failed: {exc}") from exc
        finally:
            conn.close()
