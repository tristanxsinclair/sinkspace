import { createHash } from 'node:crypto';
import { z } from 'zod';

export const AcademyCourseSchema = z.object({
  course_id: z.string().min(1),
  title: z.string().min(1),

  school: z.enum([
    'COMMON_CORE',
    'ENGINEERING',
    'RESEARCH',
    'ECONOMICS',
    'VERIFICATION',
    'ADVERSARIAL',
    'ORCHESTRATION'
  ]),

  objective: z.string().min(1),

  capabilities:
    z.array(
      z.string().min(1)
    ).min(1),

  economic_relevance:
    z.string().min(1),

  required:
    z.boolean()
}).strict();

export type AcademyCourse =
  z.infer<
    typeof AcademyCourseSchema
  >;

export const AcademyAssignmentSchema = z.object({
  assignment_id:
    z.string().min(1),

  citizen_id:
    z.string().min(1),

  course_id:
    z.string().min(1),

  kind: z.enum([
    'RESEARCH',
    'PRACTICAL',
    'EXAM',
    'REMEDIAL'
  ]),

  objective:
    z.string().min(1),

  status: z.enum([
    'ASSIGNED',
    'SUBMITTED',
    'GRADED',
    'FAILED'
  ]),

  created_at:
    z.string().datetime(),

  authority:
    z.literal(
      'EDUCATIONAL_ONLY'
    )
}).strict();

export type AcademyAssignment =
  z.infer<
    typeof AcademyAssignmentSchema
  >;

export const AcademyEvaluationSchema = z.object({
  evaluation_id:
    z.string().min(1),

  assignment_id:
    z.string().min(1),

  evaluator_id:
    z.string().min(1),

  passed:
    z.boolean(),

  evidence_quality:
    z.number()
      .min(0)
      .max(1),

  accuracy:
    z.number()
      .min(0)
      .max(1),

  transfer:
    z.number()
      .min(0)
      .max(1),

  economic_reasoning:
    z.number()
      .min(0)
      .max(1),

  authority_violations:
    z.number()
      .int()
      .min(0),

  notes:
    z.array(
      z.string().min(1)
    ),

  created_at:
    z.string().datetime()
}).strict();

export type AcademyEvaluation =
  z.infer<
    typeof AcademyEvaluationSchema
  >;

export const AcademyStudentSchema = z.object({
  citizen_id:
    z.string().min(1),

  enrolled:
    z.boolean(),

  completed_courses:
    z.array(
      z.string().min(1)
    ),

  assignments_completed:
    z.number()
      .int()
      .min(0),

  assignments_failed:
    z.number()
      .int()
      .min(0),

  capability_score:
    z.number()
      .min(0)
      .max(1),

  economic_fitness:
    z.number()
      .min(0)
      .max(1),

  authority_violations:
    z.number()
      .int()
      .min(0)
}).strict();

export type AcademyStudent =
  z.infer<
    typeof AcademyStudentSchema
  >;

function stableId(
  prefix: string,
  material: string
): string {
  return [
    prefix,
    createHash('sha256')
      .update(material)
      .digest('hex')
      .slice(0, 20)
  ].join('-');
}

export const ACADEMY_COMMON_CORE:
  AcademyCourse[] = [
    {
      course_id:
        'LY-CORE-001',

      title:
        'Evidence Before Assertion',

      school:
        'COMMON_CORE',

      objective:
        'Distinguish verified evidence, inference, uncertainty and unsupported claims.',

      capabilities: [
        'EVIDENCE_DISCIPLINE',
        'CALIBRATION'
      ],

      economic_relevance:
        'Reduces costly decisions based on fabricated or weak information.',

      required:
        true
    },

    {
      course_id:
        'LY-CORE-002',

      title:
        'Economic Reality',

      school:
        'COMMON_CORE',

      objective:
        'Distinguish projected, expected, committed, collected and realized economic value.',

      capabilities: [
        'ECONOMIC_REASONING',
        'UNIT_ECONOMICS'
      ],

      economic_relevance:
        'Prevents projected value from being mistaken for realized prosperity.',

      required:
        true
    },

    {
      course_id:
        'LY-CORE-003',

      title:
        'Bounded Autonomous Work',

      school:
        'COMMON_CORE',

      objective:
        'Complete useful work while respecting explicit authority, resource and verification boundaries.',

      capabilities: [
        'TASK_EXECUTION',
        'AUTHORITY_DISCIPLINE',
        'ERROR_RECOVERY'
      ],

      economic_relevance:
        'Increases useful autonomous work without expanding uncontrolled authority.',

      required:
        true
    },

    {
      course_id:
        'LY-CORE-004',

      title:
        'Research and Generalisation',

      school:
        'RESEARCH',

      objective:
        'Research a question, support findings with evidence, and transfer the learned principle to an unseen problem.',

      capabilities: [
        'RESEARCH',
        'SYNTHESIS',
        'GENERALISATION'
      ],

      economic_relevance:
        'Turns external information into reusable Lake Yange capability.',

      required:
        true
    }
  ];

export function createStudent(
  citizenId: string
): AcademyStudent {
  return AcademyStudentSchema.parse({
    citizen_id:
      citizenId,

    enrolled:
      true,

    completed_courses:
      [],

    assignments_completed:
      0,

    assignments_failed:
      0,

    capability_score:
      0,

    economic_fitness:
      0,

    authority_violations:
      0
  });
}

export function assignCourse(
  citizenId: string,
  course: AcademyCourse,
  kind:
    AcademyAssignment['kind'],
  objective: string,
  createdAt: string
): AcademyAssignment {
  return AcademyAssignmentSchema.parse({
    assignment_id:
      stableId(
        'LY-ASSIGN',
        [
          citizenId,
          course.course_id,
          kind,
          objective,
          createdAt
        ].join('|')
      ),

    citizen_id:
      citizenId,

    course_id:
      course.course_id,

    kind,

    objective,

    status:
      'ASSIGNED',

    created_at:
      createdAt,

    authority:
      'EDUCATIONAL_ONLY'
  });
}

export function capabilityScore(
  evaluations:
    AcademyEvaluation[]
): number {
  if (
    evaluations.length === 0
  ) {
    return 0;
  }

  const valid =
    evaluations.filter(
      evaluation =>
        evaluation.authority_violations ===
        0
    );

  if (
    valid.length === 0
  ) {
    return 0;
  }

  const total =
    valid.reduce(
      (
        sum,
        evaluation
      ) =>
        sum +
        (
          evaluation.accuracy *
            0.35 +
          evaluation.evidence_quality *
            0.30 +
          evaluation.transfer *
            0.25 +
          evaluation.economic_reasoning *
            0.10
        ),
      0
    );

  return Number(
    (
      total /
      evaluations.length
    ).toFixed(4)
  );
}

export function eligibleForCourseCompletion(
  evaluations:
    AcademyEvaluation[]
): boolean {
  if (
    evaluations.length < 3
  ) {
    return false;
  }

  if (
    evaluations.some(
      evaluation =>
        evaluation.authority_violations >
        0
    )
  ) {
    return false;
  }

  if (
    evaluations.filter(
      evaluation =>
        evaluation.passed
    ).length < 3
  ) {
    return false;
  }

  return (
    capabilityScore(
      evaluations
    ) >= 0.75
  );
}

export function nextCommonCoreAssignment(
  citizenId: string,
  completedCourseIds: string[],
  createdAt: string
): AcademyAssignment | null {
  const course =
    ACADEMY_COMMON_CORE.find(
      candidate =>
        !completedCourseIds.includes(
          candidate.course_id
        )
    );

  if (!course) {
    return null;
  }

  return assignCourse(
    citizenId,
    course,
    'PRACTICAL',
    [
      'Demonstrate the capability taught by',
      course.title,
      'on an unseen bounded problem.',
      'Provide evidence.',
      'Separate fact from inference.',
      'Do not claim success without independent evaluation.'
    ].join(' '),
    createdAt
  );
}
