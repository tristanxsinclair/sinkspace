import {
  gradeSubmission,
  createRemediation,
  createCapabilityRecord
} from './academy-learning.js';

import {
  type AcademyState
} from './academy-store.js';

import {
  AcademyIntelligence
} from './academy-intelligence.js';

import {
  teacherForAssignment
} from './academy-teachers.js';

import {
  evaluateAcademySubmission
} from './academy-evaluators.js';

export type NeuralAcademyCycleResult = {
  state: AcademyState;

  attempted: number;
  graded: number;
  passed: number;
  failed: number;
  remediations_created:
    number;

  skipped_self_grading:
    string[];

  model_failures: Array<{
    assignment_id: string;
    citizen_id: string;
    reason: string;
  }>;
};

export async function runNeuralAcademyCycle(
  stateInput:
    AcademyState,

  intelligence:
    AcademyIntelligence,

  now:
    string
): Promise<NeuralAcademyCycleResult> {
  const state:
    AcademyState = {
      ...stateInput,

      students:
        stateInput.students.map(
          student => ({
            ...student,
            completed_courses: [
              ...student.completed_courses
            ]
          })
        ),

      assignments:
        stateInput.assignments.map(
          assignment => ({
            ...assignment
          })
        ),

      evaluations:
        [...stateInput.evaluations],

      submissions:
        [...stateInput.submissions],

      grades:
        [...stateInput.grades],

      remediations:
        [...stateInput.remediations],

      capability_records:
        [...stateInput.capability_records],

      research_artifacts:
        [...stateInput.research_artifacts]
    };

  let attempted = 0;
  let graded = 0;
  let passed = 0;
  let failed = 0;
  let remediationsCreated = 0;

  const skipped:
    string[] = [];

  const modelFailures: Array<{
    assignment_id: string;
    citizen_id: string;
    reason: string;
  }> = [];

  for (
    const assignment
    of state.assignments
  ) {
    if (
      assignment.status !==
      'ASSIGNED'
    ) {
      continue;
    }

    if (
      state.submissions.some(
        submission =>
          submission.assignment_id ===
          assignment.assignment_id
      )
    ) {
      continue;
    }

    /*
     * Vera and Rook cannot participate in
     * the Vera + Rook grading pair for
     * their own work.
     *
     * Preserve the invariant rather than
     * inventing an exception.
     */
    if (
      assignment.citizen_id ===
        'SINK-03' ||
      assignment.citizen_id ===
        'RED-SINK'
    ) {
      skipped.push(
        assignment.assignment_id
      );

      continue;
    }

    const teacher =
      teacherForAssignment(
        assignment
      );

    let submission;

    try {
      submission =
        await intelligence
          .attemptAssignment({
            assignment,

            studentId:
              assignment.citizen_id,

            teacherId:
              teacher.teacher_id,

            teacherGuidance:
              teacher.guidance,

            now
          });
    } catch (error) {
      modelFailures.push({
        assignment_id:
          assignment.assignment_id,

        citizen_id:
          assignment.citizen_id,

        reason:
          error instanceof Error
            ? error.message
            : 'UNKNOWN_MODEL_FAILURE'
      });

      continue;
    }

    state.submissions.push(
      submission
    );

    attempted += 1;

    const vera =
      evaluateAcademySubmission({
        assignment,
        submission,
        evaluatorId:
          'SINK-03',
        now
      });

    const rook =
      evaluateAcademySubmission({
        assignment,
        submission,
        evaluatorId:
          'RED-SINK',
        now
      });

    state.evaluations.push(
      vera,
      rook
    );

    const grade =
      gradeSubmission({
        assignment,
        submission,
        vera,
        rook,
        gradedAt:
          now
      });

    state.grades.push(
      grade
    );

    graded += 1;

    assignment.status =
      grade.passed
        ? 'GRADED'
        : 'FAILED';

    const student =
      state.students.find(
        candidate =>
          candidate.citizen_id ===
          assignment.citizen_id
      );

    if (!student) {
      throw new Error(
        'ACADEMY_STUDENT_RECORD_MISSING'
      );
    }

    if (grade.passed) {
      passed += 1;

      student.assignments_completed +=
        1;

      const passedAssignmentIds =
        new Set(
          state.grades
            .filter(
              candidate =>
                candidate.passed
            )
            .map(
              candidate =>
                candidate.assignment_id
            )
        );

      const courseAssignments =
        state.assignments.filter(
          candidate =>
            candidate.citizen_id ===
              student.citizen_id &&
            candidate.course_id ===
              assignment.course_id &&
            passedAssignmentIds.has(
              candidate.assignment_id
            )
        );

      const courseAssignmentIds =
        new Set(
          courseAssignments.map(
            candidate =>
              candidate.assignment_id
          )
        );

      const record =
        createCapabilityRecord({
          citizenId:
            student.citizen_id,
          courseId:
            assignment.course_id,
          evaluations:
            state.evaluations.filter(
              candidate =>
                courseAssignmentIds.has(
                  candidate.assignment_id
                )
            ),
          /*
           * A second independently assessed assignment is treated as an
           * unseen transfer attempt. One strong answer remains insufficient.
           */
          transferDemonstrated:
            courseAssignmentIds.size >= 2,
          recordedAt:
            now
        });

      state.capability_records.push(
        record
      );

      student.capability_score =
        Math.max(
          student.capability_score,
          record.capability_score
        );

      if (
        record.demonstrated &&
        !student.completed_courses.includes(
          assignment.course_id
        )
      ) {
        student.completed_courses.push(
          assignment.course_id
        );
      }
    } else {
      failed += 1;

      student.assignments_failed +=
        1;

      const remediation =
        createRemediation({
          assignment,
          grade,
          createdAt:
            now
        });

      state.remediations.push(
        remediation
      );

      remediationsCreated +=
        1;
    }
  }

  return {
    state,

    attempted,
    graded,
    passed,
    failed,

    remediations_created:
      remediationsCreated,

    skipped_self_grading:
      skipped,

    model_failures:
      modelFailures
  };
}
