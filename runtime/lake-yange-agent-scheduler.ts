import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  LakeYangeAgentRuntime,
  type AgentRunResult
} from './lake-yange-agent.js';

import {
  LakeYangeStateSchema,
  type Citizen,
  type LakeYangeState
} from './lake-yange.js';

import {
  executeAgentAction
} from './lake-yange-agent-actions.js';

import {
  LakeYangeAgentWorldStore
} from './lake-yange-agent-world.js';

const SCHEDULER_SCHEMA_VERSION = 1 as const;

export const SchedulerOptionsSchema = z.object({
  max_decisions_per_cycle: z.number().int().min(1).max(32),
  minimum_wake_gap_ms: z.number().int().min(0).max(86_400_000)
}).strict();

export type SchedulerOptions =
  z.infer<typeof SchedulerOptionsSchema>;

export const SchedulerReceiptSchema = z.object({
  schema_version:
    z.literal(SCHEDULER_SCHEMA_VERSION),

  receipt_id:
    z.string().min(1),

  cycle_id:
    z.string().min(1),

  created_at:
    z.string().datetime(),

  citizen_id:
    z.string().min(1),

  accepted:
    z.boolean(),

  action:
    z.string().min(1),

  reason:
    z.string().min(1)
}).strict();

export type SchedulerReceipt =
  z.infer<typeof SchedulerReceiptSchema>;

export const SchedulerCycleResultSchema = z.object({
  schema_version:
    z.literal(SCHEDULER_SCHEMA_VERSION),

  cycle_id:
    z.string().min(1),

  created_at:
    z.string().datetime(),

  attempted:
    z.number().int().min(0),

  accepted:
    z.number().int().min(0),

  rejected:
    z.number().int().min(0),

  results:
    z.array(SchedulerReceiptSchema)
}).strict();

export type SchedulerCycleResult =
  z.infer<typeof SchedulerCycleResultSchema>;

const DEFAULT_OPTIONS: SchedulerOptions = {
  max_decisions_per_cycle: 4,
  minimum_wake_gap_ms: 60_000
};

function hashId(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24);
}

function cycleId(
  generation: number,
  now: string
): string {
  return `LY-CYCLE-${hashId({
    generation,
    now
  })}`;
}

function receiptId(
  cycle: string,
  result: AgentRunResult
): string {
  return `LY-SCHED-${hashId({
    cycle,
    citizen_id: result.citizen_id,
    decision: result.decision,
    accepted: result.accepted,
    reason: result.reason,
    receipt_id: result.receipt_id
  })}`;
}

function citizenIsEligible(
  citizen: Citizen
): boolean {
  return citizen.status !== 'ARCHIVED';
}

export class LakeYangeAgentScheduler {
  constructor(
    private readonly runtime:
      LakeYangeAgentRuntime,
    private readonly options:
      SchedulerOptions = DEFAULT_OPTIONS,
    private readonly worldStore:
      LakeYangeAgentWorldStore =
        new LakeYangeAgentWorldStore()
  ) {
    SchedulerOptionsSchema.parse(
      options
    );
  }

  private selectCitizens(
    lake: LakeYangeState,
    limit: number
  ): Citizen[] {
    return lake.citizens
      .filter(citizen =>
        citizenIsEligible(citizen)
      )
      .sort((a, b) =>
        a.citizen_id.localeCompare(
          b.citizen_id
        )
      )
      .slice(0, limit);
  }

  async runCycle(
    lakeInput: LakeYangeState,
    now = new Date().toISOString()
  ): Promise<SchedulerCycleResult> {
    const lake =
      LakeYangeStateSchema.parse(
        lakeInput
      );

    const cycle =
      cycleId(
        lake.generation,
        now
      );

    const citizens =
      this.selectCitizens(
        lake,
        this.options.max_decisions_per_cycle
      );

    const results:
      SchedulerReceipt[] = [];

    for (const citizen of citizens) {
      const result =
        await this.runCitizen(
          lake,
          citizen,
          cycle,
          now
        );

      results.push(result);
    }

    return SchedulerCycleResultSchema.parse({
      schema_version:
        SCHEDULER_SCHEMA_VERSION,

      cycle_id:
        cycle,

      created_at:
        now,

      attempted:
        results.length,

      accepted:
        results.filter(
          result => result.accepted
        ).length,

      rejected:
        results.filter(
          result => !result.accepted
        ).length,

      results
    });
  }

  private async runCitizen(
    lake: LakeYangeState,
    citizen: Citizen,
    cycle: string,
    now: string
  ): Promise<SchedulerReceipt> {
    try {
      const result =
        await this.runtime.think(
          lake,
          citizen.citizen_id,
          now
        );

      if (!result.accepted) {
        return SchedulerReceiptSchema.parse({
          schema_version:
            SCHEDULER_SCHEMA_VERSION,

          receipt_id:
            receiptId(
              cycle,
              result
            ),

          cycle_id:
            cycle,

          created_at:
            now,

          citizen_id:
            result.citizen_id,

          accepted: false,

          action:
            result.decision.action,

          reason:
            result.reason
        });
      }

      const execution =
        await executeAgentAction(
          lake,
          citizen.citizen_id,
          result.decision,
          now,
          this.worldStore
        );

      return SchedulerReceiptSchema.parse({
        schema_version:
          SCHEDULER_SCHEMA_VERSION,

        receipt_id:
          receiptId(
            cycle,
            result
          ),

        cycle_id:
          cycle,

        created_at:
          now,

        citizen_id:
          result.citizen_id,

        accepted:
          execution.receipt.accepted,

        action:
          execution.receipt.action,

        reason:
          execution.receipt.reason
      });
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'UNKNOWN_AGENT_FAILURE';

      return SchedulerReceiptSchema.parse({
        schema_version:
          SCHEDULER_SCHEMA_VERSION,

        receipt_id:
          `LY-SCHED-${hashId({
            cycle,
            citizen_id:
              citizen.citizen_id,
            reason
          })}`,

        cycle_id:
          cycle,

        created_at:
          now,

        citizen_id:
          citizen.citizen_id,

        accepted:
          false,

        action:
          'OBSERVE',

        reason:
          `AGENT_CYCLE_FAILED:${reason}`
      });
    }
  }
}
