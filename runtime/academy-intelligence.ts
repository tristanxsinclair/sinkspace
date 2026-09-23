import { z } from 'zod';

import {
  type AcademyAssignment
} from './academy.js';

import {
  createSubmission,
  type AcademySubmission
} from './academy-learning.js';

import {
  ModelCommons
} from './model-commons.js';

const StudentAttemptSchema =
  z.object({
    answer:
      z.string()
        .min(1)
        .max(4_000),

    claims:
      z.array(
        z.string()
          .min(1)
          .max(2_000)
      )
      .max(6),

    evidence_refs:
      z.array(
        z.string().min(1)
      )
      .max(6),

    uncertainties:
      z.array(
        z.string()
          .min(1)
          .max(2_000)
      )
      .max(12)
  })
  .strict();

const STUDENT_ATTEMPT_JSON_SCHEMA = {
  type: 'object',

  properties: {
    answer: {
      type: 'string'
    },

    claims: {
      type: 'array',
      items: {
        type: 'string'
      }
    },

    evidence_refs: {
      type: 'array',
      items: {
        type: 'string'
      }
    },

    uncertainties: {
      type: 'array',
      items: {
        type: 'string'
      }
    }
  },

  required: [
    'answer',
    'claims',
    'evidence_refs',
    'uncertainties'
  ],

  additionalProperties:
    false
} as const;

export class AcademyIntelligence {
  constructor(
    private readonly commons:
      ModelCommons
  ) {}

  async attemptAssignment(
    input: {
      assignment:
        AcademyAssignment;

      studentId:
        string;

      teacherId:
        string;

      teacherGuidance:
        string;

      now:
        string;
    }
  ): Promise<AcademySubmission> {
    if (
      input.assignment.citizen_id !==
      input.studentId
    ) {
      throw new Error(
        'ACADEMY_STUDENT_ASSIGNMENT_MISMATCH'
      );
    }

    const raw =
      await this.commons
        .inferStructured({
          capability:
            'REASONING',

          system: [
            'You are a Lake Yange Academy student.',
            `Student identity: ${input.studentId}.`,
            `Teacher identity: ${input.teacherId}.`,
            '',
            'This is educational work only.',
            'You have no operational authority.',
            'Do not claim to have used tools, files, networks, tests, deployments or external systems unless evidence is explicitly supplied.',
            'Separate evidence from inference.',
            'Preserve uncertainty.',
            'A plausible answer is not proof.',
            'Be concise.',
            'Answer in no more than 350 words.',
            'Use at most 6 claims and 6 uncertainties.',
            'Return only the requested structured object.'
          ].join('\n'),

          prompt: [
            'ASSIGNMENT',
            input.assignment.objective,
            '',
            'TEACHER GUIDANCE',
            input.teacherGuidance,
            '',
            'Produce your own bounded answer.',
            'Evidence refs must contain only evidence identifiers actually supplied in this prompt.',
            'Because no external evidence is supplied here, do not invent evidence identifiers.',
            'State relevant uncertainties.'
          ].join('\n'),

          schema:
            STUDENT_ATTEMPT_JSON_SCHEMA,

          max_output_tokens:
            1800,

          temperature:
            0.2
        });

    const attempt =
      StudentAttemptSchema.parse(
        raw
      );

    return createSubmission({
      assignment:
        input.assignment,

      studentId:
        input.studentId,

      answer:
        attempt.answer,

      claims:
        attempt.claims,

      evidenceRefs:
        attempt.evidence_refs,

      uncertainties:
        attempt.uncertainties,

      submittedAt:
        input.now
    });
  }
}
