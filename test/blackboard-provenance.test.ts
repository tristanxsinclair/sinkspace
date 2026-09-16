import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Blackboard
} from '../runtime/blackboard.js';

test(
  'Blackboard uses injected provenance authority',
  () => {
    let sequence = 0;

    const board = new Blackboard({
      id: () => `entry-${++sequence}`,
      now: () => '2026-09-16T13:00:00.000Z'
    });

    const entry = board.add({
      run_id: 'run-1',
      agent_id: 'SINK-01',
      task_id: 'task-1',
      kind: 'FACT',
      content: 'Verified fact.',
      evidence_ids: ['evidence-1']
    });

    assert.equal(entry.entry_id, 'entry-1');
    assert.equal(
      entry.created_at,
      '2026-09-16T13:00:00.000Z'
    );
  }
);

test(
  'Blackboard evidence arrays cannot mutate internal state',
  () => {
    const board = new Blackboard();

    board.add({
      run_id: 'run-copy',
      agent_id: 'SINK-01',
      task_id: 'task-copy',
      kind: 'FACT',
      content: 'Immutable fact.',
      evidence_ids: ['evidence-original']
    });

    const copy = board.all('run-copy');

    copy[0]!.evidence_ids.push(
      'forged-evidence'
    );

    assert.deepEqual(
      board.all('run-copy')[0]!.evidence_ids,
      ['evidence-original']
    );
  }
);
