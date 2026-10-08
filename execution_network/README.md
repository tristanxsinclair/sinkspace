# Lake Yange bounded-agent middleware (Python)

Offline, no network. Needs `pydantic>=2`, `cryptography`, `pytest`:

    python3 -m venv .venv-lake && .venv-lake/bin/pip install pydantic cryptography pytest
    cd execution_network && ../.venv-lake/bin/python -m pytest

The code avoids 3.10+ syntax so it also runs on the system Python 3.9 (it targets 3.12+ in production).
Spending tiers: T0 < $100, T1 $100-$1,000, T2 > $1,000-$10,000 (2 stewards + 6h lock), T3 > $10,000 (3 stewards + 24h lock).
Treasury scenarios A, B, D, E, F, G are placeholders; only C is from the brief.
Known limits: in-memory proposal state, single-process, HS256 gate secret is per-process, ledger chain has no external anchor,
execution outside the gateway cannot be detected by this code, and none of this touches real money.

## Hardening layer (v0.2)

| Module | Purpose | Honest limits |
|---|---|---|
| `storage/encrypted_store.py` | SQLite KV store, per-record AES-256-GCM (AAD binds kind:id); persists proposals, session-key hashes/revocations, kill switch, steward registry, gate secret, JWT jti state | Record-level encryption only (kind/id/row counts visible); key is a local 0600 file, not in a keystore |
| `middleware/hsm.py` | `StewardSigner` interface, `SignatureAggregator`, PKCS#11 Ed25519 adapter | Adapter is **untested against real hardware** (PyKCS11 not installed here); tests use a software double |
| `middleware/auth_gate.py` | `hsm_required_tiers` (use `{2,3}`) counts only HSM-enrolled steward keys; a bad hardware signature revokes that steward key (persisted, ledger-logged) | Enrolment is trust-on-first-use; no attestation that a key is truly in hardware |
| `treasury/trust_deed.py` | Rule engine for tier movements: trustee resolution, 15-year sunset, 24-month Tier 1 runway, Tier 3 cap, Art. 16.1 outflow limit | **Not legal advice.** Art. 16.1 text was unavailable; the 5% outflow rule is an assumption. No real trust/ACN exists |
| `audit/archive.py` | Write-once JSONL export (header, entries, proofs, footer hash) + `verify_archive` | "Proofs" are hash commitments, not ZK/attested; no external anchor of the head hash |

Not production-ready: no real HSM verification, no external ledger anchoring, no legal review, no key ceremony/backup, single-process only. Uses Python 3.9-compatible syntax; dependencies: pydantic, cryptography (pytest for tests).

## Local tools, offline RAG, orchestration (v0.3)

- `tools/schemas.py` (python_sandbox, filesystem, database calls; the payload is hash-bound to the human signature; target is never `sandbox:*`, so a human signature is always required), `tools/runner.py` (executes only when armed), `tools/adapters.py` (`GatedToolAdapter`: the only path to the runner, via `gateway.execute` -> single-use 60s token).
- `research/vector_store.py` (stdlib TF-IDF + sqlite, hashed chunks with offsets, re-verifiable) and `research/deep_research.py` (Prime decomposes, Vera builds the evidence matrix and audits claims). Read-only; no execution authority. A local LLM can be injected as a `str -> str` callable; none is bundled or tested.
- `agents/orchestrator.py`: draft -> Vera vet -> human signature -> Forge -> Vera review, all in the Red Sink chain (approval entry lists steward ids and signature prefixes; execution result carries pre/post workspace state hashes).

Limits: the Python sandbox is best-effort process isolation (not a security boundary; no network namespace), a Vera veto only gates this orchestrator (a human can still sign directly via the gateway), and nothing here is production-ready.

## Container sandbox and gateway Vera veto (v0.4)

- `tools/container_runner.py`: `ContainerToolRunner` runs Python/filesystem tools in `podman|docker run --rm --read-only --network=none --cap-drop=ALL --no-new-privileges --pids/--memory/--cpus --user 65534`, workspace-only mount (ro for read/list). Fails closed with no engine unless `allow_fallback=True` (stamped process-level isolation). **Not run against a real engine here** (none installed); the command line is asserted via a recording `MockEngine`, which gives no isolation. DB tools still run host-side.
- `BoundedAgentGateway.vera_veto` (Vera only, persisted) sets status `BLOCKED_BY_VERA`. `authorize` then refuses unless a `TIER_3_EMERGENCY_OVERRIDE` is supplied with >=3 distinct valid steward signatures bound to that proposal hash (HSM-only if tier 3 requires HSM), in addition to the normal quorum; this logs a CRITICAL `EMERGENCY_OVERRIDE` ledger entry and an alert. `execute` also refuses any proposal still blocked (covers a veto after a token was issued). The veto is set via a gateway call, not a field of the signed proposal (which would change its hash).

## Command Center UI (`lake_yange/ui_api.py`, `lake_yange/ui/index.html`)

Offline, single-file dark UI served by a local FastAPI bridge.

```
PYTHONPATH=. ../.venv-lake/bin/python -m lake_yange.ui_api --state-dir ./ui_state --demo
# open http://127.0.0.1:8000/
```

`--demo` seeds 3 proposals, treasury/CII demo figures and writes steward
PRIVATE seeds to `<state>/demo_stewards.json` (0600). In the page, load that
file with the "Signer" picker; signing happens in the browser (WebCrypto
Ed25519) and keys never reach the server. "HSM / External Signer" shows the
exact bytes to sign and accepts a pasted base64 signature.

Security model and limits: loopback only (Host check), writes require a
per-process `X-LY-Session` header and reject cross-origin requests, CSP with no
external sources, all failures closed (403 bad signature/token, 409 conflict,
423 time-lock). The 60s token is returned to the browser as a bearer secret.
Browsers cannot speak PKCS#11, so there is no direct hardware path. Scenario C
is a simulation on a copy. Module 10 enrolment is only a recommendation. No
accounts, TLS or multi-process support; demo keys are for rehearsal only.
Not production-ready.

## External anchoring, override time-lock, hardware diagnostics

- `audit/anchor.py`: `LedgerAnchorManager.snapshot(ledger)` appends a signed anchor
  `[anchor_id, timestamp, head_hash, block_height, previous_anchor_hash, signature]` to an anchor file.
  `verify_anchor_chain(archive_or_ledger, anchor_file, witness_public_key)` detects edited, truncated or fully
  re-chained history. Exports: RFC 3161 TimeStampReq (DER), `git tag -s` argv/runner, plain witness-log line.
  **Limit:** this only protects you if the anchor file, witness public key and (ideally) the witness private
  key are kept off this host. Nothing is submitted to any timestamp authority or log by this code; `git tag -s`
  needs your GPG key. The UI reads `anchors.jsonl` + `anchor_witness.pub` (hex) from the state dir, if present.
- `middleware/time_lock.py`: with a `TimeLockEngine` configured (the UI does this by default), a 3-steward
  `TIER_3_EMERGENCY_OVERRIDE` only files `PENDING_TIME_LOCK`; the veto stays until 86400s have elapsed, and any
  2 stewards can sign `CANCEL_OVERRIDE` before then. `BoundedAgentGateway` without an engine keeps the old
  immediate-override behaviour (library default, kept for backward compatibility). The countdown trusts the host clock.
- `hardware/diagnostics.py`: `HardwareDiagnosticHarness.report()` -> `LIVE_HARDWARE` only if a PKCS#11 token is
  present AND passes an attestation callback you supply AND a docker/podman socket answers a well-formed `_ping`;
  otherwise `SOFTWARE_SIMULATION` with the reason. Served at `/api/hardware`. **Not tested against real
  hardware**: no YubiKey, PyKCS11 or container engine exists on this machine; tests use fakes and a local socket.

## Unified hub (single page, four views)

`http://127.0.0.1:8000/` is one offline SPA with a shared header (air-gapped, hardware mode, anchor status, clock,
session) and four views: 1 System Map (SVG; hover/click nodes for live state + source file), 2 Command Center
(signing, veto/time-lock, audit stream), 3 Dashboard (treasury, Scenario C, CII), 4 Bento overview (read-only
summary). New endpoints: `GET /api/system/map`, `GET /api/state/full` (one payload incl. a `version` token).
Real-time = 5s polling of `/api/state/full` plus a same-browser `BroadcastChannel` that refreshes other tabs right
after a write; there is no WebSocket. Anchor badge says "NOT CONFIGURED" (not "SEALED") until an anchor file exists.

## The Realm (canvas world view)

`#realm` (the default view) renders the system as a 24x13 tile world on an HTML5 canvas: no libraries, assets drawn in code.
Buildings come from `GET /api/system/map` -> `world` (tile coordinates, agent patrol paths, roads, and a `status` computed
server-side from real node state), so the picture can only show what the backend reports. Pan by dragging, zoom with the wheel.
Clicking a building opens a slide-over that re-uses the live panels (Citadel/Vera/Spire: signing queue and override;
Vaults: treasury and Scenario C; Red Sink: audit stream; Arena: CII). Proposal caravans sit at their lifecycle stage; the
drawbridge, 60s token ring, Vera stasis field and Spire override ring reflect real state. Scenario C and the lightning/dome
are a visual layer over the existing simulation endpoint and change no real state. Not tested on touch devices.

## Missions & Key Vault

**Missions** (`lake_yange/agents/missions.py`) move through five milestones: 0% scoping (Prime + RAG evidence) → 25% audit & proposal (Vera matrix: `CLEARED`/`VERA_VETO`) → 50% human gate (Ed25519 quorum, single-use 60s token) → 75–90% sandbox run (Forge; stdout/stderr and pre/post file hashes captured) → 100% sealed (Vera verifies the receipt, Red Sink `MISSION_SEALED`). Skip-ahead is refused at every step. If the token expires or is lost, the mission rolls back from 75% to the 50% gate (`GATE_REOPENED`) and can be re-authorized.

Endpoints: `GET/POST /api/missions`, `GET /api/missions/{id}`, `POST /api/missions/{id}/authorize|run`, `POST /api/rag/ingest`, `GET /api/stewards/{sid}/revoke-message`, `POST /api/stewards/{sid}/revoke`.

**Key Vault** (🔑 header button): keys load into browser memory as non-extractable WebCrypto keys and are never sent to the server; signatures are made over the exact proposal payload hash. Revocation is signed by any active steward and logs `REVOCATION_EVENT`.

Limits: Vera's audit is static rule checking, not a safety proof; CII impact is informational. The browser cannot talk to PKCS#11, so hardware signing is a paste-the-signature flow, untested on real devices. Tokens are memory-only, so a server restart rolls a 75% mission back to 50%. Revocation by a single steward is irreversible via the API. Not production-ready.
