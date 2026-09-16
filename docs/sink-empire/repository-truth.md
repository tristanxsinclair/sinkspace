# Repository truth before the execution build

Observed 2026-09-15. Repository: `tristanxsinclair/sinkspace`. This document describes the baseline, not capabilities introduced later in this branch.

## Baseline and history

- Production/main baseline: `8711181060a0c6cf46f161ecc34594dc8131bd91` (`Reconcile Sites source history`).
- Generation 0: `origin/feat/sink-clones-v0`, head `46474d237c329e43aa83706a9110ed1ae6a0326e`.
- [Open PR #1](https://github.com/tristanxsinclair/sinkspace/pull/1), “feat: establish Sink Clones v0 control plane”, contains six commits adding six files and 136 lines. Its base is main. It has no executable agent runtime.
- This implementation branch, `feat/sink-empire-execution`, extends Generation 0 rather than discarding its history. The original role doctrine remains useful; schemas and prompt-only authority need executable enforcement.
- Historical deployment fixes repeatedly changed the upload path. The current workflow explicitly uploads `./dist`. Preserve that boundary.

## Complete baseline file inventory

| Files | Observed responsibility |
| --- | --- |
| `README.md` | Business scope, local serving and release verification instructions |
| `dist/index.html` | Hand-authored homepage, local enquiry form, metadata and structured business data |
| `dist/styles.css` | Hand-authored responsive styles and reduced-motion behavior |
| `dist/app.js` | Footer year, service selection, browser validation, enquiry summary, mailto and clipboard behavior |
| `dist/404.html` | Standalone static fallback page |
| `dist/mark.svg` | Site icon |
| `dist/robots.txt`, `dist/sitemap.xml` | Crawler policy and canonical homepage URL |
| `dist/release.json` | Human-readable release marker; does not contain a Git SHA |
| `.github/workflows/static.yml` | GitHub Pages deployment on main push or manual dispatch |
| `.openai/hosting.json` | Previous ChatGPT Sites project/static directory configuration retained for reference |
| `agents/README.md` | Generation 0 doctrine and proposed execution loop |
| `agents/registry.json` | Five descriptive role definitions and advisory approval lists |
| `agents/prompts/SINK-00-commander.md`, `agents/prompts/SINK-03-auditor.md` | Two role instruction documents |
| `agents/schemas/task.schema.json`, `agents/schemas/receipt.schema.json` | JSON Schema contracts; no validator or caller existed |

`dist` is both maintained source and the published static artifact, despite its conventional generated-output name. No upstream source directory, bundler, dependency manifest, lockfile, backend, database, runtime server, API integration, automated tests, typecheck or lint command exists in the baseline tree. The complete main tree has 11 files; Generation 0 adds six. No `AGENTS.md` exists in either baseline tree.

The README understates `dist/app.js` as footer-only; inspection shows it also handles enquiry preparation. The form does not submit to a backend. It creates a local brief and opens a mailto draft; the visitor must send it. The existing public site should remain functional throughout this work.

## Deployment observation

The Pages workflow has `contents: read`, `pages: write`, `id-token: write`, a ten-minute job timeout, a Pages environment and concurrency control. It uploads `dist` directly, with no build/test job. Actions use version tags rather than immutable action SHAs. Repository branch protection, organization security settings, domain ownership and credential configuration were not inspected; their status remains unknown.

[Workflow run 34559221525](https://github.com/tristanxsinclair/sinkspace/actions/runs/34559221525) reported `success` for SHA `8711181060a0c6cf46f161ecc34594dc8131bd91`. Independently, HTTPS GET of [production release.json](https://sinkspace.com.au/release.json) returned:

```json
{
  "site": "Sink Space",
  "canonical": "https://sinkspace.com.au/",
  "release": "business-services-v3",
  "released_on": "2026-09-11",
  "artifact_root": "dist",
  "hosting": "GitHub Pages"
}
```

These observations support the current static architecture. They do not cryptographically bind the served page to that commit, prove every route/browser behavior, or establish backend capabilities outside this repository. No production change was made by this research.

## Reproducible inspection

```sh
git ls-tree -r --name-only origin/main
git ls-tree -r --name-only origin/feat/sink-clones-v0
git log --all --oneline
git diff --stat origin/main...origin/feat/sink-clones-v0
git show origin/main:dist/app.js
gh pr view 1 --repo tristanxsinclair/sinkspace --json number,title,state,headRefName,baseRefName,commits,files,url
gh run view 34559221525 --repo tristanxsinclair/sinkspace --json conclusion,headSha,name,url
curl -fsS https://sinkspace.com.au/release.json
```

All baseline files above were read. No secret files or secret values were inspected.

## Engineering consequences

1. Add the execution system beside `dist`; keep the public Pages artifact unchanged.
2. Retain the Generation 0 history and doctrine, replacing advisory contracts with validated, versioned runtime contracts rather than treating prompts as security controls.
3. Prove one bounded repository-health workflow using a clearly labeled deterministic development adapter. A generic “highest-leverage business improvement” cannot be established from this small repository alone; demand, conversion and customer value remain unknown.
4. Add CI and adversarial invariants before permitting model-selected tools. No live model session or API access is implied by documentation research.
5. Keep local persistence and the internal console separate from Pages. Publishing a loopback console or receipt store under `dist` would expose operator data and would not create a backend.
