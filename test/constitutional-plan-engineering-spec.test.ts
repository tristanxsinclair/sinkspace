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

test(
  'plan store persists and reopens engineering spec under the same digest',
  async () => {
    const {
      mkdtemp
    } = await import(
      'node:fs/promises'
    );

    const {
      tmpdir
    } = await import(
      'node:os'
    );

    const {
      join
    } = await import(
      'node:path'
    );

    const {
      ConstitutionalPlanStore
    } = await import(
      '../runtime/constitutional-plan-store.js'
    );

    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-plan-spec-store-'
        )
      );

    const plan =
      createPendingConstitutionalPlan({
        mandate_id:
          'LY-MANDATE-spec-store',

        proposal_id:
          'LY-PROPOSAL-spec-store',

        title:
          'Executable plan',

        objective:
          'Create a bounded deterministic module.',

        target_system:
          'BUILDERS_GUILD_WORKSHOP',

        engineering_spec: {
          schema_version:
            1,

          target_path:
            'runtime/example.ts',

          operation:
            'CREATE',

          expected_exports: [
            'example'
          ],

          verification_commands: [
            'TYPECHECK'
          ],

          max_files_changed:
            1,

          network:
            false,

          credentials:
            false,

          external_messages:
            false,

          deployment:
            false,

          dependency_installation:
            false,

          destructive_operations:
            false
        },

        inspected_state: {
          population:
            9,

          generation:
            0,

          cognition:
            'LOCAL',

          external_model_api:
            false
        }
      });

    const store =
      new ConstitutionalPlanStore(
        root
      );

    await store.create(
      plan
    );

    const reopened =
      await store.load(
        plan.plan_id
      );

    assert.equal(
      reopened.proposal_digest,
      plan.proposal_digest
    );

    assert.deepEqual(
      reopened.engineering_spec,
      plan.engineering_spec
    );
  }
);
