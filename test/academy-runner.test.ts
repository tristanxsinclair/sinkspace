import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  readFile,
  rm
} from 'node:fs/promises';

import {
  tmpdir
} from 'node:os';

import {
  join
} from 'node:path';

import {
  runAcademyCycle
} from '../runtime/academy-clock.js';

import {
  academyStatePath,
  emptyAcademyState,
  loadAcademyState,
  saveAcademyState
} from '../runtime/academy-store.js';

test(
  'Academy state persists generated assignments',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-academy-'
        )
      );

    try {
      const cycle =
        runAcademyCycle(
          emptyAcademyState(),
          [
            {
              system_id:
                'SINK-PRIME'
            },
            {
              system_id:
                'SINK-04'
            }
          ],
          '2026-09-19T05:00:00.000Z'
        );

      await saveAcademyState(
        root,
        cycle.state
      );

      const loaded =
        await loadAcademyState(
          root
        );

      assert.equal(
        loaded.students.length,
        2
      );

      assert.equal(
        loaded.assignments.length,
        2
      );

      assert.ok(
        loaded.assignments.every(
          assignment =>
            assignment.authority ===
            'EDUCATIONAL_ONLY'
        )
      );

      const raw =
        await readFile(
          academyStatePath(root),
          'utf8'
        );

      assert.match(
        raw,
        /LY-CORE-001/
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
  'persisted Academy state prevents duplicate active assignments',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-academy-'
        )
      );

    try {
      const first =
        runAcademyCycle(
          emptyAcademyState(),
          [
            {
              system_id:
                'SINK-05'
            }
          ],
          '2026-09-19T06:00:00.000Z'
        );

      await saveAcademyState(
        root,
        first.state
      );

      const persisted =
        await loadAcademyState(
          root
        );

      const second =
        runAcademyCycle(
          persisted,
          [
            {
              system_id:
                'SINK-05'
            }
          ],
          '2026-09-19T07:00:00.000Z'
        );

      assert.equal(
        second.assignments_created.length,
        0
      );

      assert.equal(
        second.state.assignments.length,
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
