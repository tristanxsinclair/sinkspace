import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access
} from 'node:fs/promises';
import {
  dirname,
  join
} from 'node:path';
import {
  fileURLToPath
} from 'node:url';

import {
  runEngineeringMission
} from '../runtime/engineering-orchestrator.js';

import type {
  EngineeringIntelligence,
  EngineeringProposal
} from '../runtime/engineering-intelligence.js';

import type {
  EngineeringMission
} from '../runtime/engineering-mission.js';

const repositoryRoot =
  join(
    dirname(
      fileURLToPath(
        import.meta.url
      )
    ),
    '..'
  );

const targetPath =
  'runtime/lake-yange-constitutional-status.ts';

const canonicalTarget =
  join(
    repositoryRoot,
    targetPath
  );

async function assertCanonicalTargetAbsent():
  Promise<void> {
  await assert.rejects(
    access(
      canonicalTarget
    ),
    error =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
  );
}

function proposal(
  mission:
    EngineeringMission,
  content:
    string
): EngineeringProposal {
  const target =
    mission.allowed_paths[0];

  assert.ok(
    target
  );

  return {
    summary:
      `Fixture proposal for ${target}.`,

    mutations: [
      {
        path:
          target,

        operation:
          'CREATE',

        content,

        rationale:
          'Deterministic test fixture.'
      }
    ],

    tests_expected: [
      'Independent verification required: TYPECHECK.'
    ],

    uncertainties: [],

    requires_human_decision:
      true
  };
}

test(
  'Vera diagnostics drive one bounded repair that can become VERIFIED',
  async () => {
    await assertCanonicalTargetAbsent();

    let proposeCalls = 0;
    let repairCalls = 0;
    let receivedDiagnostics = '';
    let receivedFailedSource = '';

    const forge:
      EngineeringIntelligence = {
        name:
          'fixture-forge',

        locality:
          'LOCAL',

        async propose(
          mission
        ) {
          proposeCalls += 1;

          return proposal(
            mission,
            [
              "import { Missing } from './missing.js';",
              '',
              'export function constitutionalStatus(): Missing {',
              '  return {} as Missing;',
              '}'
            ].join('\n')
          );
        },

        async repair(
          mission,
          failedSource,
          diagnostics
        ) {
          repairCalls += 1;

          receivedFailedSource =
            failedSource;

          receivedDiagnostics =
            diagnostics;

          return proposal(
            mission,
            [
              'export function constitutionalStatus() {',
              "  return { capability: 'bounded' } as const;",
              '}'
            ].join('\n')
          );
        }
      };

    const receipt =
      await runEngineeringMission(
        repositoryRoot,
        {
          objective:
            'Create a bounded constitutional status function.',

          target_path:
            targetPath,

          operation:
            'CREATE',

          expected_exports: [
            'constitutionalStatus'
          ]
        },
        {
          forge
        }
      );

    assert.equal(
      proposeCalls,
      1
    );

    assert.equal(
      repairCalls,
      1
    );

    assert.equal(
      receipt.repair_attempted,
      true
    );

    assert.notEqual(
      receipt.initial_typecheck_exit_code,
      0
    );

    assert.match(
      receivedFailedSource,
      /Missing/
    );

    assert.match(
      receivedDiagnostics,
      /error TS/
    );

    assert.equal(
      receipt.typecheck_exit_code,
      0
    );

    assert.equal(
      receipt.vera,
      'PASS'
    );

    assert.equal(
      receipt.rook,
      'PASS'
    );

    assert.equal(
      receipt.status,
      'VERIFIED'
    );

    assert.equal(
      receipt.promotion,
      'NOT_AUTHORIZED'
    );

    assert.equal(
      receipt.workspace_destroyed,
      true
    );

    assert.deepEqual(
      receipt.changed_files,
      [
        targetPath
      ]
    );

    assert.match(
      receipt.proposal
        ?.mutations[0]
        ?.content ?? '',
      /export function constitutionalStatus/
    );

    assert.match(
      receipt.initial_proposal
        ?.mutations[0]
        ?.content ?? '',
      /Missing/
    );

    await assertCanonicalTargetAbsent();
  }
);

test(
  'a failed repair is rejected without a third neural attempt',
  async () => {
    await assertCanonicalTargetAbsent();

    let proposeCalls = 0;
    let repairCalls = 0;

    const forge:
      EngineeringIntelligence = {
        name:
          'fixture-forge',

        locality:
          'LOCAL',

        async propose(
          mission
        ) {
          proposeCalls += 1;

          return proposal(
            mission,
            [
              "import { Missing } from './missing.js';",
              '',
              'export const constitutionalStatus: Missing = {};'
            ].join('\n')
          );
        },

        async repair(
          mission
        ) {
          repairCalls += 1;

          return proposal(
            mission,
            [
              "import { StillMissing } from './still-missing.js';",
              '',
              'export const constitutionalStatus: StillMissing = {};'
            ].join('\n')
          );
        }
      };

    const receipt =
      await runEngineeringMission(
        repositoryRoot,
        {
          objective:
            'Create bounded constitutional status.',

          target_path:
            targetPath,

          operation:
            'CREATE',

          expected_exports: [
            'constitutionalStatus'
          ]
        },
        {
          forge
        }
      );

    assert.equal(
      proposeCalls,
      1
    );

    assert.equal(
      repairCalls,
      1
    );

    assert.equal(
      receipt.repair_attempted,
      true
    );

    assert.equal(
      receipt.status,
      'REJECTED'
    );

    assert.equal(
      receipt.vera,
      'FAIL'
    );

    assert.equal(
      receipt.rook,
      'PASS'
    );

    assert.equal(
      receipt.failure,
      'VERA_REPAIR_TYPECHECK_FAILED'
    );

    assert.notEqual(
      receipt.typecheck_exit_code,
      0
    );

    assert.equal(
      receipt.workspace_destroyed,
      true
    );

    assert.equal(
      receipt.promotion,
      'NOT_AUTHORIZED'
    );

    await assertCanonicalTargetAbsent();
  }
);
