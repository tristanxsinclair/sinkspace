import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LocalEngineeringIntelligence,
  validateEngineeringProposal,
  type LocalModelTransport
} from '../runtime/engineering-intelligence.js';

import {
  EngineeringMissionSchema
} from '../runtime/engineering-mission.js';

test(
  'Forge cognition operates through local transport',
  async () => {
    let called = false;

    const transport:
      LocalModelTransport = {
        name:
          'fixture-local-model',

        async inferStructured(
          input
        ) {
          called = true;

          assert.match(
            input.system,
            /local inference runtime/i
          );

          return {
            summary:
              'Add a bounded status view.',

            mutations: [
              {
                path:
                  'console/lake-yange.js',

                operation:
                  'CREATE',

                content:
                  'export const status = true;\n',

                rationale:
                  'Expose persisted Lake Yange state.'
              }
            ],

            tests_expected: [
              'TypeScript remains valid.'
            ],

            uncertainties: [],

            requires_human_decision:
              false
          };
        }
      };

    const intelligence =
      new LocalEngineeringIntelligence(
        transport
      );

    const mission =
      EngineeringMissionSchema.parse({
        objective:
          'Improve Lake Yange status display.',

        repository_root:
          '/tmp/lake-yange'
      });

    const proposal =
      await intelligence.propose(
        mission,
        [
          {
            path:
              'console/index.html',

            content:
              '<main></main>'
          }
        ]
      );

    assert.equal(
      called,
      true
    );

    assert.equal(
      intelligence.locality,
      'LOCAL'
    );

    assert.equal(
      proposal.mutations[0]?.path,
      'console/lake-yange.js'
    );
  }
);

test(
  'Forge rejects local model mutations outside mission scope',
  () => {
    const mission =
      EngineeringMissionSchema.parse({
        objective:
          'Improve console UI.',

        repository_root:
          '/tmp/lake-yange',

        allowed_paths: [
          'console'
        ]
      });

    assert.throws(
      () =>
        validateEngineeringProposal(
          mission,
          {
            summary:
              'Attempt forbidden mutation.',

            mutations: [
              {
                operation:
                  'REPLACE',

                path:
                  'runtime/security.ts',

                content:
                  'unsafe',

                rationale:
                  'Adversarial fixture.'
              }
            ],

            tests_expected: [],
            uncertainties: [],
            requires_human_decision:
              false
          }
        ),

      /FORGE_PATH_FORBIDDEN/
    );
  }
);

test(
  'Forge rejects duplicate mutation paths',
  () => {
    const mission =
      EngineeringMissionSchema.parse({
        objective:
          'Improve console UI.',

        repository_root:
          '/tmp/lake-yange',

        allowed_paths: [
          'console'
        ],

        max_files_changed:
          2
      });

    assert.throws(
      () =>
        validateEngineeringProposal(
          mission,
          {
            summary:
              'Attempt duplicate writes.',

            mutations: [
              {
                operation:
                  'REPLACE',

                path:
                  'console/app.js',

                content:
                  'one',

                rationale:
                  'First mutation.'
              },
              {
                operation:
                  'REPLACE',

                path:
                  'console/app.js',

                content:
                  'two',

                rationale:
                  'Duplicate mutation.'
              }
            ],

            tests_expected: [],
            uncertainties: [],
            requires_human_decision:
              false
          }
        ),

      /FORGE_DUPLICATE_MUTATION/
    );
  }
);

test(
  'Forge rejects proposals exceeding file budget',
  () => {
    const mission =
      EngineeringMissionSchema.parse({
        objective:
          'Improve console UI.',

        repository_root:
          '/tmp/lake-yange',

        allowed_paths: [
          'console'
        ],

        max_files_changed:
          1
      });

    assert.throws(
      () =>
        validateEngineeringProposal(
          mission,
          {
            summary:
              'Attempt excessive file changes.',

            mutations: [
              {
                operation:
                  'CREATE',

                path:
                  'console/a.js',

                content:
                  'a',

                rationale:
                  'First file.'
              },
              {
                operation:
                  'CREATE',

                path:
                  'console/b.js',

                content:
                  'b',

                rationale:
                  'Second file.'
              }
            ],

            tests_expected: [],
            uncertainties: [],
            requires_human_decision:
              false
          }
        ),

      /FORGE_FILE_LIMIT_EXCEEDED/
    );
  }
);

test(
  'Forge rejects proposals exceeding patch byte budget',
  () => {
    const mission =
      EngineeringMissionSchema.parse({
        objective:
          'Improve console UI.',

        repository_root:
          '/tmp/lake-yange',

        allowed_paths: [
          'console'
        ],

        max_patch_bytes:
          4
      });

    assert.throws(
      () =>
        validateEngineeringProposal(
          mission,
          {
            summary:
              'Attempt oversized mutation.',

            mutations: [
              {
                operation:
                  'CREATE',

                path:
                  'console/a.js',

                content:
                  '12345',

                rationale:
                  'Five byte fixture.'
              }
            ],

            tests_expected: [],
            uncertainties: [],
            requires_human_decision:
              false
          }
        ),

      /FORGE_PATCH_LIMIT_EXCEEDED/
    );
  }
);
