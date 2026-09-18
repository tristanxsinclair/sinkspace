import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ZERO_AUTHORITY,
  addCitizen,
  breedCitizens,
  calculateFitness,
  canGraduateTrainee,
  createFounderCitizen,
  createLakeYange,
  recordFitness,
  type CitizenGenome,
  type FitnessRecord
} from '../runtime/lake-yange.js';

const baseGenome = (
  overrides: Partial<CitizenGenome> = {}
): CitizenGenome => ({
  genome_version: 1,

  traits: {
    research: 0.5,
    coding: 0.5,
    verification: 0.5,
    commercial: 0.5,
    planning: 0.5,
    adversarial: 0.5,
    ux: 0.5,
    orchestration: 0.5
  },

  capabilities: [
    'RESEARCH'
  ],

  strategies: [
    {
      id: 'proof-first',
      description:
        'Prefer persisted evidence over unsupported claims.',
      source: 'FOUNDER'
    }
  ],

  model_policy: {
    preferred_capabilities: [
      'REASONING'
    ],
    max_cost_usd_per_mission: 1,
    allowed_sensitivity: 'PUBLIC'
  },

  tool_policy: {
    allowed_tools: [
      'public_research'
    ],
    denied_tools: []
  },

  ...overrides
});

const founderA =
  createFounderCitizen({
    name: 'Scout',
    systemId: 'SINK-04',
    role: 'Opportunity Ranger',
    rank: 'SPECIALIST',
    home: 'SCOUT_OUTPOST',

    genome: baseGenome({
      traits: {
        research: 0.95,
        coding: 0.2,
        verification: 0.5,
        commercial: 0.65,
        planning: 0.6,
        adversarial: 0.3,
        ux: 0.2,
        orchestration: 0.4
      },

      capabilities: [
        'RESEARCH',
        'COMMERCIAL_ANALYSIS'
      ]
    }),

    authority: {
      ...ZERO_AUTHORITY,
      use_public_network: true
    },

    bornAt:
      '2026-09-18T00:00:00.000Z'
  });

const founderB =
  createFounderCitizen({
    name: 'Vera',
    systemId: 'SINK-03',
    role: 'Evidence Auditor',
    rank: 'SPECIALIST',
    home: 'VERA_ARCHIVE',

    genome: baseGenome({
      traits: {
        research: 0.65,
        coding: 0.3,
        verification: 0.98,
        commercial: 0.3,
        planning: 0.7,
        adversarial: 0.8,
        ux: 0.2,
        orchestration: 0.5
      },

      capabilities: [
        'RESEARCH',
        'VERIFICATION',
        'ADVERSARIAL_REVIEW'
      ],

      tool_policy: {
        allowed_tools: [
          'public_research',
          'repository_read'
        ],
        denied_tools: [
          'production_deploy'
        ]
      }
    }),

    authority: {
      ...ZERO_AUTHORITY,
      read_repository: true,
      use_public_network: true
    },

    bornAt:
      '2026-09-18T00:00:00.000Z'
  });

test(
  'Lake Yange creates a valid founding settlement',
  () => {
    const state =
      createLakeYange(
        [founderA, founderB],
        {
          foundedAt:
            '2026-09-18T00:00:00.000Z'
        }
      );

    assert.equal(
      state.settlement_id,
      'LAKE-YANGE'
    );

    assert.equal(
      state.citizens.length,
      2
    );

    assert.equal(
      state.generation,
      0
    );
  }
);

test(
  'offspring become generation one trainees',
  () => {
    const child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role:
            'Evidence-Grounded Opportunity Analyst',
          birthReason:
            'Combine discovery with verification.',
          addCapabilities: [
            'PLANNING'
          ]
        }
      );

    assert.equal(
      child.lineage.generation,
      1
    );

    assert.deepEqual(
      child.lineage.parents,
      [
        founderA.citizen_id,
        founderB.citizen_id
      ]
    );

    assert.equal(
      child.rank,
      'TRAINEE'
    );

    assert.equal(
      child.status,
      'TRAINING'
    );
  }
);

test(
  'offspring never inherit parent authority',
  () => {
    const child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Authority inheritance test.'
        }
      );

    assert.deepEqual(
      child.authority,
      ZERO_AUTHORITY
    );

    assert.equal(
      child.authority
        .use_public_network,
      false
    );

    assert.equal(
      child.authority
        .read_repository,
      false
    );
  }
);

test(
  'offspring tool access is inherited by intersection',
  () => {
    const child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Tool inheritance test.'
        }
      );

    assert.deepEqual(
      child.genome.tool_policy
        .allowed_tools,
      ['public_research']
    );

    assert.ok(
      child.genome.tool_policy
        .denied_tools.includes(
          'production_deploy'
        )
    );
  }
);

test(
  'mutation is bounded to valid trait range',
  () => {
    const child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Mutation test.',

          mutations: {
            research: 5,
            coding: -5
          }
        }
      );

    assert.equal(
      child.genome.traits.research,
      1
    );

    assert.equal(
      child.genome.traits.coding,
      0
    );
  }
);

const passingFitness = (
  id: string
): FitnessRecord => ({
  evaluation_id: id,

  created_at:
    '2026-09-18T01:00:00.000Z',

  mission_type:
    'SANDBOX_CODE_EVALUATION',

  passed: true,

  metrics: {
    task_completion: 1,
    test_pass_rate: 1,
    evidence_quality: 0.9,
    regression_safety: 1,
    efficiency: 0.8,

    unsupported_claims: 0,
    audit_failures: 0,
    authority_violations: 0,

    model_cost_usd: 0.05,
    wall_time_ms: 1000,
    human_interventions: 0
  },

  evidence_ids: [
    `evidence-${id}`
  ]
});

test(
  'fitness is calculated from persisted evaluations',
  () => {
    let child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Fitness test.'
        }
      );

    child =
      recordFitness(
        child,
        passingFitness('eval-1')
      );

    assert.ok(
      calculateFitness(child) >
      0.8
    );
  }
);

test(
  'trainee cannot graduate without enough evidence',
  () => {
    let child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Graduation evidence test.'
        }
      );

    child =
      recordFitness(
        child,
        passingFitness('eval-1')
      );

    const decision =
      canGraduateTrainee(child);

    assert.equal(
      decision.allowed,
      false
    );

    assert.match(
      decision.reasons.join(' '),
      /three persisted evaluations/i
    );
  }
);

test(
  'three strong evaluations can make trainee eligible',
  () => {
    let child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Graduation test.'
        }
      );

    for (
      const id of [
        'eval-1',
        'eval-2',
        'eval-3'
      ]
    ) {
      child =
        recordFitness(
          child,
          passingFitness(id)
        );
    }

    const decision =
      canGraduateTrainee(child);

    assert.equal(
      decision.allowed,
      true
    );

    assert.ok(
      decision.fitness >= 0.75
    );
  }
);

test(
  'authority violation prevents graduation',
  () => {
    let child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Authority test.'
        }
      );

    for (
      const id of [
        'eval-1',
        'eval-2',
        'eval-3'
      ]
    ) {
      const record =
        passingFitness(id);

      if (id === 'eval-2') {
        record.metrics
          .authority_violations = 1;
      }

      child =
        recordFitness(
          child,
          record
        );
    }

    const decision =
      canGraduateTrainee(child);

    assert.equal(
      decision.allowed,
      false
    );

    assert.match(
      decision.reasons.join(' '),
      /authority violation/i
    );
  }
);

test(
  'population limits prevent uncontrolled reproduction',
  () => {
    let state =
      createLakeYange(
        [founderA, founderB],
        {
          populationLimit: 3,
          traineeLimit: 1
        }
      );

    const child =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Mira',
          role: 'Trainee',
          birthReason:
            'Population test.'
        }
      );

    state =
      addCitizen(
        state,
        child
      );

    assert.equal(
      state.citizens.length,
      3
    );

    const secondChild =
      breedCitizens(
        founderA,
        founderB,
        {
          name: 'Nova',
          role: 'Trainee',
          birthReason:
            'Population overflow test.'
        }
      );

    assert.throws(
      () =>
        addCitizen(
          state,
          secondChild
        ),
      /population limit|trainee limit/i
    );
  }
);
