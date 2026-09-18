import test from 'node:test';
import assert from 'node:assert/strict';

import {
  interpretPrimeCommand
} from '../runtime/prime.js';

test(
  'Prime routes revenue discovery',
  () => {
    const result =
      interpretPrimeCommand(
        'Find me $2000 of revenue from Perth businesses in 14 days'
      );

    assert.equal(
      result.status,
      'READY'
    );

    assert.equal(
      result.mission?.workflow,
      'revenue'
    );

    if (
      result.mission?.workflow !==
      'revenue'
    ) {
      throw new Error(
        'Expected revenue mission'
      );
    }

    assert.equal(
      result.mission.mission.mode,
      'DISCOVER'
    );

    assert.equal(
      result.mission.mission
        .cash_target_aud,
      2000
    );

    assert.equal(
      result.mission.mission
        .horizon_days,
      14
    );

    assert.equal(
      result.mission.mission
        .max_spend_aud,
      0
    );
  }
);

test(
  'Prime routes revenue validation',
  () => {
    const result =
      interpretPrimeCommand(
        'Validate our revenue opportunities'
      );

    assert.equal(
      result.status,
      'READY'
    );

    if (
      result.mission?.workflow !==
      'revenue'
    ) {
      throw new Error(
        'Expected revenue mission'
      );
    }

    assert.equal(
      result.mission.mission.mode,
      'VALIDATE'
    );
  }
);

test(
  'Prime routes Gold Rush',
  () => {
    const result =
      interpretPrimeCommand(
        'Gold rush for grants and bounties over the next 7 days'
      );

    assert.equal(
      result.status,
      'READY'
    );

    if (
      result.mission?.workflow !==
      'gold-rush'
    ) {
      throw new Error(
        'Expected Gold Rush mission'
      );
    }

    assert.equal(
      result.mission.mission
        .horizon_days,
      7
    );

    assert.equal(
      result.mission.mission
        .max_spend_aud,
      0
    );
  }
);

test(
  'Prime does not pretend to understand unsupported commands',
  () => {
    const result =
      interpretPrimeCommand(
        'Do something amazing'
      );

    assert.equal(
      result.status,
      'NEEDS_CLARIFICATION'
    );

    assert.equal(
      result.mission,
      null
    );
  }
);

test(
  'Prime never infers spending authority',
  () => {
    const result =
      interpretPrimeCommand(
        'Find me $5000 revenue and spend whatever you need'
      );

    if (
      result.mission?.workflow !==
      'revenue'
    ) {
      throw new Error(
        'Expected revenue mission'
      );
    }

    assert.equal(
      result.mission.mission
        .max_spend_aud,
      0
    );
  }
);
