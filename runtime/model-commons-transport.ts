import type {
  LocalModelTransport
} from './engineering-intelligence.js';

import {
  ModelCommons
} from './model-commons.js';

export class ModelCommonsTransport
  implements LocalModelTransport {

  readonly name =
    'lake-yange-model-commons';

  constructor(
    private readonly commons:
      ModelCommons
  ) {}

  async inferStructured(
    input: {
      system: string;
      prompt: string;
      schema: unknown;
    }
  ): Promise<unknown> {
    return this.commons
      .inferStructured({
        capability:
          'CODING',

        system:
          input.system,

        prompt:
          input.prompt,

        schema:
          input.schema,

        max_output_tokens:
          4096,

        temperature:
          0.1
      });
  }
}
