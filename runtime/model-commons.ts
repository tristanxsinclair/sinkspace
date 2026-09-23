import { z } from 'zod';

export const ModelCapabilitySchema =
  z.enum([
    'FAST',
    'REASONING',
    'CODING',
    'RESEARCH',
    'VISION'
  ]);

export type ModelCapability =
  z.infer<
    typeof ModelCapabilitySchema
  >;

export const LocalModelSchema =
  z.object({
    model_id:
      z.string().min(1),

    name:
      z.string().min(1),

    runtime:
      z.string().min(1),

    locality:
      z.literal('LOCAL'),

    capabilities:
      z.array(
        ModelCapabilitySchema
      ).min(1),

    context_tokens:
      z.number()
        .int()
        .positive(),

    enabled:
      z.boolean(),

    loaded:
      z.boolean(),

    memory_class_gb:
      z.number()
        .positive(),

    endpoint:
      z.string()
        .min(1)
        .nullable()
  })
  .strict();

export type LocalModel =
  z.infer<
    typeof LocalModelSchema
  >;

export const ModelRequestSchema =
  z.object({
    capability:
      ModelCapabilitySchema,

    system:
      z.string()
        .max(50_000),

    prompt:
      z.string()
        .max(500_000),

    schema:
      z.unknown(),

    max_output_tokens:
      z.number()
        .int()
        .min(1)
        .max(16_384)
        .default(4096),

    temperature:
      z.number()
        .min(0)
        .max(2)
        .default(0.1)
  })
  .strict();

export type ModelRequest =
  z.infer<
    typeof ModelRequestSchema
  >;

export type ModelRequestInput =
  z.input<
    typeof ModelRequestSchema
  >;

export interface LocalInferenceRuntime {
  readonly name: string;

  health(): Promise<boolean>;

  inferStructured(
    model:
      LocalModel,

    request:
      ModelRequest
  ): Promise<unknown>;
}

export class ModelCommons {
  private readonly models =
    new Map<
      string,
      LocalModel
    >();

  constructor(
    private readonly runtime:
      LocalInferenceRuntime
  ) {}

  register(
    modelInput:
      LocalModel
  ): void {
    const model =
      LocalModelSchema.parse(
        modelInput
      );

    if (
      model.runtime !==
      this.runtime.name
    ) {
      throw new Error(
        'MODEL_RUNTIME_MISMATCH'
      );
    }

    this.models.set(
      model.model_id,
      model
    );
  }

  list():
    LocalModel[] {
    return [
      ...this.models.values()
    ].map(
      model => ({
        ...model,
        capabilities: [
          ...model.capabilities
        ]
      })
    );
  }

  select(
    capability:
      ModelCapability
  ): LocalModel {
    const candidates =
      this.list()
        .filter(
          model =>
            model.enabled &&
            model.capabilities
              .includes(
                capability
              )
        )
        .sort(
          (a, b) =>
            a.memory_class_gb -
              b.memory_class_gb ||
            a.model_id.localeCompare(
              b.model_id
            )
        );

    const selected =
      candidates[0];

    if (!selected) {
      throw new Error(
        `NO_LOCAL_MODEL_FOR_CAPABILITY:${capability}`
      );
    }

    return selected;
  }

  async inferStructured(
    requestInput:
      ModelRequestInput
  ): Promise<unknown> {
    const request =
      ModelRequestSchema.parse(
        requestInput
      );

    const healthy =
      await this.runtime.health();

    if (!healthy) {
      throw new Error(
        'LOCAL_MODEL_RUNTIME_UNAVAILABLE'
      );
    }

    const model =
      this.select(
        request.capability
      );

    return this.runtime
      .inferStructured(
        model,
        request
      );
  }
}
