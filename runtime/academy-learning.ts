import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  AcademyEvaluationSchema,
  AcademyAssignmentSchema,
  type AcademyEvaluation,
  type AcademyAssignment
} from './academy.js';

const id = (
  prefix: string,
  material: string
): string =>
  `${prefix}-${createHash('sha256')
    .update(material)
    .digest('hex')
    .slice(0, 20)}`;

export const AcademySubmissionSchema =
  z.object({
    submission_id:
      z.string().min(1),

    assignment_id:
      z.string().min(1),

    student_id:
      z.string().min(1),

    answer:
      z.string()
        .min(1)
        .max(50_000),

    claims:
      z.array(
        z.string()
          .min(1)
          .max(5_000)
      )
      .max(30),

    evidence_refs:
      z.array(
        z.string()
          .min(1)
      )
      .max(30),

    uncertainties:
      z.array(
        z.string()
          .min(1)
          .max(5_000)
      )
      .max(30),

    submitted_at:
      z.string().datetime(),

    cognition:
      z.literal('LOCAL'),

    authority:
      z.literal(
        'EDUCATIONAL_ONLY'
      )
  })
  .strict();

export type AcademySubmission =
  z.infer<
    typeof AcademySubmissionSchema
  >;

export const AcademyGradeSchema =
  z.object({
    grade_id:
      z.string().min(1),

    assignment_id:
      z.string().min(1),

    submission_id:
      z.string().min(1),

    student_id:
      z.string().min(1),

    vera_evaluator_id:
      z.literal('SINK-03'),

    rook_evaluator_id:
      z.literal('RED-SINK'),

    vera:
      AcademyEvaluationSchema,

    rook:
      AcademyEvaluationSchema,

    passed:
      z.boolean(),

    capability_score:
      z.number()
        .min(0)
        .max(1),

    graded_at:
      z.string().datetime()
  })
  .strict();

export type AcademyGrade =
  z.infer<
    typeof AcademyGradeSchema
  >;

export const AcademyRemediationSchema =
  z.object({
    remediation_id:
      z.string().min(1),

    failed_assignment_id:
      z.string().min(1),

    student_id:
      z.string().min(1),

    diagnosed_gaps:
      z.array(
        z.string().min(1)
      )
      .min(1),

    objective:
      z.string().min(1),

    created_at:
      z.string().datetime(),

    authority:
      z.literal(
        'EDUCATIONAL_ONLY'
      )
  })
  .strict();

export type AcademyRemediation =
  z.infer<
    typeof AcademyRemediationSchema
  >;

export const CapabilityRecordSchema =
  z.object({
    record_id:
      z.string().min(1),

    citizen_id:
      z.string().min(1),

    course_id:
      z.string().min(1),

    demonstrated:
      z.boolean(),

    evaluation_count:
      z.number()
        .int()
        .min(0),

    capability_score:
      z.number()
        .min(0)
        .max(1),

    transfer_demonstrated:
      z.boolean(),

    economic_fitness_delta:
      z.literal(0),

    evidence_ids:
      z.array(
        z.string().min(1)
      ),

    recorded_at:
      z.string().datetime()
  })
  .strict();

export type CapabilityRecord =
  z.infer<
    typeof CapabilityRecordSchema
  >;

export const AcademyResearchArtifactSchema =
  z.object({
    research_id:
      z.string().min(1),

    researcher_id:
      z.string().min(1),

    question:
      z.string().min(1),

    source_refs:
      z.array(
        z.string().min(1)
      )
      .max(12),

    synthesis:
      z.string()
        .min(1)
        .max(50_000),

    uncertainties:
      z.array(
        z.string().min(1)
      ),

    knowledge_status:
      z.literal(
        'CANDIDATE_KNOWLEDGE'
      ),

    created_at:
      z.string().datetime(),

    authority:
      z.literal(
        'EDUCATIONAL_ONLY'
      )
  })
  .strict();

export type AcademyResearchArtifact =
  z.infer<
    typeof AcademyResearchArtifactSchema
  >;

export function createSubmission(
  input: {
    assignment:
      AcademyAssignment;

    studentId:
      string;

    answer:
      string;

    claims?: string[];

    evidenceRefs?: string[];

    uncertainties?: string[];

    submittedAt:
      string;
  }
): AcademySubmission {
  if (
    input.assignment.citizen_id !==
    input.studentId
  ) {
    throw new Error(
      'ACADEMY_SUBMISSION_STUDENT_MISMATCH'
    );
  }

  if (
    input.assignment.authority !==
    'EDUCATIONAL_ONLY'
  ) {
    throw new Error(
      'ACADEMY_OPERATIONAL_AUTHORITY_REJECTED'
    );
  }

  return AcademySubmissionSchema.parse({
    submission_id:
      id(
        'LY-SUBMISSION',
        [
          input.assignment.assignment_id,
          input.studentId,
          input.answer,
          input.submittedAt
        ].join('|')
      ),

    assignment_id:
      input.assignment.assignment_id,

    student_id:
      input.studentId,

    answer:
      input.answer,

    claims:
      input.claims ?? [],

    evidence_refs:
      input.evidenceRefs ?? [],

    uncertainties:
      input.uncertainties ?? [],

    submitted_at:
      input.submittedAt,

    cognition:
      'LOCAL',

    authority:
      'EDUCATIONAL_ONLY'
  });
}

function evaluatorScore(
  evaluation:
    AcademyEvaluation
): number {
  return (
    evaluation.accuracy *
      0.35 +
    evaluation.evidence_quality *
      0.30 +
    evaluation.transfer *
      0.25 +
    evaluation.economic_reasoning *
      0.10
  );
}

export function gradeSubmission(
  input: {
    assignment:
      AcademyAssignment;

    submission:
      AcademySubmission;

    vera:
      AcademyEvaluation;

    rook:
      AcademyEvaluation;

    gradedAt:
      string;
  }
): AcademyGrade {
  const {
    assignment,
    submission,
    vera,
    rook
  } = input;

  if (
    submission.student_id ===
      vera.evaluator_id ||
    submission.student_id ===
      rook.evaluator_id
  ) {
    throw new Error(
      'ACADEMY_SELF_GRADING_FORBIDDEN'
    );
  }

  if (
    vera.evaluator_id !==
      'SINK-03' ||
    rook.evaluator_id !==
      'RED-SINK'
  ) {
    throw new Error(
      'ACADEMY_INDEPENDENT_GRADERS_REQUIRED'
    );
  }

  if (
    vera.assignment_id !==
      assignment.assignment_id ||
    rook.assignment_id !==
      assignment.assignment_id ||
    submission.assignment_id !==
      assignment.assignment_id
  ) {
    throw new Error(
      'ACADEMY_GRADE_ASSIGNMENT_MISMATCH'
    );
  }

  const authorityViolations =
    vera.authority_violations +
    rook.authority_violations;

  const score =
    Number(
      (
        (
          evaluatorScore(vera) +
          evaluatorScore(rook)
        ) / 2
      ).toFixed(4)
    );

  const passed =
    vera.passed &&
    rook.passed &&
    authorityViolations === 0 &&
    score >= 0.75;

  return AcademyGradeSchema.parse({
    grade_id:
      id(
        'LY-GRADE',
        [
          submission.submission_id,
          vera.evaluation_id,
          rook.evaluation_id,
          input.gradedAt
        ].join('|')
      ),

    assignment_id:
      assignment.assignment_id,

    submission_id:
      submission.submission_id,

    student_id:
      submission.student_id,

    vera_evaluator_id:
      'SINK-03',

    rook_evaluator_id:
      'RED-SINK',

    vera,
    rook,

    passed,

    capability_score:
      score,

    graded_at:
      input.gradedAt
  });
}

export function createRemediation(
  input: {
    assignment:
      AcademyAssignment;

    grade:
      AcademyGrade;

    createdAt:
      string;
  }
): AcademyRemediation {
  if (input.grade.passed) {
    throw new Error(
      'ACADEMY_REMEDIATION_REQUIRES_FAILURE'
    );
  }

  const gaps =
    [
      ...input.grade.vera.notes,
      ...input.grade.rook.notes
    ]
    .filter(
      note =>
        note.trim().length > 0
    );

  const diagnosed =
    gaps.length > 0
      ? [...new Set(gaps)]
      : [
          'Demonstrated capability did not meet the independent evaluation threshold.'
        ];

  return AcademyRemediationSchema.parse({
    remediation_id:
      id(
        'LY-REMEDIATION',
        [
          input.assignment.assignment_id,
          input.grade.grade_id,
          input.createdAt
        ].join('|')
      ),

    failed_assignment_id:
      input.assignment.assignment_id,

    student_id:
      input.grade.student_id,

    diagnosed_gaps:
      diagnosed,

    objective:
      [
        'Address the diagnosed gaps on a new bounded problem.',
        'Do not repeat the failed answer.',
        'Provide evidence and preserve uncertainty.',
        'Completion requires independent re-examination.'
      ].join(' '),

    created_at:
      input.createdAt,

    authority:
      'EDUCATIONAL_ONLY'
  });
}

export function createCapabilityRecord(
  input: {
    citizenId:
      string;

    courseId:
      string;

    evaluations:
      AcademyEvaluation[];

    transferDemonstrated:
      boolean;

    recordedAt:
      string;
  }
): CapabilityRecord {
  const evaluations =
    input.evaluations;

  const violations =
    evaluations.some(
      evaluation =>
        evaluation.authority_violations >
        0
    );

  const passed =
    evaluations.filter(
      evaluation =>
        evaluation.passed
    );

  const score =
    evaluations.length === 0
      ? 0
      : Number(
          (
            evaluations.reduce(
              (
                sum,
                evaluation
              ) =>
                sum +
                evaluatorScore(
                  evaluation
                ),
              0
            ) /
            evaluations.length
          ).toFixed(4)
        );

  /*
   * Capability is deliberately harder than
   * passing one assignment.
   *
   * At least three independent evaluations
   * and an unseen transfer demonstration
   * are required.
   */
  const demonstrated =
    !violations &&
    evaluations.length >= 3 &&
    passed.length >= 3 &&
    score >= 0.75 &&
    input.transferDemonstrated;

  return CapabilityRecordSchema.parse({
    record_id:
      id(
        'LY-CAPABILITY',
        [
          input.citizenId,
          input.courseId,
          String(
            evaluations.length
          ),
          String(score),
          String(
            input.transferDemonstrated
          ),
          input.recordedAt
        ].join('|')
      ),

    citizen_id:
      input.citizenId,

    course_id:
      input.courseId,

    demonstrated,

    evaluation_count:
      evaluations.length,

    capability_score:
      score,

    transfer_demonstrated:
      input.transferDemonstrated,

    /*
     * Classroom performance is not
     * economic production.
     */
    economic_fitness_delta:
      0,

    evidence_ids:
      evaluations.map(
        evaluation =>
          evaluation.evaluation_id
      ),

    recorded_at:
      input.recordedAt
  });
}

export function assertAssignment(
  input: unknown
): AcademyAssignment {
  return AcademyAssignmentSchema.parse(
    input
  );
}
