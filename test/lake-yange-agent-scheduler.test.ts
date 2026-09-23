import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LakeYangeStateSchema,
  type Citizen,
  type LakeYangeState
} from '../runtime/lake-yange.js';
import {
  LakeYangeAgentRuntime,
  type AgentRunResult
} from '../runtime/lake-yange-agent.js';
import {
  LakeYangeAgentScheduler,
  type SchedulerCycleResult
} from '../runtime/lake-yange-agent-scheduler.js';

import { LakeYangeAgentWorldStore } from '../runtime/lake-yange-agent-world.js';

async function testWorldStore(): Promise<LakeYangeAgentWorldStore> {
  const directory = await mkdtemp(
    join(tmpdir(), 'lake-yange-agent-scheduler-')
  );

  return new LakeYangeAgentWorldStore(
    join(directory, 'world.json')
  );
}

function testCitizen(id: string): Citizen {
  return {
    schema_version: 1,
    citizen_id: id,
    name: `Test Citizen ${id}`,
    system_id: `test-system-${id}`,
    role: 'WORKER',
    rank: 'WORKER',
    status: 'ACTIVE',
    home: 'PRIME_TOWER',
    born_at: '2026-09-21T00:00:00.000Z',
    genome: {
      genome_version: 1,
      traits: {
        research: 0.5,
        coding: 0.5,
        verification: 0.5,
        commercial: 0.5,
        planning: 0.5,
        adversarial: 0.5,
        ux: 0.5,
        orchestration: 0.5
      },
      capabilities: [],
      strategies: [],
      model_policy: {
        preferred_capabilities: ['FAST'],
        max_cost_usd_per_mission: 0,
        allowed_sensitivity: 'PUBLIC'
      },
      tool_policy: {
        allowed_tools: [],
        denied_tools: []
      }
    },
    lineage: {
      generation: 0,
      parents: [],
      ancestry: [],
      birth_reason: 'TEST',
      mutation_notes: []
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
      grant_authority: false
    },
    fitness_history: [],
    missions_completed: 0,
    missions_failed: 0,
    admitted_at: '2026-09-21T00:00:00.000Z',
    archived_at: null
  };
}

function testLake(count = 1): LakeYangeState {
  const citizens = Array.from(
    { length: count },
    (_, index) =>
      testCitizen(`LY-TEST-${String(index + 1).padStart(3, '0')}`)
  );

  return LakeYangeStateSchema.parse({
    schema_version: 1,
    settlement_id: 'LAKE-YANGE',
    founded_at: '2026-09-21T00:00:00.000Z',
    generation: 0,
    citizens,
    population_limit: 100,
    trainee_limit: 50,
    births_total: 0,
    admissions_total: count,
    archived_total: 0
  });
}

function acceptedResult(citizenId: string): AgentRunResult {
  return {
    citizen_id: citizenId,
    decision: {
      action: 'OBSERVE',
      reason: 'The citizen observes the current settlement state.',
      objective: 'Understand the current state of Lake Yange.',
      expected_outcome: 'A bounded observation is recorded.',
      capability_used: 'FAST',
      confidence: 0.9
    },
    accepted: true,
    reason: 'AGENT_DECISION_ACCEPTED',
    receipt_id: `agent-receipt-${citizenId}`
  };
}

test('scheduler executes a bounded cognition cycle', async () => {
  const lake = testLake(1);
  const calls: string[] = [];

  const fakeRuntime = {
    async think(
      _lake: LakeYangeState,
      citizenId: string
    ): Promise<AgentRunResult> {
      calls.push(citizenId);
      return acceptedResult(citizenId);
    }
  } as unknown as LakeYangeAgentRuntime;

  const scheduler = new LakeYangeAgentScheduler(
    fakeRuntime,
    {
      max_decisions_per_cycle: 4,
      minimum_wake_gap_ms: 0
    },
    await testWorldStore()
  );

  const result: SchedulerCycleResult = await scheduler.runCycle(
    lake,
    '2026-09-21T00:01:00.000Z'
  );

  assert.equal(result.attempted, 1);
  assert.equal(result.accepted, 1);
  assert.equal(result.rejected, 0);
  assert.equal(result.results.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(result.results[0]?.action, 'OBSERVE');
  assert.equal(result.results[0]?.accepted, true);
});

test('scheduler never exceeds its decision budget', async () => {
  const lake = testLake(4);
  const calls: string[] = [];

  const fakeRuntime = {
    async think(
      _lake: LakeYangeState,
      citizenId: string
    ): Promise<AgentRunResult> {
      calls.push(citizenId);
      return acceptedResult(citizenId);
    }
  } as unknown as LakeYangeAgentRuntime;

  const scheduler = new LakeYangeAgentScheduler(
    fakeRuntime,
    {
      max_decisions_per_cycle: 2,
      minimum_wake_gap_ms: 0
    },
    await testWorldStore()
  );

  const result = await scheduler.runCycle(
    lake,
    '2026-09-21T00:02:00.000Z'
  );

  assert.equal(result.attempted, 2);
  assert.equal(result.accepted, 2);
  assert.equal(result.rejected, 0);
  assert.equal(result.results.length, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, ['LY-TEST-001', 'LY-TEST-002']);
});

test('scheduler converts agent failure into an auditable rejection', async () => {
  const lake = testLake(1);

  const fakeRuntime = {
    async think(): Promise<AgentRunResult> {
      throw new Error('LOCAL_MODEL_RUNTIME_UNAVAILABLE');
    }
  } as unknown as LakeYangeAgentRuntime;

  const scheduler = new LakeYangeAgentScheduler(fakeRuntime, {
    max_decisions_per_cycle: 4,
    minimum_wake_gap_ms: 0
  });

  const result = await scheduler.runCycle(
    lake,
    '2026-09-21T00:03:00.000Z'
  );

  assert.equal(result.attempted, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.results.length, 1);

  const receipt = result.results[0];
  assert.equal(receipt?.accepted, false);
  assert.equal(receipt?.action, 'OBSERVE');
  assert.match(
    receipt?.reason ?? '',
    /AGENT_CYCLE_FAILED:LOCAL_MODEL_RUNTIME_UNAVAILABLE/
  );
});
