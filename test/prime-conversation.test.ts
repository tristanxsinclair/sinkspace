import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answerPrimeRunQuestion
} from '../runtime/prime-conversation.js';

const run = {
  run_id: 'run-proof-1',
  status: 'COMPLETED',

  events: [
    {
      event_id: 'event-04',
      type: 'ARTIFACT_CREATED',
      timestamp:
        '2026-09-18T00:00:00.000Z',
      agent_id: 'SINK-04',
      task_id: 'task-04',
      summary:
        'Discovered eight revenue candidates.'
    },

    {
      event_id: 'event-03',
      type:
        'EVIDENCE_ATTACHED',
      timestamp:
        '2026-09-18T00:01:00.000Z',
      agent_id: 'SINK-03',
      task_id: 'task-03',
      summary:
        'Independently checked the shortlisted candidates.'
    }
  ],

  artifacts: [
    {
      artifact_id: 'artifact-04',
      run_id: 'run-proof-1',
      task_id: 'task-04',
      agent_id: 'SINK-04',
      type: 'REPORT',
      media_type: 'text/markdown',
      content:
        '# Revenue discovery\nEight candidates discovered.',
      created_at:
        '2026-09-18T00:00:00.000Z',
      sha256: 'abc'
    }
  ]
} as any;

test(
  'Prime answers from a requested agent',
  () => {
    const answer =
      answerPrimeRunQuestion(
        'What did SINK-04 find?',
        run
      );

    assert.equal(
      answer.status,
      'ANSWERED'
    );

    assert.match(
      answer.reply,
      /eight candidates discovered/i
    );

    assert.deepEqual(
      answer.evidence[0]
        ?.event_ids,
      ['event-04']
    );

    assert.deepEqual(
      answer.evidence[0]
        ?.artifact_ids,
      ['artifact-04']
    );
  }
);

test(
  'Prime can summarize agent work',
  () => {
    const answer =
      answerPrimeRunQuestion(
        'What did the agents find?',
        run
      );

    assert.equal(
      answer.status,
      'ANSWERED'
    );

    assert.match(
      answer.reply,
      /SINK-04/
    );

    assert.match(
      answer.reply,
      /SINK-03/
    );
  }
);

test(
  'Prime does not invent unsupported answers',
  () => {
    const answer =
      answerPrimeRunQuestion(
        'What colour should the office be?',
        run
      );

    assert.equal(
      answer.status,
      'NEEDS_CLARIFICATION'
    );

    assert.equal(
      answer.evidence.length,
      0
    );
  }
);
