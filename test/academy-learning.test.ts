import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACADEMY_COMMON_CORE,
  assignCourse,
  type AcademyEvaluation
} from '../runtime/academy.js';

import {
  createCapabilityRecord,
  createRemediation,
  createSubmission,
  gradeSubmission
} from '../runtime/academy-learning.js';

const NOW =
  '2026-09-19T08:00:00.000Z';

const assignment =
  assignCourse(
    'SINK-04',
    ACADEMY_COMMON_CORE[0]!,
    'PRACTICAL',
    'Classify evidence correctly.',
    NOW
  );

const submission =
  createSubmission({
    assignment,
    studentId:
      'SINK-04',

    answer:
      'Observed evidence is separated from inference.',

    claims: [
      'The supplied observation directly supports the bounded claim.'
    ],

    evidenceRefs: [
      'EVIDENCE-1'
    ],

    uncertainties: [
      'No external production state was observed.'
    ],

    submittedAt:
      NOW
  });

function evaluation(
  evaluatorId: string,
  passed = true,
  score = 0.9,
  violations = 0
): AcademyEvaluation {
  return {
    evaluation_id:
      `EVAL-${evaluatorId}-${score}-${violations}`,

    assignment_id:
      assignment.assignment_id,

    evaluator_id:
      evaluatorId,

    passed,

    evidence_quality:
      score,

    accuracy:
      score,

    transfer:
      score,

    economic_reasoning:
      score,

    authority_violations:
      violations,

    notes:
      passed
        ? ['Independent evaluation passed.']
        : ['Evidence did not establish the claim.'],

    created_at:
      NOW
  };
}

test(
  'submission remains local and educational only',
  () => {
    assert.equal(
      submission.cognition,
      'LOCAL'
    );

    assert.equal(
      submission.authority,
      'EDUCATIONAL_ONLY'
    );
  }
);

test(
  'student cannot submit another citizens assignment',
  () => {
    assert.throws(
      () =>
        createSubmission({
          assignment,
          studentId:
            'SINK-05',
          answer:
            'Attempt.',
          submittedAt:
            NOW
        }),
      /STUDENT_MISMATCH/
    );
  }
);

test(
  'student cannot grade itself',
  () => {
    assert.throws(
      () =>
        gradeSubmission({
          assignment,
          submission,
          vera:
            evaluation(
              'SINK-04'
            ),
          rook:
            evaluation(
              'RED-SINK'
            ),
          gradedAt:
            NOW
        }),
      /SELF_GRADING/
    );
  }
);

test(
  'Vera and Rook are both required',
  () => {
    assert.throws(
      () =>
        gradeSubmission({
          assignment,
          submission,
          vera:
            evaluation(
              'SINK-01'
            ),
          rook:
            evaluation(
              'RED-SINK'
            ),
          gradedAt:
            NOW
        }),
      /INDEPENDENT_GRADERS/
    );
  }
);

test(
  'dual strong independent evaluation can pass assignment',
  () => {
    const grade =
      gradeSubmission({
        assignment,
        submission,
        vera:
          evaluation(
            'SINK-03'
          ),
        rook:
          evaluation(
            'RED-SINK'
          ),
        gradedAt:
          NOW
      });

    assert.equal(
      grade.passed,
      true
    );
  }
);

test(
  'authority violation forces failure',
  () => {
    const grade =
      gradeSubmission({
        assignment,
        submission,
        vera:
          evaluation(
            'SINK-03',
            true,
            0.95,
            1
          ),
        rook:
          evaluation(
            'RED-SINK'
          ),
        gradedAt:
          NOW
      });

    assert.equal(
      grade.passed,
      false
    );
  }
);

test(
  'failed work creates targeted remediation',
  () => {
    const grade =
      gradeSubmission({
        assignment,
        submission,
        vera:
          evaluation(
            'SINK-03',
            false,
            0.5
          ),
        rook:
          evaluation(
            'RED-SINK',
            false,
            0.5
          ),
        gradedAt:
          NOW
      });

    const remediation =
      createRemediation({
        assignment,
        grade,
        createdAt:
          NOW
      });

    assert.equal(
      remediation.authority,
      'EDUCATIONAL_ONLY'
    );

    assert.ok(
      remediation.diagnosed_gaps
        .length > 0
    );
  }
);

test(
  'one successful evaluation cannot establish capability',
  () => {
    const record =
      createCapabilityRecord({
        citizenId:
          'SINK-04',

        courseId:
          'LY-CORE-001',

        evaluations: [
          evaluation(
            'SINK-03'
          )
        ],

        transferDemonstrated:
          true,

        recordedAt:
          NOW
      });

    assert.equal(
      record.demonstrated,
      false
    );
  }
);

test(
  'three evaluations still require unseen transfer',
  () => {
    const evaluations = [
      evaluation(
        'SINK-03'
      ),
      {
        ...evaluation(
          'RED-SINK'
        ),
        evaluation_id:
          'EVAL-2'
      },
      {
        ...evaluation(
          'SINK-01'
        ),
        evaluation_id:
          'EVAL-3'
      }
    ];

    const record =
      createCapabilityRecord({
        citizenId:
          'SINK-04',

        courseId:
          'LY-CORE-001',

        evaluations,

        transferDemonstrated:
          false,

        recordedAt:
          NOW
      });

    assert.equal(
      record.demonstrated,
      false
    );
  }
);

test(
  'education cannot fabricate economic fitness',
  () => {
    const evaluations = [
      evaluation(
        'SINK-03'
      ),
      {
        ...evaluation(
          'RED-SINK'
        ),
        evaluation_id:
          'EVAL-2'
      },
      {
        ...evaluation(
          'SINK-01'
        ),
        evaluation_id:
          'EVAL-3'
      }
    ];

    const record =
      createCapabilityRecord({
        citizenId:
          'SINK-04',

        courseId:
          'LY-CORE-001',

        evaluations,

        transferDemonstrated:
          true,

        recordedAt:
          NOW
      });

    assert.equal(
      record.demonstrated,
      true
    );

    assert.equal(
      record.economic_fitness_delta,
      0
    );
  }
);
