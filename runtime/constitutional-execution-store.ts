import {
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';

import { join } from 'node:path';

import {
  verifyExecutionClaim,
  verifyExecutionResult,
  type ConstitutionalExecutionClaim,
  type ConstitutionalExecutionResult
} from './constitutional-execution.js';

export class ConstitutionalExecutionStore {
  constructor(
    private readonly root: string
  ) {}

  private claimsRoot(): string {
    return join(
      this.root,
      'claims'
    );
  }

  private resultsRoot(): string {
    return join(
      this.root,
      'results'
    );
  }

  async createClaim(
    claim:
      ConstitutionalExecutionClaim
  ): Promise<void> {
    const parsed =
      verifyExecutionClaim(
        claim
      );

    const root =
      this.claimsRoot();

    await mkdir(
      root,
      {
        recursive: true,
        mode: 0o700
      }
    );

    await writeFile(
      join(
        root,
        `${parsed.claim_id}.json`
      ),
      `${JSON.stringify(
        parsed,
        null,
        2
      )}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      }
    );
  }

  async loadClaim(
    claimId: string
  ): Promise<ConstitutionalExecutionClaim> {
    if (
      !/^LY-CLAIM-[a-f0-9]{32}$/.test(
        claimId
      )
    ) {
      throw new Error(
        'CONSTITUTIONAL_CLAIM_ID_INVALID'
      );
    }

    const raw =
      await readFile(
        join(
          this.claimsRoot(),
          `${claimId}.json`
        ),
        'utf8'
      );

    return verifyExecutionClaim(
      JSON.parse(raw)
    );
  }

  async createResult(
    result:
      ConstitutionalExecutionResult
  ): Promise<void> {
    const parsed =
      verifyExecutionResult(
        result
      );

    const root =
      this.resultsRoot();

    await mkdir(
      root,
      {
        recursive: true,
        mode: 0o700
      }
    );

    await writeFile(
      join(
        root,
        `${parsed.result_id}.json`
      ),
      `${JSON.stringify(
        parsed,
        null,
        2
      )}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      }
    );
  }
}
