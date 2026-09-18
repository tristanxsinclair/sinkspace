import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LlamaCppLocalRuntime
} from '../runtime/llama-cpp-local-runtime.js';

test(
  'llama.cpp runtime refuses non-loopback endpoints',
  () => {
    assert.throws(
      () =>
        new LlamaCppLocalRuntime({
          baseUrl:
            'https://example.com'
        }),

      /LOCAL_RUNTIME_LOOPBACK_REQUIRED/
    );
  }
);

test(
  'llama.cpp runtime accepts loopback',
  () => {
    const runtime =
      new LlamaCppLocalRuntime({
        baseUrl:
          'http://127.0.0.1:18181'
      });

    assert.equal(
      runtime.name,
      'llama.cpp'
    );
  }
);

test(
  'llama.cpp runtime sends schema as constrained response format',
  async () => {
    let capturedBody:
      unknown = null;

    const fakeFetch =
      async (
        input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        const url =
          String(input);

        if (
          url.endsWith(
            '/v1/chat/completions'
          )
        ) {
          capturedBody =
            JSON.parse(
              String(
                init?.body
              )
            );

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '{"value":"PASS"}'
                  }
                }
              ]
            }),
            {
              status:
                200,

              headers: {
                'content-type':
                  'application/json'
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            status:
              'ok'
          }),
          {
            status:
              200,

            headers: {
              'content-type':
                'application/json'
            }
          }
        );
      };

    const runtime =
      new LlamaCppLocalRuntime({
        baseUrl:
          'http://127.0.0.1:18181',

        fetchImpl:
          fakeFetch as typeof fetch
      });

    const schema = {
      type:
        'object',

      additionalProperties:
        false,

      required: [
        'value'
      ],

      properties: {
        value: {
          type:
            'string',

          enum: [
            'PASS'
          ]
        }
      }
    };

    const result =
      await runtime.inferStructured(
        {
          model_id:
            'fixture-model',

          name:
            'Fixture',

          runtime:
            'llama.cpp',

          locality:
            'LOCAL',

          capabilities: [
            'CODING'
          ],

          context_tokens:
            4096,

          enabled:
            true,

          loaded:
            true,

          memory_class_gb:
            3,

          endpoint:
            'http://127.0.0.1:18181'
        },

        {
          capability:
            'CODING',

          system:
            'Fixture.',

          prompt:
            'Return PASS.',

          schema,

          max_output_tokens:
            100,

          temperature:
            0
        }
      );

    const body =
      capturedBody as {
        response_format?: {
          type?: unknown;

          json_schema?: {
            strict?: unknown;
            schema?: unknown;
          };
        };

        messages?: Array<{
          content?: unknown;
        }>;
      };

    assert.equal(
      body.response_format?.type,
      'json_schema'
    );

    assert.equal(
      body.response_format
        ?.json_schema
        ?.strict,
      true
    );

    assert.deepEqual(
      body.response_format
        ?.json_schema
        ?.schema,
      schema
    );

    const userPrompt =
      String(
        body.messages?.[1]
          ?.content ??
        ''
      );

    assert.equal(
      userPrompt.includes(
        JSON.stringify(
          schema
        )
      ),
      false
    );

    assert.deepEqual(
      result,
      {
        value:
          'PASS'
      }
    );
  }
);

test(
  'llama.cpp runtime identifies output truncated by token limit',
  async () => {
    const fakeFetch =
      async (
        input: string | URL | Request
      ): Promise<Response> => {
        const url =
          String(input);

        if (
          url.endsWith(
            '/v1/chat/completions'
          )
        ) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason:
                    'length',

                  message: {
                    content:
                      '{"value":"incomplete'
                  }
                }
              ]
            }),
            {
              status: 200,
              headers: {
                'content-type':
                  'application/json'
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            status: 'ok'
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json'
            }
          }
        );
      };

    const runtime =
      new LlamaCppLocalRuntime({
        baseUrl:
          'http://127.0.0.1:18181',

        fetchImpl:
          fakeFetch as typeof fetch
      });

    await assert.rejects(
      runtime.inferStructured(
        {
          model_id:
            'fixture-model',

          name:
            'Fixture',

          runtime:
            'llama.cpp',

          locality:
            'LOCAL',

          capabilities: [
            'CODING'
          ],

          context_tokens:
            4096,

          enabled:
            true,

          loaded:
            true,

          memory_class_gb:
            3,

          endpoint:
            'http://127.0.0.1:18181'
        },

        {
          capability:
            'CODING',

          system:
            'Fixture.',

          prompt:
            'Return structured data.',

          schema: {
            type:
              'object'
          },

          max_output_tokens:
            100,

          temperature:
            0
        }
      ),

      /LOCAL_MODEL_OUTPUT_TRUNCATED/
    );
  }
);

test(
  'llama.cpp runtime distinguishes malformed completed JSON',
  async () => {
    const fakeFetch =
      async (
        input: string | URL | Request
      ): Promise<Response> => {
        const url =
          String(input);

        if (
          url.endsWith(
            '/v1/chat/completions'
          )
        ) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason:
                    'stop',

                  message: {
                    content:
                      '{"value":"malformed'
                  }
                }
              ]
            }),
            {
              status: 200,
              headers: {
                'content-type':
                  'application/json'
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            status: 'ok'
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json'
            }
          }
        );
      };

    const runtime =
      new LlamaCppLocalRuntime({
        baseUrl:
          'http://127.0.0.1:18181',

        fetchImpl:
          fakeFetch as typeof fetch
      });

    await assert.rejects(
      runtime.inferStructured(
        {
          model_id:
            'fixture-model',

          name:
            'Fixture',

          runtime:
            'llama.cpp',

          locality:
            'LOCAL',

          capabilities: [
            'CODING'
          ],

          context_tokens:
            4096,

          enabled:
            true,

          loaded:
            true,

          memory_class_gb:
            3,

          endpoint:
            'http://127.0.0.1:18181'
        },

        {
          capability:
            'CODING',

          system:
            'Fixture.',

          prompt:
            'Return structured data.',

          schema: {
            type:
              'object'
          },

          max_output_tokens:
            100,

          temperature:
            0
        }
      ),

      /LOCAL_MODEL_INVALID_JSON/
    );
  }
);
