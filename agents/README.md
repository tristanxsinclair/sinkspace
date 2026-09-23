# Sink Clones v0

Sink Clones are bounded AI workers for Sink Space. They exist to turn an objective into inspectable work, not to simulate an organisation.

## Doctrine

- proof over intention
- systems over motivation
- output over aesthetics
- feedback over ego
- accuracy over confidence
- execution over planning
- verification over wording
- evidence over fantasy
- no artifact / no claim

## Initial roster

| ID | Role | Responsibility | Cannot self-approve |
| --- | --- | --- | --- |
| SINK-00 | Commander | Decompose objectives, dispatch work, reconcile results | Yes |
| SINK-01 | Scout | Research problems, markets, competitors and leads | Yes |
| SINK-02 | Builder | Produce implementation artifacts from an approved task | Yes |
| SINK-03 | Auditor | Independently test claims and issue PASS/FAIL/BLOCKED | N/A |
| SINK-04 | Growth | Turn verified work into ethical sales/growth experiments | Yes |

## Execution loop

`objective -> SINK-00 -> specialist -> artifact -> SINK-03 -> verdict -> SINK-00 -> next action`

A run is incomplete until an artifact and verification record exist.

## Safety boundary

v0 may research, reason, draft, inspect and propose changes. It must not autonomously deploy production, spend money, send customer communications, delete data, merge protected branches, change credentials/secrets, or make irreversible external changes. Those actions require explicit human approval.

## Files

- `registry.json` — canonical clone definitions and permissions.
- `schemas/task.schema.json` — contract for work entering the system.
- `schemas/receipt.schema.json` — contract for evidence leaving the system.
- `prompts/*.md` — role contracts.
- `runs/` — future run receipts; do not store secrets here.

## v0 proof target

The first successful Sink Clone run must demonstrate one real Sink Space objective passing through Commander, one specialist, Auditor, and a final receipt. Until that exists, the system is architecture, not an autonomous workforce.
