import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises';

import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path';

import {
  spawn
} from 'node:child_process';

import {
  randomUUID
} from 'node:crypto';

import { z } from 'zod';

/**
 * LAKE YANGE — ENGINEERING WORKSPACE
 * ==================================
 *
 * This is the first write-capable boundary in Lake Yange.
 *
 * Constitutional rules:
 *
 * - Never edit the canonical repository.
 * - Every mission receives an isolated Git worktree.
 * - No arbitrary shell strings.
 * - Commands are argv arrays selected from an allowlist.
 * - Paths must remain inside the worktree.
 * - Sensitive/control paths cannot be written.
 * - No deploy, network, credential or destructive tools.
 * - Every mutation can be represented as a Git diff.
 * - Workspace lifetime is bounded.
 */

export const EngineeringCommandSchema =
  z.enum([
    'TYPECHECK',
    'TEST',
    'EVAL',
    'BUILD'
  ]);

export type EngineeringCommand =
  z.infer<
    typeof EngineeringCommandSchema
  >;

export const EngineeringWorkspaceSchema =
  z.object({
    workspace_id:
      z.string().uuid(),

    repository_root:
      z.string().min(1),

    workspace_root:
      z.string().min(1),

    branch:
      z.string().min(1),

    base_commit:
      z.string()
        .regex(
          /^[a-f0-9]{40,64}$/
        ),

    created_at:
      z.string().datetime(),

    max_runtime_ms:
      z.number()
        .int()
        .positive(),

    max_output_bytes:
      z.number()
        .int()
        .positive()
  }).strict();

export type EngineeringWorkspace =
  z.infer<
    typeof EngineeringWorkspaceSchema
  >;

export const CommandResultSchema =
  z.object({
    command:
      EngineeringCommandSchema,

    argv:
      z.array(z.string()),

    exit_code:
      z.number()
        .int()
        .nullable(),

    signal:
      z.string()
        .nullable(),

    stdout:
      z.string(),

    stderr:
      z.string(),

    timed_out:
      z.boolean(),

    duration_ms:
      z.number()
        .int()
        .nonnegative()
  }).strict();

export type CommandResult =
  z.infer<
    typeof CommandResultSchema
  >;

export const WorkspaceDiffSchema =
  z.object({
    workspace_id:
      z.string().uuid(),

    base_commit:
      z.string()
        .regex(
          /^[a-f0-9]{40,64}$/
        ),

    changed_files:
      z.array(z.string()),

    diff:
      z.string(),

    clean:
      z.boolean()
  }).strict();

export type WorkspaceDiff =
  z.infer<
    typeof WorkspaceDiffSchema
  >;

const COMMANDS:
  Record<
    EngineeringCommand,
    readonly string[]
  > = {
    TYPECHECK: [
      './node_modules/.bin/tsc',
      '--noEmit'
    ],

    TEST: [
      'npm',
      'test'
    ],

    EVAL: [
      'npm',
      'run',
      'eval'
    ],

    BUILD: [
      'npm',
      'run',
      'build'
    ]
  };

const BLOCKED_PATH_PARTS =
  new Set([
    '.git',
    '.sink',
    '.env',
    '.env.local',
    '.env.production',
    '.npmrc',
    '.ssh',
    'credentials',
    'secrets'
  ]);

function assertSafeRelativePath(
  path: string
): void {
  if (!path.trim()) {
    throw new Error(
      'ENGINEERING_PATH_EMPTY'
    );
  }

  if (isAbsolute(path)) {
    throw new Error(
      'ENGINEERING_ABSOLUTE_PATH_FORBIDDEN'
    );
  }

  const normalized =
    path.replace(/\\/g, '/');

  const parts =
    normalized.split('/');

  if (
    parts.some(
      (part) =>
        part === '..'
    )
  ) {
    throw new Error(
      'ENGINEERING_PATH_TRAVERSAL'
    );
  }

  if (
    parts.some(
      (part) =>
        BLOCKED_PATH_PARTS.has(
          part.toLowerCase()
        )
    )
  ) {
    throw new Error(
      'ENGINEERING_PROTECTED_PATH'
    );
  }
}

function inside(
  parent: string,
  child: string
): boolean {
  const rel =
    relative(
      parent,
      child
    );

  return (
    rel === '' ||
    (
      !rel.startsWith('..') &&
      !isAbsolute(rel)
    )
  );
}

async function assertContainedPath(
  root: string,
  requested: string
): Promise<string> {
  assertSafeRelativePath(
    requested
  );

  const target =
    resolve(
      root,
      requested
    );

  if (
    !inside(
      root,
      target
    )
  ) {
    throw new Error(
      'ENGINEERING_PATH_ESCAPE'
    );
  }

  return target;
}

async function runProcess(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    timeoutMs: number;
    maxOutputBytes: number;
    env?: NodeJS.ProcessEnv;
  }
): Promise<{
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}> {
  const started =
    Date.now();

  return await new Promise(
    (
      resolvePromise,
      rejectPromise
    ) => {
      const child =
        spawn(
          executable,
          [...args],
          {
            cwd:
              options.cwd,

            shell:
              false,

            env:
              options.env ?? {
                ...process.env,

                /**
                 * Prevent accidental interactive
                 * command behaviour.
                 */
                CI: '1'
              },

            stdio: [
              'ignore',
              'pipe',
              'pipe'
            ]
          }
        );

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let timedOut = false;
      let settled = false;

      const append = (
        current: string,
        chunk: Buffer
      ): string => {
        outputBytes +=
          chunk.byteLength;

        if (
          outputBytes >
          options.maxOutputBytes
        ) {
          child.kill(
            'SIGTERM'
          );

          return current;
        }

        return (
          current +
          chunk.toString('utf8')
        );
      };

      child.stdout.on(
        'data',
        (chunk: Buffer) => {
          stdout =
            append(
              stdout,
              chunk
            );
        }
      );

      child.stderr.on(
        'data',
        (chunk: Buffer) => {
          stderr =
            append(
              stderr,
              chunk
            );
        }
      );

      child.on(
        'error',
        (error) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          rejectPromise(error);
        }
      );

      child.on(
        'close',
        (
          exitCode,
          signal
        ) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);

          resolvePromise({
            exitCode,
            signal,
            stdout,
            stderr,
            timedOut,
            durationMs:
              Date.now() -
              started
          });
        }
      );

      const timer =
        setTimeout(
          () => {
            timedOut = true;

            child.kill(
              'SIGTERM'
            );

            setTimeout(
              () => {
                if (
                  !settled
                ) {
                  child.kill(
                    'SIGKILL'
                  );
                }
              },
              1500
            ).unref();
          },
          options.timeoutMs
        );

      timer.unref();
    }
  );
}

async function git(
  cwd: string,
  args: readonly string[],
  timeoutMs = 30_000
) {
  const result =
    await runProcess(
      'git',
      args,
      {
        cwd,
        timeoutMs,
        maxOutputBytes:
          2_000_000
      }
    );

  if (
    result.exitCode !== 0
  ) {
    throw new Error(
      [
        'ENGINEERING_GIT_FAILURE',
        `git ${args.join(' ')}`,
        result.stderr ||
          result.stdout
      ].join('\n')
    );
  }

  return result.stdout.trim();
}

export async function createEngineeringWorkspace(
  repositoryRootInput: string,
  options: {
    maxRuntimeMs?: number;
    maxOutputBytes?: number;
  } = {}
): Promise<EngineeringWorkspace> {
  const repositoryRoot =
    await realpath(
      repositoryRootInput
    );

  const baseCommit =
    await git(
      repositoryRoot,
      [
        'rev-parse',
        'HEAD'
      ]
    );

  if (
    !/^[a-f0-9]{40,64}$/.test(
      baseCommit
    )
  ) {
    throw new Error(
      'ENGINEERING_INVALID_BASE_COMMIT'
    );
  }

  const workspaceId =
    randomUUID();

  const branch =
    `lake-yange/forge-${workspaceId.slice(0, 8)}`;

  /**
   * Keep worktrees OUTSIDE the repository.
   *
   * This prevents a builder from confusing
   * canonical runtime state with its sandbox.
   */
  const workspaceParent =
    resolve(
      repositoryRoot,
      '..',
      '.lake-yange-worktrees'
    );

  await mkdir(
    workspaceParent,
    {
      recursive: true
    }
  );

  const workspaceRoot =
    join(
      workspaceParent,
      workspaceId
    );

  await git(
    repositoryRoot,
    [
      'worktree',
      'add',
      '-b',
      branch,
      workspaceRoot,
      baseCommit
    ],
    60_000
  );

  const canonicalReal =
    await realpath(
      repositoryRoot
    );

  const workspaceReal =
    await realpath(
      workspaceRoot
    );

  if (
    canonicalReal ===
    workspaceReal
  ) {
    throw new Error(
      'ENGINEERING_CANONICAL_REPOSITORY_FORBIDDEN'
    );
  }

  return EngineeringWorkspaceSchema.parse({
    workspace_id:
      workspaceId,

    repository_root:
      canonicalReal,

    workspace_root:
      workspaceReal,

    branch,

    base_commit:
      baseCommit,

    created_at:
      new Date()
        .toISOString(),

    max_runtime_ms:
      options.maxRuntimeMs ??
      120_000,

    max_output_bytes:
      options.maxOutputBytes ??
      2_000_000
  });
}

export async function readWorkspaceFile(
  workspaceInput:
    EngineeringWorkspace,
  path: string
): Promise<string> {
  const workspace =
    EngineeringWorkspaceSchema.parse(
      workspaceInput
    );

  const target =
    await assertContainedPath(
      workspace.workspace_root,
      path
    );

  const resolvedParent =
    await realpath(
      dirname(target)
    );

  if (
    !inside(
      workspace.workspace_root,
      resolvedParent
    )
  ) {
    throw new Error(
      'ENGINEERING_SYMLINK_ESCAPE'
    );
  }

  return await readFile(
    target,
    'utf8'
  );
}

export async function writeWorkspaceFile(
  workspaceInput:
    EngineeringWorkspace,
  path: string,
  content: string
): Promise<void> {
  const workspace =
    EngineeringWorkspaceSchema.parse(
      workspaceInput
    );

  if (
    Buffer.byteLength(
      content,
      'utf8'
    ) >
    1_000_000
  ) {
    throw new Error(
      'ENGINEERING_WRITE_TOO_LARGE'
    );
  }

  const target =
    await assertContainedPath(
      workspace.workspace_root,
      path
    );

  await mkdir(
    dirname(target),
    {
      recursive: true
    }
  );

  const resolvedParent =
    await realpath(
      dirname(target)
    );

  if (
    !inside(
      workspace.workspace_root,
      resolvedParent
    )
  ) {
    throw new Error(
      'ENGINEERING_SYMLINK_ESCAPE'
    );
  }

  await writeFile(
    target,
    content,
    {
      encoding: 'utf8'
    }
  );
}

export async function runEngineeringCommand(
  workspaceInput:
    EngineeringWorkspace,
  commandInput:
    EngineeringCommand
): Promise<CommandResult> {
  const workspace =
    EngineeringWorkspaceSchema.parse(
      workspaceInput
    );

  const command =
    EngineeringCommandSchema.parse(
      commandInput
    );

  const argv =
    [...COMMANDS[command]];

  const [
    executable,
    ...args
  ] = argv;

  if (!executable) {
    throw new Error(
      'ENGINEERING_COMMAND_EMPTY'
    );
  }

  const result =
    await runProcess(
      executable,
      args,
      {
        cwd:
          workspace.workspace_root,

        timeoutMs:
          workspace.max_runtime_ms,

        maxOutputBytes:
          workspace.max_output_bytes,

        env: {
          ...process.env,
          CI: '1',

          /**
           * Do not make credentials available
           * through common package/publish vars.
           *
           * This is not a complete secret sandbox;
           * G1 execution remains local and bounded.
           */
          NODE_AUTH_TOKEN:
            undefined,

          NPM_TOKEN:
            undefined,

          GITHUB_TOKEN:
            undefined,

          GH_TOKEN:
            undefined
        }
      }
    );

  return CommandResultSchema.parse({
    command,

    argv,

    exit_code:
      result.exitCode,

    signal:
      result.signal,

    stdout:
      result.stdout,

    stderr:
      result.stderr,

    timed_out:
      result.timedOut,

    duration_ms:
      result.durationMs
  });
}

export async function workspaceDiff(
  workspaceInput:
    EngineeringWorkspace
): Promise<WorkspaceDiff> {
  const workspace =
    EngineeringWorkspaceSchema.parse(
      workspaceInput
    );

  const changedRaw =
    await git(
      workspace.workspace_root,
      [
        'status',
        '--short'
      ]
    );

  const diff =
    await git(
      workspace.workspace_root,
      [
        'diff',
        '--no-ext-diff',
        '--binary',
        workspace.base_commit,
        '--',
        '.'
      ]
    );

  const changedFiles =
    changedRaw
      .split('\n')
      .map(
        (line) =>
          line.trim()
      )
      .filter(Boolean)
      .map(
        (line) =>
          line
            .replace(
              /^..\s+/,
              ''
            )
            .trim()
      );

  return WorkspaceDiffSchema.parse({
    workspace_id:
      workspace.workspace_id,

    base_commit:
      workspace.base_commit,

    changed_files:
      changedFiles,

    diff,

    clean:
      changedFiles.length ===
      0
  });
}

export async function destroyEngineeringWorkspace(
  workspaceInput:
    EngineeringWorkspace
): Promise<void> {
  const workspace =
    EngineeringWorkspaceSchema.parse(
      workspaceInput
    );

  /**
   * Remove through Git first so worktree metadata
   * remains coherent.
   */
  const result =
    await runProcess(
      'git',
      [
        'worktree',
        'remove',
        '--force',
        workspace.workspace_root
      ],
      {
        cwd:
          workspace.repository_root,

        timeoutMs:
          30_000,

        maxOutputBytes:
          1_000_000
      }
    );

  if (
    result.exitCode !== 0
  ) {
    /**
     * Best-effort filesystem cleanup.
     * We still refuse to touch the canonical repo.
     */
    if (
      workspace.workspace_root !==
      workspace.repository_root
    ) {
      await rm(
        workspace.workspace_root,
        {
          recursive: true,
          force: true
        }
      );
    }
  }

  /**
   * The experimental branch is disposable until
   * a later governance layer explicitly promotes it.
   */
  await runProcess(
    'git',
    [
      'branch',
      '-D',
      workspace.branch
    ],
    {
      cwd:
        workspace.repository_root,

      timeoutMs:
        30_000,

      maxOutputBytes:
        1_000_000
    }
  );
}

export async function workspaceExists(
  workspaceInput:
    EngineeringWorkspace
): Promise<boolean> {
  const workspace =
    EngineeringWorkspaceSchema.parse(
      workspaceInput
    );

  try {
    await access(
      workspace.workspace_root
    );

    return true;
  } catch {
    return false;
  }
}

export function workspaceLabel(
  workspace:
    EngineeringWorkspace
): string {
  return [
    'Lake Yange Engineering Workspace',
    basename(
      workspace.workspace_root
    ),
    workspace.branch,
    workspace.base_commit
  ].join(' | ');
}
