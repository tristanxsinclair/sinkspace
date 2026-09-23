import test from 'node:test';
import assert from 'node:assert/strict';

import {
  interpretPrimeConstitutionalPlan
} from '../runtime/prime-constitutional-plan.js';

test(
  'Prime parses an explicit bounded constitutional engineering plan',
  () => {
    const action =
      interpretPrimeConstitutionalPlan(
        [
          'Prime, plan engineering for mandate LY-MANDATE-test:',
          'Create the first governed constitutional status module',
          ':: runtime/lake-yange-constitutional-status.ts',
          ':: CREATE',
          ':: export constitutionalStatus'
        ].join(' ')
      );

    assert.deepEqual(
      action,
      {
        status:
          'PLAN_CONSTITUTIONAL_ENGINEERING',

        mandate_id:
          'LY-MANDATE-test',

        objective:
          'Create the first governed constitutional status module',

        target_path:
          'runtime/lake-yange-constitutional-status.ts',

        operation:
          'CREATE',

        expected_export:
          'constitutionalStatus'
      }
    );
  }
);

test(
  'Prime does not infer an executable plan from vague language',
  () => {
    assert.deepEqual(
      interpretPrimeConstitutionalPlan(
        'Prime, improve Lake Yange.'
      ),
      {
        status:
          'NOT_CONSTITUTIONAL_PLAN'
      }
    );
  }
);
