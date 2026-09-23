import {
  mkdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import {
  FounderMandateSchema,
  type FounderMandate
} from './founder-mandate.js';

const DEFAULT_DIRECTORY =
  '.sink/lake-yange/mandates';

function safeMandateId(
  mandateId: string
): string {
  if (
    !/^LY-MANDATE-[A-Za-z0-9-]+$/
      .test(mandateId)
  ) {
    throw new Error(
      'INVALID_FOUNDER_MANDATE_ID'
    );
  }

  return mandateId;
}

export class FounderMandateStore {
  constructor(
    private readonly directory =
      DEFAULT_DIRECTORY
  ) {}

  private pathFor(
    mandateId: string
  ): string {
    return join(
      this.directory,
      `${safeMandateId(mandateId)}.json`
    );
  }

  async save(
    input: FounderMandate
  ): Promise<void> {
    const mandate =
      FounderMandateSchema.parse(input);

    await mkdir(
      this.directory,
      {
        recursive: true
      }
    );

    const path =
      this.pathFor(
        mandate.mandate_id
      );

    const temporaryPath =
      `${path}.tmp`;

    await writeFile(
      temporaryPath,
      JSON.stringify(
        mandate,
        null,
        2
      ) + '\n',
      {
        encoding: 'utf8',
        mode: 0o600
      }
    );

    await rename(
      temporaryPath,
      path
    );
  }

  async load(
    mandateId: string
  ): Promise<FounderMandate> {
    const raw =
      await readFile(
        this.pathFor(mandateId),
        'utf8'
      );

    return FounderMandateSchema.parse(
      JSON.parse(raw)
    );
  }
}
