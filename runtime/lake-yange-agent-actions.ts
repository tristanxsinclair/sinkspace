import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  LakeYangeStateSchema,
  type Citizen,
  type LakeYangeState,
} from './lake-yange.js';

import {
  AgentActionSchema,
  type AgentDecision,
} from './lake-yange-agent.js';

import {
  LakeYangeAgentWorldStore,
  type LakeYangeAgentWorld,
} from './lake-yange-agent-world.js';

export const AGENT_ACTIONS_SCHEMA_VERSION = 2 as const;

export const AgentActionReceiptSchema = z.object({
  schema_version: z.literal(AGENT_ACTIONS_SCHEMA_VERSION),
  receipt_id: z.string().min(1),
  created_at: z.string().datetime(),
  settlement_id: z.literal('LAKE-YANGE'),
  citizen_id: z.string().min(1),
  action: AgentActionSchema,
  accepted: z.boolean(),
  reason: z.string().min(1).max(2_000),
  state_before_hash: z.string().regex(/^[a-f0-9]{64}$/),
  state_after_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type AgentActionReceipt =
  z.infer<typeof AgentActionReceiptSchema>;

export interface AgentActionExecutionResult {
  state: LakeYangeState;
  world: LakeYangeAgentWorld;
  receipt: AgentActionReceipt;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function stateHash(state: LakeYangeState): string {
  return createHash('sha256')
    .update(canonicalJson(state))
    .digest('hex');
}

function receiptId(input: {
  created_at: string;
  citizen_id: string;
  action: AgentDecision['action'];
  accepted: boolean;
  state_before_hash: string;
  state_after_hash: string;
}): string {
  return createHash('sha256')
    .update(canonicalJson(input))
    .digest('hex');
}

function recordId(prefix: string, input: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(input))
    .digest('hex')
    .slice(0, 24)
    .replace(/^/, `${prefix}-`);
}

function findCitizen(
  state: LakeYangeState,
  citizenId: string,
): Citizen {
  const citizen = state.citizens.find(
    (candidate) => candidate.citizen_id === citizenId,
  );

  if (!citizen) {
    throw new Error(`CITIZEN_NOT_FOUND:${citizenId}`);
  }

  return citizen;
}

function cloneState(
  state: LakeYangeState,
): LakeYangeState {
  return LakeYangeStateSchema.parse(
    JSON.parse(JSON.stringify(state)),
  );
}

function cloneWorld(
  world: LakeYangeAgentWorld,
): LakeYangeAgentWorld {
  return JSON.parse(JSON.stringify(world)) as LakeYangeAgentWorld;
}

function executeActionMutation(
  state: LakeYangeState,
  world: LakeYangeAgentWorld,
  citizenId: string,
  decision: AgentDecision,
  now: string,
): string {
  const citizen = findCitizen(state, citizenId);

  if (citizen.status === 'ARCHIVED') {
    throw new Error('ARCHIVED_CITIZEN_CANNOT_ACT');
  }

  switch (decision.action) {
    case 'OBSERVE': {
      world.observations.push({
        observation_id: recordId('obs', {
          citizenId,
          now,
          objective: decision.objective,
          expectedOutcome: decision.expected_outcome,
        }),
        citizen_id: citizenId,
        created_at: now,
        content: decision.objective,
      });

      return 'OBSERVATION_RECORDED';
    }

    case 'STUDY': {
      world.learning_outcomes.push({
        learning_id: recordId('learn', {
          citizenId,
          now,
          objective: decision.objective,
        }),
        citizen_id: citizenId,
        created_at: now,
        subject: decision.objective,
        outcome: decision.expected_outcome,
      });

      return 'STUDY_RECORDED';
    }

    case 'REST': {
      world.rest_records.push({
        rest_id: recordId('rest', {
          citizenId,
          now,
        }),
        citizen_id: citizenId,
        created_at: now,
      });

      return 'REST_RECORDED';
    }

    case 'PROPOSE_PROJECT': {
      const projectId = recordId('project', {
        citizenId,
        now,
        objective: decision.objective,
      });

      world.project_proposals.push({
        project_id: projectId,
        citizen_id: citizenId,
        created_at: now,
        objective: decision.objective,
        expected_outcome: decision.expected_outcome,
        status: 'PROPOSED',
      });

      return 'PROJECT_PROPOSAL_RECORDED';
    }

    case 'CONTRIBUTE_PROJECT': {
      const latestProject =
        [...world.project_proposals]
          .reverse()
          .find(
            (project) =>
              project.status === 'PROPOSED',
          );

      if (!latestProject) {
        throw new Error(
          'NO_PROJECT_AVAILABLE_FOR_CONTRIBUTION',
        );
      }

      world.project_contributions.push({
        contribution_id: recordId('contribution', {
          citizenId,
          now,
          projectId: latestProject.project_id,
          objective: decision.objective,
        }),
        project_id: latestProject.project_id,
        citizen_id: citizenId,
        created_at: now,
        contribution: decision.expected_outcome,
      });

      return 'PROJECT_CONTRIBUTION_RECORDED';
    }

    default:
      return decision.action satisfies never;
  }
}

export async function executeAgentAction(
  stateInput: LakeYangeState,
  citizenId: string,
  decisionInput: AgentDecision,
  now = new Date().toISOString(),
  worldStore = new LakeYangeAgentWorldStore(),
): Promise<AgentActionExecutionResult> {
  const state = cloneState(stateInput);
  const world = cloneWorld(
    await worldStore.load(),
  );

  const decision = decisionInput;

  AgentActionSchema.parse(
    decision.action,
  );

  const beforeHash =
    stateHash(state);

  let accepted = true;
  let reason: string;

  try {
    reason = executeActionMutation(
      state,
      world,
      citizenId,
      decision,
      now,
    );

    await worldStore.save(world);
  } catch (error) {
    accepted = false;
    reason =
      error instanceof Error
        ? error.message
        : String(error);
  }

  const afterHash =
    stateHash(state);

  const idInput = {
    created_at: now,
    citizen_id: citizenId,
    action: decision.action,
    accepted,
    state_before_hash: beforeHash,
    state_after_hash: afterHash,
  };

  const receipt =
    AgentActionReceiptSchema.parse({
      schema_version:
        AGENT_ACTIONS_SCHEMA_VERSION,
      receipt_id:
        receiptId(idInput),
      created_at: now,
      settlement_id: 'LAKE-YANGE',
      citizen_id: citizenId,
      action: decision.action,
      accepted,
      reason,
      state_before_hash: beforeHash,
      state_after_hash: afterHash,
    });

  return {
    state,
    world,
    receipt,
  };
}
