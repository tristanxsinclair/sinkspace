import test from 'node:test';
import assert from 'node:assert/strict';

import {
  interpretPrimeEngineering
} from '../runtime/prime-engineering.js';

test(
  'ordinary Prime conversation is not engineering',
  () => {
    const result =
      interpretPrimeEngineering(
        'What is happening in Lake Yange?'
      );

    assert.equal(
      result.status,
      'NOT_ENGINEERING'
    );
  }
);

test(
  'build command requires explicit target',
  () => {
    const result =
      interpretPrimeEngineering(
        'build: improve the town'
      );

    assert.equal(
      result.status,
      'NEEDS_TARGET'
    );
  }
);

test(
  'Prime compiles explicit build command',
  () => {
    const result =
      interpretPrimeEngineering(
        'build: add a citizen greeting formatter :: console/citizen-greeting.ts'
      );

    assert.equal(
      result.status,
      'ENGINEERING_READY'
    );

    assert.equal(
      result.command?.objective,
      'add a citizen greeting formatter'
    );

    assert.equal(
      result.command?.target_path,
      'console/citizen-greeting.ts'
    );
  }
);

test(
  'extracts an explicit expected function export as an engineering acceptance contract',
  () => {
    const result =
      interpretPrimeEngineering(
        'build: create a formatter. Export a function named formatLakeYangeStatus that returns a readable status. :: console/lake-yange-status.ts'
      );

    assert.equal(
      result.status,
      'ENGINEERING_READY'
    );

    assert.deepEqual(
      result.command?.expected_exports,
      [
        'formatLakeYangeStatus'
      ]
    );
  }
);
