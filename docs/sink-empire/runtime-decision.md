# ADR: prove governed execution before live intelligence

Date: 2026-09-15. Status: accepted for the first development slice. Revisit before adding a live provider.

## Decision

Build a separate local TypeScript execution system for one bounded repository-health objective. Use a deterministic development adapter that performs actual inspection and produces artifacts, with separate audit and adversarial checks. Do not label it model reasoning, general autonomous intelligence, or a production system.

Keep four boundaries: control (registry, tasks, state, budgets, authority); execution (bounded runtime/tool adapters); evidence (artifacts, observations, claims, verification and receipts); interface (operator views of stored state). The runtime boundary accepts validated task/context and returns validated output plus observable usage. Model output cannot directly alter permissions, grant approval, or establish verification.

Use local development persistence first, with explicit schema versions and a storage interface. No hosted database, graph database, message broker or microservices are needed to prove this workflow. Evidence IDs and relationships provide a graph without requiring a graph database. Migration to a durable transactional store is required before multi-process or hosted execution; old receipts must retain their schema version and must never be silently rewritten.

## Official landscape checked on 2026-09-15

Every source below was opened and read during this pass. These are documentation observations, not evidence of account entitlement or successful integration. No API key was accessed and no model/API execution was performed.

| Capability | Current official evidence | Consequence for Sink |
| --- | --- | --- |
| Managed harness and durable sessions | [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview) describes a managed Codex harness, sessions, orchestration, compaction and recovery | Evaluate this first for hosted live work; do not rebuild a cloud harness |
| Sandboxes and network control | [Hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) provides Linux workspaces, package/setup configuration, input files and network modes; outbound access defaults to enabled | Explicitly disable or restrict egress; never assume vendor defaults match Sink policy |
| Files and output durability | [Files and artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files) distinguishes environment files from published artifacts; hosted outputs under `/workspace/outputs` publish when the turn completes | Copy and hash retrieved artifacts into Sink evidence storage; a provider turn status is not a Sink audit verdict |
| Subagents | [Multi-agent](https://developers.openai.com/api/docs/guides/agents-api/multi-agent) supports separate context and concurrent work | Permit only bounded delegation, and map every child to a governed task |
| Code-first orchestration | [Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk) supports agent definitions and progressively more advanced runtime patterns | Alternative when the application must own more of the loop; not installed for this local proof |
| Local Codex integration | [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) exposes local thread start/continue/resume through a server-side TypeScript library, Node.js 18+ | Candidate for an isolated repository Builder later; do not grant a live thread arbitrary host access |
| Function tools | [Functions](https://developers.openai.com/api/docs/guides/agents-api/tools/functions) emits pending required actions for application handlers | Route all execution through the central Sink authority engine before dispatch |
| Web research | [Agents API web search](https://developers.openai.com/api/docs/guides/agents-api/tools/web-search) requires enabling a tool; supports live/cached/disabled modes and domain filters | A prompt cannot enable search. Preserve source URLs, retrieval time and uncertainty |
| Structured output | [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) constrains a supported JSON Schema subset; refusals and incomplete output still require handling | Validate both structure and semantic evidence links locally; schema compliance is not truth |
| Context and skills | [Compaction](https://developers.openai.com/api/docs/guides/compaction) supports long-running context reduction; [Skills](https://developers.openai.com/api/docs/guides/tools-skills) provides reusable versioned instructions and files | Keep receipts outside compacted context. Curated skills remain subordinate to authority policy |
| Observability and evaluation | [Tracing](https://developers.openai.com/api/docs/guides/agents-api/tracing) records turns and steps; [agent evaluations](https://developers.openai.com/api/docs/guides/agent-evals) covers traces, graders and datasets | Link provider trace IDs to Sink events; use explicit invariants locally and evaluate intelligence separately |
| Computer use | [Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) documents code-based UI automation and structured computer actions | Defer: the selected workflow needs neither UI automation nor authenticated account access |
| Model routing | [Models and providers](https://developers.openai.com/api/docs/guides/agents/models) recommends explicit per-agent/run models and straightforward setup | Store exact provider/model/config version and usage; choose based on measured task quality, not invented capability scores |
| OpenAI interoperability | [MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp) supports tool discovery and calls to MCP servers | MCP results remain untrusted; direct provider connections must not bypass Sink approvals |

### MCP and A2A

The [official MCP July 28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/) establishes `2026-07-28` as the released protocol revision: a stateless core, optional discovery, header routing, cacheable lists, authorization changes and extensions. It deprecates old handshake/session assumptions and moves tasks into an extension. A future adapter must pin a supported revision and test actual provider interoperability; this research does not prove OpenAI supports every newest MCP feature.

[A2A v1.0 was released March 12, 2026](https://a2a-protocol.org/latest/blog/2026/03/12/a2a-protocol-ships-v10-production-ready-standard-for-agent-to-agent-communication/). The [current stable specification](https://a2a-protocol.org/latest/specification/) defines agent cards, capabilities, tasks, messages, artifacts, authentication declarations and protocol negotiation. Cards can be discovered at `/.well-known/agent-card.json`. MCP integrates tools/context; A2A coordinates agents. Neither establishes that an external agent's completion claim is true.

Do not implement either protocol in this slice. Preserve stable agent IDs/config versions, typed input/output contracts, capability names, task IDs, artifact media types/digests and evidence provenance. Later adapters can translate these contracts without placing protocol transport inside Commander. External discovery must use operator-approved registries/endpoints, verified identity, capability intersection and the same risk policy. No official source reviewed here establishes native OpenAI A2A interoperability; treat that as unknown rather than infer it from MCP or subagent support.

## Why this choice

The repository had no runtime or test harness. The first unknown is whether Sink can prevent false completion while executing real bounded work. The deterministic slice makes these invariants reproducible without a provider account, nondeterministic model behavior, sandbox setup or API spend. This is deliberately narrower than strategic recommendation, council deliberation, competitive model selection or dynamic Forge agents.

Managed infrastructure is the intended next evaluation, not a discarded option. A narrow local workflow is not permission to grow a home-built general agent harness. The durable Sink work is authority, evidence provenance, independent verification, operator attention and outcome evaluation.

## Exact prerequisites for a future live adapter

Adding a key alone does **not** enable live execution; no live adapter is implemented in this milestone.

1. Choose and implement one adapter against a pinned OpenAI SDK version exposing the documented `beta.agents` session methods, or explicitly select the local Codex SDK instead. Integration-test the exact installed version.
2. Obtain an application API key for the intended OpenAI Platform project with `api.agents.read`, `api.agents.write` and `api.responses.write`. The [Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart) requires `OpenAI-Beta: agents=v1`; SDKs add it. Keep `OPENAI_API_KEY` on the trusted application side and outside sandbox, browser, receipts and logs. Confirm reuse versus new credentials with Tristan before provisioning.
3. Confirm account/model access, billing, rate limits, regional/data requirements and current pricing. None was established here. Select an explicit permitted model; record its returned identity rather than assuming a documentation example is available.
4. Configure an OpenAI-hosted environment with approved inputs, pinned setup dependencies and disabled/restricted network access. Upload an isolated repository snapshot at a known commit; do not put production credentials in it. Use self-hosting only if a concrete private-network or image requirement justifies it.
5. Translate pending function calls through Sink policy, enforce deadlines and cancellation, reserve budget before calls and reconcile actual usage afterward. No tools for deployment, messaging, money or account mutation may bypass operator approval.
6. Ingest provider events with idempotency, retrieve artifacts by matching session/turn/path, hash the bytes, attach commit/environment provenance, and independently audit claims. Preserve incomplete/refused/failed outcomes.
7. Run the existing adversarial invariants plus live-provider tests, including hostile retrieved content, denied tools, incorrect citations, usage limits, cancellation, replay and partial session recovery. Record a new receipt with actual token/tool usage and cost before calling the integration executable.

## Memory, improvement and future scope

Run/working memory is task state and intermediate artifacts. Project/operator memory must be explicitly sourced and correctable, with timestamps, scope, confidence and staleness. Evidence memory is receipts with links to original observations. Performance memory records actual attempts, audit outcomes, corrections, latency and usage; no fabricated rates or operator scores.

Context packages should contain only the objective, constraints, relevant approved state, evidence references, permitted tools and output contract. Summaries must preserve uncertainty and source pointers. Prompt/config changes require versions and evaluation against an incumbent; agents cannot rewrite governance or promote themselves. Council, Forge, opportunity radar, customer workflows, autonomous self-improvement and protocol adapters remain future engineering work.

## Cost and limitations

The deterministic adapter uses local CPU/storage and no model tokens or paid provider tools. This statement excludes the cost of the development session used to build it. Future live cost must account for model tokens, tools, sandbox time, persistence and retries; unknown prices must remain unknown until measured against current billing. A local same-process Auditor provides implementation independence, not a separate machine or independent organization. Unsigned hashes detect changed bytes relative to a trusted reference; they do not prevent a malicious operator from rewriting all local state.
