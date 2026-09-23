import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ModelCommons,
  type LocalInferenceRuntime
} from '../runtime/model-commons.js';

import {
  ModelCommonsTransport
} from '../runtime/model-commons-transport.js';

test(
  'Model Commons routes coding work to a local model',
  async () => {
    let invoked = false;

    const runtime:
      LocalInferenceRuntime = {
        name:
          'fixture-runtime',

        async health() {
          return true;
        },

        async inferStructured(
          model,
          request
        ) {
          invoked = true;

          assert.equal(
            model.locality,
            'LOCAL'
          );

          assert.equal(
            request.capability,
            'CODING'
          );

          return {
            result:
              'local'
          };
        }
      };

    const commons =
      new ModelCommons(
        runtime
      );

    commons.register({
      model_id:
        'forge-bootstrap',

      name:
        'Forge Bootstrap',

      runtime:
        'fixture-runtime',

      locality:
        'LOCAL',

      capabilities: [
        'CODING',
        'REASONING'
      ],

      context_tokens:
        8192,

      enabled:
        true,

      loaded:
        true,

      memory_class_gb:
        3,

      endpoint:
        null
    });

    const transport =
      new ModelCommonsTransport(
        commons
      );

    const result =
      await transport
        .inferStructured({
          system:
            'Forge',

          prompt:
            'Implement feature.',

          schema: {}
        });

    assert.equal(
      invoked,
      true
    );

    assert.deepEqual(
      result,
      {
        result:
          'local'
      }
    );
  }
);

test(
  'Model Commons refuses missing capabilities',
  () => {
    const runtime:
      LocalInferenceRuntime = {
        name:
          'fixture-runtime',

        async health() {
          return true;
        },

        async inferStructured() {
          return {};
        }
      };

    const commons =
      new ModelCommons(
        runtime
      );

    assert.throws(
      () =>
        commons.select(
          'VISION'
        ),

      /NO_LOCAL_MODEL/
    );
  }
);

test(
  'Model Commons refuses unhealthy local runtime',
  async () => {
    const runtime:
      LocalInferenceRuntime = {
        name:
          'fixture-runtime',

        async health() {
          return false;
        },

        async inferStructured() {
          throw new Error(
            'should not run'
          );
        }
      };

    const commons =
      new ModelCommons(
        runtime
      );

    commons.register({
      model_id:
        'forge-bootstrap',

      name:
        'Forge Bootstrap',

      runtime:
        'fixture-runtime',

      locality:
        'LOCAL',

      capabilities: [
        'CODING'
      ],

      context_tokens:
        8192,

      enabled:
        true,

      loaded:
        true,

      memory_class_gb:
        3,

      endpoint:
        null
    });

    await assert.rejects(
      () =>
        commons.inferStructured({
          capability:
            'CODING',

          system:
            'Forge',

          prompt:
            'test',

          schema: {}
        }),

      /LOCAL_MODEL_RUNTIME_UNAVAILABLE/
    );
  }
);
