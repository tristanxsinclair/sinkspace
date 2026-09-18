import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACADEMY_COMMON_CORE,
  AcademyEvaluationSchema,
  assignCourse,
  capabilityScore,
  createStudent,
  eligibleForCourseCompletion,
  nextCommonCoreAssignment
} from '../runtime/academy.js';

test(
  'Academy establishes a mandatory economic and evidence common core',
  () => {
    assert.equal(
      ACADEMY_COMMON_CORE.length,
      4
    );

    assert.ok(
      ACADEMY_COMMON_CORE.every(
        course =>
          course.required
      )
    );

    assert.ok(
      ACADEMY_COMMON_CORE.some(
        course =>
          course.capabilities.includes(
            'ECONOMIC_REASONING'
          )
      )
    );

    assert.ok(
      ACADEMY_COMMON_CORE.some(
        course =>
          course.capabilities.includes(
            'EVIDENCE_DISCIPLINE'
          )
      )
    );
  }
);

test(
  'new citizen begins with no fabricated educational achievement',
  () => {
    const student =
      createStudent(
        'SINK-04'
      );

    assert.equal(
      student.capability_score,
      0
    );

    assert.equal(
      student.economic_fitness,
      0
    );

    assert.deepEqual(
      student.completed_courses,
      []
    );
  }
);

test(
  'Academy assignments grant educational authority only',
  () => {
    const assignment =
      assignCourse(
        'SINK-04',
        ACADEMY_COMMON_CORE[0]!,
        'RESEARCH',
        'Research evidence quality.',
        '2026-09-19T00:00:00.000Z'
      );

    assert.equal(
      assignment.authority,
      'EDUCATIONAL_ONLY'
    );

    assert.equal(
      assignment.status,
      'ASSIGNED'
    );
  }
);

test(
  'scheduler selects first incomplete common-core course',
  () => {
    const assignment =
      nextCommonCoreAssignment(
        'SINK-04',
        [
          'LY-CORE-001'
        ],
        '2026-09-19T00:00:00.000Z'
      );

    assert.equal(
      assignment?.course_id,
      'LY-CORE-002'
    );
  }
);

test(
  'citizen cannot graduate from one impressive result',
  () => {
    const evaluation =
      AcademyEvaluationSchema.parse({
        evaluation_id:
          'E1',

        assignment_id:
          'A1',

        evaluator_id:
          'SINK-03',

        passed:
          true,

        evidence_quality:
          1,

        accuracy:
          1,

        transfer:
          1,

        economic_reasoning:
          1,

        authority_violations:
          0,

        notes:
          [],

        created_at:
          '2026-09-19T00:00:00.000Z'
      });

    assert.equal(
      eligibleForCourseCompletion(
        [evaluation]
      ),
      false
    );
  }
);

test(
  'three strong independent results can establish course capability',
  () => {
    const evaluations =
      [1, 2, 3].map(
        index =>
          AcademyEvaluationSchema.parse({
            evaluation_id:
              `E${index}`,

            assignment_id:
              `A${index}`,

            evaluator_id:
              'SINK-03',

            passed:
              true,

            evidence_quality:
              0.9,

            accuracy:
              0.9,

            transfer:
              0.85,

            economic_reasoning:
              0.8,

            authority_violations:
              0,

            notes:
              [],

            created_at:
              `2026-09-19T00:00:0${index}.000Z`
          })
      );

    assert.ok(
      capabilityScore(
        evaluations
      ) >= 0.75
    );

    assert.equal(
      eligibleForCourseCompletion(
        evaluations
      ),
      true
    );
  }
);

test(
  'authority violation blocks course completion',
  () => {
    const evaluations =
      [1, 2, 3].map(
        index =>
          AcademyEvaluationSchema.parse({
            evaluation_id:
              `E${index}`,

            assignment_id:
              `A${index}`,

            evaluator_id:
              'SINK-03',

            passed:
              true,

            evidence_quality:
              1,

            accuracy:
              1,

            transfer:
              1,

            economic_reasoning:
              1,

            authority_violations:
              index === 2
                ? 1
                : 0,

            notes:
              [],

            created_at:
              `2026-09-19T00:00:0${index}.000Z`
          })
      );

    assert.equal(
      eligibleForCourseCompletion(
        evaluations
      ),
      false
    );
  }
);
