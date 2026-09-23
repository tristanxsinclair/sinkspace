import test from 'node:test';
import assert from 'node:assert/strict';

import { Blackboard } from '../runtime/blackboard.js';
import { analyseBlackboard } from '../runtime/analyst.js';

test('SINK-05 analyst separates fact from hypothesis and uncertainty', () => {
  const board = new Blackboard();

  board.add({
    run_id: 'r1',
    agent_id: 'SINK-01',
    kind: 'FACT',
    content: 'dist/index.html exists.',
    evidence_ids: ['e1']
  });

  board.add({
    run_id: 'r1',
    agent_id: 'SINK-05',
    kind: 'HYPOTHESIS',
    content: 'The site may support lead generation.'
  });

  board.add({
    run_id: 'r1',
    agent_id: 'SINK-05',
    kind: 'UNCERTAINTY',
    content: 'Actual conversion rate is unknown.'
  });

  const result = analyseBlackboard(board, 'r1');

  assert.deepEqual(
    result.facts,
    ['dist/index.html exists.']
  );

  assert.deepEqual(
    result.hypotheses,
    ['The site may support lead generation.']
  );

  assert.deepEqual(
    result.uncertainties,
    ['Actual conversion rate is unknown.']
  );
});
