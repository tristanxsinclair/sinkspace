import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  EMPTY_LAKE_YANGE_AGENT_WORLD,
  LakeYangeAgentWorldStore,
} from '../runtime/lake-yange-agent-world.js';

test('Lake Yange agent world persists and reloads', async () => {
  const directory =
    await mkdtemp(
      join(tmpdir(), 'lake-yange-agent-world-'),
    );

  const filePath =
    join(directory, 'world.json');

  const store =
    new LakeYangeAgentWorldStore(filePath);

  const world = {
    ...EMPTY_LAKE_YANGE_AGENT_WORLD,
    observations: [
      {
        observation_id: 'obs-1',
        citizen_id: 'CITIZEN-1',
        created_at: '2026-01-01T00:00:00.000Z',
        content: 'Lake Yange is active.',
      },
    ],
  };

  await store.save(world);

  const loaded =
    await store.load();

  assert.deepEqual(
    loaded,
    world,
  );

  const raw =
    await readFile(
      filePath,
      'utf8',
    );

  assert.match(
    raw,
    /Lake Yange is active/,
  );
});
