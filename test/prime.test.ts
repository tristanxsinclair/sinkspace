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

test(
  'Prime classifies constitutional Lake Yange direction as a Founder Mandate',
  () => {
    const result =
      interpretPrimeCommand(
        [
          'Prime, establish the first institutional and societal structure of Lake Yange.',
          'Design the constitutional architecture around State House, the Court, Rook Keep, Ledger House and Model Commons.',
          'Establish institutional jurisdiction and Founder reserved powers.',
          'This is Lake Yange Founding Mandate I: Institutions and Society.'
        ].join(' ')
      );

    assert.equal(
      result.status,
      'FOUNDER_MANDATE'
    );

    assert.equal(
      result.mission,
      null
    );

    assert.match(
      result.reply,
      /constitutional and institutional development/i
    );
  }
);

test(
  'Prime does not convert an explicit Gold Rush rejection into Gold Rush intent',
  () => {
    const result =
      interpretPrimeCommand(
        [
          'Prime, correction.',
          'Your previous interpretation was false.',
          'Founding Mandate I is not Gold Rush opportunity discovery.',
          'Treat this interaction as evidence of a State House intent-routing failure.',
          'The dominant intent is constitutional and institutional development of Lake Yange.',
          'Do not run Gold Rush.',
          'Classify this as a Founder Mandate requiring decomposition into bounded implementation missions.',
          'Return your interpretation only. Do not execute yet.'
        ].join(' ')
      );

    assert.equal(
      result.status,
      'FOUNDER_MANDATE'
    );

    assert.equal(
      result.mission,
      null
    );


  }
);

test(
  'Prime does not treat explicit Gold Rush negation as positive Gold Rush authority',
  () => {
    const result =
      interpretPrimeCommand(
        'Do not run Gold Rush'
      );

    assert.equal(
      result.mission,
      null
    );
  }
);
