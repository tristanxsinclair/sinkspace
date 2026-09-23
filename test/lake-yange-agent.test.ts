import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LakeYangeAgentStore,
  AgentDecisionSchema
} from '../runtime/lake-yange-agent.js';

test('agent decision schema accepts bounded simulated actions', () => {
  const decision = AgentDecisionSchema.parse({
    action: 'STUDY',
    reason: 'The citizen identified an unfinished capability.',
    objective: 'Improve the relevant learning capability.',
    expected_outcome: 'A stronger independently evaluated result.',
    capability_used: 'REASONING',
    confidence: 0.8
  });

  assert.equal(
    decision.action,
    'STUDY'
  );
});

test('agent state persists atomically and reloads', async () => {
  const root =
    await mkdtemp(
      join(tmpdir(), 'lake-yange-agent-')
    );

  const path =
    join(root, 'agents.json');

  const store =
    new LakeYangeAgentStore(path);

  const state = {
    schema_version: 1 as const,
    settlement_id: 'LAKE-YANGE' as const,
    updated_at: new Date().toISOString(),
    agents: []
  };

  await store.save(state);

  const loaded =
    await store.load();

  assert.deepEqual(
    loaded,
    state
  );

  const raw =
    await readFile(
      path,
      'utf8'
    );

  assert.ok(
    raw.includes('LAKE-YANGE')
  );
});
