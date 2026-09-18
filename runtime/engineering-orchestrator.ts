import {
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';

import {
  join,
  relative,
  resolve
} from 'node:path';

import {
  randomUUID
} from 'node:crypto';

import {
  EngineeringMissionSchema,
  type EngineeringMission
} from './engineering-mission.js';

import {
  LocalEngineeringIntelligence,
  type EngineeringIntelligence,
  type EngineeringProposal
} from './engineering-intelligence.js';

import {
  applyEngineeringProposal
} from './engineering-executor.js';

import {
  createEngineeringWorkspace,
  destroyEngineeringWorkspace,
  runEngineeringCommand,
  type EngineeringWorkspace
} from './engineering-workspace.js';

import {
  ModelCommons
} from './model-commons.js';

import {
  ModelCommonsTransport
} from './model-commons-transport.js';

import {
  LlamaCppLocalRuntime
} from './llama-cpp-local-runtime.js';

export type EngineeringRunStatus =
  | 'PROPOSED'
  | 'VERIFIED'
  | 'REJECTED';

export interface EngineeringReceipt {
  receipt_id: string;
  created_at: string;
  status: EngineeringRunStatus;
  objective: string;
  target_path: string;
  base_commit: string;
  proposal?: EngineeringProposal;
  diff?: string;
  changed_files: string[];
  typecheck_exit_code?: number | null;
  typecheck_stdout?: string;
  typecheck_stderr?: string;
  acceptance_checks?: string[];
  repair_attempted?: boolean;
  initial_proposal?: EngineeringProposal;
  initial_typecheck_exit_code?: number | null;
  initial_typecheck_stdout?: string;
  initial_typecheck_stderr?: string;
  repair_diagnostics?: string;
  vera: 'PASS' | 'FAIL';
  rook: 'PASS' | 'FAIL';
  promotion: 'NOT_AUTHORIZED';
  workspace_destroyed: boolean;
  cognition: 'LOCAL';
  model:
    'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M';
  failure?: string;
}

export interface EngineeringRequest {
  objective: string;
  target_path: string;
  operation?: 'CREATE' | 'REPLACE';
  expected_exports?: string[];
}

const MODEL_ID = 'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M' as const;

const RECEIPT_DIRECTORY =
  '.sink/lake-yange/engineering-receipts';

const MAX_CONTEXT_BYTES =
  12_000;

function repositoryRelativePath(
  repositoryRoot: string,
  path: string
): string {
  const rel =
    relative(
      repositoryRoot,
      resolve(
        repositoryRoot,
        path
      )
    );

  if (
    !rel ||
    rel.startsWith('..') ||
    rel.includes('\0')
  ) {
    throw new Error(
      'ENGINEERING_TARGET_OUTSIDE_REPOSITORY'
    );
  }

  return rel;
}

async function readTargetContext(
  repositoryRoot: string,
  targetPath: string
): Promise<{
  exists: boolean;
  content: string;
}> {
  try {
    const content =
      await readFile(
        join(
          repositoryRoot,
          targetPath
        ),
        'utf8'
      );

    return {
      exists: true,
      content:
        content.slice(
          0,
          MAX_CONTEXT_BYTES
        )
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as {
        code?: unknown
      }).code === 'ENOENT'
    ) {
      return {
        exists: false,
        content: ''
      };
    }

    throw error;
  }
}

function rookFindings(
  proposal: EngineeringProposal
): string[] {
  const source =
    proposal.mutations
      .map(
        mutation =>
          mutation.content
      )
      .join('\n');

  const forbidden = [
    'child_process',
    'process.env',
    'node:http',
    'node:https',
    'fetch(',
    'Bun.spawn',
    'Deno.run'
  ];

  return forbidden.filter(
    token =>
      source.includes(token)
  );
}

async function persistReceipt(
  repositoryRoot: string,
  receipt: EngineeringReceipt
): Promise<string> {
  const directory =
    join(
      repositoryRoot,
      RECEIPT_DIRECTORY
    );

  await mkdir(
    directory,
    {
      recursive: true
    }
  );

  const path =
    join(
      directory,
      `${receipt.receipt_id}.json`
    );

  await writeFile(
    path,
    JSON.stringify(
      receipt,
      null,
      2
    ) + '\n',
    {
      mode: 0o600
    }
  );

  return path;
}

function verifyExpectedExports(
  source: string,
  expectedExports: string[]
): string[] {
  const failures: string[] = [];

  for (const name of expectedExports) {
    const escaped =
      name.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

    const declaration =
      new RegExp(
        String.raw`\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+${escaped}\b`
      );

    const exportList =
      new RegExp(
        String.raw`\bexport\s*\{[^}]*\b${escaped}\b[^}]*\}`
      );

    if (
      !declaration.test(source) &&
      !exportList.test(source)
    ) {
      failures.push(
        `MISSING_EXPECTED_EXPORT:${name}`
      );
    }
  }

  return failures;
}

function buildMission(
  repositoryRoot: string,
  request: EngineeringRequest,
  targetExists: boolean
): EngineeringMission {
  const operation =
    request.operation ??
    (
      targetExists
        ? 'REPLACE'
        : 'CREATE'
    );

  return EngineeringMissionSchema.parse({
    objective: `
${request.objective}

You are Forge inside Lake Yange.

Generate the COMPLETE TypeScript/JavaScript source
for exactly this target:

${request.target_path}

Required mutation operation:
${operation}

Return source code only through the structured
content field.

Do not return a filename.
Do not use Markdown.
Do not explain outside the source.

Stay within the requested objective.
Preserve existing behavior unless the objective
requires changing it.

No shell.
No child_process.
No process.env.
No network.
No fetch.
No git.
No credentials.
No deployment.
No dependency installation.
Do not weaken tests.
`.trim(),

    repository_root:
      repositoryRoot,

    allowed_paths: [
      request.target_path
    ],

    verification_commands: [
      'TYPECHECK'
    ],

    max_files_changed:
      1,

    max_patch_bytes:
      24_000,

    max_model_calls:
      2
  });
}

function createForge() {
  const runtime =
    new LlamaCppLocalRuntime({
      baseUrl:
        'http://127.0.0.1:18181',

      timeoutMs:
        120_000
    });

  const commons =
    new ModelCommons(
      runtime
    );

  commons.register({
    model_id:
      MODEL_ID,

    name:
      'Lake Yange Forge',

    runtime:
      'llama.cpp',

    locality:
      'LOCAL',

    capabilities: [
      'CODING'
    ],

    context_tokens:
      4096,

    enabled:
      true,

    loaded:
      true,

    memory_class_gb:
      3,

    endpoint:
      'http://127.0.0.1:18181'
  });

  return new LocalEngineeringIntelligence(
    new ModelCommonsTransport(
      commons
    )
  );
}

export interface EngineeringOrchestratorDependencies {
  forge?: EngineeringIntelligence;
}

export async function runEngineeringMission(
  repositoryRoot: string,
  request: EngineeringRequest,
  dependencies:
    EngineeringOrchestratorDependencies = {}
): Promise<EngineeringReceipt> {
  const receiptId =
    randomUUID();

  const targetPath =
    repositoryRelativePath(
      repositoryRoot,
      request.target_path
    );

  const target =
    await readTargetContext(
      repositoryRoot,
      targetPath
    );

  const mission =
    buildMission(
      repositoryRoot,
      {
        ...request,
        target_path:
          targetPath
      },
      target.exists
    );

  const forge =
    dependencies.forge ??
    createForge();

  let workspace:
    EngineeringWorkspace |
    undefined;

  const receipt:
    EngineeringReceipt = {
      receipt_id:
        receiptId,

      created_at:
        new Date()
          .toISOString(),

      status:
        'REJECTED',

      objective:
        request.objective,

      target_path:
        targetPath,

      base_commit:
        '',

      changed_files: [],

      vera:
        'FAIL',

      rook:
        'FAIL',

      promotion:
        'NOT_AUTHORIZED',

      workspace_destroyed:
        false,

      cognition:
        'LOCAL',

      model:
        MODEL_ID
    };

  try {
    workspace =
      await createEngineeringWorkspace(
        repositoryRoot
      );

    receipt.base_commit =
      workspace.base_commit;

    const context = [
      {
        path:
          target.exists
            ? targetPath
            : 'TARGET_DOES_NOT_EXIST.txt',

        content:
          target.exists
            ? target.content
            : `The target ${targetPath} does not exist yet.`
      },

      {
        path:
          'LAKE_YANGE_AUTHORITY.txt',

        content: `
The model supplies source content only.
Lake Yange supplies the target path and operation.
Canonical repository promotion is forbidden.
TYPECHECK is the only executable verification command.
`
      }
    ];

    const proposal =
      await forge.propose(
        mission,
        context
      );

    let acceptedProposal =
      proposal;

    receipt.proposal =
      proposal;

    const findings =
      rookFindings(
        proposal
      );

    if (
      findings.length > 0
    ) {
      receipt.failure =
        `ROOK_FORBIDDEN:${findings.join(',')}`;

      return receipt;
    }

    receipt.rook =
      'PASS';

    const diff =
      await applyEngineeringProposal(
        workspace,
        proposal
      );

    receipt.diff =
      diff.diff;

    receipt.changed_files =
      diff.changed_files;

    const typecheck =
      await runEngineeringCommand(
        workspace,
        'TYPECHECK'
      );

    receipt.typecheck_exit_code =
      typecheck.exit_code;

    receipt.typecheck_stdout =
      typecheck.stdout;

    receipt.typecheck_stderr =
      typecheck.stderr;

    if (
      typecheck.exit_code !== 0
    ) {
      /*
       * Vera has rejected the initial neural draft.
       *
       * One bounded repair is permitted inside the
       * SAME mission, workspace, target and authority
       * envelope. No new constitutional authority is
       * created by this repair.
       */
      receipt.repair_attempted =
        true;

      receipt.initial_proposal =
        proposal;

      receipt.initial_typecheck_exit_code =
        typecheck.exit_code;

      receipt.initial_typecheck_stdout =
        typecheck.stdout;

      receipt.initial_typecheck_stderr =
        typecheck.stderr;

      const diagnostics = [
        typecheck.stdout,
        typecheck.stderr
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 12_000);

      receipt.repair_diagnostics =
        diagnostics;

      const failedSource =
        proposal.mutations[0]
          ?.content ?? '';

      const repairProposal =
        await forge.repair(
          mission,
          failedSource,
          diagnostics
        );

      const repairFindings =
        rookFindings(
          repairProposal
        );

      if (
        repairFindings.length > 0
      ) {
        receipt.proposal =
          repairProposal;

        receipt.rook =
          'FAIL';

        receipt.failure =
          `ROOK_REPAIR_FORBIDDEN:${repairFindings.join(',')}`;

        return receipt;
      }

      /*
       * CREATE authority refers to the canonical
       * target. The initial draft already exists only
       * inside the disposable Workshop, so the repair
       * replaces that draft without changing canonical
       * operation authority.
       */
      const repairMutation =
        repairProposal.mutations[0];

      if (!repairMutation) {
        receipt.failure =
          'FORGE_REPAIR_MUTATION_MISSING';

        return receipt;
      }

      const workshopRepair = {
        ...repairProposal,
        mutations: [
          {
            ...repairMutation,
            operation:
              'REPLACE' as const
          }
        ]
      };

      const repairDiff =
        await applyEngineeringProposal(
          workspace,
          workshopRepair
        );

      acceptedProposal =
        repairProposal;

      receipt.proposal =
        repairProposal;

      receipt.diff =
        repairDiff.diff;

      receipt.changed_files =
        repairDiff.changed_files;

      const repairedTypecheck =
        await runEngineeringCommand(
          workspace,
          'TYPECHECK'
        );

      receipt.typecheck_exit_code =
        repairedTypecheck.exit_code;

      receipt.typecheck_stdout =
        repairedTypecheck.stdout;

      receipt.typecheck_stderr =
        repairedTypecheck.stderr;

      if (
        repairedTypecheck.exit_code !==
          0
      ) {
        receipt.failure =
          'VERA_REPAIR_TYPECHECK_FAILED';

        return receipt;
      }
    }

    const expectedExports =
      request.expected_exports ?? [];

    const proposedSource =
      acceptedProposal
        .mutations[0]
        ?.content ?? '';

    const acceptanceFailures =
      verifyExpectedExports(
        proposedSource,
        expectedExports
      );

    receipt.acceptance_checks =
      expectedExports.map(
        name =>
          `EXPECTED_EXPORT:${name}`
      );

    if (
      acceptanceFailures.length > 0
    ) {
      receipt.failure =
        `VERA_ACCEPTANCE_FAILED:${acceptanceFailures.join(',')}`;

      return receipt;
    }

    receipt.vera =
      'PASS';

    receipt.status =
      'VERIFIED';

    return receipt;
  } catch (error) {
    receipt.failure =
      error instanceof Error
        ? error.message
        : String(error);

    return receipt;
  } finally {
    if (workspace) {
      await destroyEngineeringWorkspace(
        workspace
      );

      receipt.workspace_destroyed =
        true;
    }

    await persistReceipt(
      repositoryRoot,
      receipt
    );
  }
}

export async function readEngineeringReceipt(
  repositoryRoot: string,
  receiptId: string
): Promise<EngineeringReceipt> {
  const path =
    join(
      repositoryRoot,
      RECEIPT_DIRECTORY,
      `${receiptId}.json`
    );

  return JSON.parse(
    await readFile(
      path,
      'utf8'
    )
  ) as EngineeringReceipt;
}
