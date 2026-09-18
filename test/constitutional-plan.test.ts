import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  readFile,
  writeFile
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPendingConstitutionalPlan
} from '../runtime/constitutional-plan.js';

import {
  ConstitutionalPlanStore
} from '../runtime/constitutional-plan-store.js';

function input() {
  return {
    mandate_id:
      'LY-MANDATE-test',

    proposal_id:
      'LY-PROPOSAL-test',

    title:
      'Establish constitutional lifecycle',

    objective:
      'Create bounded constitutional engineering authority.',

    target_system:
      'STATE_HOUSE_MANDATE_AUTHORITY',

    inspected_state: {
      population: 9,
      generation: 0,
      cognition: 'LOCAL' as const,
      external_model_api: false as const
    }
  };
}

test(
  'pending plan freezes proposal and inspected state without authority',
  () => {
    const plan =
      createPendingConstitutionalPlan(
        input(),
        '2026-09-19T00:00:00.000Z'
      );

    assert.equal(
      plan.status,
      'PENDING'
    );

    assert.equal(
      plan.execution_authority,
      false
    );

    assert.equal(
      plan.inspected_state.population,
      9
    );

    assert.match(
      plan.proposal_digest,
      /^[a-f0-9]{64}$/
    );
  }
);

test(
  'pending plan store refuses overwrite',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-plan-store-'
        )
      );

    const store =
      new ConstitutionalPlanStore(root);

    const plan =
      createPendingConstitutionalPlan(
        input()
      );

    await store.create(plan);

    await assert.rejects(
      () => store.create(plan),
      error =>
        error instanceof Error &&
        (
          'code' in error &&
          error.code === 'EEXIST'
        )
    );
  }
);

test(
  'pending plan store detects proposal tampering',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-plan-tamper-'
        )
      );

    const store =
      new ConstitutionalPlanStore(root);

    const plan =
      createPendingConstitutionalPlan(
        input()
      );

    await store.create(plan);

    const path =
      join(
        root,
        `${plan.plan_id}.json`
      );

    const raw =
      JSON.parse(
        await readFile(
          path,
          'utf8'
        )
      );

    raw.objective =
      'TAMPERED OBJECTIVE';

    await writeFile(
      path,
      `${JSON.stringify(raw, null, 2)}\n`,
      'utf8'
    );

    await assert.rejects(
      () =>
        store.load(
          plan.plan_id
        ),
      /CONSTITUTIONAL_PLAN_DIGEST_INVALID/
    );
  }
);
