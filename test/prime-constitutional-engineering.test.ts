import test from 'node:test';
import assert from 'node:assert/strict';

import {
  interpretPrimeConstitutionalEngineering
} from '../runtime/prime-constitutional-engineering.js';

test(
  'Prime requires explicit execution of exact authorization',
  () => {
    const id =
      'LY-AUTH-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    assert.deepEqual(
      interpretPrimeConstitutionalEngineering(
        `Prime, execute authorization ${id}`
      ),
      {
        status:
          'EXECUTE_AUTHORIZATION',

        authorization_id:
          id
      }
    );
  }
);

test(
  'ordinary engineering language cannot consume constitutional authority',
  () => {
    assert.deepEqual(
      interpretPrimeConstitutionalEngineering(
        'Prime, build the constitutional system'
      ),
      {
        status:
          'NOT_CONSTITUTIONAL_ENGINEERING'
      }
    );
  }
);
