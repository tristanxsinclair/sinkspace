import test from 'node:test';
import assert from 'node:assert/strict';
import { runCivilisationLoop } from '../runtime/civilisation-loop.js';

test('civilisation loop compounds bounded educational cycles only', async () => {
  let calls = 0;
  const result = await runCivilisationLoop({
    cycles: 3,
    runCycle: async () => {
      calls += 1;
      return {
        attempted: 2,
        graded: 2,
        passed: 1,
        failed: 1,
        assignments_created: 2,
        authority: 'EDUCATIONAL_ONLY',
        external_llm_calls: 0,
        economic_fitness_created: 0
      };
    }
  });
  assert.equal(calls, 3);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.total_attempted, 6);
  assert.equal(result.total_graded, 6);
  assert.equal(result.total_passed, 3);
  assert.equal(result.authority, 'EDUCATIONAL_ONLY');
  assert.equal(result.external_actions, 0);
});

test('civilisation loop rejects an unbounded cycle request', async () => {
  await assert.rejects(
    () => runCivilisationLoop({ cycles: 97 }),
    /CIVILISATION_LOOP_CYCLES_INVALID/
  );
});
