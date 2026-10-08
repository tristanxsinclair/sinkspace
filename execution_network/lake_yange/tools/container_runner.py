"""OS-container tool runner (Podman/Docker). Extends ToolRunner; Python and filesystem tools run in an ephemeral
container: --network=none, --read-only root, --cap-drop=ALL, no-new-privileges, pids/memory/cpu limits, non-root,
only the workspace mounted (read-only for read/list).

FAIL-CLOSED: with no container engine and `allow_fallback=False` (default) execution is refused. Fallback to the
v0.3 process-level runner must be requested explicitly and is stamped isolation="process-fallback" in the result.
This module was NOT exercised against a real engine in this environment (neither podman nor docker is installed);
tests verify the exact command line through a recording engine. Database tools stay host-side (read-only
authorizer in ToolRunner); the DB file is inside the workspace but sqlite runs in the host process.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable, List, Optional, Sequence

from lake_yange.tools.runner import (MAX_FILE_BYTES, ToolRefused, ToolRunner, resolve_in_workspace)
from lake_yange.tools.schemas import FileSystemTool, PythonSandboxTool

Engine = Callable[[Sequence[str], str, float], "subprocess.CompletedProcess[str]"]

_NET_BLOCK = ("import socket\n"
              "def _b(*a, **k): raise OSError('network disabled')\n"
              "socket.socket = _b; socket.create_connection = _b; socket.getaddrinfo = _b\n")


class ContainerUnavailable(ToolRefused):
    pass


def subprocess_engine(argv: Sequence[str], stdin: str, timeout: float) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(list(argv), input=stdin, capture_output=True, text=True, timeout=timeout)


class MockEngine:
    """For tests / non-container hosts: records argv and returns a canned result. Provides NO isolation."""
    isolation = "mock"

    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.calls: List[dict] = []
        self._rc, self._out, self._err = returncode, stdout, stderr

    def __call__(self, argv: Sequence[str], stdin: str, timeout: float) -> "subprocess.CompletedProcess[str]":
        self.calls.append({"argv": list(argv), "stdin": stdin, "timeout": timeout})
        return subprocess.CompletedProcess(list(argv), self._rc, self._out, self._err)


def detect_engine() -> Optional[str]:
    return shutil.which("podman") or shutil.which("docker")


class ContainerToolRunner(ToolRunner):
    def __init__(self, workspace: Path, engine_binary: Optional[str] = None, image: str = "python:3.12-slim",
                 engine: Engine = subprocess_engine, allow_fallback: bool = False,
                 memory: str = "128m", cpus: str = "1", pids: int = 64) -> None:
        super().__init__(workspace)
        self.engine_binary = engine_binary if engine_binary is not None else detect_engine()
        self.image, self._engine, self.allow_fallback = image, engine, allow_fallback
        self.memory, self.cpus, self.pids = memory, cpus, pids
        self.last_isolation = "none"

    def build_argv(self, writable: bool) -> List[str]:
        if not self.engine_binary:
            raise ContainerUnavailable("No podman/docker engine available.")
        mount = f"{self.workspace.resolve()}:/workspace:{'rw' if writable else 'ro'}"
        return [self.engine_binary, "run", "--rm", "-i", "--read-only", "--network=none", "--cap-drop=ALL",
                "--security-opt=no-new-privileges", f"--pids-limit={self.pids}", f"--memory={self.memory}",
                f"--cpus={self.cpus}", "--user=65534:65534", "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
                "-v", mount, "-w", "/workspace", self.image, "python", "-I", "-c",
                "import sys; exec(compile(sys.stdin.read(), '<sandbox>', 'exec'), {'__name__': '__main__'})"]

    def _run(self, code: str, writable: bool, timeout: float) -> str:
        try:
            r = self._engine(self.build_argv(writable), _NET_BLOCK + code, timeout)
        except subprocess.TimeoutExpired:
            raise ToolRefused(f"Container timed out after {timeout}s.")
        except FileNotFoundError as exc:
            raise ContainerUnavailable(f"Container engine not runnable: {exc}") from exc
        if r.returncode != 0:
            raise ToolRefused(f"Container exited {r.returncode}: {r.stderr[-800:]}")
        self.last_isolation = getattr(self._engine, "isolation", "container")
        return r.stdout

    def _usable(self) -> bool:
        if self.engine_binary:
            return True
        if self.allow_fallback:
            self.last_isolation = "process-fallback"
            return False
        raise ContainerUnavailable("No container engine; refusing to execute (fail closed).")

    def _python(self, call: PythonSandboxTool) -> str:
        if not self._usable():
            return super()._python(call)
        return self._run(call.code, writable=True, timeout=call.timeout_s + 10)

    def _fs(self, call: FileSystemTool) -> str:
        resolve_in_workspace(self.workspace, call.path)  # host-side traversal check, before any container starts
        if not self._usable():
            return super()._fs(call)
        spec = json.dumps({"op": call.op, "path": call.path, "content": call.content, "max": MAX_FILE_BYTES})
        code = (
            "import json, os\n"
            f"s = json.loads({spec!r})\n"
            "p = s['path']\n"
            "p = '.' if p == '/workspace' else (p[len('/workspace/'):] if p.startswith('/workspace/') else p)\n"
            "root = os.path.realpath('/workspace'); t = os.path.realpath(os.path.join(root, p))\n"
            "assert t == root or t.startswith(root + os.sep), 'escape'\n"
            "if s['op'] == 'list': print(json.dumps(sorted(os.listdir(t))), end='')\n"
            "elif s['op'] == 'read':\n"
            "    assert os.path.getsize(t) <= s['max']; print(open(t, encoding='utf-8').read(), end='')\n"
            "else:\n"
            "    os.makedirs(os.path.dirname(t), exist_ok=True); open(t, 'w', encoding='utf-8').write(s['content'])\n"
            "    print('wrote %d bytes' % len(s['content'].encode()), end='')\n")
        return self._run(code, writable=call.op == "write", timeout=15)
