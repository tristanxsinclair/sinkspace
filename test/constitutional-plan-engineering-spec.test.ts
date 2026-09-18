import test from 'node:test';
import assert from 'node:assert/strict';

import {
  constitutionalProposalDigest,
  createPendingConstitutionalPlan
} from '../runtime/constitutional-plan.js';

const base = {
  mandate_id:
    'LY-MANDATE-spec-test',

  proposal_id:
    'LY-PROPOSAL-spec-test',

  title:
    'Create bounded constitutional execution bridge',

  objective:
    'Create one bounded additive source file.',

  target_system:
    'STATE_HOUSE_MANDATE_AUTHORITY',

  inspected_state: {
    population: 9,
    generation: 0,
    cognition: 'LOCAL' as const,
    external_model_api: false as const
  }
};

const spec = {
  schema_version: 1 as const,

  target_path:
    'runtime/constitutional-bridge-example.ts',

  operation:
    'CREATE' as const,

  expected_exports: [
    'constitutionalBridgeExample'
  ],

  verification_commands:
    ['TYPECHECK'] as ['TYPECHECK'],

  max_files_changed:
    1 as const,

  network:
    false as const,

  credentials:
    false as const,

  external_messages:
    false as const,

  deployment:
    false as const,

  dependency_installation:
    false as const,

  destructive_operations:
    false as const
};

test(
  'new constitutional plan can bind exact engineering specification',
  () => {
    const plan =
      createPendingConstitutionalPlan({
        ...base,
        engineering_spec:
          spec
      });

    assert.deepEqual(
      plan.engineering_spec,
      spec
    );

    assert.equal(
      plan.execution_authority,
      false
    );
  }
);

test(
  'engineering specification changes constitutional proposal digest',
  () => {
    const first =
      constitutionalProposalDigest({
        ...base,
        engineering_spec:
          spec
      });

    const second =
      constitutionalProposalDigest({
        ...base,
        engineering_spec: {
          ...spec,
          target_path:
            'runtime/different.ts'
        }
      });

    assert.notEqual(
      first,
      second
    );
  }
);

test(
  'legacy constitutional plan digest remains valid without engineering specification',
  () => {
    const digest =
      constitutionalProposalDigest(
        base
      );

    assert.match(
      digest,
      /^[a-f0-9]{64}$/
    );
  }
);
