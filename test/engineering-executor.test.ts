import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyEngineeringProposal
} from '../runtime/engineering-executor.js';

import {
  createEngineeringWorkspace,
  destroyEngineeringWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile
} from '../runtime/engineering-workspace.js';

import type {
  EngineeringProposal
} from '../runtime/engineering-intelligence.js';

function proposal(
  mutation: {
    path: string;
    operation:
      | 'CREATE'
      | 'REPLACE';
    content: string;
  }
): EngineeringProposal {
  return {
    summary:
      'Trusted executor behavioral test.',

    mutations: [
      {
        ...mutation,

        rationale:
          'Exercise executor semantics.'
      }
    ],

    tests_expected: [],

    uncertainties: [],

    requires_human_decision:
      true
  };
}

test(
  'executor creates an absent file',
  async () => {
    const workspace =
      await createEngineeringWorkspace(
        process.cwd()
      );

    try {
      const path =
        'runtime/executor-created-test.ts';

      const diff =
        await applyEngineeringProposal(
          workspace,
          proposal({
            path,

            operation:
              'CREATE',

            content:
              'export const created = true;\n'
          })
        );

      assert.equal(
        await readWorkspaceFile(
          workspace,
          path
        ),
        'export const created = true;\n'
      );

      assert.ok(
        diff.changed_files.includes(
          path
        )
      );
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );
    }
  }
);

test(
  'executor rejects CREATE for existing file',
  async () => {
    const workspace =
      await createEngineeringWorkspace(
        process.cwd()
      );

    try {
      const path =
        'runtime/executor-existing-test.ts';

      await writeWorkspaceFile(
        workspace,
        path,
        'export const before = true;\n'
      );

      await assert.rejects(
        applyEngineeringProposal(
          workspace,
          proposal({
            path,

            operation:
              'CREATE',

            content:
              'export const after = true;\n'
          })
        ),

        /ENGINEERING_CREATE_TARGET_EXISTS/
      );

      assert.equal(
        await readWorkspaceFile(
          workspace,
          path
        ),
        'export const before = true;\n'
      );
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );
    }
  }
);

test(
  'executor replaces an existing file',
  async () => {
    const workspace =
      await createEngineeringWorkspace(
        process.cwd()
      );

    try {
      const path =
        'runtime/executor-replace-test.ts';

      await writeWorkspaceFile(
        workspace,
        path,
        'export const state = "before";\n'
      );

      const diff =
        await applyEngineeringProposal(
          workspace,
          proposal({
            path,

            operation:
              'REPLACE',

            content:
              'export const state = "after";\n'
          })
        );

      assert.equal(
        await readWorkspaceFile(
          workspace,
          path
        ),
        'export const state = "after";\n'
      );

      assert.ok(
        diff.changed_files.includes(
          path
        )
      );
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );
    }
  }
);

test(
  'executor rejects REPLACE for missing file',
  async () => {
    const workspace =
      await createEngineeringWorkspace(
        process.cwd()
      );

    try {
      await assert.rejects(
        applyEngineeringProposal(
          workspace,
          proposal({
            path:
              'runtime/executor-missing-test.ts',

            operation:
              'REPLACE',

            content:
              'export const state = "after";\n'
          })
        ),

        /ENGINEERING_REPLACE_TARGET_MISSING/
      );
    } finally {
      await destroyEngineeringWorkspace(
        workspace
      );
    }
  }
);
