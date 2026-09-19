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

test(
  'Prime treats persisted RED-SINK review events as substantive output',
  () => {
    const redSinkRun = {
      run_id: 'run-red-sink-proof',
      status: 'COMPLETED',

      events: [
        {
          event_id: 'event-red-assigned',
          type: 'AGENT_ASSIGNED',
          timestamp:
            '2026-09-18T00:00:00.000Z',
          agent_id: 'RED-SINK',
          task_id: 'task-red',
          summary:
            'Challenge demand and pricing assumptions.'
        },

        {
          event_id: 'event-red-audit',
          type: 'AUDIT_PASSED',
          timestamp:
            '2026-09-18T00:01:00.000Z',
          agent_id: 'RED-SINK',
          task_id: 'task-red',
          summary:
            'Candidate existence is established, but purchase intent and budget remain unverified.'
        },

        {
          event_id: 'event-red-completed',
          type: 'RED_SINK_COMPLETED',
          timestamp:
            '2026-09-18T00:02:00.000Z',
          agent_id: 'RED-SINK',
          task_id: 'task-red',
          summary:
            'Priority score is an experiment-ranking heuristic and must not be interpreted as expected income.'
        }
      ],

      // Intentional: RED-SINK has no conventional artifact.
      artifacts: []
    } as any;

    const answer =
      answerPrimeRunQuestion(
        'What did RED-SINK find?',
        redSinkRun
      );

    assert.equal(
      answer.status,
      'ANSWERED'
    );

    assert.match(
      answer.reply,
      /purchase intent and budget remain unverified/i
    );

    assert.match(
      answer.reply,
      /experiment-ranking heuristic/i
    );

    assert.doesNotMatch(
      answer.reply,
      /no substantive persisted output/i
    );

    assert.deepEqual(
      answer.evidence[0]
        ?.event_ids,
      [
        'event-red-audit',
        'event-red-completed'
      ]
    );

    assert.deepEqual(
      answer.evidence[0]
        ?.artifact_ids,
      []
    );
  }
);
