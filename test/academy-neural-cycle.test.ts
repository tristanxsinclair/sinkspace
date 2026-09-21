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

test(
  'two independently graded learning turns can demonstrate a course',
  async () => {
    const firstScheduled =
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

    const first =
      await runNeuralAcademyCycle(
        firstScheduled.state,
        intelligence(),
        '2026-09-19T10:00:00.000Z'
      );

    const secondScheduled =
      runAcademyCycle(
        first.state,
        [
          {
            system_id:
              'SINK-04'
          }
        ],
        '2026-09-19T11:00:00.000Z'
      );

    assert.equal(
      first.state.grades[0]
        ?.passed,
      true
    );

    assert.equal(
      secondScheduled.assignments_created[0]
        ?.kind,
      'EXAM'
    );

    const second =
      await runNeuralAcademyCycle(
        secondScheduled.state,
        intelligence(),
        '2026-09-19T12:00:00.000Z'
      );

    assert.ok(
      second.state.students[0]
        ?.completed_courses.includes(
          'LY-CORE-001'
        )
    );

    assert.equal(
      second.state.capability_records.at(-1)
        ?.demonstrated,
      true
    );
  }
);

test(
  'one local model failure does not abort the whole class',
  async () => {
    let calls = 0;

    const flakyRuntime:
      LocalInferenceRuntime = {
        name:
          'flaky-local',

        async health() {
          return true;
        },

        async inferStructured() {
          calls += 1;

          if (calls === 1) {
            throw new Error(
              'LOCAL_MODEL_OUTPUT_TRUNCATED'
            );
          }

          return {
            answer:
              'The bounded claim must remain separate from inference. This response does not invent external observations, tool use or verification. Evidence would be required before any substantive external claim could be promoted to established fact.',

            claims: [
              'Evidence is required before treating an external claim as established.'
            ],

            evidence_refs: [],

            uncertainties: [
              'No external evidence was supplied.'
            ]
          };
        }
      };

    const commons =
      new ModelCommons(
        flakyRuntime
      );

    commons.register({
      model_id:
        'flaky-reasoner',

      name:
        'Flaky local reasoner',

      runtime:
        'flaky-local',

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

    const enrolled =
      runAcademyCycle(
        emptyAcademyState(),
        [
          {
            system_id:
              'SINK-PRIME'
          },
          {
            system_id:
              'SINK-04'
          }
        ],
        '2026-09-19T11:00:00.000Z'
      );

    const result =
      await runNeuralAcademyCycle(
        enrolled.state,
        new AcademyIntelligence(
          commons
        ),
        '2026-09-19T12:00:00.000Z'
      );

    assert.equal(
      result.model_failures.length,
      1
    );

    assert.equal(
      result.attempted,
      1
    );

    assert.equal(
      result.state.submissions.length,
      1
    );

    assert.equal(
      result.state.assignments[0]
        ?.status,
      'ASSIGNED'
    );
  }
);
