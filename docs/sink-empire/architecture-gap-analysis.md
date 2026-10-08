# Sink Empire / Lake Yange architecture gap analysis

Observed 2026-10-03. This is a bounded architecture map based on the runtime entry points, contracts, persistence, model adapters, governance, console routes and relevant tests inspected for this change. It is not a line-by-line review of every module, and it does not claim external deployment or production verification.

## System audit

| Area | What exists now | Gap or boundary |
| --- | --- | --- |
| Package and runtime | Private TypeScript/Node package with `runtime/`, `agents/`, `console/`, `test/`, and a separate static `dist/` site. Build, typecheck, lint, test, eval, run, serve, mission, and console commands are declared in `package.json`. | The root README documents the static business site, not the execution runtime or its operator workflow. |
| Prime and orchestration | Deterministic Prime command interpreters, a mission intake schema, an orchestrator that plans tasks, validates dependencies, assigns registered agents, enforces budgets, and creates receipts. The bounded capability-inventory steps now come from a versioned workflow registry entry. | Mission/workflow selection and non-inventory execution remain concentrated in `runtime/orchestrator.ts`; new sector workflow IDs still require intake/runtime integration. |
| Agents and Academy | Validated agent definitions and a JSON registry; Academy courses, assignments, evaluation, graduation and persisted learning modules are present. | Agent definitions and executable task behavior are separate: the registry alone does not supply an independently installable task executor or a general delegation protocol. |
| Tools and authority | `ExecutionContext` exposes repository read/inventory and bounded system/public research operations through typed, versioned capabilities with schemas, risk, permissions, resource limits and evidence requirements; central tool policy checks remain authoritative. | Existing underlying tool handlers and authorization policy remain in core. A plugin may compose existing permissions, but adding a new permission/executable tool still requires explicit policy and handler integration. |
| Evidence and provenance | Runs persist artifacts, claims, evidence, verification, events, usage, budgets, agent snapshots and scope-limited memory. Capability events link the capability and its evidence IDs; memory is stored and sealed in existing run/receipt records. | Hashes establish integrity relative to a trusted reference, not external authenticity. Memory is confined to a mission run and per-agent working scope; there is no durable cross-mission/project memory provider. |
| Persistence and recovery | `RunStore` has file and in-memory adapters; Lake Yange and Academy have separate stores. Run files are schema-checked, snapshots are atomic, and sealed receipts use exclusive creation. | The file store is single-process development persistence. It does not resume interrupted work; the CLI stops if it finds an active run after restart. Multi-process execution needs a transactional backend and defined recovery semantics. |
| Models | Deterministic local intelligence and optional OpenAI intelligence adapters exist. A separate Model Commons interface and loopback-only llama.cpp runtime are also present. | The current intelligence adapter selector is a small fixed choice, not a provider/plugin registry. The llama.cpp runtime is not selected by that adapter selector. |
| Lake Yange and governance | Separate schemas and modules model citizens, capabilities, authority, institutions, agent actions, scheduling, constitutional decisions and governance incidents. | There is not yet one demonstrated, sector-neutral execution contract joining all these subsystems, Prime missions, tool permissions, memory and operator approvals. |
| API and operator interface | HTTP command-centre and console-server implementations expose runtime/operator surfaces; a browser console and static site are present. | The audit did not exercise every route or verify UI parity for every underlying subsystem. Runtime behavior must continue to be validated against stored state rather than presentation alone. |
| Evaluation | A broad TypeScript test suite and scenario/evaluation code cover governance, missions, agents, Academy, model adapters, receipts and engineering flows. | Current full-suite run has one known failure in Prime's Academy next-lesson command parsing; see verification notes below. |

## Existing, broken, disconnected, duplicated, missing, risky

### Existing

- The repository contains an executable, typed runtime rather than only agent prompts.
- Mission runs have explicit state, dependencies, permissions, resource budgets, events, evidence and verification.
- High-impact tool categories are not made executable merely by requesting approval; they remain disabled in policy.
- The command-line runner detects interrupted runs rather than reporting them as successful.
- The production static site is separate from the local execution data and runtime.

### Broken or unverified

- `npm test` completed with 344/345 passing. The isolated failure is `Prime recognizes Academy next lesson command` (expected `ACADEMY_NEXT_LESSON`, received `UNSUPPORTED`); the focused capability and Prime execution tests pass.
- `npm run typecheck`, `npm run build`, and `npm run eval` passed. The evaluation suite passed all 25 scenarios.
- The full console, server, model-provider and deployment paths were not exercised in a live production environment.

### Disconnected

- The root README is focused on static-site operation and does not describe the runtime.
- The run/mission orchestration and Lake Yange/Academy subsystems have distinct state models and stores; their existence does not demonstrate unified orchestration or shared memory.
- Model Commons and llama.cpp are separate from the two-mode intelligence adapter selector.

### Duplicated

- The inspected surfaces use multiple state/persistence models (run receipts, Lake Yange state and Academy state). These are distinct domain concerns, but a shared migration, provenance and recovery policy is not evident.
- No additional duplicate implementation was confirmed in this bounded inspection.

### Missing

1. General workflow execution is still centrally coupled; the registry currently covers the existing five-stage capability-inventory pipeline only, and mission intake still allowlists workflow IDs.
2. Capability plugins can compose existing tool permissions, but new executable permissions and handlers remain centrally governed.
3. A general approval/recovery protocol that can pause and resume persisted workflows across restarts.
4. Durable cross-mission/project memory and explicit retention/deletion management. Current mission and agent-working memories are scoped to one run.
5. A validated extension and integration path connecting Prime, Lake Yange, Academy, model selection and operator-facing state.

### Risky boundaries

- File-backed run persistence is unsuitable for concurrent processes or hosted multi-worker operation, despite atomic single-process snapshots.
- A restart with an in-flight run requires operator review; automatic continuation is not implemented.
- Several control surfaces and state stores exist, so cross-surface lifecycle consistency needs explicit integration tests before granting additional authority.

## Implemented foundation in this slice

- Added a typed capability definition/registry with registration, discovery, schema validation, permission checks, risk consistency, resource ceilings, executor invocation and capability/evidence-linked events.
- Adapted the existing pinned repository read/inventory, bounded system-probe and public-research paths through registered capabilities. The orchestrator still owns authorization, budgets, artifacts and evidence; capability handlers reuse those paths.
- Added `capability_requirements` to task contracts. The versioned capability-inventory workflow definition declares them outside the core planner, and discovery filters by both that task declaration and the agent’s existing capability/tool grants.
- Activated the existing `MemorySchema` in run/receipt persistence. Agent-working memory is visible only to its owner within the run; mission memory is visible to the current run. Writes require an explicit `mission_memory_write` agent capability and same-run evidence provenance. Receipt validation checks source identity, scope, supersession, and evidence links.
- A Prime-interpreted system scan has been exercised through the real mission orchestrator, registered tools, evidence production, memory persistence and final receipt. This is a deterministic bounded path, not a general autonomous Prime runtime.

`FileRunStore.save()` now snapshots validated input at call time, serializes writes per run, writes to a unique exclusive temporary file, atomically renames the completed snapshot, and cleans up the temporary path. The targeted persistence test issues 32 concurrent saves, checks that the last submitted snapshot is retrievable, and confirms that no temporary files remain.

This improves integrity for concurrent saves within one process. It does not provide cross-process locking, durable transactions, interrupted-run resumption or multi-host consistency.

## Next architectural frontier

Decouple the non-inventory workflows and mission intake behind executable, schema-validated workflow modules, then integrate mission lifecycles with Academy and Lake Yange state. Preserve the core policy boundary so plugins cannot grant permissions or install new executable tools by themselves. Follow with transactional multi-process persistence and restart-safe approval/recovery semantics.

## Governed economic execution loop (implemented)

Code: `runtime/economic-loop.ts`, `runtime/lake-yange-wealth.ts`; routes under `/api/lake-yange/economy*` in `runtime/console-server.ts`. Persistence: append-only, hash-chained `.sink/economy/events.jsonl` (gitignored). All state is derived by folding events.

**Action state machine** (`ACTION_TRANSITIONS`): AWAITING_APPROVAL -> APPROVED -> EXECUTING -> OUTCOME_PENDING -> WON/LOST/FAILED/CANCELLED (every claim, including a claimed failure, waits in OUTCOME_PENDING for human verification; a signed OUTCOME_RETURNED sends it back to EXECUTING for a corrected claim); CANCELLED and REJECTED are reachable earlier. Terminal states have no exits. Existing opportunity statuses (DISCOVERED/VALIDATING/APPROVED_FOR_TEST/...) are reused unchanged; only VALIDATING and APPROVED_FOR_TEST opportunities with evidence can be proposed. Invalid transitions throw `GovernanceError`.

**Approval boundary:** approval is a HUMAN-only event bound to a `scope_hash` (sha256 of opportunity + canonical scope), with expiry and spend cap. Revising scope clears approval. Execution re-checks the opportunity (not rejected, has evidence), approval validity, scope hash, and that real execution was explicitly approved. Agents get a facade (`asAgent`) that can only propose, revise, cancel and claim outcomes.

**Execution:** default `SimulatedExecutor` has no side effects. No real executor exists; a REAL executor must be passed explicitly and needs `real_execution_permitted` in the approval. Simulated executions can never produce revenue.

**Outcomes and ledger:** an agent outcome is only a claim. A human verification event (payment evidence and customer id required for revenue, cost within spend cap) creates the single ledger entry `ledger:<action_id>`. `reconcile()` recomputes totals and flags duplicates, missing entries, revenue from non-real execution; Wealth Command ignores loop revenue if reconciliation fails. Customers are counted by distinct id.

**Idempotency:** repeated `event_id` with identical content is a no-op; different content under the same id is refused. Execution uses a deterministic id per action and refuses a second run. Hash-chain or governance violations on load throw `CorruptEconomicLogError` (fail closed).

**Learning:** uses verified outcomes only. Facts (counts, result mix, time to outcome) are RECORDED_FACT; the smoothed win rate and a bounded 0.5-1.5 ranking multiplier are MODEL_INFERENCE and apply only after 3+ verified outcomes. History is never rewritten. Stage factors remain PLANNING_ASSUMPTIONs.

**Next-best action:** governance readiness outranks value (approved-ready, then verify, then awaiting approval, then propose). Opportunities without evidence, price, or in rejected/won/lost status are listed as blocked. Every recommendation states requires approval: YES; none grants spend authority.

**Honest limits:**
- HUMAN identity is now a signed authorization (see the next section), but the key is a local development file; the hash chain still detects accidental/naive edits, not an attacker who recomputes it.
- Only the top 8 opportunities are ranked (active governed actions outside the top 8 are still surfaced).
- No real executor, payment rail or outbound channel exists.
- Run-ledger revenue and loop revenue are kept in separate fields and summed for display only.

## Operator identity and signed human control (implemented)

Code: `runtime/operator-identity.ts`, `runtime/economic-loop.ts` (`checkAuthorization`), console wiring in `runtime/console-server.ts`, UI in `console/app.js`. Tests: `test/operator-authorization.test.ts`, `test/economic-loop.test.ts`.

**Operator identity model.** An operator is an id (`^[a-z0-9][a-z0-9-]{2,39}$`) plus an Ed25519 public key recorded in the log by a signed `OPERATOR_ENROLLED` event. The private key lives only in `.sink/operator/<id>.ed25519.pem` (mode 0600, created `wx`, gitignored) and in a `#private` field of `OperatorSigner`; it is never serialised into events or API responses. The first enrolment is trust-on-first-use (self-signed); every later enrolment or `OPERATOR_REVOKED` must be signed by an active operator. Reused ids or keys are refused. If every operator is revoked the system deliberately dead-ends and needs a manual archive and re-bootstrap.

**Signature model.** Every human event (`APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `ACTION_CANCELLED` by a human, `OUTCOME_VERIFIED`, `OUTCOME_RETURNED`, operator enrol/revoke) carries an `authorization`: version, operation, operator_id, action_id, scope_hash, signed_at, valid_until, nonce, signature. The signature covers the domain tag `LAKE-YANGE-ECON-AUTH/1` plus the canonical JSON of those fields and the full event payload (the approval parameters, verified amounts, customer id, evidence ids and so on). Agents have no signing facade and the log refuses human event types from non-HUMAN actors before parsing.

**Authorization lifecycle.** The operator reviews a scope and the console sends its `scope_hash`; the server signs (default TTL 5 minutes, hard cap 10). On applying the event the loop checks: operation matches the event type, action_id and scope_hash match the payload and the action's *current* scope, operator is enrolled and not revoked, the signature verifies, `signed_at <= event.at <= valid_until` (5 s skew; checked against the event timestamp so replay is deterministic), and the nonce has never been seen in the log. Revising an action clears its approval, so an old authorization cannot be applied to the modified scope. Any failure throws and nothing is appended. On load, any event that fails these checks makes the whole log fail closed (`CorruptEconomicLogError`).

**Verification workflow.** Wealth Command lists actions awaiting verification. An agent records an unverified claim (form in the console). The human opens the review dialog (action, opportunity, execution mode, claimed result/revenue/cost, evidence ids, receipt id, notes, approval scope, execution time) and chooses Verify SUCCESS / FAILED / CANCELLED / NO_RESPONSE or Return for correction. The same domain rules apply as through the API: revenue needs a REAL execution, payment evidence and a customer id; cost must not exceed the approved spend cap; amounts are non-negative whole cents; one ledger entry per action; a second verification is impossible. The UI is only another client of the governed route.

**Realised revenue path** (execution -> claim -> verification -> ledger -> reconcile -> Wealth Command): only `OUTCOME_VERIFIED` with revenue creates a ledger entry. Estimates, claims, approvals and executions never touch the ledger. `reconcile()` additionally flags malformed ledger ids, revenue on a non-WON action, ledger/verified-outcome mismatches, duplicates and orphans, and Wealth Command excludes loop revenue when reconciliation fails.

**Wealth Command provenance.** The panel is split into RECORDED FACT (realised revenue, ledger), ESTIMATE (pipeline, stage assumptions, dashed styling), MODEL INFERENCE (learning multiplier, signals) and HUMAN DECISION (approvals, rejections, verifications, returns, operators). Recommendations print `REQUIRES APPROVAL: YES`, except an action already inside a valid approval (`NO (inside existing valid human approval)`).

**Security guarantees (what holds).**
- A human event is accepted only with a valid Ed25519 signature from an enrolled, non-revoked operator, bound to the action, exact scope hash, operation, timestamp window, nonce and payload. Tampering with any of these is rejected.
- An authorization cannot be replayed or moved to another action or a modified scope.
- The mutating route requires loopback peer, a localhost Host header and the `x-lake-yange-operator: console` header (CSRF and DNS-rebinding hardening).
- Corrupt, gapped, edited, duplicated or unsigned logs fail closed and are never auto-repaired.

**What is NOT guaranteed (known limitations).**
- Local-development grade: the key is a plain 0600 file with no passphrase, OS keychain or hardware token. Anyone who can read it, or who can reach the running console's signing route as the same user, can sign as the operator. The console signs on the operator's behalf, so a compromised browser session or local process that can POST with the header could trigger a signed decision.
- A tamperer with write access who recomputes the hash chain AND holds a valid key can forge history; there is no external anchor, timestamp authority or off-box witness.
- Time comes from the local clock.
- Trust-on-first-use: whoever enrols first becomes the root operator.
- Payment evidence ids and customer ids are strings the human attests to; nothing here checks them against a bank or processor.

**Threat model.** In scope: a buggy or malicious agent, replayed or edited events, cross-action authorization reuse, scope swaps after approval, stale approvals, cross-site requests to the loopback console. Out of scope: a compromised operator machine or account, malicious local root, supply-chain compromise of the runtime.

**Simulated vs real.** Real: the cryptographic signatures, hash chain, state machine, ledger and reconciliation logic. Simulated: all execution (`SimulatedExecutor` only; the console has no REAL executor), so revenue cannot be verified from the console, and no money, bank, communication or payment rail exists. Revenue-bearing paths are exercised only by tests with a test-double REAL executor.

**Required before real-world financial execution.** OS-keychain or hardware-backed operator keys with passphrase or biometric prompts on each signature; an out-of-process signer so the console cannot sign unattended; an external append-only anchor or notary; a real payment-processor integration with reconciliation against bank statements; multi-party approval for spend above thresholds; key rotation and recovery; independent security review; legal, tax and compliance review.

**One-time migration.** The pre-signature smoke-test log was moved to `.sink/economy/archive/events.pre-signature.jsonl` (it held an unsigned human event and fails closed under the new rules). It was archived manually, not rewritten.
