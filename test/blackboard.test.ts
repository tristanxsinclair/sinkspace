import test from 'node:test';
import assert from 'node:assert/strict';

import { Blackboard } from '../runtime/blackboard.js';

test('blackboard stores bounded run-scoped entries', () => {
  const board = new Blackboard();

  board.add({
    run_id: 'run-a',
    agent_id: 'SINK-01',
    kind: 'FACT',
    content: 'README.md exists.',
    evidence_ids: ['evidence-1']
  });

  board.add({
    run_id: 'run-b',
    agent_id: 'SINK-05',
    kind: 'HYPOTHESIS',
    content: 'A second capability may exist.'
  });

  assert.equal(board.all('run-a').length, 1);
  assert.equal(board.all('run-b').length, 1);

  assert.equal(
    board.all('run-a')[0]?.content,
    'README.md exists.'
  );
});

test('blackboard filters by kind', () => {
  const board = new Blackboard();

  board.add({
    run_id: 'run-a',
    agent_id: 'SINK-01',
    kind: 'FACT',
    content: 'A verified fact.',
    evidence_ids: ['e1']
  });

  board.add({
    run_id: 'run-a',
    agent_id: 'SINK-05',
    kind: 'UNCERTAINTY',
    content: 'Commercial impact is unknown.'
  });

  assert.equal(
    board.byKind('run-a', 'FACT').length,
    1
  );

  assert.equal(
    board.byKind('run-a', 'UNCERTAINTY').length,
    1
  );
});

test('blackboard returns copies rather than mutable internal state', () => {
  const board = new Blackboard();

  board.add({
    run_id: 'run-a',
    agent_id: 'SINK-01',
    kind: 'FACT',
    content: 'Original',
    evidence_ids: ['evidence-copy-test']
  });

  const entries = board.all('run-a');
  entries[0]!.content = 'Tampered';

  assert.equal(
    board.all('run-a')[0]?.content,
    'Original'
  );
});

test('blackboard rejects unevidenced facts', () => {
  const board = new Blackboard();

  assert.throws(
    () => board.add({
      run_id: 'run-a',
      agent_id: 'SINK-05',
      kind: 'FACT',
      content: 'This must not become trusted.'
    }),
    /BLACKBOARD_FACT_REQUIRES_EVIDENCE/
  );
});
