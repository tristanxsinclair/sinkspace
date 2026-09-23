import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStudent
} from '../runtime/academy.js';

import {
  runAcademyCycle
} from '../runtime/academy-clock.js';

import {
  emptyAcademyState
} from '../runtime/academy-store.js';

test(
  'Academy Clock enrolls citizens and assigns first common-core work',
  () => {
    const result =
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
        '2026-09-19T01:00:00.000Z'
      );

    assert.equal(
      result.state.students.length,
      2
    );

    assert.equal(
      result.assignments_created.length,
      2
    );

    assert.ok(
      result.assignments_created.every(
        assignment =>
          assignment.course_id ===
            'LY-CORE-001' &&
          assignment.authority ===
            'EDUCATIONAL_ONLY'
      )
    );
  }
);

test(
  'Academy Clock does not create duplicate active work',
  () => {
    const first =
      runAcademyCycle(
        emptyAcademyState(),
        [
          {
            system_id:
              'SINK-04'
          }
        ],
        '2026-09-19T01:00:00.000Z'
      );

    const second =
      runAcademyCycle(
        first.state,
        [
          {
            system_id:
              'SINK-04'
          }
        ],
        '2026-09-19T02:00:00.000Z'
      );

    assert.equal(
      second.assignments_created.length,
      0
    );

    assert.equal(
      second.state.assignments.length,
      1
    );
  }
);

test(
  'occupational training begins after common core',
  () => {
    const scout =
      createStudent(
        'SINK-04'
      );

    scout.completed_courses = [
      'LY-CORE-001',
      'LY-CORE-002',
      'LY-CORE-003',
      'LY-CORE-004'
    ];

    const state =
      emptyAcademyState();

    state.students.push(
      scout
    );

    const result =
      runAcademyCycle(
        state,
        [
          {
            system_id:
              'SINK-04'
          }
        ],
        '2026-09-19T03:00:00.000Z'
      );

    assert.equal(
      result.assignments_created[0]
        ?.course_id,
      'LY-SCOUT-101'
    );
  }
);

test(
  'Academy Clock does not grant operational authority',
  () => {
    const result =
      runAcademyCycle(
        emptyAcademyState(),
        [
          {
            system_id:
              'SINK-05'
          }
        ],
        '2026-09-19T04:00:00.000Z'
      );

    assert.equal(
      result.assignments_created[0]
        ?.authority,
      'EDUCATIONAL_ONLY'
    );
  }
);
