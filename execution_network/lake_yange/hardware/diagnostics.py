"""Hardware and container diagnostics. Detection only: nothing here signs, runs a container or changes state.

Fails closed: a component is reported LIVE_HARDWARE only when a device/daemon was positively detected AND answered
with a well-formed response. Missing, malformed, or failed-attestation results all report SOFTWARE_SIMULATION with a
reason. Detection is a statement about this moment on this host, not a security guarantee.
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import socket
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence

LIVE, SIMULATION = "LIVE_HARDWARE", "SOFTWARE_SIMULATION"

PKCS11_LIBRARY_CANDIDATES = (
    "/usr/lib/x86_64-linux-gnu/libykcs11.so", "/usr/lib/libykcs11.so", "/usr/local/lib/libykcs11.dylib",
    "/opt/homebrew/lib/libykcs11.dylib", "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
    "/usr/lib/opensc-pkcs11.so", "/Library/OpenSC/lib/opensc-pkcs11.so",
    "/opt/homebrew/lib/opensc-pkcs11.so", "/usr/local/lib/opensc-pkcs11.so",
)


def _socket_candidates() -> List[str]:
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    home = str(Path.home())
    out = ["/var/run/docker.sock", "/run/docker.sock", "/run/podman/podman.sock",
           f"{home}/.docker/run/docker.sock", f"{home}/.local/share/containers/podman/machine/podman.sock"]
    if runtime:
        out += [f"{runtime}/podman/podman.sock", f"{runtime}/docker.sock"]
    return out


def _ping_unix_socket(path: str, timeout: float = 2.0) -> str:
    """HTTP GET /_ping over a local unix socket (Docker and Podman both answer 'OK'). No network involved."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        s.connect(path)
        s.sendall(b"GET /_ping HTTP/1.0\r\nHost: localhost\r\n\r\n")
        data = b""
        while len(data) < 4096:
            chunk = s.recv(1024)
            if not chunk:
                break
            data += chunk
    return data.decode("latin-1")


class HardwareDiagnosticHarness:
    def __init__(self, pkcs11_libraries: Optional[Sequence[str]] = None,
                 socket_paths: Optional[Sequence[str]] = None,
                 import_module: Callable[[str], Any] = importlib.import_module,
                 ping: Callable[[str], str] = _ping_unix_socket,
                 which: Callable[[str], Optional[str]] = shutil.which,
                 attest: Optional[Callable[[Dict[str, Any]], bool]] = None,
                 clock: Optional[Callable[[], datetime]] = None) -> None:
        self._libs = list(pkcs11_libraries if pkcs11_libraries is not None else PKCS11_LIBRARY_CANDIDATES)
        self._sockets = list(socket_paths if socket_paths is not None else _socket_candidates())
        self._import, self._ping, self._which, self._attest = import_module, ping, which, attest
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def check_pkcs11_device(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {"mode": SIMULATION, "pykcs11_installed": False, "library": None, "tokens": [],
                               "attested": False, "reason": ""}
        try:
            pk = self._import("PyKCS11")
            res["pykcs11_installed"] = True
        except Exception:
            res["reason"] = "PyKCS11 runtime library is not installed."
            return res
        libs = [p for p in self._libs if Path(p).exists()]
        if not libs:
            res["reason"] = "No PKCS#11 module (libykcs11 / opensc-pkcs11) found."
            return res
        res["library"] = libs[0]
        try:
            lib = pk.PyKCS11Lib()
            lib.load(libs[0])
            tokens = []
            for slot in lib.getSlotList(tokenPresent=True):
                info = lib.getTokenInfo(slot)
                label, maker = str(info.label).strip(), str(info.manufacturerID).strip()
                if not label and not maker:
                    raise ValueError("token returned an empty TokenInfo")
                tokens.append({"slot": int(slot), "label": label, "manufacturer": maker,
                               "model": str(info.model).strip(), "serial": str(info.serialNumber).strip()})
        except Exception as exc:
            res["reason"] = f"FAILED CLOSED: PKCS#11 module returned an error or malformed response ({exc})."
            return res
        res["tokens"] = tokens
        if not tokens:
            res["reason"] = "PKCS#11 module loaded but no token is present."
            return res
        if self._attest is None:
            res["reason"] = "Token present but no attestation callback configured; not trusted as live."
            return res
        try:
            ok = bool(self._attest(tokens[0]))
        except Exception as exc:
            res["reason"] = f"FAILED CLOSED: attestation raised ({exc})."
            return res
        if not ok:
            res["reason"] = "FAILED CLOSED: token failed attestation."
            return res
        res.update(mode=LIVE, attested=True, reason="Token present and attested.")
        return res

    def check_container_engine(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {"mode": SIMULATION, "sockets": [], "cli": {}, "engine": None, "reason": ""}
        for name in ("podman", "docker"):
            res["cli"][name] = self._which(name)
        for path in self._sockets:
            try:
                is_sock = stat.S_ISSOCK(os.stat(path).st_mode)
            except OSError:
                continue
            if not is_sock:
                continue
            entry: Dict[str, Any] = {"path": path, "responsive": False}
            try:
                reply = self._ping(path)
                entry["responsive"] = reply.startswith("HTTP/") and reply.rstrip().endswith("OK")
                if not entry["responsive"]:
                    entry["error"] = "malformed _ping response"
            except Exception as exc:
                entry["error"] = str(exc)
            res["sockets"].append(entry)
        live = [s for s in res["sockets"] if s["responsive"]]
        if live:
            res.update(mode=LIVE, engine="podman" if "podman" in live[0]["path"] else "docker",
                       reason=f"Engine socket {live[0]['path']} answered _ping.")
        elif res["sockets"]:
            res["reason"] = "FAILED CLOSED: a socket exists but did not answer a well-formed _ping."
        else:
            res["reason"] = "No docker/podman unix socket found."
        return res

    def report(self) -> Dict[str, Any]:
        pk, ce = self.check_pkcs11_device(), self.check_container_engine()
        return {"generated_at": self._clock().astimezone(timezone.utc).isoformat(),
                "mode": LIVE if pk["mode"] == LIVE and ce["mode"] == LIVE else SIMULATION,
                "pkcs11": pk, "container_engine": ce}

    def report_json(self) -> str:
        return json.dumps(self.report(), sort_keys=True, indent=2)
