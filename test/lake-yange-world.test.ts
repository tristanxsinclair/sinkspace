import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import {
  tmpdir
} from 'node:os';

import {
  LakeYangeStore
} from '../runtime/lake-yange-store.js';

import {
  createFoundingLakeYange
} from '../runtime/lake-yange-founders.js';

import {
  projectLakeYangeWorld
} from '../runtime/lake-yange-world.js';

test(
  'world projection derives population from persisted Lake Yange state',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-world-'
        )
      );

    try {
      const store =
        new LakeYangeStore(
          join(
            root,
            '.sink/lake-yange/state.json'
          )
        );

      await store.save(
        createFoundingLakeYange()
      );

      const projection =
        await projectLakeYangeWorld(root);

      assert.equal(
        projection.settlement.population,
        9
      );

      assert.equal(
        projection.citizens.length,
        9
      );

      assert.equal(
        projection.cognition.locality,
        'LOCAL'
      );

      assert.equal(
        projection.truth.simulation_fabricated_activity,
        false
      );

      assert.equal(
        projection.engineering.workshop_active,
        false
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'world projection exposes persisted engineering evidence',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-world-receipt-'
        )
      );

    try {
      const store =
        new LakeYangeStore(
          join(
            root,
            '.sink/lake-yange/state.json'
          )
        );

      await store.save(
        createFoundingLakeYange()
      );

      const receiptDirectory =
        join(
          root,
          '.sink/lake-yange/engineering-receipts'
        );

      await mkdir(
        receiptDirectory,
        {
          recursive: true
        }
      );

      await writeFile(
        join(
          receiptDirectory,
          'proof.json'
        ),
        JSON.stringify({
          receipt_id: 'receipt-proof',
          created_at:
            '2026-09-19T00:00:00.000Z',
          status: 'REJECTED',
          objective: 'Proof mission',
          target_path: 'console/proof.ts',
          base_commit: 'abc123',
          changed_files: [
            'console/proof.ts'
          ],
          vera: 'FAIL',
          rook: 'PASS',
          promotion: 'NOT_AUTHORIZED',
          workspace_destroyed: true,
          cognition: 'LOCAL',
          model:
            'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M',
          failure:
            'VERA_ACCEPTANCE_FAILED'
        }),
        'utf8'
      );

      const projection =
        await projectLakeYangeWorld(root);

      assert.equal(
        projection.engineering.latest?.receipt_id,
        'receipt-proof'
      );

      assert.equal(
        projection.engineering.latest?.status,
        'REJECTED'
      );

      assert.equal(
        projection.engineering.latest?.vera,
        'FAIL'
      );

      assert.equal(
        projection.engineering.rejected_total,
        1
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);

test(
  'world projection exposes persisted agent activity',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-world-agents-'
        )
      );

    try {
      const store =
        new LakeYangeStore(
          join(
            root,
            '.sink/lake-yange/state.json'
          )
        );

      await store.save(
        createFoundingLakeYange()
      );

      const agentWorldDirectory =
        join(
          root,
          '.sink/lake-yange/agents'
        );

      await mkdir(
        agentWorldDirectory,
        {
          recursive: true
        }
      );

      await writeFile(
        join(
          agentWorldDirectory,
          'world.json'
        ),
        JSON.stringify({
          schema_version: 1,
          observations: [],
          learning_outcomes: [
            {
              learning_id:
                'learn-projection-test',
              citizen_id:
                'citizen-test-001',
              created_at:
                '2026-09-21T01:00:00.000Z',
              subject:
                'projection test',
              outcome:
                'persisted learning outcome'
            }
          ],
          rest_records: [],
          project_proposals: [],
          project_contributions: []
        }),
        'utf8'
      );

      const projection =
        await projectLakeYangeWorld(root);

      assert.deepEqual(
        projection.agents,
        {
          observations: 0,
          learning_outcomes: 1,
          rest_records: 0,
          project_proposals: 0,
          project_contributions: 0,
          total: 1
        }
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);
