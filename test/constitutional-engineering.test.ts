import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  mkdir
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
  createFounderAuthorization
} from '../runtime/founder-authorization.js';

import {
  FounderAuthorizationStore
} from '../runtime/founder-authorization-store.js';

import {
  executeConstitutionalEngineering
} from '../runtime/constitutional-engineering.js';

async function root() {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        'ly-constitutional-engineering-'
      )
    );

  await mkdir(
    join(
      value,
      '.sink',
      'lake-yange'
    ),
    {
      recursive: true
    }
  );

  return value;
}

test(
  'legacy plan without engineering spec cannot consume authorization',
  async () => {
    const repositoryRoot =
      await root();

    const plan =
      createPendingConstitutionalPlan({
        mandate_id:
          'LY-MANDATE-legacy',

        proposal_id:
          'LY-PROPOSAL-legacy',

        title:
          'Legacy plan',

        objective:
          'Historical authorization only.',

        target_system:
          'STATE_HOUSE_MANDATE_AUTHORITY',

        inspected_state: {
          population: 9,
          generation: 0,
          cognition: 'LOCAL',
          external_model_api: false
        }
      });

    const planStore =
      new ConstitutionalPlanStore(
        join(
          repositoryRoot,
          '.sink/lake-yange/pending-plans'
        )
      );

    await planStore.create(
      plan
    );

    const authorization =
      createFounderAuthorization({
        mandate_id:
          plan.mandate_id,

        plan_id:
          plan.plan_id,

        proposal_id:
          plan.proposal_id,

        proposal_digest:
          plan.proposal_digest,

        target_system:
          plan.target_system,

        objective:
          plan.objective
      });

    const authorizationStore =
      new FounderAuthorizationStore(
        join(
          repositoryRoot,
          '.sink/lake-yange/authorizations'
        )
      );

    await authorizationStore.create(
      authorization
    );

    await assert.rejects(
      () =>
        executeConstitutionalEngineering(
          repositoryRoot,
          authorization.authorization_id
        ),
      /CONSTITUTIONAL_ENGINEERING_SPEC_REQUIRED/
    );
  }
);
