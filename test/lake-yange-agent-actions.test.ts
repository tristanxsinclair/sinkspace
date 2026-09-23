import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AgentActionReceiptSchema,
  executeAgentAction as executeAgentActionInternal,
} from '../runtime/lake-yange-agent-actions.js';
import {
  LakeYangeStateSchema,
  type LakeYangeState,
} from '../runtime/lake-yange.js';
import {
  AgentDecisionSchema,
  type AgentDecision,
} from '../runtime/lake-yange-agent.js';

async function executeAgentAction(
  ...args: Parameters<typeof executeAgentActionInternal>
): ReturnType<typeof executeAgentActionInternal> {
  const directory = await mkdtemp(join(tmpdir(), 'lake-yange-agent-action-'));
  const worldStore = new LakeYangeAgentWorldStore(
    join(directory, 'world.json')
  );

  return executeAgentActionInternal(
    args[0],
    args[1],
    args[2],
    args[3],
    worldStore
  );
}

import { LakeYangeAgentWorldStore } from '../runtime/lake-yange-agent-world.js';

function testLake(): LakeYangeState {
  const now = '2026-09-21T00:00:00.000Z';

  return LakeYangeStateSchema.parse({
    schema_version: 1,
    settlement_id: 'LAKE-YANGE',
    founded_at: now,
    generation: 0,
    population_limit: 64,
    trainee_limit: 32,
    births_total: 0,
    admissions_total: 1,
    archived_total: 0,
    citizens: [
      {
        schema_version: 1,
        citizen_id: 'citizen-test-001',
        name: 'Test Citizen',
        system_id: 'system-test-001',
        role: 'RESEARCHER',
        rank: 'TRAINEE',
        status: 'ACTIVE',
        home: 'ACADEMY',
        born_at: now,
        genome: {
          genome_version: 1,
          traits: {
            research: 0.8,
            coding: 0.7,
            verification: 0.8,
            commercial: 0.5,
            planning: 0.7,
            adversarial: 0.6,
            ux: 0.6,
            orchestration: 0.7,
          },
          capabilities: [],
          strategies: [
            {
              id: 'test-strategy',
              description: 'Use bounded evidence-driven reasoning for test missions.',
              source: 'TRAINING',
            },
          ],
          model_policy: {
            preferred_capabilities: ['REASONING'],
            max_cost_usd_per_mission: 0,
            allowed_sensitivity: 'INTERNAL',
          },
          tool_policy: {
            allowed_tools: [],
            denied_tools: [],
          },
        },
        lineage: {
          generation: 0,
          parents: [],
          ancestry: [],
          birth_reason: 'TEST',
          mutation_notes: [],
        },
        authority: {
          read_repository: false,
          modify_repository: false,
          run_local_commands: false,
          use_public_network: false,
          create_branch: false,
          create_commit: false,
          deploy_production: false,
          spend_money: false,
          access_secrets: false,
          contact_external_people: false,
          destructive_operations: false,
          modify_authority_kernel: false,
          grant_authority: false,
        },
        fitness_history: [],
        missions_completed: 0,
        missions_failed: 0,
        admitted_at: now,
        archived_at: null,
      },
    ],
  });
}

function decision(action: AgentDecision['action']): AgentDecision {
  return AgentDecisionSchema.parse({
    action,
    reason: 'bounded test decision',
    objective: 'perform a simulated civilisation action',
    expected_outcome: 'record a bounded outcome',
    capability_used: 'REASONING',
    confidence: 0.8,
  });
}

test('OBSERVE produces an accepted deterministic receipt', async () => {
  const lake = testLake();

  const result = await executeAgentAction(
    lake,
    'citizen-test-001',
    decision('OBSERVE'),
    '2026-09-21T01:00:00.000Z',
  );

  assert.equal(result.receipt.accepted, true);
  assert.equal(result.receipt.action, 'OBSERVE');
  assert.equal(result.receipt.reason, 'OBSERVATION_RECORDED');
  AgentActionReceiptSchema.parse(result.receipt);
});

test('STUDY is a bounded simulated action', async () => {
  const result = await executeAgentAction(
    testLake(),
    'citizen-test-001',
    decision('STUDY'),
    '2026-09-21T01:00:00.000Z',
  );

  assert.equal(result.receipt.accepted, true);
  assert.equal(result.receipt.reason, 'STUDY_RECORDED');
});

test('REST is a bounded simulated action', async () => {
  const result = await executeAgentAction(
    testLake(),
    'citizen-test-001',
    decision('REST'),
    '2026-09-21T01:00:00.000Z',
  );

  assert.equal(result.receipt.accepted, true);
  assert.equal(result.receipt.reason, 'REST_RECORDED');
});

test('PROPOSE_PROJECT remains only a simulated proposal', async () => {
  const lake = testLake();

  const result = await executeAgentAction(
    lake,
    'citizen-test-001',
    decision('PROPOSE_PROJECT'),
    '2026-09-21T01:00:00.000Z',
  );

  assert.equal(result.receipt.accepted, true);
  assert.equal(result.receipt.reason, 'PROJECT_PROPOSAL_RECORDED');
  assert.deepEqual(result.state, lake);
});

test('CONTRIBUTE_PROJECT remains bounded simulated work', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'lake-yange-agent-contribution-')
  );
  const worldStore = new LakeYangeAgentWorldStore(
    join(directory, 'world.json')
  );
  const lake = testLake();

  const proposal = await executeAgentActionInternal(
    lake,
    'citizen-test-001',
    decision('PROPOSE_PROJECT'),
    '2026-09-21T00:59:00.000Z',
    worldStore
  );

  assert.equal(proposal.receipt.accepted, true);
  assert.equal(proposal.receipt.reason, 'PROJECT_PROPOSAL_RECORDED');

  const result = await executeAgentActionInternal(
    lake,
    'citizen-test-001',
    decision('CONTRIBUTE_PROJECT'),
    '2026-09-21T01:00:00.000Z',
    worldStore
  );

  assert.equal(result.receipt.accepted, true);
  assert.equal(result.receipt.reason, 'PROJECT_CONTRIBUTION_RECORDED');
});

test('archived citizens cannot act', async () => {
  const lake = testLake();
  lake.citizens[0]!.status = 'ARCHIVED';

  const result = await executeAgentAction(
    lake,
    'citizen-test-001',
    decision('OBSERVE'),
    '2026-09-21T01:00:00.000Z',
  );

  assert.equal(result.receipt.accepted, false);
  assert.equal(
    result.receipt.reason,
    'ARCHIVED_CITIZEN_CANNOT_ACT',
  );
  assert.deepEqual(result.state, lake);
});

test('missing citizen becomes an auditable execution failure', async () => {
  const result = await executeAgentAction(
    testLake(),
    'missing-citizen',
    decision('OBSERVE'),
    '2026-09-21T01:00:00.000Z',
  );

  assert.equal(result.receipt.accepted, false);
  assert.equal(
    result.receipt.reason,
    'CITIZEN_NOT_FOUND:missing-citizen',
  );
  assert.deepEqual(result.state, testLake());
});

test('same action and state produce the same receipt identity', async () => {
  const lake = testLake();

  const first = await executeAgentAction(
    lake,
    'citizen-test-001',
    decision('STUDY'),
    '2026-09-21T01:00:00.000Z',
  );

  const second = await executeAgentAction(
    lake,
    'citizen-test-001',
    decision('STUDY'),
    '2026-09-21T01:00:00.000Z',
  );

  assert.equal(
    first.receipt.receipt_id,
    second.receipt.receipt_id,
  );
  assert.equal(
    first.receipt.state_before_hash,
    second.receipt.state_before_hash,
  );
  assert.equal(
    first.receipt.state_after_hash,
    second.receipt.state_after_hash,
  );
});
