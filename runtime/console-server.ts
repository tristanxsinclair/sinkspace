import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  readFile,
  readdir
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(
  fileURLToPath(import.meta.url)
);

const ROOT = path.resolve(
  HERE,
  '..'
);

const CONSOLE_ROOT = path.join(
  ROOT,
  'console'
);

const RUN_ROOT = path.join(
  ROOT,
  '.sink',
  'runs'
);

const PRESERVED_RUN_ROOT = path.join(
  ROOT,
  'agents',
  'runs'
);

const HOST = '127.0.0.1';
const PORT = Number(
  process.env.SINK_CONSOLE_PORT ?? 4317
);

let activeRunProcess:
  ReturnType<typeof spawn> | null = null;

let activeRunStartedAt:
  string | null = null;

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(
    status,
    {
      'content-type':
        'application/json; charset=utf-8',
      'cache-control':
        'no-store'
    }
  );

  res.end(
    JSON.stringify(
      body,
      null,
      2
    )
  );
}

function text(
  res: http.ServerResponse,
  status: number,
  body: string,
  type = 'text/plain; charset=utf-8'
): void {
  res.writeHead(
    status,
    {
      'content-type': type,
      'cache-control': 'no-store'
    }
  );

  res.end(body);
}

function safeId(
  value: string
): string {
  if (
    !/^[a-zA-Z0-9._-]+$/.test(value)
  ) {
    throw new Error(
      'INVALID_RUN_ID'
    );
  }

  return value;
}

async function readRun(
  runId: string
): Promise<any> {
  const id = safeId(runId);

  const file = path.join(
    RUN_ROOT,
    `${id}.json`
  );

  return JSON.parse(
    await readFile(
      file,
      'utf8'
    )
  );
}

async function listRuns(): Promise<any[]> {
  let names: string[] = [];

  try {
    names = await readdir(
      RUN_ROOT
    );
  } catch {
    return [];
  }

  const runs: any[] = [];

  for (const name of names) {
    if (
      !name.endsWith('.json')
    ) {
      continue;
    }

    try {
      const run = JSON.parse(
        await readFile(
          path.join(
            RUN_ROOT,
            name
          ),
          'utf8'
        )
      );

      runs.push(run);
    } catch {
      // Ignore malformed historical snapshots.
    }
  }

  return runs.sort(
    (a, b) =>
      Date.parse(
        b.created_at ?? ''
      ) -
      Date.parse(
        a.created_at ?? ''
      )
  );
}

function parseArtifactJson(
  artifact: any
): any | null {
  if (
    artifact?.media_type !==
      'application/json' ||
    typeof artifact?.content !==
      'string'
  ) {
    return null;
  }

  try {
    return JSON.parse(
      artifact.content
    );
  } catch {
    return null;
  }
}

function stageState(
  run: any,
  agentId: string
): {
  status: string;
  task: any | null;
} {
  const task =
    run.tasks?.find(
      (candidate: any) =>
        candidate.assigned_agent ===
        agentId
    ) ?? null;

  if (!task) {
    return {
      status: 'NOT_PLANNED',
      task: null
    };
  }

  const status =
    task.status ??
    'UNKNOWN';

  return {
    status,
    task
  };
}

function findAnalystSnapshot(
  run: any
): {
  facts: string[];
  hypotheses: string[];
  uncertainties: string[];
  next_actions: string[];
  blackboard_entries: any[];
} {
  const persistedEntries =
    Array.isArray(run.blackboard_entries)
      ? run.blackboard_entries
      : [];

  if (persistedEntries.length) {
    return {
      facts:
        persistedEntries
          .filter(
            (entry: any) =>
              entry.kind === 'FACT'
          )
          .map(
            (entry: any) =>
              entry.content
          ),

      hypotheses:
        persistedEntries
          .filter(
            (entry: any) =>
              entry.kind === 'HYPOTHESIS'
          )
          .map(
            (entry: any) =>
              entry.content
          ),

      uncertainties:
        persistedEntries
          .filter(
            (entry: any) =>
              entry.kind === 'UNCERTAINTY'
          )
          .map(
            (entry: any) =>
              entry.content
          ),

      next_actions:
        persistedEntries
          .filter(
            (entry: any) =>
              entry.kind === 'NEXT_ACTION'
          )
          .map(
            (entry: any) =>
              entry.content
          ),

      blackboard_entries:
        persistedEntries
    };
  }

  const artifact =
    run.artifacts?.find(
      (candidate: any) =>
        candidate.agent_id ===
          'SINK-05' &&
        candidate.media_type ===
          'application/json'
    );

  const parsed =
    artifact
      ? parseArtifactJson(
          artifact
        )
      : null;

  if (!parsed) {
    return {
      facts: [],
      hypotheses: [],
      uncertainties: [],
      next_actions: [],
      blackboard_entries: []
    };
  }

  const source =
    parsed.analyst &&
    typeof parsed.analyst === 'object'
      ? parsed.analyst
      : parsed;

  return {
    facts:
      Array.isArray(
        source.facts
      )
        ? source.facts
        : [],

    hypotheses:
      Array.isArray(
        source.hypotheses
      )
        ? source.hypotheses
        : [],

    uncertainties:
      Array.isArray(
        source.uncertainties
      )
        ? source.uncertainties
        : [],

    next_actions:
      Array.isArray(
        source.next_actions
      )
        ? source.next_actions
        : [],

    blackboard_entries:
      Array.isArray(
        parsed.blackboard_entries
      )
        ? parsed.blackboard_entries
        : []
  };
}

function buildProofGraph(
  run: any,
  analyst: ReturnType<typeof findAnalystSnapshot>
): any[] {
  const evidence =
    Array.isArray(run.evidence)
      ? run.evidence
      : [];

  const artifacts =
    Array.isArray(run.artifacts)
      ? run.artifacts
      : [];

  const tasks =
    Array.isArray(run.tasks)
      ? run.tasks
      : [];

  const entries =
    Array.isArray(
      analyst.blackboard_entries
    )
      ? analyst.blackboard_entries
      : [];

  return entries.map(
    (entry: any) => {
      const broken: string[] = [];

      const evidenceNodes =
        (entry.evidence_ids ?? [])
          .map(
            (evidenceId: string) => {
              const evidenceNode =
                evidence.find(
                  (candidate: any) =>
                    candidate.evidence_id ===
                    evidenceId
                ) ?? null;

              if (!evidenceNode) {
                broken.push(
                  `Missing evidence ${evidenceId}`
                );

                return {
                  evidence_id:
                    evidenceId,

                  found:
                    false,

                  evidence:
                    null,

                  artifact:
                    null,

                  task:
                    null
                };
              }

              const artifact =
                artifacts.find(
                  (candidate: any) =>
                    candidate.artifact_id ===
                    evidenceNode.artifact_id
                ) ?? null;

              if (!artifact) {
                broken.push(
                  `Evidence ${evidenceId} references missing artifact ${evidenceNode.artifact_id}`
                );
              }

              const task =
                tasks.find(
                  (candidate: any) =>
                    candidate.task_id ===
                    evidenceNode.task_id
                ) ?? null;

              if (!task) {
                broken.push(
                  `Evidence ${evidenceId} references missing task ${evidenceNode.task_id}`
                );
              }

              if (
                evidenceNode.commit_sha !==
                run.commit_sha
              ) {
                broken.push(
                  `Evidence ${evidenceId} commit does not match pinned run commit`
                );
              }

              return {
                evidence_id:
                  evidenceId,

                found:
                  true,

                evidence: {
                  evidence_id:
                    evidenceNode.evidence_id,

                  artifact_id:
                    evidenceNode.artifact_id,

                  commit_sha:
                    evidenceNode.commit_sha,

                  tool:
                    evidenceNode.tool,

                  agent_id:
                    evidenceNode.agent_id,

                  task_id:
                    evidenceNode.task_id,

                  source:
                    evidenceNode.source,

                  trust:
                    evidenceNode.trust,

                  timestamp:
                    evidenceNode.timestamp
                },

                artifact:
                  artifact
                    ? {
                        artifact_id:
                          artifact.artifact_id,

                        agent_id:
                          artifact.agent_id,

                        task_id:
                          artifact.task_id,

                        media_type:
                          artifact.media_type,

                        sha256:
                          artifact.sha256,

                        created_at:
                          artifact.created_at
                      }
                    : null,

                task:
                  task
                    ? {
                        task_id:
                          task.task_id,

                        assigned_agent:
                          task.assigned_agent,

                        agent_version:
                          task.agent_version,

                        objective:
                          task.objective,

                        status:
                          task.status
                      }
                    : null
              };
            }
          );

      if (
        entry.kind === 'FACT' &&
        evidenceNodes.length === 0
      ) {
        broken.push(
          'FACT has no evidence references'
        );
      }

      return {
        entry_id:
          entry.entry_id,

        kind:
          entry.kind,

        content:
          entry.content,

        agent_id:
          entry.agent_id,

        task_id:
          entry.task_id,

        created_at:
          entry.created_at,

        evidence_ids:
          entry.evidence_ids ?? [],

        evidence_nodes:
          evidenceNodes,

        pinned_commit:
          run.commit_sha ?? null,

        receipt: {
          sealed:
            Boolean(
              run.receipt
            ),

          receipt_id:
            run.receipt?.receipt_id ??
            null,

          hash:
            run.receipt?.hash ??
            null,

          final_status:
            run.receipt?.final_status ??
            null
        },

        integrity:
          broken.length === 0,

        broken_references:
          broken
      };
    }
  );
}

function summarizeRun(
  run: any
): any {
  const analyst =
    findAnalystSnapshot(run);

  const proofGraph =
    buildProofGraph(
      run,
      analyst
    );

  const stages = [
    'SINK-01',
    'SINK-05',
    'SINK-02',
    'SINK-03',
    'RED-SINK'
  ].map(agentId => {
    const stage =
      stageState(
        run,
        agentId
      );

    return {
      agent_id:
        agentId,

      status:
        stage.status,

      objective:
        stage.task?.objective ??
        null,

      verification_status:
        stage.task
          ?.verification_status ??
        null,

      artifacts:
        stage.task?.artifacts
          ?.length ?? 0,

      evidence:
        stage.task?.evidence
          ?.length ?? 0,

      attempts:
        stage.task?.attempts ??
        0
    };
  });

  const verification =
    (run.verification ?? [])
      .map(
        (item: any) => ({
          agent_id:
            item.agent_id,

          verdict:
            item.verdict,

          reasons:
            item.reasons ?? [],

          checked_claim_ids:
            item.checked_claim_ids ??
            [],

          evidence_ids:
            item.evidence_ids ??
            []
        })
      );

  const claims =
    run.claims ?? [];

  const known =
    claims.filter(
      (claim: any) =>
        claim.classification ===
        'KNOWN'
    );

  const inferred =
    claims.filter(
      (claim: any) =>
        claim.classification ===
        'INFERRED'
    );

  const unknown =
    claims.filter(
      (claim: any) =>
        ![
          'KNOWN',
          'INFERRED'
        ].includes(
          claim.classification
        )
    );

  return {
    run_id:
      run.run_id,

    status:
      run.status,

    adapter:
      run.adapter,

    commit_sha:
      run.commit_sha,

    objective:
      run.objective,

    created_at:
      run.created_at,

    started_at:
      run.started_at,

    completed_at:
      run.completed_at,

    usage:
      run.usage ?? null,

    receipt: {
      sealed:
        Boolean(
          run.receipt
        ),

      hash:
        run.receipt?.hash ??
        null,

      confidence:
        run.receipt?.confidence ??
        null,

      final_status:
        run.receipt
          ?.final_status ??
        null
    },

    counts: {
      tasks:
        run.tasks?.length ?? 0,

      artifacts:
        run.artifacts?.length ??
        0,

      evidence:
        run.evidence?.length ??
        0,

      claims:
        claims.length,

      known:
        known.length,

      inferred:
        inferred.length,

      unknown:
        unknown.length,

      uncertainties:
        run.uncertainty
          ?.length ?? 0,

      errors:
        run.errors?.length ??
        0
    },

    stages,
    analyst,
    proof_graph:
      proofGraph,
    proof_integrity: {
      total:
        proofGraph.length,

      intact:
        proofGraph.filter(
          entry =>
            entry.integrity
        ).length,

      broken:
        proofGraph.filter(
          entry =>
            !entry.integrity
        ).length
    },
    verification,

    uncertainty:
      run.uncertainty ?? [],

    errors:
      run.errors ?? [],

    red_sink_findings:
      run.red_sink_findings ??
      [],

    tasks:
      run.tasks ?? [],

    claims,

    evidence:
      run.evidence ?? [],

    artifacts:
      run.artifacts ?? [],

    events:
      run.events ?? []
  };
}

function launchLocalRun(): {
  started: boolean;
  started_at: string | null;
} {
  if (
    activeRunProcess &&
    activeRunProcess.exitCode ===
      null
  ) {
    return {
      started: false,
      started_at:
        activeRunStartedAt
    };
  }

  activeRunStartedAt =
    new Date().toISOString();

  activeRunProcess = spawn(
    process.platform ===
      'win32'
      ? 'npm.cmd'
      : 'npm',
    [
      'run',
      'clones:run'
    ],
    {
      cwd: ROOT,

      env: {
        ...process.env,
        SINK_INTELLIGENCE:
          'local'
      },

      stdio:
        'inherit'
    }
  );

  activeRunProcess.once(
    'exit',
    () => {
      activeRunProcess =
        null;
    }
  );

  return {
    started: true,
    started_at:
      activeRunStartedAt
  };
}

async function serveStatic(
  pathname: string,
  res: http.ServerResponse
): Promise<void> {
  const files: Record<
    string,
    [
      string,
      string
    ]
  > = {
    '/':
      [
        'index.html',
        'text/html; charset=utf-8'
      ],

    '/index.html':
      [
        'index.html',
        'text/html; charset=utf-8'
      ],

    '/app.js':
      [
        'app.js',
        'text/javascript; charset=utf-8'
      ],

    '/styles.css':
      [
        'styles.css',
        'text/css; charset=utf-8'
      ]
  };

  const entry =
    files[pathname];

  if (!entry) {
    text(
      res,
      404,
      'Not found'
    );

    return;
  }

  const [
    filename,
    type
  ] = entry;

  text(
    res,
    200,
    await readFile(
      path.join(
        CONSOLE_ROOT,
        filename
      ),
      'utf8'
    ),
    type
  );
}

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
        const url =
          new URL(
            req.url ?? '/',
            `http://${HOST}:${PORT}`
          );

        if (
          url.pathname ===
            '/api/run' &&
          req.method === 'POST'
        ) {
          const result =
            launchLocalRun();

          json(
            res,
            result.started
              ? 202
              : 409,
            {
              ...result,

              mode:
                'local-deterministic-v1',

              message:
                result.started
                  ? 'Sink Clones run launched.'
                  : 'A Sink Clones run is already active.'
            }
          );

          return;
        }

        if (
          url.pathname ===
            '/api/run/status' &&
          req.method === 'GET'
        ) {
          json(
            res,
            200,
            {
              running:
                activeRunProcess !==
                  null &&
                activeRunProcess
                  .exitCode ===
                  null,

              started_at:
                activeRunStartedAt
            }
          );

          return;
        }

        if (
          url.pathname ===
            '/api/runs' &&
          req.method === 'GET'
        ) {
          const runs =
            await listRuns();

          json(
            res,
            200,
            runs.map(
              summarizeRun
            )
          );

          return;
        }

        if (
          url.pathname ===
            '/api/latest' &&
          req.method === 'GET'
        ) {
          const runs =
            await listRuns();

          json(
            res,
            200,
            runs.length
              ? summarizeRun(
                  runs[0]
                )
              : null
          );

          return;
        }

        const match =
          url.pathname.match(
            /^\/api\/runs\/([^/]+)$/
          );

        if (
          match &&
          req.method === 'GET'
        ) {
          const run =
            await readRun(
              match[1]!
            );

          json(
            res,
            200,
            summarizeRun(run)
          );

          return;
        }

        const preservedMatch =
          url.pathname.match(
            /^\/runs\/([^/]+)\/([^/]+)$/
          );

        if (
          preservedMatch &&
          req.method === 'GET'
        ) {
          const runId =
            safeId(
              preservedMatch[1]!
            );

          const filename =
            safeId(
              preservedMatch[2]!
            );

          const content =
            await readFile(
              path.join(
                PRESERVED_RUN_ROOT,
                runId,
                filename
              ),
              'utf8'
            );

          text(
            res,
            200,
            content
          );

          return;
        }

        if (
          req.method !==
            'GET' &&
          req.method !==
            'HEAD'
        ) {
          text(
            res,
            405,
            'Method not allowed'
          );

          return;
        }

        await serveStatic(
          url.pathname,
          res
        );
      } catch (
        error
      ) {
        json(
          res,
          500,
          {
            error:
              error instanceof
              Error
                ? error.message
                : 'Unknown console error'
          }
        );
      }
    }
  );

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      ''
    );

    console.log(
      'SINK CLONES MISSION CONTROL'
    );

    console.log(
      '────────────────────────────'
    );

    console.log(
      `http://${HOST}:${PORT}`
    );

    console.log(
      ''
    );

    console.log(
      'Local-only command surface.'
    );

    console.log(
      'Consequential actions remain governed by the runtime.'
    );

    console.log(
      ''
    );
  }
);
