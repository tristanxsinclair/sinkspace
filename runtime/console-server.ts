import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  readFile,
  readdir,
  writeFile,
  unlink
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  founderMandateRegisteredReply,
  interpretPrimeMandateAction,
  registerPrimeFounderMandate,
  registerPrimeFounderMandateFile
} from './prime-mandate.js';

import { interpretPrimeCommand } from './prime.js';
import { answerPrimeRunQuestion } from './prime-conversation.js';
import { looksLikePrimeRunQuestion } from './prime-routing.js';
import {
  answerEntertainment,
  looksLikeEntertainmentRequest
} from './prime-entertainment.js';
import {
  executePrimeMandatePlanning,
  interpretPrimeMandatePlanning,
  mandatePlanReply
} from './prime-mandate-planning.js';

import {
  interpretPrimeEngineering,
  executePrimeEngineering
} from './prime-engineering.js';

import {
  constitutionalPlanReply,
  executePrimeConstitutionalPlan,
  interpretPrimeConstitutionalPlan
} from './prime-constitutional-plan.js';

import {
  interpretPrimeConstitutionalEngineering
} from './prime-constitutional-engineering.js';

import {
  constitutionalEngineeringReply,
  executeConstitutionalEngineering
} from './constitutional-engineering.js';
import {
  MissionIntakeSchema,
  type MissionIntake
} from './contracts.js';
import {
  projectLakeYangeWorld
} from './lake-yange-world.js';

import {
  projectLakeYangeEconomy
} from './lake-yange-economy.js';

import {
  probeLocalAi
} from './local-ai-status.js';

import {
  loadAcademyState
} from './academy-store.js';
import {
  listAutonomousCycles,
  readAutonomousCycle,
  runAutonomousCycle
} from './autonomous-engine.js';
import {
  executePrimeAgentCommand
} from './prime-agent-command.js';

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

const HOST = '0.0.0.0';
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

type ConsoleMission =
  | {
      workflow: 'capability-inventory';
      mode: 'RUN';
    }
  | {
      workflow: 'gold-rush';
      mode: 'DISCOVER';
    }
  | {
      workflow: 'revenue';
      mode: 'DISCOVER' | 'VALIDATE';
    };

function parseConsoleMission(
  input: unknown
): ConsoleMission {
  if (
    !input ||
    typeof input !== 'object'
  ) {
    return {
      workflow:
        'capability-inventory',
      mode: 'RUN'
    };
  }

  const value =
    input as Record<
      string,
      unknown
    >;

  if (
    value.workflow ===
      'gold-rush' &&
    value.mode ===
      'DISCOVER'
  ) {
    return {
      workflow: 'gold-rush',
      mode: 'DISCOVER'
    };
  }

  if (
    value.workflow ===
      'revenue' &&
    (
      value.mode ===
        'DISCOVER' ||
      value.mode ===
        'VALIDATE'
    )
  ) {
    return {
      workflow: 'revenue',
      mode: value.mode
    };
  }

  if (
    value.workflow ===
      'capability-inventory'
  ) {
    return {
      workflow:
        'capability-inventory',
      mode: 'RUN'
    };
  }

  throw new Error(
    'Unsupported console mission.'
  );
}

function launchLocalRun(
  mission: ConsoleMission
): {
  started: boolean;
  started_at: string | null;
  workflow: ConsoleMission['workflow'];
  mode: string;
} {
  if (
    activeRunProcess &&
    activeRunProcess.exitCode ===
      null
  ) {
    return {
      started: false,
      started_at:
        activeRunStartedAt,
      workflow:
        mission.workflow,
      mode:
        mission.mode
    };
  }

  const args =
    mission.workflow ===
      'capability-inventory'
      ? [
          'run',
          'clones:run'
        ]
      : [
          'run',
          'clones:mission',
          '--',
          mission.workflow,
          mission.mode
        ];

  activeRunStartedAt =
    new Date().toISOString();

  activeRunProcess = spawn(
    process.platform ===
      'win32'
      ? 'npm.cmd'
      : 'npm',
    args,
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
      activeRunStartedAt,
    workflow:
      mission.workflow,
    mode:
      mission.mode
  };
}

async function launchPrimeMission(
  input: unknown
): Promise<{
  started: boolean;
  started_at: string | null;
  workflow: MissionIntake['workflow'];
  mode: string;
}> {
  const intake =
    MissionIntakeSchema.parse(
      input
    );

  const mode =
    intake.workflow ===
      'capability-inventory'
      ? 'RUN'
      : intake.mission.mode;

  if (
    activeRunProcess &&
    activeRunProcess.exitCode ===
      null
  ) {
    return {
      started: false,
      started_at:
        activeRunStartedAt,
      workflow:
        intake.workflow,
      mode
    };
  }

  const missionPath =
    path.join(
      ROOT,
      '.sink',
      `prime-mission-${Date.now()}-${process.pid}.json`
    );

  await writeFile(
    missionPath,
    JSON.stringify(
      intake,
      null,
      2
    ) + '\n',
    {
      flag: 'wx',
      mode: 0o600
    }
  );

  activeRunStartedAt =
    new Date().toISOString();

  activeRunProcess = spawn(
    process.platform ===
      'win32'
      ? 'npm.cmd'
      : 'npm',
    [
      'run',
      'clones:prime-mission',
      '--',
      missionPath
    ],
    {
      cwd: ROOT,

      env: {
        ...process.env,
        SINK_INTELLIGENCE:
          'local'
      },

      stdio: 'inherit'
    }
  );

  activeRunProcess.once(
    'exit',
    () => {
      activeRunProcess = null;

      void unlink(
        missionPath
      ).catch(() => {
        // Preserve runtime exit;
        // stale temp files contain
        // mission metadata only.
      });
    }
  );

  return {
    started: true,
    started_at:
      activeRunStartedAt,
    workflow:
      intake.workflow,
    mode
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
      ],

    '/prime.js':
      [
        'prime.js',
        'text/javascript; charset=utf-8'
      ],

    '/prime.css':
      [
        'prime.css',
        'text/css; charset=utf-8'
      ],

    '/empire.js':
      [
        'empire.js',
        'text/javascript; charset=utf-8'
      ],

    '/empire.css':
      [
        'empire.css',
        'text/css; charset=utf-8'
      ],

    '/world.html':
      [
        'world.html',
        'text/html; charset=utf-8'
      ],

    '/lake-yange-world.js':
      [
        'lake-yange-world.js',
        'text/javascript; charset=utf-8'
      ],


    '/lake-yange-geography.js':
      [
        'lake-yange-geography.js',
        'text/javascript; charset=utf-8'
      ],


    '/lake-yange-city.js':
      [
        'lake-yange-city.js',
        'text/javascript; charset=utf-8'
      ],

    '/lake-yange-city.css':
      [
        'lake-yange-city.css',
        'text/css; charset=utf-8'
      ],

    '/lake-yange-world.css':
      [
        'lake-yange-world.css',
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

async function readJsonBody(
  req: http.IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

    totalBytes += buffer.length;

    if (totalBytes > 32_768) {
      throw new Error(
        'Request body too large.'
      );
    }

    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {};
  }

  const raw =
    Buffer.concat(chunks)
      .toString('utf8')
      .trim();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      'Invalid JSON request body.'
    );
  }
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
            '/api/lake-yange/academy' &&
          req.method === 'GET'
        ) {
          const academy =
            await loadAcademyState(ROOT);

          json(
            res,
            200,
            academy
          );

          return;
        }

        if (
          url.pathname ===
            '/api/lake-yange/autonomous/cycles' &&
          req.method === 'GET'
        ) {
          json(
            res,
            200,
            await listAutonomousCycles(ROOT)
          );

          return;
        }

        if (
          url.pathname ===
            '/api/lake-yange/autonomous/cycle' &&
          req.method === 'POST'
        ) {
          const body = await readJsonBody(req);
          const cycle = await runAutonomousCycle(
            ROOT,
            {
              dryRun:
                typeof body === 'object' &&
                body !== null &&
                'dry_run' in body &&
                body.dry_run === true
            }
          );

          json(
            res,
            200,
            cycle
          );

          return;
        }

        const autonomousCycleMatch =
          url.pathname.match(
            /^\/api\/lake-yange\/autonomous\/cycles\/([^/]+)$/
          );

        if (
          autonomousCycleMatch &&
          req.method === 'GET'
        ) {
          json(
            res,
            200,
            await readAutonomousCycle(
              ROOT,
              safeId(autonomousCycleMatch[1]!)
            )
          );

          return;
        }

        if (
          url.pathname ===
            '/api/lake-yange/world' &&
          req.method === 'GET'
        ) {
          const projection =
            await projectLakeYangeWorld(
              ROOT,
              {
                localAi: await probeLocalAi()
              }
            );

          json(
            res,
            200,
            projection
          );

          return;
        }

        if (
          url.pathname ===
            '/api/lake-yange/economy' &&
          req.method === 'GET'
        ) {
          const projection =
            await projectLakeYangeEconomy(ROOT);

          json(
            res,
            200,
            projection
          );

          return;
        }

        if (
          url.pathname ===
            '/api/prime/agent-command' &&
          req.method === 'POST'
        ) {
          const body = await readJsonBody(req);
          const command =
            typeof body === 'object' &&
            body !== null &&
            'command' in body &&
            typeof body.command === 'string'
              ? body.command
              : '';

          if (!command.trim()) {
            json(res, 400, { error: 'Prime requires a natural-language command.' });
            return;
          }

          json(
            res,
            200,
            await executePrimeAgentCommand(ROOT, command)
          );

          return;
        }

        if (
          url.pathname ===
            '/api/prime/message' &&
          req.method === 'POST'
        ) {
          const body =
            await readJsonBody(req);

          if (
            !body ||
            typeof body !== 'object' ||
            typeof (
              body as Record<string, unknown>
            ).message !== 'string'
          ) {
            json(
              res,
              400,
              {
                error:
                  'Prime requires a text message.'
              }
            );

            return;
          }

          const message =
            (
              body as Record<
                string,
                unknown
              >
            ).message as string;

          /*
           * Explicit constitutional persistence has precedence
           * over engineering and generic Prime classification.
           *
           * Recognition is not registration.
           * Registration is not execution authority.
           */
          const mandateAction =
            interpretPrimeMandateAction(
              message
            );

          if (
            mandateAction.status ===
            'NEEDS_MANDATE_TEXT'
          ) {
            json(
              res,
              200,
              {
                status:
                  'NEEDS_CLARIFICATION',

                reply:
                  mandateAction.reply,

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [],

                constitutional:
                  true
              }
            );

            return;
          }

          if (
            mandateAction.status ===
            'REGISTER_MANDATE_FILE'
          ) {
            const mandate =
              await registerPrimeFounderMandateFile(
                ROOT,
                mandateAction.relative_path
              );

            json(
              res,
              200,
              {
                status:
                  'FOUNDER_MANDATE_REGISTERED',

                reply:
                  founderMandateRegisteredReply(
                    mandate
                  ),

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [
                  'Registration grants no execution authority.'
                ],

                constitutional:
                  true,

                mandate
              }
            );

            return;
          }

          if (
            mandateAction.status ===
            'REGISTER_MANDATE'
          ) {
            const mandate =
              await registerPrimeFounderMandate(
                ROOT,
                mandateAction.original_text
              );

            json(
              res,
              200,
              {
                status:
                  'FOUNDER_MANDATE_REGISTERED',

                reply:
                  founderMandateRegisteredReply(
                    mandate
                  ),

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [
                  'Registration grants no execution authority.'
                ],

                constitutional:
                  true,

                mandate
              }
            );

            return;
          }

          /*
           * Constitutional planning has precedence over
           * engineering and generic Prime classification.
           *
           * Planning is read/derive only:
           * - no execution authority
           * - no Workshop execution
           * - no constitutional mutation
           */
          const mandatePlanning =
            interpretPrimeMandatePlanning(
              message
            );

          if (
            mandatePlanning.status ===
            'PLAN_MANDATE'
          ) {
            const plan =
              await executePrimeMandatePlanning(
                ROOT,
                mandatePlanning.mandate_id
              );

            json(
              res,
              200,
              {
                status:
                  'FOUNDER_MANDATE_PLAN_READY',

                reply:
                  mandatePlanReply(
                    plan
                  ),

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [
                  'Planning grants no execution authority.',
                  'Planning does not mutate constitutional state.'
                ],

                constitutional:
                  true,

                plan
              }
            );

            return;
          }

          /*
           * Explicit constitutional engineering planning.
           *
           * This freezes an exact repository operation and
           * acceptance contract into a non-authoritative
           * pending plan.
           */
          const constitutionalPlanAction =
            interpretPrimeConstitutionalPlan(
              message
            );

          if (
            constitutionalPlanAction.status ===
            'PLAN_CONSTITUTIONAL_ENGINEERING'
          ) {
            const plan =
              await executePrimeConstitutionalPlan(
                ROOT,
                constitutionalPlanAction
              );

            json(
              res,
              200,
              {
                status:
                  'CONSTITUTIONAL_ENGINEERING_PLAN_READY',

                reply:
                  constitutionalPlanReply(
                    plan
                  ),

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [
                  'Planning grants no execution authority.',
                  'The engineering specification is frozen into the proposal digest.',
                  'Founder authorization is required before execution.'
                ],

                constitutional:
                  true,

                engineering:
                  false,

                plan
              }
            );

            return;
          }

          /*
           * Founder authorization is evaluated before
           * ordinary engineering or generic Prime routing.
           *
           * This records bounded authority only.
           * It does NOT execute Workshop engineering.
           */
          const {
            interpretPrimeAuthorization
          } =
            await import(
              './prime-authorization.js'
            );

          const authorizationAction =
            interpretPrimeAuthorization(
              message
            );

          if (
            authorizationAction.status ===
            'AUTHORIZE_PLAN'
          ) {
            const {
              authorizeConstitutionalPlan,
              constitutionalAuthorizationReply
            } =
              await import(
                './constitutional-authority.js'
              );

            const result =
              await authorizeConstitutionalPlan(
                ROOT,
                authorizationAction.plan_id
              );

            json(
              res,
              200,
              {
                status:
                  'FOUNDER_AUTHORIZATION_RECORDED',

                reply:
                  constitutionalAuthorizationReply(
                    result
                  ),

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [
                  'Authorization is bounded to one engineering mission.',
                  'Authorization does not itself execute engineering.',
                  'World Gate and high-consequence operations remain prohibited.'
                ],

                constitutional:
                  true,

                engineering:
                  false,

                authorization:
                  result.authorization
              }
            );

            return;
          }

          /*
           * Constitutional execution has precedence over
           * ordinary engineering.
           *
           * The consumer persists the one-shot execution
           * claim before Forge receives work.
           */
          const constitutionalExecution =
            interpretPrimeConstitutionalEngineering(
              message
            );

          if (
            constitutionalExecution.status ===
            'EXECUTE_AUTHORIZATION'
          ) {
            const result =
              await executeConstitutionalEngineering(
                ROOT,
                constitutionalExecution.authorization_id
              );

            json(
              res,
              200,
              {
                status:
                  'CONSTITUTIONAL_ENGINEERING_COMPLETE',

                reply:
                  constitutionalEngineeringReply(
                    result
                  ),

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [
                  'The authorization is one-shot.',
                  'The execution claim is durable before Forge runs.',
                  'Canonical promotion remains unauthorized.'
                ],

                constitutional:
                  true,

                engineering:
                  true,

                claim:
                  result.claim,

                engineering_receipt:
                  result.engineering_receipt,

                result:
                  result.result
              }
            );

            return;
          }

          const engineering =
            interpretPrimeEngineering(
              message
            );

          if (
            engineering.status ===
            'NEEDS_TARGET'
          ) {
            json(
              res,
              200,
              {
                status:
                  'NEEDS_CLARIFICATION',

                reply:
                  engineering.reply,

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [],

                engineering:
                  true
              }
            );

            return;
          }

          if (
            engineering.status ===
              'ENGINEERING_READY' &&
            engineering.command
          ) {
            const result =
              await executePrimeEngineering(
                ROOT,
                engineering.command
              );

            json(
              res,
              200,
              {
                status:
                  result.receipt.status ===
                  'VERIFIED'
                    ? 'ENGINEERING_VERIFIED'
                    : 'ENGINEERING_REJECTED',

                reply:
                  result.reply,

                mission: null,

                confidence:
                  'HIGH',

                assumptions: [],

                engineering:
                  true,

                receipt:
                  result.receipt
              }
            );

            return;
          }

          if (
            looksLikePrimeRunQuestion(
              message
            )
          ) {
            const runs =
              await listRuns();

            const latestRun =
              runs[0] ?? null;

            if (!latestRun) {
              json(
                res,
                200,
                {
                  status:
                    'NEEDS_CLARIFICATION',

                  reply:
                    'There is no persisted run for me to inspect yet.',

                  mission: null,

                  confidence:
                    'HIGH',

                  assumptions: [],

                  run_id: null,

                  evidence: []
                }
              );

              return;
            }

            const answer =
              answerPrimeRunQuestion(
                message,
                latestRun
              );

            json(
              res,
              200,
              {
                ...answer,

                mission: null,

                confidence:
                  'HIGH',

                assumptions: []
              }
            );

            return;
          }

          /*
           * Cultural discovery is conversational and read-only. It must be
           * evaluated before generic mission interpretation so words such as
           * "discover" or "watch" never turn into a runtime deployment.
           */
          if (
            looksLikeEntertainmentRequest(
              message
            )
          ) {
            const answer =
              answerEntertainment(
                message
              );

            json(
              res,
              200,
              {
                ...answer,
                mission: null,
                confidence: 'MEDIUM',
                assumptions: [
                  'Results are from the local editorial bootstrap catalogue.',
                  'No provider metadata was retrieved.'
                ],
                entertainment: true
              }
            );

            return;
          }

          const interpretation =
            interpretPrimeCommand(
              message
            );

          json(
            res,
            200,
            interpretation
          );

          return;
        }

        if (
          url.pathname ===
            '/api/prime/deploy' &&
          req.method === 'POST'
        ) {
          const body =
            await readJsonBody(req);

          const result =
            await launchPrimeMission(
              body
            );

          json(
            res,
            result.started
              ? 202
              : 409,
            {
              ...result,

              adapter:
                'local-deterministic-v1',

              message:
                result.started
                  ? 'Prime mission accepted for execution.'
                  : 'A Sink Clones run is already active.'
            }
          );

          return;
        }

        if (
          url.pathname ===
            '/api/run' &&
          req.method === 'POST'
        ) {
          const mission =
            parseConsoleMission(
              await readJsonBody(req)
            );

          const result =
            launchLocalRun(
              mission
            );

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
