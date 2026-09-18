import {
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';

import { join } from 'node:path';

import {
  ConstitutionalPlanSchema,
  constitutionalProposalDigest,
  type ConstitutionalPlan
} from './constitutional-plan.js';

function safePlanId(id: string): string {
  if (!/^LY-PLAN-[A-Za-z0-9-]+$/.test(id)) {
    throw new Error(
      'CONSTITUTIONAL_PLAN_ID_INVALID'
    );
  }

  return id;
}

export class ConstitutionalPlanStore {
  constructor(
    private readonly root: string
  ) {}

  private pathFor(id: string): string {
    return join(
      this.root,
      `${safePlanId(id)}.json`
    );
  }

  async create(
    plan: ConstitutionalPlan
  ): Promise<void> {
    const parsed =
      ConstitutionalPlanSchema.parse(plan);

    const expectedDigest =
      constitutionalProposalDigest({
        mandate_id: parsed.mandate_id,
        proposal_id: parsed.proposal_id,
        title: parsed.title,
        objective: parsed.objective,
        target_system: parsed.target_system,
        inspected_state: parsed.inspected_state
      });

    if (
      expectedDigest !==
      parsed.proposal_digest
    ) {
      throw new Error(
        'CONSTITUTIONAL_PLAN_DIGEST_INVALID'
      );
    }

    await mkdir(this.root, {
      recursive: true,
      mode: 0o700
    });

    await writeFile(
      this.pathFor(parsed.plan_id),
      `${JSON.stringify(parsed, null, 2)}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      }
    );
  }

  async load(
    id: string
  ): Promise<ConstitutionalPlan> {
    const raw =
      await readFile(
        this.pathFor(id),
        'utf8'
      );

    const parsed =
      ConstitutionalPlanSchema.parse(
        JSON.parse(raw)
      );

    const expectedDigest =
      constitutionalProposalDigest({
        mandate_id: parsed.mandate_id,
        proposal_id: parsed.proposal_id,
        title: parsed.title,
        objective: parsed.objective,
        target_system: parsed.target_system,
        inspected_state: parsed.inspected_state
      });

    if (
      expectedDigest !==
      parsed.proposal_digest
    ) {
      throw new Error(
        'CONSTITUTIONAL_PLAN_DIGEST_INVALID'
      );
    }

    return parsed;
  }
}
