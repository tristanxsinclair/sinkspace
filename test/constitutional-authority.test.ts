import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  readFile,
  writeFile
} from 'node:fs/promises';

import {
  tmpdir
} from 'node:os';

import {
  join
} from 'node:path';

import {
  createPendingConstitutionalPlan
} from '../runtime/constitutional-plan.js';

import {
  ConstitutionalPlanStore
} from '../runtime/constitutional-plan-store.js';

import {
  authorizeConstitutionalPlan
} from '../runtime/constitutional-authority.js';

import {
  FounderAuthorizationStore
} from '../runtime/founder-authorization-store.js';

function planInput() {
  return {
    mandate_id:
      'LY-MANDATE-test',

    proposal_id:
      'LY-PROPOSAL-test',

    title:
      'Constitutional lifecycle',

    objective:
      'Create bounded engineering authority.',

    target_system:
      'STATE_HOUSE_MANDATE_AUTHORITY',

    engineering_spec: {
      schema_version: 1 as const,
      target_path: 'runtime/authority-proof.ts',
      operation: 'CREATE' as const,
      expected_exports: ['authorityProof'],
      verification_commands: ['TYPECHECK'] as ['TYPECHECK'],
      max_files_changed: 1 as const,
      network: false as const,
      credentials: false as const,
      external_messages: false as const,
      deployment: false as const,
      dependency_installation: false as const,
      destructive_operations: false as const
    },

    inspected_state: {
      population: 9,
      generation: 0,
      cognition: 'LOCAL' as const,
      external_model_api: false as const
    }
  };
}

test(
  'Founder authorization binds to exact pending plan without executing',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-authority-'
        )
      );

    const plan =
      createPendingConstitutionalPlan(
        planInput()
      );

    const plans =
      new ConstitutionalPlanStore(
        join(
          root,
          '.sink/lake-yange/pending-plans'
        )
      );

    await plans.create(plan);

    const result =
      await authorizeConstitutionalPlan(
        root,
        plan.plan_id
      );

    assert.equal(
      result.authorization.plan_id,
      plan.plan_id
    );

    assert.equal(
      result.authorization.proposal_digest,
      plan.proposal_digest
    );

    assert.equal(
      result.authorization.execution_authority,
      true
    );

    assert.equal(
      result.authorization.execution_limit,
      1
    );

    assert.equal(
      result.engineering_executed,
      false
    );

    assert.equal(
      result.authorization_consumed,
      false
    );
  }
);

test(
  'same plan cannot receive a second authorization artifact',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-authority-duplicate-'
        )
      );

    const plan =
      createPendingConstitutionalPlan(
        planInput()
      );

    const plans =
      new ConstitutionalPlanStore(
        join(
          root,
          '.sink/lake-yange/pending-plans'
        )
      );

    await plans.create(plan);

    await authorizeConstitutionalPlan(
      root,
      plan.plan_id
    );

    await assert.rejects(
      () =>
        authorizeConstitutionalPlan(
          root,
          plan.plan_id
        ),
      error =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST'
    );
  }
);

test(
  'tampered pending plan cannot be authorized',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-authority-tamper-'
        )
      );

    const plan =
      createPendingConstitutionalPlan(
        planInput()
      );

    const directory =
      join(
        root,
        '.sink/lake-yange/pending-plans'
      );

    const plans =
      new ConstitutionalPlanStore(
        directory
      );

    await plans.create(plan);

    const path =
      join(
        directory,
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
      'Tampered authority objective';

    await writeFile(
      path,
      `${JSON.stringify(
        raw,
        null,
        2
      )}\n`,
      'utf8'
    );

    await assert.rejects(
      () =>
        authorizeConstitutionalPlan(
          root,
          plan.plan_id
        ),
      /CONSTITUTIONAL_PLAN_DIGEST_INVALID/
    );
  }
);

test(
  'tampered authorization is rejected when reopened',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-auth-reopen-'
        )
      );

    const plan =
      createPendingConstitutionalPlan(
        planInput()
      );

    const plans =
      new ConstitutionalPlanStore(
        join(
          root,
          '.sink/lake-yange/pending-plans'
        )
      );

    await plans.create(plan);

    const result =
      await authorizeConstitutionalPlan(
        root,
        plan.plan_id
      );

    const directory =
      join(
        root,
        '.sink/lake-yange/authorizations'
      );

    const path =
      join(
        directory,
        `${result.authorization.authorization_id}.json`
      );

    const raw =
      JSON.parse(
        await readFile(
          path,
          'utf8'
        )
      );

    raw.objective =
      'Tampered after Founder authorization';

    await writeFile(
      path,
      `${JSON.stringify(
        raw,
        null,
        2
      )}\n`,
      'utf8'
    );

    const store =
      new FounderAuthorizationStore(
        directory
      );

    await assert.rejects(
      () =>
        store.load(
          result.authorization.authorization_id
        ),
      /FOUNDER_AUTHORIZATION_DIGEST_INVALID/
    );
  }
);

test(
  'legacy plan cannot mint new Founder execution authority',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'ly-auth-legacy-'));
    const plan = createPendingConstitutionalPlan({
      mandate_id: 'LY-MANDATE-legacy',
      proposal_id: 'LY-PROPOSAL-legacy',
      title: 'Legacy plan',
      objective: 'Historical plan without a frozen engineering spec.',
      target_system: 'STATE_HOUSE_MANDATE_AUTHORITY',
      inspected_state: {
        population: 9,
        generation: 0,
        cognition: 'LOCAL',
        external_model_api: false
      }
    });
    const plans = new ConstitutionalPlanStore(
      join(root, '.sink/lake-yange/pending-plans')
    );
    await plans.create(plan);
    await assert.rejects(
      () => authorizeConstitutionalPlan(root, plan.plan_id),
      /CONSTITUTIONAL_ENGINEERING_SPEC_REQUIRED_FOR_AUTHORIZATION/
    );
  }
);
