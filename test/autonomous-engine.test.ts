import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runAutonomousCycle,
  type AutonomousEngineDependencies
} from '../runtime/autonomous-engine.js';
import type { LakeYangeWorldProjection } from '../runtime/lake-yange-world.js';
import type { Run } from '../runtime/contracts.js';

const projection = {
  projection_version: 1,
  generated_at: '2026-09-24T00:00:00.000Z',
  settlement: { settlement_id: 'LAKE-YANGE', founded_at: '2026-09-18T00:00:00.000Z', generation: 0, population: 9, population_limit: 100, trainee_limit: 20, births_total: 0, admissions_total: 9, archived_total: 0 },
  cognition: { locality: 'LOCAL', external_model_api: false },
  citizens: [], agents: {}, agent_records: [], institutions: [], missions: [], operations: [],
  governance: { pending_plans: 0, authorizations: 0, execution_claims: 0, execution_results: 0, records: { mandates: [], plans: [], authorizations: [], claims: [], results: [], invalid_records: 0 }, plans_are_not_execution: true },
  academy: { students: 0, assignments: 0, submissions: 0, grades: 0, last_cycle_at: null },
  entertainment: { source: 'EDITORIAL_BOOTSTRAP', item_count: 0, music_count: 0, film_count: 0, persisted_taste_profile: false },
  health: { persistence: 'OK', academy: 'EMPTY', study_missions: 'EMPTY', agent_runtime: 'EMPTY', local_ai: { status: 'UNKNOWN', runtime: 'llama.cpp', endpoint: null, probed_at: null }, overall: 'OK' },
  engineering: { recent: [], latest: null, verified_total: 0, rejected_total: 0, workshop_active: false },
  resources: { state: 'UNQUANTIFIED', telemetry_backed: false, harvesting_enabled: false }, truth: { source: 'PERSISTED_STATE_AND_RECEIPTS', simulation_fabricated_activity: false }
} as unknown as LakeYangeWorldProjection;
const failedRun = { run_id: 'failed-run-001', status: 'FAILED' } as Run;
function deps(overrides: Partial<AutonomousEngineDependencies> = {}): AutonomousEngineDependencies { return { cycleRoot: join(testRoot, 'cycles'), now: () => new Date('2026-09-24T00:01:00.000Z'), observe: async () => ({ projection, runs: [failedRun] }), ...overrides }; }
let testRoot = '';
test.beforeEach(async () => { testRoot = await mkdtemp(join(tmpdir(), 'lake-yange-autonomous-')); });
test.afterEach(async () => { await rm(testRoot, { recursive: true, force: true }); });

test('observation produces a proposal but default authorization prevents execution', async () => {
  const cycle = await runAutonomousCycle(testRoot, { dependencies: deps() });
  assert.equal(cycle.findings.length, 1);
  assert.equal(cycle.proposals.length, 1);
  assert.equal(cycle.authorization_decisions[0]?.status, 'REQUIRES_APPROVAL');
  assert.equal(cycle.executions[0]?.status, 'NOT_EXECUTED');
  assert.equal(cycle.outcomes[0]?.status, 'PENDING');
});

test('dry run stops before an authorized executor', async () => {
  let executions = 0;
  const cycle = await runAutonomousCycle(testRoot, { dryRun: true, dependencies: deps({ authorize: async proposal => ({ proposal_id: proposal.proposal_id, status: 'AUTHORIZED', reason: 'Fixture authorization.', decided_at: '2026-09-24T00:01:00.000Z' }), executor: { async execute() { executions += 1; return { run_id: 'run', evidence_ids: ['evidence'] }; } } }) });
  assert.equal(executions, 0);
  assert.equal(cycle.dry_run, true);
  assert.equal(cycle.executions[0]?.status, 'NOT_EXECUTED');
});

test('authorized execution becomes verified only with evidence', async () => {
  const cycle = await runAutonomousCycle(testRoot, { dependencies: deps({ authorize: async proposal => ({ proposal_id: proposal.proposal_id, status: 'AUTHORIZED', reason: 'Fixture authorization.', decided_at: '2026-09-24T00:01:00.000Z' }), executor: { async execute() { return { run_id: 'run-001', evidence_ids: ['evidence-001'] }; } } }) });
  assert.equal(cycle.executions[0]?.status, 'COMPLETED');
  assert.equal(cycle.verification_results[0]?.status, 'VERIFIED');
  assert.equal(cycle.outcomes[0]?.status, 'COMMITTED');
});

test('repeated cycles reconcile an existing execution without executing twice', async () => {
  let executions = 0;
  const dependencies = deps({ authorize: async proposal => ({ proposal_id: proposal.proposal_id, status: 'AUTHORIZED', reason: 'Fixture authorization.', decided_at: '2026-09-24T00:01:00.000Z' }), executor: { async execute() { executions += 1; return { run_id: 'run-001', evidence_ids: ['evidence-001'] }; } } });
  await runAutonomousCycle(testRoot, { dependencies });
  const repeated = await runAutonomousCycle(testRoot, { dependencies });
  assert.equal(executions, 1);
  assert.equal(repeated.executions[0]?.status, 'RECONCILED');
});
