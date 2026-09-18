import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ModelCommons,
  type LocalInferenceRuntime
} from '../runtime/model-commons.js';

import {
  AcademyIntelligence
} from '../runtime/academy-intelligence.js';

import {
  runNeuralAcademyCycle
} from '../runtime/academy-neural-cycle.js';

import {
  emptyAcademyState
} from '../runtime/academy-store.js';

import {
  runAcademyCycle
} from '../runtime/academy-clock.js';

const runtime:
  LocalInferenceRuntime = {
    name:
      'test-local',

    async health() {
      return true;
    },

    async inferStructured() {
      return {
        answer:
          'The supplied scenario should be separated into direct observations, inferences and unresolved uncertainty. A claim should only be treated as established when the supplied evidence entails it. Because this educational prompt supplies no external evidence, no external factual claim should be presented as verified.',

        claims: [
          'Claims require evidence before they can be treated as established.'
        ],

        evidence_refs:
          [],

        uncertainties: [
          'No external evidence was supplied in the assignment context.'
        ]
      };
    }
  };

function intelligence():
  AcademyIntelligence {
  const commons =
    new ModelCommons(
      runtime
    );

  commons.register({
    model_id:
      'test-reasoner',

    name:
      'Test local reasoner',

    runtime:
      'test-local',

    locality:
      'LOCAL',

    capabilities: [
      'REASONING'
    ],

    context_tokens:
      4096,

    enabled:
      true,

    loaded:
      true,

    memory_class_gb:
      1,

    endpoint:
      null
  });

  return new AcademyIntelligence(
    commons
  );
}

test(
  'neural Academy creates local submissions and independent grades',
  async () => {
    const enrolled =
      runAcademyCycle(
        emptyAcademyState(),
        [
          {
            system_id:
              'SINK-04'
          }
        ],
        '2026-09-19T09:00:00.000Z'
      );

    const result =
      await runNeuralAcademyCycle(
        enrolled.state,
        intelligence(),
        '2026-09-19T10:00:00.000Z'
      );

    assert.equal(
      result.attempted,
      1
    );

    assert.equal(
      result.graded,
      1
    );

    assert.equal(
      result.state.submissions.length,
      1
    );

    assert.equal(
      result.state.evaluations.length,
      2
    );

    assert.equal(
      result.state.submissions[0]
        ?.cognition,
      'LOCAL'
    );

    assert.equal(
      result.state.submissions[0]
        ?.authority,
      'EDUCATIONAL_ONLY'
    );
  }
);

test(
  'Vera and Rook student work is not self graded',
  async () => {
    const enrolled =
      runAcademyCycle(
        emptyAcademyState(),
        [
          {
            system_id:
              'SINK-03'
          },
          {
            system_id:
              'RED-SINK'
          }
        ],
        '2026-09-19T09:00:00.000Z'
      );

    const result =
      await runNeuralAcademyCycle(
        enrolled.state,
        intelligence(),
        '2026-09-19T10:00:00.000Z'
      );

    assert.equal(
      result.attempted,
      0
    );

    assert.equal(
      result.skipped_self_grading
        .length,
      2
    );
  }
);

test(
  'one neural pass does not complete a course',
  async () => {
    const enrolled =
      runAcademyCycle(
        emptyAcademyState(),
        [
          {
            system_id:
              'SINK-04'
          }
        ],
        '2026-09-19T09:00:00.000Z'
      );

    const result =
      await runNeuralAcademyCycle(
        enrolled.state,
        intelligence(),
        '2026-09-19T10:00:00.000Z'
      );

    assert.deepEqual(
      result.state.students[0]
        ?.completed_courses,
      []
    );

    assert.equal(
      result.state.students[0]
        ?.economic_fitness,
      0
    );
  }
);
