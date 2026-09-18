import {
  type LocalInferenceRuntime,
  type LocalModel,
  type ModelRequest
} from './model-commons.js';

type FetchLike =
  typeof fetch;

function extractJson(
  text: string
): unknown {
  const trimmed =
    text.trim();

  try {
    return JSON.parse(
      trimmed
    );
  } catch {
    // Continue to bounded extraction.
  }

  const fenced =
    trimmed.match(
      /```(?:json)?\s*([\s\S]*?)```/i
    );

  if (fenced?.[1]) {
    return JSON.parse(
      fenced[1].trim()
    );
  }

  const start =
    trimmed.indexOf('{');

  const end =
    trimmed.lastIndexOf('}');

  if (
    start >= 0 &&
    end > start
  ) {
    return JSON.parse(
      trimmed.slice(
        start,
        end + 1
      )
    );
  }

  throw new Error(
    'LOCAL_MODEL_INVALID_JSON'
  );
}

export class LlamaCppLocalRuntime
  implements LocalInferenceRuntime {

  readonly name =
    'llama.cpp';

  private readonly baseUrl:
    string;

  constructor(
    options: {
      baseUrl?:
        string;

      timeoutMs?:
        number;

      fetchImpl?:
        FetchLike;
    } = {}
  ) {
    this.baseUrl =
      options.baseUrl ??
      'http://127.0.0.1:18181';

    this.timeoutMs =
      options.timeoutMs ??
      60_000;

    this.fetchImpl =
      options.fetchImpl ??
      fetch;

    const parsed =
      new URL(
        this.baseUrl
      );

    if (
      parsed.protocol !==
        'http:' ||
      (
        parsed.hostname !==
          '127.0.0.1' &&
        parsed.hostname !==
          'localhost'
      )
    ) {
      throw new Error(
        'LOCAL_RUNTIME_LOOPBACK_REQUIRED'
      );
    }
  }

  private readonly timeoutMs:
    number;

  private readonly fetchImpl:
    FetchLike;

  async health():
    Promise<boolean> {
    try {
      const response =
        await this.fetchImpl(
          `${this.baseUrl}/health`,
          {
            signal:
              AbortSignal.timeout(
                3_000
              )
          }
        );

      if (!response.ok) {
        return false;
      }

      const body =
        await response.json()
          .catch(
            () => null
          ) as {
            status?: unknown;
          } | null;

      return (
        body?.status ===
        'ok'
      );
    } catch {
      return false;
    }
  }

  async inferStructured(
    model:
      LocalModel,

    request:
      ModelRequest
  ): Promise<unknown> {
    if (
      model.locality !==
      'LOCAL'
    ) {
      throw new Error(
        'NON_LOCAL_MODEL_REJECTED'
      );
    }

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        this.timeoutMs
      );

    try {
      const response =
        await this.fetchImpl(
          `${this.baseUrl}/v1/chat/completions`,
          {
            method:
              'POST',

            headers: {
              'content-type':
                'application/json'
            },

            body:
              JSON.stringify({
                model:
                  model.model_id,

                messages: [
                  {
                    role:
                      'system',

                    content:
                      request.system
                  },
                  {
                    role:
                      'user',

                    content: [
                      request.prompt,
                      '',
                      'OUTPUT CONTRACT',
                      'Return the requested structured data.',
                      'Do not describe the schema.',
                      'Do not claim verification occurred.'
                    ].join('\n')
                  }
                ],

                temperature:
                  request.temperature,

                max_tokens:
                  request.max_output_tokens,

                stream:
                  false,

                response_format: {
                  type:
                    'json_schema',

                  json_schema: {
                    name:
                      'lake_yange_structured_output',

                    strict:
                      true,

                    schema:
                      request.schema
                  }
                }
              }),

            signal:
              controller.signal
          }
        );

      if (!response.ok) {
        const detail =
          await response.text()
            .catch(
              () => ''
            );

        throw new Error(
          `LOCAL_MODEL_HTTP_${response.status}:${detail.slice(0, 500)}`
        );
      }

      const body =
        await response.json() as {
          choices?: Array<{
            finish_reason?: unknown;
            message?: {
              content?: unknown;
            };
          }>;
        };

      const choice =
        body.choices?.[0];

      const content =
        choice?.message
          ?.content;

      const finishReason =
        choice?.finish_reason;

      if (
        typeof content !==
          'string' ||
        !content.trim()
      ) {
        throw new Error(
          'LOCAL_MODEL_EMPTY_RESPONSE'
        );
      }

      if (
        finishReason ===
          'length'
      ) {
        throw new Error(
          'LOCAL_MODEL_OUTPUT_TRUNCATED'
        );
      }

      try {
        return extractJson(
          content
        );
      } catch {
        throw new Error(
          'LOCAL_MODEL_INVALID_JSON'
        );
      }
    } finally {
      clearTimeout(
        timer
      );
    }
  }
}
