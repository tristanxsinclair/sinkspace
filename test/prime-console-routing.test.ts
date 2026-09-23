import test from 'node:test';
import assert from 'node:assert/strict';

import {
  looksLikePrimeRunQuestion
} from '../runtime/prime-routing.js';

test(
  'explicit RED-SINK readback is historical run Q&A',
  () => {
    assert.equal(
      looksLikePrimeRunQuestion(
        'What did RED-SINK find?'
      ),
      true
    );
  }
);

test(
  'RED-SINK inside a constitutional command is not run Q&A',
  () => {
    assert.equal(
      looksLikePrimeRunQuestion(
        [
          'Prime, decompose the accepted Human Governance Hypothesis Founder Mandate.',
          'Vera must independently verify factual claims.',
          'RED-SINK must challenge Lake Yange institutions.',
          'Do not execute implementation yet.'
        ].join(' ')
      ),
      false
    );
  }
);

test(
  'persisted run can supply evidence to a new revenue mission',
  () => {
    assert.equal(
      looksLikePrimeRunQuestion(
        [
          'Prime, execute a NEW revenue VALIDATE mission.',
          'Use persisted run 28be92f5-f7f6-4a5e-b37e-394a7f564ced as source evidence.',
          'Create a new run.',
          'RED-SINK must review the result.'
        ].join(' ')
      ),
      false
    );
  }
);

test(
  'agent review instruction is not historical readback',
  () => {
    assert.equal(
      looksLikePrimeRunQuestion(
        'RED-SINK must review this new experiment.'
      ),
      false
    );
  }
);

test(
  'persisted run summary request remains readback',
  () => {
    assert.equal(
      looksLikePrimeRunQuestion(
        'Summarize persisted run 28be92f5-f7f6-4a5e-b37e-394a7f564ced.'
      ),
      true
    );
  }
);

test(
  'agent name alone is not enough to trigger readback',
  () => {
    assert.equal(
      looksLikePrimeRunQuestion(
        'RED-SINK'
      ),
      false
    );
  }
);
