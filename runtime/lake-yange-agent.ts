import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  ModelCommons,
  type ModelCapability
} from './model-commons.js';

import {
  LakeYangeStateSchema,
  type Citizen,
  type LakeYangeState
} from './lake-yange.js';

const AGENT_SCHEMA_VERSION = 1 as const;

export const AgentActionSchema = z.enum([
  'OBSERVE',
  'STUDY',
  'REST',
  'PROPOSE_PROJECT',
  'CONTRIBUTE_PROJECT'
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

export const AgentDecisionSchema = z.object({
  action: AgentActionSchema,
  reason: z.string().min(1).max(2_000),
  objective: z.string().min(1).max(2_000),
  expected_outcome: z.string().min(1).max(2_000),
  capability_used: z.string().min(1).max(100),
  confidence: z.number().min(0).max(1)
}).strict();

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export const AgentMemorySchema = z.object({
  memory_id: z.string().min(1),
  created_at: z.string().datetime(),
  kind: z.enum([
    'OBSERVATION',
    'DECISION',
    'OUTCOME',
    'LESSON'
  ]),
  summary: z.string().min(1).max(4_000),
  evidence_ids: z.array(z.string()).max(32)
}).strict();

export type AgentMemory = z.infer<typeof AgentMemorySchema>;

export const AgentStateSchema = z.object({
  schema_version: z.literal(AGENT_SCHEMA_VERSION),
  citizen_id: z.string().min(1),
  wake_count: z.number().int().min(0),
  last_wake_at: z.string().datetime().nullable(),
  last_action: AgentActionSchema.nullable(),
  memories: z.array(AgentMemorySchema).max(100),
  decisions: z.array(AgentDecisionSchema).max(50)
}).strict();

export type AgentState = z.infer<typeof AgentStateSchema>;

export const AgentRuntimeStateSchema = z.object({
  schema_version: z.literal(AGENT_SCHEMA_VERSION),
  settlement_id: z.literal('LAKE-YANGE'),
  updated_at: z.string().datetime(),
  agents: z.array(AgentStateSchema)
}).strict();

export type AgentRuntimeState = z.infer<typeof AgentRuntimeStateSchema>;

export interface AgentWorldObservation {
  citizen: Citizen;
  population: number;
  generation: number;
  available_actions: AgentAction[];
  recent_memories: AgentMemory[];
}

export interface AgentRunResult {
  citizen_id: string;
  decision: AgentDecision;
  accepted: boolean;
  reason: string;
  receipt_id: string;
}

const DEFAULT_PATH =
  '.sink/lake-yange/agents/state.json';

function hashReceipt(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24);
}

function memoryId(
  citizenId: string,
  now: string,
  summary: string
): string {
  return `LY-MEM-${hashReceipt({
    citizenId,
    now,
    summary
  })}`;
}

export class LakeYangeAgentStore {
  constructor(
    private readonly path = DEFAULT_PATH
  ) {}

  async load(): Promise<AgentRuntimeState> {
    try {
      const raw = await readFile(this.path, 'utf8');

      return AgentRuntimeStateSchema.parse(
        JSON.parse(raw)
      );
    } catch (error) {
      const code =
        error instanceof Error &&
        'code' in error
          ? error.code
          : undefined;

      if (code !== 'ENOENT') {
        throw error;
      }

      return {
        schema_version: AGENT_SCHEMA_VERSION,
        settlement_id: 'LAKE-YANGE',
        updated_at: new Date(0).toISOString(),
        agents: []
      };
    }
  }

  async save(
    state: AgentRuntimeState
  ): Promise<void> {
    const validated =
      AgentRuntimeStateSchema.parse(state);

    await mkdir(
      dirname(this.path),
      { recursive: true }
    );

    const temporaryPath =
      `${this.path}.tmp`;

    await writeFile(
      temporaryPath,
      JSON.stringify(
        validated,
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
      this.path
    );
  }
}

export class LakeYangeAgentRuntime {
  constructor(
    private readonly commons: ModelCommons,
    private readonly store =
      new LakeYangeAgentStore()
  ) {}

  private async ensureAgent(
    citizen: Citizen,
    now: string
  ): Promise<AgentRuntimeState> {
    const state = await this.store.load();

    const existing = state.agents.find(
      agent =>
        agent.citizen_id === citizen.citizen_id
    );

    if (existing) {
      return state;
    }

    state.agents.push({
      schema_version: AGENT_SCHEMA_VERSION,
      citizen_id: citizen.citizen_id,
      wake_count: 0,
      last_wake_at: null,
      last_action: null,
      memories: [],
      decisions: []
    });

    state.updated_at = now;

    await this.store.save(state);

    return state;
  }

  async think(
    lake: LakeYangeState,
    citizenId: string,
    now = new Date().toISOString()
  ): Promise<AgentRunResult> {
    const canonical =
      LakeYangeStateSchema.parse(lake);

    const citizen =
      canonical.citizens.find(
        candidate =>
          candidate.citizen_id === citizenId
      );

    if (!citizen) {
      throw new Error(
        `UNKNOWN_LAKE_YANGE_CITIZEN:${citizenId}`
      );
    }

    const state =
      await this.ensureAgent(
        citizen,
        now
      );

    const agent =
      state.agents.find(
        candidate =>
          candidate.citizen_id === citizenId
      );

    if (!agent) {
      throw new Error(
        `AGENT_STATE_MISSING:${citizenId}`
      );
    }

    const recentMemories =
      agent.memories.slice(-8);

    const observation:
      AgentWorldObservation = {
      citizen,
      population: canonical.citizens.length,
      generation: canonical.generation,
      available_actions: [
        'OBSERVE',
        'STUDY',
        'REST',
        'PROPOSE_PROJECT',
        'CONTRIBUTE_PROJECT'
      ],
      recent_memories: recentMemories
    };

    const capability:
      ModelCapability =
      citizen.genome.model_policy
        .preferred_capabilities
        .includes('REASONING')
        ? 'REASONING'
        : 'FAST';

    const raw =
      await this.commons.inferStructured({
        capability,
        system: [
          'You are a citizen cognition process inside',
          'the Lake Yange simulation.',
          '',
          'You may reason about the simulated world only.',
          'You cannot control the host machine.',
          'You cannot spend money.',
          'You cannot send communications.',
          'You cannot access secrets.',
          'You cannot modify governance.',
          'You cannot delegate authority.',
          'You cannot reproduce autonomously.',
          '',
          'Return exactly one structured decision.'
        ].join('\n'),
        prompt: JSON.stringify({
          observation,
          rules: {
            choose_one_action: true,
            actions_are_simulated_only: true,
            confidence_between_zero_and_one: true
          }
        }),
        schema: AgentDecisionSchema.toJSONSchema(),
        max_output_tokens: 700,
        temperature: 0.2
      });

    const decision =
      AgentDecisionSchema.parse(raw);

    const accepted =
      this.validateDecision(
        citizen,
        decision
      );

    const reason =
      accepted
        ? 'DECISION_ACCEPTED'
        : 'DECISION_REJECTED_BY_POLICY';

    const receiptInput = {
      citizen_id: citizenId,
      now,
      decision,
      accepted,
      reason
    };

    const receipt_id =
      `LY-AGENT-${hashReceipt(receiptInput)}`;

    agent.wake_count += 1;
    agent.last_wake_at = now;
    agent.last_action =
      accepted
        ? decision.action
        : 'OBSERVE';

    agent.decisions.push(decision);

    if (agent.decisions.length > 50) {
      agent.decisions =
        agent.decisions.slice(-50);
    }

    agent.memories.push({
      memory_id: memoryId(
        citizenId,
        now,
        decision.reason
      ),
      created_at: now,
      kind: 'DECISION',
      summary:
        `${decision.action}: ${decision.reason}`,
      evidence_ids: [receipt_id]
    });

    if (agent.memories.length > 100) {
      agent.memories =
        agent.memories.slice(-100);
    }

    state.updated_at = now;

    await this.store.save(state);

    return {
      citizen_id: citizenId,
      decision,
      accepted,
      reason,
      receipt_id
    };
  }

  private validateDecision(
    citizen: Citizen,
    decision: AgentDecision
  ): boolean {
    if (
      !citizen.genome
        .model_policy
        .preferred_capabilities
        .includes(
          decision.capability_used as never
        )
    ) {
      return false;
    }

    if (
      decision.action ===
        'CONTRIBUTE_PROJECT' &&
      citizen.rank === 'TRAINEE'
    ) {
      return false;
    }

    if (
      decision.action ===
        'PROPOSE_PROJECT' &&
      citizen.status !== 'ACTIVE'
    ) {
      return false;
    }

    return true;
  }
}
