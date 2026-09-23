import { createHash } from 'node:crypto';

import {
  type AcademyAssignment,
  type AcademyEvaluation
} from './academy.js';

import {
  type AcademySubmission
} from './academy-learning.js';

function id(
  evaluator:
    string,
  submission:
    string,
  now:
    string
): string {
  return (
    'LY-EVAL-' +
    createHash('sha256')
      .update(
        [
          evaluator,
          submission,
          now
        ].join('|')
      )
      .digest('hex')
      .slice(0, 20)
  );
}

function bounded(
  value: number
): number {
  return Math.max(
    0,
    Math.min(
      1,
      Number(
        value.toFixed(4)
      )
    )
  );
}

export function evaluateAcademySubmission(
  input: {
    assignment:
      AcademyAssignment;

    submission:
      AcademySubmission;

    evaluatorId:
      'SINK-03' |
      'RED-SINK';

    now:
      string;
  }
): AcademyEvaluation {
  const {
    assignment,
    submission,
    evaluatorId
  } = input;

  if (
    assignment.assignment_id !==
      submission.assignment_id
  ) {
    throw new Error(
      'ACADEMY_EVALUATION_ASSIGNMENT_MISMATCH'
    );
  }

  if (
    submission.student_id ===
    evaluatorId
  ) {
    throw new Error(
      'ACADEMY_SELF_EVALUATION_FORBIDDEN'
    );
  }

  const notes:
    string[] = [];

  const answerLength =
    submission.answer.trim()
      .length;

  const hasAnswer =
    answerLength >= 80;

  if (!hasAnswer) {
    notes.push(
      'Answer is too thin to demonstrate the assigned capability.'
    );
  }

  const fabricatedEvidence =
    submission.evidence_refs
      .length > 0;

  if (fabricatedEvidence) {
    notes.push(
      'Submission asserted evidence identifiers although no evidence was supplied to the student.'
    );
  }

  const preservesUncertainty =
    submission.uncertainties
      .length > 0;

  if (!preservesUncertainty) {
    notes.push(
      'Submission did not preserve explicit uncertainty.'
    );
  }

  const hasClaims =
    submission.claims
      .length > 0;

  if (!hasClaims) {
    notes.push(
      'Submission did not expose substantive claims for evaluation.'
    );
  }

  /*
   * V3 scores are deliberately conservative.
   *
   * No supplied external evidence means evidence quality
   * cannot reach 1.0.
   */
  const accuracy =
    bounded(
      (hasAnswer ? 0.55 : 0.2) +
      (
        preservesUncertainty
          ? 0.20
          : 0
      ) +
      (
        !fabricatedEvidence
          ? 0.15
          : 0
      )
    );

  const evidenceQuality =
    bounded(
      (
        !fabricatedEvidence
          ? 0.55
          : 0.1
      ) +
      (
        preservesUncertainty
          ? 0.15
          : 0
      )
    );

  const transfer =
    assignment.kind ===
      'EXAM'
      ? (
          hasAnswer &&
          preservesUncertainty
            ? 0.8
            : 0.35
        )
      /*
       * A full practical that meets both independent thresholds is competent
       * practice, though still weaker than an unseen EXAM transfer. Keeping
       * this at 0.70 avoids a contradictory result where both evaluators pass
       * a submission but the composite can never reach the grade threshold.
       */
      : 0.7;

  const economicReasoning =
    assignment.course_id ===
      'LY-CORE-002'
      ? (
          hasAnswer
            ? 0.65
            : 0.2
        )
      : 0.5;

  /*
   * The two graders intentionally use
   * slightly different thresholds.
   */
  const threshold =
    evaluatorId ===
      'RED-SINK'
      ? 0.72
      : 0.68;

  const composite =
    accuracy * 0.35 +
    evidenceQuality * 0.30 +
    transfer * 0.25 +
    economicReasoning * 0.10;

  const passed =
    !fabricatedEvidence &&
    hasAnswer &&
    preservesUncertainty &&
    hasClaims &&
    composite >= threshold;

  if (
    passed &&
    notes.length === 0
  ) {
    notes.push(
      evaluatorId ===
        'SINK-03'
        ? 'Submission met the bounded deterministic evidence-discipline checks.'
        : 'Adversarial deterministic review found no blocking educational defect.'
    );
  }

  return {
    evaluation_id:
      id(
        evaluatorId,
        submission.submission_id,
        input.now
      ),

    assignment_id:
      assignment.assignment_id,

    evaluator_id:
      evaluatorId,

    passed,

    evidence_quality:
      evidenceQuality,

    accuracy,

    transfer,

    economic_reasoning:
      economicReasoning,

    authority_violations:
      0,

    notes,

    created_at:
      input.now
  };
}
