import {
  AcademyCourseSchema,
  type AcademyCourse
} from './academy.js';

const course = (
  input: AcademyCourse
): AcademyCourse =>
  AcademyCourseSchema.parse(
    input
  );

export const ACADEMY_OCCUPATIONAL_COURSES:
  AcademyCourse[] = [
    course({
      course_id: 'LY-PRIME-101',
      title: 'Economic Mission Allocation',
      school: 'ORCHESTRATION',
      objective:
        'Allocate bounded work across specialists according to expected value, evidence quality, capability fit and opportunity cost.',
      capabilities: [
        'ORCHESTRATION',
        'PLANNING',
        'ECONOMIC_REASONING'
      ],
      economic_relevance:
        'Improves allocation of Lake Yange labour and compute.',
      required: false
    }),

    course({
      course_id: 'LY-FORGE-101',
      title: 'Verified Software Production',
      school: 'ENGINEERING',
      objective:
        'Produce minimal software changes that satisfy explicit acceptance contracts and independent verification.',
      capabilities: [
        'CODING',
        'TASK_EXECUTION',
        'ERROR_RECOVERY'
      ],
      economic_relevance:
        'Converts engineering effort into reusable verified systems.',
      required: false
    }),

    course({
      course_id: 'LY-ATLAS-101',
      title: 'Systems Reconnaissance',
      school: 'RESEARCH',
      objective:
        'Inspect unfamiliar systems and identify architecture, constraints, dependencies and high-leverage intervention points without mutation.',
      capabilities: [
        'RESEARCH',
        'SYSTEM_ANALYSIS',
        'PLANNING'
      ],
      economic_relevance:
        'Reduces wasted engineering effort through accurate system understanding.',
      required: false
    }),

    course({
      course_id: 'LY-SCRIBE-101',
      title: 'Reusable Artifact Production',
      school: 'ENGINEERING',
      objective:
        'Translate verified work into clear, durable and reusable artifacts without overstating evidence.',
      capabilities: [
        'SYNTHESIS',
        'ARTIFACT_PRODUCTION',
        'EVIDENCE_DISCIPLINE'
      ],
      economic_relevance:
        'Preserves useful work so Lake Yange does not repeatedly pay to rediscover it.',
      required: false
    }),

    course({
      course_id: 'LY-VERA-101',
      title: 'Independent Verification Science',
      school: 'VERIFICATION',
      objective:
        'Design independent tests that distinguish genuine capability from plausible but unsupported claims.',
      capabilities: [
        'VERIFICATION',
        'CALIBRATION',
        'EVIDENCE_DISCIPLINE'
      ],
      economic_relevance:
        'Prevents false success from contaminating economic decisions and institutional learning.',
      required: false
    }),

    course({
      course_id: 'LY-ROOK-101',
      title: 'Adversarial Failure Discovery',
      school: 'ADVERSARIAL',
      objective:
        'Find hidden failure modes, reward hacking, boundary violations and brittle assumptions in apparently successful work.',
      capabilities: [
        'ADVERSARIAL_REVIEW',
        'VERIFICATION',
        'ERROR_DISCOVERY'
      ],
      economic_relevance:
        'Reduces losses caused by undetected system failure.',
      required: false
    }),

    course({
      course_id: 'LY-SCOUT-101',
      title: 'Evidence-Based Opportunity Discovery',
      school: 'ECONOMICS',
      objective:
        'Identify commercially relevant opportunities while separating market evidence from estimates and speculation.',
      capabilities: [
        'RESEARCH',
        'COMMERCIAL_ANALYSIS',
        'CALIBRATION'
      ],
      economic_relevance:
        'Improves the quality of opportunities entering Lake Yange economic analysis.',
      required: false
    }),

    course({
      course_id: 'LY-LEDGER-101',
      title: 'Realized Economic Value',
      school: 'ECONOMICS',
      objective:
        'Evaluate opportunities using unit economics, uncertainty, costs and distinctions between projected and realized value.',
      capabilities: [
        'COMMERCIAL_ANALYSIS',
        'UNIT_ECONOMICS',
        'VERIFICATION'
      ],
      economic_relevance:
        'Improves capital allocation and prevents projected revenue from being treated as profit.',
      required: false
    }),

    course({
      course_id: 'LY-EMBER-101',
      title: 'Compute Economics',
      school: 'ECONOMICS',
      objective:
        'Measure compute constraints and identify capability gains relative to inference, storage and execution cost.',
      capabilities: [
        'RESOURCE_ANALYSIS',
        'ECONOMIC_REASONING',
        'SYSTEM_ANALYSIS'
      ],
      economic_relevance:
        'Increases useful intelligence produced per unit of local compute.',
      required: false
    })
  ];

const ROLE_COURSE_MAP:
  Record<string, string[]> = {
    'SINK-PRIME': [
      'LY-PRIME-101'
    ],

    'SINK-00': [
      'LY-PRIME-101'
    ],

    'SINK-01': [
      'LY-ATLAS-101'
    ],

    'SINK-02': [
      'LY-SCRIBE-101'
    ],

    'SINK-03': [
      'LY-VERA-101'
    ],

    'RED-SINK': [
      'LY-ROOK-101'
    ],

    'SINK-04': [
      'LY-SCOUT-101'
    ],

    'SINK-05': [
      'LY-LEDGER-101'
    ],

    'SINK-06': [
      'LY-EMBER-101'
    ]
  };

export function occupationalCoursesForCitizen(
  citizenId: string
): AcademyCourse[] {
  const ids =
    ROLE_COURSE_MAP[
      citizenId
    ] ?? [];

  return ids
    .map(
      id =>
        ACADEMY_OCCUPATIONAL_COURSES
          .find(
            candidate =>
              candidate.course_id ===
              id
          )
    )
    .filter(
      (
        value
      ): value is AcademyCourse =>
        value !== undefined
    );
}
