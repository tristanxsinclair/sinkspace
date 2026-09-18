import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPendingConstitutionalPlan
} from '../runtime/constitutional-plan.js';

import {
  createFounderAuthorization
} from '../runtime/founder-authorization.js';

import {
  interpretPrimeAuthorization
} from '../runtime/prime-authorization.js';

test(
  'pending plan cannot execute',
  () => {
    const plan =
      createPendingConstitutionalPlan({
        mandate_id: 'LY-MANDATE-test',
        proposal_id: 'LY-PROPOSAL-test',
        title: 'Test',
        objective:
          'Test constitutional planning.',
        target_system:
          'TEST_SYSTEM',

        inspected_state: {
          population: 9,
          generation: 0,
          cognition: 'LOCAL',
          external_model_api: false
        }
      });

    assert.equal(
      plan.status,
      'PENDING'
    );

    assert.equal(
      plan.execution_authority,
      false
    );

    assert.match(
      plan.proposal_digest,
      /^[a-f0-9]{64}$/
    );
  }
);

test(
  'Founder authorization grants only one bounded engineering execution',
  () => {
    const authorization =
      createFounderAuthorization({
        mandate_id:
          'LY-MANDATE-test',

        plan_id:
          'LY-PLAN-test',

        proposal_id:
          'LY-PROPOSAL-test',

        proposal_digest:
          'a'.repeat(64),

        target_system:
          'TEST_SYSTEM',

        objective:
          'Test bounded engineering.'
      });

    assert.equal(
      authorization.execution_authority,
      true
    );

    assert.deepEqual(
      authorization.permitted_operations,
      ['ENGINEERING_MISSION']
    );

    assert.equal(
      authorization.execution_limit,
      1
    );

    assert.equal(
      authorization.executions_consumed,
      0
    );

    assert.equal(
      authorization.consumed,
      false
    );

    assert.ok(
      authorization.prohibited_operations.includes(
        'SPEND'
      )
    );

    assert.ok(
      authorization.prohibited_operations.includes(
        'FINANCIAL_TRANSACTION'
      )
    );

    assert.ok(
      authorization.prohibited_operations.includes(
        'PRODUCTION_DEPLOY'
      )
    );

    assert.ok(
      authorization.prohibited_operations.includes(
        'CREDENTIAL_ACCESS'
      )
    );

    assert.ok(
      authorization.prohibited_operations.includes(
        'AUTHORITY_DELEGATION'
      )
    );
  }
);

test(
  'Prime requires explicit authorization language',
  () => {
    const explicit =
      interpretPrimeAuthorization(
        'Prime, authorize plan LY-PLAN-abc-123.'
      );

    assert.deepEqual(
      explicit,
      {
        status: 'AUTHORIZE_PLAN',
        plan_id: 'LY-PLAN-abc-123'
      }
    );

    assert.deepEqual(
      interpretPrimeAuthorization(
        'Prime, inspect plan LY-PLAN-abc-123.'
      ),
      {
        status: 'NOT_AUTHORIZATION'
      }
    );

    assert.deepEqual(
      interpretPrimeAuthorization(
        'Prime, I like this plan.'
      ),
      {
        status: 'NOT_AUTHORIZATION'
      }
    );
  }
);
