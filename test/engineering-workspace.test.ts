import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import {
  tmpdir
} from 'node:os';

import {
  spawnSync
} from 'node:child_process';

import {
  createEngineeringWorkspace,
  destroyEngineeringWorkspace,
  readWorkspaceFile,
  workspaceDiff,
  workspaceExists,
  writeWorkspaceFile
} from '../runtime/engineering-workspace.js';

function git(
  cwd: string,
  args: string[]
): string {
  const result =
    spawnSync(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8'
      }
    );

  assert.equal(
    result.status,
    0,
    result.stderr
  );

  return result.stdout.trim();
}

async function fixtureRepo() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        'lake-yange-engineering-'
      )
    );

  git(
    root,
    ['init']
  );

  git(
    root,
    [
      'config',
      'user.email',
      'lake-yange@example.invalid'
    ]
  );

  git(
    root,
    [
      'config',
      'user.name',
      'Lake Yange Test'
    ]
  );

  await writeFile(
    join(
      root,
      'hello.txt'
    ),
    'founding state\n',
    'utf8'
  );

  await mkdir(
    join(
      root,
      'runtime'
    )
  );

  await writeFile(
    join(
      root,
      'runtime',
      'example.ts'
    ),
    'export const value = 1;\n',
    'utf8'
  );

  git(
    root,
    [
      'add',
      '.'
    ]
  );

  git(
    root,
    [
      'commit',
      '-m',
      'fixture'
    ]
  );

  return root;
}

test(
  'engineering workspace is isolated from canonical repository',
  async () => {
    const repo =
      await fixtureRepo();

    const workspace =
      await createEngineeringWorkspace(
        repo
      );

    try {
      assert.notEqual(
        workspace.workspace_root,
        workspace.repository_root
      );

      await writeWorkspaceFile(
        workspace,
        'hello.txt',
        'changed by Forge\n'
      );

      const sandboxValue =
        await readWorkspaceFile(
          workspace,
          'hello.txt'
        );

      const canonicalValue =
        await readFile(
          join(
            repo,
            'hello.txt'
          ),
          'utf8'
        );

      assert.equal(
        sandboxValue,
        'changed by Forge\n'
      );

      assert.equal(
        canonicalValue,
        'founding state\n'
      );
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );

      await rm(
        repo,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'workspace produces inspectable Git diff',
  async () => {
    const repo =
      await fixtureRepo();

    const workspace =
      await createEngineeringWorkspace(
        repo
      );

    try {
      await writeWorkspaceFile(
        workspace,
        'runtime/example.ts',
        'export const value = 2;\n'
      );

      const result =
        await workspaceDiff(
          workspace
        );

      assert.equal(
        result.clean,
        false
      );

      assert.ok(
        result.changed_files.some(
          (path) =>
            path.includes(
              'runtime/example.ts'
            )
        )
      );

      assert.match(
        result.diff,
        /value = 2/
      );
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );

      await rm(
        repo,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'path traversal is rejected',
  async () => {
    const repo =
      await fixtureRepo();

    const workspace =
      await createEngineeringWorkspace(
        repo
      );

    try {
      await assert.rejects(
        () =>
          writeWorkspaceFile(
            workspace,
            '../escape.txt',
            'forbidden'
          ),
        /PATH_TRAVERSAL|PATH_ESCAPE/
      );
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );

      await rm(
        repo,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'control and secret paths are rejected',
  async () => {
    const repo =
      await fixtureRepo();

    const workspace =
      await createEngineeringWorkspace(
        repo
      );

    try {
      for (
        const path of [
          '.git/config',
          '.sink/state.json',
          '.env',
          '.env.local',
          'secrets/token.txt',
          'credentials/key.txt'
        ]
      ) {
        await assert.rejects(
          () =>
            writeWorkspaceFile(
              workspace,
              path,
              'forbidden'
            ),
          /PROTECTED_PATH/
        );
      }
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );

      await rm(
        repo,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'destroy removes experimental workspace',
  async () => {
    const repo =
      await fixtureRepo();

    const workspace =
      await createEngineeringWorkspace(
        repo
      );

    assert.equal(
      await workspaceExists(
        workspace
      ),
      true
    );

    await destroyEngineeringWorkspace(
      workspace
    );

    assert.equal(
      await workspaceExists(
        workspace
      ),
      false
    );

    await rm(
      repo,
      {
        recursive: true,
        force: true
      }
    );
  }
);
