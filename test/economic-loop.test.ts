import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperatorSigner } from '../runtime/operator-identity.js';
import {
  ACTION_TRANSITIONS,
  CorruptEconomicLogError,
  EconomicLoopStore,
  GovernanceError,
  SimulatedExecutor,
  applyEvent,
  emptyState,
  foldEvents,
  reconcile,
  scopeHash,
  type ActionScope,
  type EconomicExecutor
} from '../runtime/economic-loop.js';
import { computeWealthCommand } from '../runtime/lake-yange-wealth.js';

const T0 = Date.parse('2026-01-01T00:00:00Z');
const OPPS: Record<string, { status: string; evidence_count: number }> = {
  good: { status: 'APPROVED_FOR_TEST', evidence_count: 2 },
  noev: { status: 'VALIDATING', evidence_count: 0 },
  rej: { status: 'REJECTED', evidence_count: 3 },
  other: { status: 'VALIDATING', evidence_count: 1 }
};
const scope: ActionScope = {
  type: 'PROPOSAL', channel: 'email', recipient: 'a@example.com', payload_summary: 'Send quote',
  max_cost_aud: 0, money_involved: false, external_communication: true, real_execution: true
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'econ-'));
  let clock = T0;
  const store = new EconomicLoopStore(root, {
    now: () => new Date(clock),
    resolveOpportunity: id => OPPS[id] ?? null
  });
  const advance = (ms: number) => { clock += ms; };
  const signer = await createOperatorSigner(root, 'tristan');
  await store.enrollOperator(signer, 'Test operator');
  return { root, store, advance, signer, agent: store.asAgent('agent-1'), human: store.asHuman(signer) };
}

const realExecutor: EconomicExecutor = { id: 'fake-real', mode: 'REAL', execute: async () => ({ note: 'test double' }) };

async function approvedAndExecuted(ctx: Awaited<ReturnType<typeof setup>>, mode: 'REAL' | 'SIM' = 'REAL') {
  const id = await ctx.agent.propose({ opportunity_id: 'good', evidence_ids: ['e1'], rationale: 'r', scope });
  await ctx.human.approve(id, { expires_in_minutes: 60, real_execution_permitted: mode === 'REAL' });
  await ctx.store.execute(id, mode === 'REAL' ? realExecutor : new SimulatedExecutor());
  return id;
}

const claim = (id: string, over: object = {}) => ({
  action_id: id, claimed_result: 'SUCCESS' as const, claimed_revenue_aud: 500, claimed_cost_aud: 0,
  evidence_ids: ['pay1'], receipt_id: null, notes: '', ...over
});
const verify = (id: string, over: object = {}) => ({
  action_id: id, verified_result: 'SUCCESS' as const, verified_revenue_aud: 500, verified_cost_aud: 0,
  customer_id: 'cust-1', evidence_ids: ['pay1'], notes: '', ...over
});

test('no-evidence and rejected opportunities cannot be proposed', async () => {
  const c = await setup();
  await assert.rejects(c.agent.propose({ opportunity_id: 'noev', evidence_ids: ['e'], rationale: 'r', scope }), /no evidence/);
  await assert.rejects(c.agent.propose({ opportunity_id: 'rej', evidence_ids: ['e'], rationale: 'r', scope }), /REJECTED/);
  await assert.rejects(c.agent.propose({ opportunity_id: 'ghost', evidence_ids: ['e'], rationale: 'r', scope }), /not in any persisted/);
});

test('rejected-after-approval opportunity cannot execute', async () => {
  const c = await setup();
  const id = await c.agent.propose({ opportunity_id: 'other', evidence_ids: ['e'], rationale: 'r', scope });
  await c.human.approve(id, { expires_in_minutes: 10 });
  OPPS.other = { status: 'REJECTED', evidence_count: 1 };
  try { await assert.rejects(c.store.execute(id), /REJECTED/); } finally { OPPS.other = { status: 'VALIDATING', evidence_count: 1 }; }
});

test('execution without approval is blocked; agents cannot approve or verify', async () => {
  const c = await setup();
  const id = await c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope });
  await assert.rejects(c.store.execute(id), /approval/i);
  assert.equal((c.agent as any).approve, undefined);
  assert.equal((c.agent as any).verifyOutcome, undefined);
  // hostile direct event with an AGENT actor claiming approval
  const state = await c.store.load();
  const rec = state.actions.get(id)!;
  const forged = { seq: 2, event_id: 'x', type: 'APPROVAL_GRANTED', at: new Date(T0).toISOString(), actor: { kind: 'AGENT', id: 'agent-1' },
    payload: { action_id: id, scope_hash: rec.scope_hash, expires_at: new Date(T0 + 1e6).toISOString(), spend_cap_aud: 0, real_execution_permitted: false }, prev_hash: '', hash: '' } as any;
  assert.throws(() => applyEvent(state, forged), GovernanceError);
});

test('approval is bound to scope; modification invalidates it', async () => {
  const c = await setup();
  const id = await c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope });
  const staleHash = (await c.store.load()).actions.get(id)!.scope_hash;
  await c.human.approve(id, { expires_in_minutes: 60 });
  await c.agent.revise(id, { ...scope, recipient: 'attacker@example.com' }, 'tweak');
  const after = (await c.store.load()).actions.get(id)!;
  assert.equal(after.state, 'AWAITING_APPROVAL');
  assert.equal(after.approval, null);
  await assert.rejects(c.store.execute(id), /approval/i);
  // approval of the old scope hash cannot authorise the modified action
  await assert.rejects(c.human.approveReviewed(id, staleHash, { expires_at: new Date(T0 + 1e6).toISOString(), spend_cap_aud: 0, real_execution_permitted: false }), /scope does not match/);
  assert.notEqual(staleHash, scopeHash('good', { ...scope, recipient: 'attacker@example.com' }));
});

test('approval expires and stale approval fails closed', async () => {
  const c = await setup();
  const id = await c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope });
  await c.human.approve(id, { expires_in_minutes: 5 });
  c.advance(6 * 60_000);
  await assert.rejects(c.store.execute(id), /approval/i);
});

test('duplicate execution is prevented; replayed event ids are idempotent', async () => {
  const c = await setup();
  const id = await approvedAndExecuted(c);
  await assert.rejects(c.store.execute(id, realExecutor, 'another-id'), /already been executed/);
  let runs = 0;
  const counting: EconomicExecutor = { id: 'fake-real', mode: 'REAL', execute: async () => { runs += 1; return { note: '' }; } };
  await c.store.execute(id, counting); // same deterministic event id -> replay, executor not re-run
  assert.equal(runs, 0);
  const n = (await c.store.readEvents()).length;
  await c.agent.claimOutcome(claim(id), 'oc-1');
  await c.agent.claimOutcome(claim(id), 'oc-1');
  assert.equal((await c.store.readEvents()).length, n + 1);
  await assert.rejects(c.agent.claimOutcome(claim(id, { notes: 'different' }), 'oc-1'), /already used/);
});

test('verified successful real outcome creates exactly one ledger entry; replay cannot duplicate', async () => {
  const c = await setup();
  const id = await approvedAndExecuted(c);
  await c.agent.claimOutcome(claim(id));
  assert.equal(reconcile(await c.store.load()).gross_revenue_aud, 0, 'claim alone is not revenue');
  await c.human.verifyOutcome(verify(id), 'v1');
  await c.human.verifyOutcome(verify(id), 'v1');
  await assert.rejects(c.human.verifyOutcome(verify(id), 'v2'), /already verified/);
  const rec = reconcile(await c.store.load());
  assert.deepEqual([rec.ok, rec.gross_revenue_aud, rec.customers_won], [true, 500, 1]);
});

test('agents cannot verify outcomes or inject revenue; simulated runs never yield revenue', async () => {
  const c = await setup();
  const id = await approvedAndExecuted(c, 'SIM');
  await c.agent.claimOutcome(claim(id));
  await assert.rejects(c.human.verifyOutcome(verify(id)), /Simulated execution/);
  const state = await c.store.load();
  const forged = { seq: 99, event_id: 'f', type: 'OUTCOME_VERIFIED', at: new Date(T0).toISOString(), actor: { kind: 'AGENT', id: 'agent-1' }, payload: verify(id), prev_hash: '', hash: '' } as any;
  assert.throws(() => applyEvent(state, forged), /HUMAN/);
  assert.equal(reconcile(state).gross_revenue_aud, 0);
});

test('failed, cancelled, no-response outcomes create no revenue and stay visible', async () => {
  for (const result of ['FAILED', 'CANCELLED', 'NO_RESPONSE', 'REJECTED'] as const) {
    const c = await setup();
    const id = await approvedAndExecuted(c);
    await assert.rejects(c.agent.claimOutcome(claim(id, { claimed_result: result })), /cannot carry revenue/);
    await c.agent.claimOutcome(claim(id, { claimed_result: result, claimed_revenue_aud: 0 }));
    const state = await c.store.load();
    assert.equal(reconcile(state).gross_revenue_aud, 0);
    assert.ok(state.actions.has(id));
    assert.ok(state.actions.get(id)!.history.length >= 4);
  }
});

test('revenue needs payment evidence and a customer; malformed amounts rejected', async () => {
  const c = await setup();
  const id = await approvedAndExecuted(c);
  await c.agent.claimOutcome(claim(id));
  await assert.rejects(c.human.verifyOutcome(verify(id, { evidence_ids: [] })), /payment evidence/);
  await assert.rejects(c.human.verifyOutcome(verify(id, { customer_id: null })), /customer/);
  await assert.rejects(c.human.verifyOutcome(verify(id, { verified_revenue_aud: -5 })));
  await assert.rejects(c.human.verifyOutcome(verify(id, { verified_revenue_aud: Number.NaN })));
  await assert.rejects(c.human.verifyOutcome(verify(id, { verified_cost_aud: 10 })), /spend cap/);
});

test('same customer is not double counted across actions', async () => {
  const c = await setup();
  for (let i = 0; i < 2; i++) {
    const id = await approvedAndExecuted(c);
    await c.agent.claimOutcome(claim(id));
    await c.human.verifyOutcome(verify(id));
  }
  const rec = reconcile(await c.store.load());
  assert.equal(rec.gross_revenue_aud, 1000);
  assert.equal(rec.customers_won, 1);
});

test('invalid transitions fail; terminal states have no exits', async () => {
  const c = await setup();
  const id = await c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope });
  await assert.rejects(c.agent.claimOutcome(claim(id, { claimed_revenue_aud: 0 })), /Invalid transition/);
  await c.agent.cancel(id, 'no');
  await assert.rejects(c.human.approve(id, { expires_in_minutes: 5 }), /Invalid transition/);
  for (const s of ['WON', 'LOST', 'CANCELLED', 'FAILED', 'REJECTED'] as const) assert.equal(ACTION_TRANSITIONS[s].length, 0);
});

test('invalid scope and spend values fail', async () => {
  const c = await setup();
  await assert.rejects(c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope: { ...scope, max_cost_aud: 10 } }));
  await assert.rejects(c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope: { ...scope, max_cost_aud: -1 } }));
  await assert.rejects(c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope: { ...scope, external_communication: false } }));
  const id = await c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope: { ...scope, real_execution: false } });
  await assert.rejects(c.human.approve(id, { expires_in_minutes: 5, real_execution_permitted: true }), /not declared in scope/);
  await assert.rejects(c.human.approve(id, { expires_in_minutes: 5, spend_cap_aud: 5 }), /no money/);
});

test('real execution is never silently substituted and needs explicit approval', async () => {
  const c = await setup();
  const id = await c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope });
  await c.human.approve(id, { expires_in_minutes: 60 });
  await assert.rejects(c.store.execute(id, realExecutor), /Real execution was not explicitly approved/);
  await c.store.execute(id); // default is the simulated executor
  assert.equal((await c.store.load()).actions.get(id)!.execution!.mode, 'SIMULATED');
});

test('corrupted, tampered, gapped and edited logs fail closed; history stays intact', async () => {
  const c = await setup();
  const id = await approvedAndExecuted(c);
  await c.agent.claimOutcome(claim(id));
  await c.human.verifyOutcome(verify(id));
  const file = join(c.root, '.sink/economy/events.jsonl');
  const original = await readFile(file, 'utf8');
  const before = (await c.store.load()).actions.get(id)!.history.length;

  await writeFile(file, original.replace('"verified_revenue_aud":500', '"verified_revenue_aud":900000'));
  await assert.rejects(c.store.load(), CorruptEconomicLogError);
  await writeFile(file, original + 'not json\n');
  await assert.rejects(c.store.load(), CorruptEconomicLogError);
  const lines = original.split('\n').filter(Boolean);
  await writeFile(file, [lines[0], ...lines.slice(2)].join('\n') + '\n');
  await assert.rejects(c.store.load(), CorruptEconomicLogError);

  await writeFile(file, original);
  assert.equal((await c.store.load()).actions.get(id)!.history.length, before);
  await assert.rejects(c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope }).then(async () => {
    await writeFile(file, 'garbage\n');
    return c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e'], rationale: 'r', scope });
  }), CorruptEconomicLogError);
});

test('reconcile detects a corrupted ledger and wealth refuses to count it', async () => {
  const c = await setup();
  const id = await approvedAndExecuted(c);
  await c.agent.claimOutcome(claim(id));
  await c.human.verifyOutcome(verify(id));
  const state = await c.store.load();
  state.ledger.push({ ...state.ledger[0]! }); // duplicate entry
  const rec = reconcile(state);
  assert.equal(rec.ok, false);
  const w = computeWealthCommand(economy([]), 1000, state, new Date(T0));
  assert.equal(w.realised.from_verified_loop_aud, 0);
});

test('mismatched ids and unknown actions are refused', async () => {
  const c = await setup();
  await assert.rejects(c.agent.cancel('missing', 'x'), /Unknown action/);
  await assert.rejects(c.human.verifyOutcome(verify('missing')), /Unknown action/);
  const state = emptyState();
  assert.throws(() => foldEvents([{ seq: 2 } as any]), CorruptEconomicLogError);
  assert.equal(state.ledger.length, 0);
});

function economy(top: any[], gross = 0) {
  return {
    gross_revenue_aud: gross, net_cash_aud: gross, customers_won: 0,
    opportunities_by_status: { DISCOVERED: 0, VALIDATING: top.length, APPROVED_FOR_TEST: 0, REJECTED: 0, WON: 0, LOST: 0 },
    top_opportunities: top
  };
}
const opp = (id: string, status: string, price: number, evidence = 1) => ({
  opportunity_id: id, title: id, target_customer: 'x', proposed_offer: 'y', proposed_price_aud: price,
  priority_score: 1, confidence: 1, status, evidence_count: evidence
});

test('estimates never change realised; pipeline stays separate', async () => {
  const w = computeWealthCommand(economy([opp('good', 'APPROVED_FOR_TEST', 1000)], 10) as any);
  assert.equal(w.realised.gross_aud, 10);
  assert.ok(w.pipeline_estimate.expected_value_aud > 0);
});

test('ranking: governance readiness outranks raw value; every rec requires approval; spend is not granted', async () => {
  const c = await setup();
  const id = await c.agent.propose({ opportunity_id: 'other', evidence_ids: ['e'], rationale: 'r', scope });
  await c.human.approve(id, { expires_in_minutes: 60 });
  const state = await c.store.load();
  const w = computeWealthCommand(economy([opp('big', 'APPROVED_FOR_TEST', 100000), opp('other', 'VALIDATING', 10), opp('noev', 'APPROVED_FOR_TEST', 99999, 0)]) as any, 1000, state, new Date(T0));
  assert.equal(w.next_actions[0]!.opportunity_id, 'other');
  assert.equal(w.next_actions[0]!.governance_step, 'EXECUTE_APPROVED');
  assert.equal(w.next_actions[0]!.requires_approval_label, 'NO (inside existing valid human approval)');
  assert.ok(w.next_actions.slice(1).every(a => a.requires_approval === true && a.requires_approval_label === 'YES'));
  assert.ok(w.blocked.some(b => b.opportunity_id === 'noev'));
  assert.ok(!w.next_actions.some(a => a.opportunity_id === 'noev'));
});

test('learning uses verified outcomes only and is bounded', async () => {
  const c = await setup();
  const first = await approvedAndExecuted(c);
  await c.agent.claimOutcome(claim(first)); // claimed, unverified: must not count
  let w = computeWealthCommand(economy([opp('good', 'APPROVED_FOR_TEST', 100)]) as any, 1000, await c.store.load(), new Date(T0));
  assert.equal(w.learning.applied, false);
  assert.equal(w.learning.ranking_multiplier, 1);
  await c.human.verifyOutcome(verify(first));
  for (let i = 0; i < 2; i++) {
    const id = await approvedAndExecuted(c);
    await c.agent.claimOutcome(claim(id));
    await c.human.verifyOutcome(verify(id, { customer_id: `c${i}` }));
  }
  const state = await c.store.load();
  w = computeWealthCommand(economy([opp('good', 'APPROVED_FOR_TEST', 100)]) as any, 1000, state, new Date(T0));
  assert.equal(w.learning.applied, true);
  assert.ok(w.learning.ranking_multiplier > 1 && w.learning.ranking_multiplier <= 1.5);
  assert.ok(w.learning.signals.some(s => s.provenance === 'MODEL_INFERENCE'));
  assert.equal(w.realised.from_verified_loop_aud, 1500);
  assert.equal(w.loop!.reconciliation.ok, true);
  assert.equal(w.loop!.funnel.find(f => f.stage === 'REALISED')!.count, 3);
});
