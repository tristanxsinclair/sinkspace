import {
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';

import { join } from 'node:path';

import {
  verifyFounderAuthorization,
  type FounderAuthorization
} from './founder-authorization.js';

function safeAuthorizationId(
  id: string
): string {
  if (
    !/^LY-AUTH-[a-f0-9]{32}$/.test(id)
  ) {
    throw new Error(
      'FOUNDER_AUTHORIZATION_ID_INVALID'
    );
  }

  return id;
}

export class FounderAuthorizationStore {
  constructor(
    private readonly root: string
  ) {}

  private pathFor(
    id: string
  ): string {
    return join(
      this.root,
      `${safeAuthorizationId(id)}.json`
    );
  }

  async create(
    authorization:
      FounderAuthorization
  ): Promise<void> {
    const parsed =
      verifyFounderAuthorization(
        authorization
      );

    await mkdir(
      this.root,
      {
        recursive: true,
        mode: 0o700
      }
    );

    await writeFile(
      this.pathFor(
        parsed.authorization_id
      ),
      `${JSON.stringify(
        parsed,
        null,
        2
      )}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,

        /*
         * Constitutional authority artifacts
         * cannot be silently overwritten.
         */
        flag: 'wx'
      }
    );
  }

  async load(
    id: string
  ): Promise<FounderAuthorization> {
    const raw =
      await readFile(
        this.pathFor(id),
        'utf8'
      );

    return verifyFounderAuthorization(
      JSON.parse(raw)
    );
  }
}
