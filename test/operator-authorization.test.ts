import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CorruptEconomicLogError,
  EconomicLoopStore,
  GovernanceError,
  SimulatedExecutor,
  applyEvent,
  reconcile,
  type ActionScope,
  type EconomicEvent,
  type EconomicExecutor
} from '../runtime/economic-loop.js';
import { createOperatorSigner, loadOperatorSigner, type OperatorSigner } from '../runtime/operator-identity.js';

const T0 = Date.parse('2026-01-01T00:00:00Z');
const MIN = 60_000;
const scope: ActionScope = {
  type: 'PROPOSAL', channel: 'email', recipient: 'a@example.com', payload_summary: 'Send quote',
  max_cost_aud: 0, money_involved: false, external_communication: true, real_execution: true
};
const realExecutor: EconomicExecutor = { id: 'fake-real', mode: 'REAL', execute: async () => ({ note: 'test double' }) };

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'econ-auth-'));
  let clock = T0;
  const make = () => new EconomicLoopStore(root, {
    now: () => new Date(clock),
    resolveOpportunity: id => (id === 'good' ? { status: 'APPROVED_FOR_TEST', evidence_count: 2 } : null)
  });
  const store = make();
  const signer = await createOperatorSigner(root, 'tristan');
  await store.enrollOperator(signer, 'Primary');
  return {
    root, store, signer, make,
    now: () => new Date(clock),
    advance: (ms: number) => { clock += ms; },
    agent: store.asAgent('agent-1'),
    human: store.asHuman(signer)
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const propose = (c: Ctx, over: Partial<ActionScope> = {}) =>
  c.agent.propose({ opportunity_id: 'good', evidence_ids: ['e1'], rationale: 'r', scope: { ...scope, ...over } });
const claim = (id: string, over: object = {}) => ({
  action_id: id, claimed_result: 'SUCCESS' as const, claimed_revenue_aud: 500, claimed_cost_aud: 0,
  evidence_ids: ['pay1'], receipt_id: null, notes: '', ...over
});
const verify = (id: string, over: object = {}) => ({
  action_id: id, verified_result: 'SUCCESS' as const, verified_revenue_aud: 500, verified_cost_aud: 0,
  customer_id: 'cust-1', evidence_ids: ['pay1'], notes: '', ...over
});
async function executedReal(c: Ctx) {
  const id = await propose(c);
  await c.human.approve(id, { expires_in_minutes: 60, real_execution_permitted: true });
  await c.store.execute(id, realExecutor);
  return id;
}
async function claimed(c: Ctx) {
  const id = await executedReal(c);
  await c.agent.claimOutcome(claim(id));
  return id;
}

/** Build a raw signed event (not routed through the store) for hostile-path tests. */
async function rawApproval(c: Ctx, signer: OperatorSigner, id: string, patch: { sign?: object; payload?: object; actor?: any; at?: Date } = {}) {
  const state = await c.store.load();
  const rec = state.actions.get(id)!;
  const at = patch.at ?? c.now();
  const body = { action_id: id, scope_hash: rec.scope_hash, expires_at: new Date(T0 + 60 * MIN).toISOString(), spend_cap_aud: 0, real_execution_permitted: false, ...(patch.payload ?? {}) };
  const authorization = signer.sign({ operation: 'APPROVE_ACTION', action_id: id, scope_hash: rec.scope_hash, params: body, now: at, ...(patch.sign ?? {}) } as never);
  const event = { seq: state.last_seq + 1, event_id: `raw-${Math.random()}`, type: 'APPROVAL_GRANTED', at: at.toISOString(),
    actor: patch.actor ?? { kind: 'HUMAN', id: signer.operator_id }, payload: { ...body, authorization }, prev_hash: state.last_hash, hash: 'x' } as unknown as EconomicEvent;
  return { state, event, authorization, body };
}

// ---------- Identity ----------
test('identity: valid signature succeeds and private key never reaches the log', async () => {
  const c = await setup();
  const id = await propose(c);
  await c.human.approve(id, { expires_in_minutes: 60 });
  const rec = (await c.store.load()).actions.get(id)!;
  assert.equal(rec.state, 'APPROVED');
  assert.ok(rec.approval!.authorization.signature.length > 20);
  const log = await readFile(join(c.root, '.sink/economy/events.jsonl'), 'utf8');
  assert.ok(!log.includes('PRIVATE KEY'));
  const pem = await readFile(join(c.root, '.sink/operator/tristan.ed25519.pem'), 'utf8');
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  assert.ok(!log.includes(body.slice(0, 40)));
  assert.equal(((await readFile(join(c.root, '.sink/operator/tristan.ed25519.pem'))).length > 0), true);
  assert.ok(await loadOperatorSigner(c.root, 'tristan'));
  assert.equal(await loadOperatorSigner(c.root, 'nobody-here'), null);
});

test('identity: invalid signature fails closed', async () => {
  const c = await setup();
  const id = await propose(c);
  const { state, event } = await rawApproval(c, c.signer, id);
  (event.payload as any).authorization.signature = Buffer.alloc(64, 1).toString('base64');
  assert.throws(() => applyEvent(state, event), /signature/i);
  assert.equal(state.actions.get(id)!.state, 'AWAITING_APPROVAL');
});

test('identity: wrong operator (key not registered for that id) fails', async () => {
  const c = await setup();
  const id = await propose(c);
  const impostor = await createOperatorSigner(await mkdtemp(join(tmpdir(), 'imp-')), 'tristan');
  const { state, event } = await rawApproval(c, impostor, id);
  assert.throws(() => applyEvent(state, event), /signature/i);
});

test('identity: unknown operator fails', async () => {
  const c = await setup();
  const id = await propose(c);
  const stranger = await createOperatorSigner(await mkdtemp(join(tmpdir(), 'str-')), 'stranger');
  const { state, event } = await rawApproval(c, stranger, id);
  assert.throws(() => applyEvent(state, event), /operator/i);
});

test('identity: modified payload fails', async () => {
  const c = await setup();
  const id = await propose(c);
  const { state, event } = await rawApproval(c, c.signer, id);
  (event.payload as any).spend_cap_aud = 9999;
  assert.throws(() => applyEvent(state, event), GovernanceError);
  const second = await rawApproval(c, c.signer, id);
  (second.event.payload as any).real_execution_permitted = true;
  assert.throws(() => applyEvent(second.state, second.event), GovernanceError);
});

test('identity: modified scope hash fails (signed hash differs from reviewed scope)', async () => {
  const c = await setup();
  const id = await propose(c);
  const { state, event } = await rawApproval(c, c.signer, id, { sign: { scope_hash: 'f'.repeat(64) } });
  assert.throws(() => applyEvent(state, event), GovernanceError);
});

test('identity: modified action id fails', async () => {
  const c = await setup();
  const a = await propose(c);
  const b = await propose(c, { recipient: 'b@example.com' });
  const { state, event } = await rawApproval(c, c.signer, a);
  (event.payload as any).action_id = b;
  assert.throws(() => applyEvent(state, event), GovernanceError);
  assert.equal(state.actions.get(b)!.state, 'AWAITING_APPROVAL');
});

test('identity: authorization for action A cannot approve action B, even re-signed fields cannot be transplanted', async () => {
  const c = await setup();
  const a = await propose(c);
  const b = await propose(c, { recipient: 'b@example.com' });
  const forA = await rawApproval(c, c.signer, a);
  const forB = await rawApproval(c, c.signer, b);
  (forB.event.payload as any).authorization = forA.authorization;
  assert.throws(() => applyEvent(forB.state, forB.event), GovernanceError);
});

test('identity: modified timestamp fails (signature or validity window)', async () => {
  const c = await setup();
  const id = await propose(c);
  const r = await rawApproval(c, c.signer, id);
  (r.event.payload as any).authorization.signed_at = new Date(T0 + 1).toISOString();
  assert.throws(() => applyEvent(r.state, r.event), GovernanceError);
  const r2 = await rawApproval(c, c.signer, id);
  (r2.event.payload as any).authorization.valid_until = new Date(T0 + 24 * 60 * MIN).toISOString();
  assert.throws(() => applyEvent(r2.state, r2.event), GovernanceError);
});

test('identity: replayed authorization (nonce) fails', async () => {
  const c = await setup();
  const id = await propose(c);
  const first = await rawApproval(c, c.signer, id, { sign: { nonce: 'n'.repeat(16) } });
  applyEvent(first.state, first.event);
  // Re-open the action by revision, then replay the exact same authorization
  const state = first.state;
  const rec = state.actions.get(id)!;
  rec.state = 'AWAITING_APPROVAL'; rec.approval = null;
  const replay = { ...first.event, seq: first.event.seq + 1, event_id: 'replayed' } as EconomicEvent;
  assert.throws(() => applyEvent(state, replay), /replay|nonce/i);
});

// ---------- Governance ----------
test('governance: agent cannot approve, reject, verify, return or enrol', async () => {
  const c = await setup();
  const id = await claimed(c);
  for (const type of ['APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'OUTCOME_VERIFIED', 'OUTCOME_RETURNED', 'OPERATOR_ENROLLED', 'OPERATOR_REVOKED']) {
    const ev = { seq: 99, event_id: type, type, at: c.now().toISOString(), actor: { kind: 'AGENT', id: 'agent-1' }, payload: {}, prev_hash: '', hash: '' } as any;
    assert.throws(() => applyEvent(emptyLike(), ev), /HUMAN/);
  }
  assert.equal((c.agent as any).verifyOutcome, undefined);
  assert.equal((c.agent as any).approve, undefined);
  assert.equal((await c.store.load()).actions.get(id)!.state, 'OUTCOME_PENDING');
});
function emptyLike() {
  return { actions: new Map(), ledger: [], event_ids: new Map(), operators: new Map(), nonces: new Set(), last_seq: 0, last_hash: '' } as any;
}

test('governance: unsigned human event fails', async () => {
  const c = await setup();
  const id = await propose(c);
  const { state, event } = await rawApproval(c, c.signer, id);
  delete (event.payload as any).authorization;
  assert.throws(() => applyEvent(state, event));
  const cancel = { seq: state.last_seq + 1, event_id: 'u', type: 'ACTION_CANCELLED', at: c.now().toISOString(), actor: { kind: 'HUMAN', id: 'tristan' }, payload: { action_id: id, reason: 'x' }, prev_hash: '', hash: '' } as any;
  assert.throws(() => applyEvent(state, cancel), /authoriz|sign/i);
});

test('governance: expired authorization fails', async () => {
  const c = await setup();
  const id = await propose(c);
  const r = await rawApproval(c, c.signer, id, { sign: { ttl_ms: MIN }, at: new Date(T0) });
  r.event.at = new Date(T0 + 30 * MIN).toISOString();
  assert.throws(() => applyEvent(r.state, r.event), /expired|valid/i);
});

test('governance: authorization TTL is capped at the maximum', async () => {
  const c = await setup();
  const id = await propose(c);
  await c.human.approve(id, { expires_in_minutes: 60, ttl_ms: 60 * MIN });
  const auth = (await c.store.load()).actions.get(id)!.approval!.authorization;
  assert.ok(Date.parse(auth.valid_until) - Date.parse(auth.signed_at) <= 10 * MIN);
});

test('governance: revoked operator fails closed; history preserved', async () => {
  const c = await setup();
  const second = await createOperatorSigner(await mkdtemp(join(tmpdir(), 'op2-')), 'second-op');
  await c.store.enrollOperator(second, 'Second', c.signer);
  const id = await propose(c);
  await c.store.revokeOperator(second, 'tristan', 'lost laptop');
  const before = (await c.store.readEvents()).length;
  await assert.rejects(c.human.approve(id, { expires_in_minutes: 5 }), /revoked/i);
  assert.equal((await c.store.readEvents()).length, before);
  await c.store.asHuman(second).approve(id, { expires_in_minutes: 5 });
  assert.equal((await c.store.load()).actions.get(id)!.state, 'APPROVED');
});

test('governance: first enrolment is self-signed, later ones need an active operator, duplicates refused', async () => {
  const c = await setup();
  const other = await createOperatorSigner(await mkdtemp(join(tmpdir(), 'op3-')), 'other-op');
  await assert.rejects(c.store.enrollOperator(other, 'self-enrol attempt'), GovernanceError);
  await assert.rejects(c.store.enrollOperator(c.signer, 'dup'), GovernanceError);
});

test('governance: modifying the action after authorisation requires a fresh authorisation', async () => {
  const c = await setup();
  const id = await propose(c);
  const staleHash = (await c.store.load()).actions.get(id)!.scope_hash;
  const r = await rawApproval(c, c.signer, id);
  await c.agent.revise(id, { ...scope, recipient: 'evil@example.com' }, 'edit');
  const fresh = await c.store.load();
  // the pre-signed approval (for the old scope) can no longer be applied
  assert.throws(() => applyEvent(fresh, { ...r.event, seq: fresh.last_seq + 1 } as EconomicEvent), GovernanceError);
  await assert.rejects(c.human.approveReviewed(id, staleHash, { expires_at: new Date(T0 + 60 * MIN).toISOString(), spend_cap_aud: 0, real_execution_permitted: false }), GovernanceError);
  await assert.rejects(c.store.execute(id), /approval/i);
});

test('governance: scope hash reviewed by the human is bound into rejection, cancel and verification', async () => {
  const c = await setup();
  const id = await claimed(c);
  await assert.rejects(c.human.verifyOutcome(verify(id), { scope_hash: 'a'.repeat(64) }), GovernanceError);
  await assert.rejects(c.human.returnOutcome(id, 'x', { scope_hash: 'a'.repeat(64) }), GovernanceError);
  const id2 = await propose(c, { recipient: 'z@example.com' });
  await assert.rejects(c.human.reject(id2, 'no', { scope_hash: 'a'.repeat(64) }), GovernanceError);
  await assert.rejects(c.human.cancel(id2, 'no', { scope_hash: 'a'.repeat(64) }), GovernanceError);
});

// ---------- Economic integrity ----------
test('integrity: every claim waits for human verification, nothing is revenue before then', async () => {
  const c = await setup();
  const id = await claimed(c);
  let state = await c.store.load();
  assert.equal(state.actions.get(id)!.state, 'OUTCOME_PENDING');
  assert.equal(reconcile(state).gross_revenue_aud, 0);
  assert.equal(state.ledger.length, 0);
  await c.human.verifyOutcome(verify(id));
  state = await c.store.load();
  assert.equal(state.ledger.length, 1);
  assert.equal(reconcile(state).gross_revenue_aud, 500);
});

test('integrity: approval and execution alone create no ledger effect', async () => {
  const c = await setup();
  await executedReal(c);
  const state = await c.store.load();
  assert.equal(state.ledger.length, 0);
  assert.equal(reconcile(state).gross_revenue_aud, 0);
});

test('integrity: duplicate verification (even with a new event id or operator) yields one ledger entry', async () => {
  const c = await setup();
  const id = await claimed(c);
  await c.human.verifyOutcome(verify(id), 'v1');
  await assert.rejects(c.human.verifyOutcome(verify(id), 'v2'), /already verified|Invalid transition/);
  const second = await createOperatorSigner(await mkdtemp(join(tmpdir(), 'op4-')), 'second-op');
  await c.store.enrollOperator(second, 'Second', c.signer);
  await assert.rejects(c.store.asHuman(second).verifyOutcome(verify(id)), GovernanceError);
  assert.equal(reconcile(await c.store.load()).gross_revenue_aud, 500);
});

test('integrity: FAILED/CANCELLED/NO_RESPONSE verification creates no revenue; revenue claimed on them is refused', async () => {
  for (const result of ['FAILED', 'CANCELLED', 'NO_RESPONSE'] as const) {
    const c = await setup();
    const id = await executedReal(c);
    await c.agent.claimOutcome(claim(id, { claimed_result: result, claimed_revenue_aud: 0 }));
    await assert.rejects(c.human.verifyOutcome(verify(id, { verified_result: result })), /cannot carry revenue/);
    await c.human.verifyOutcome(verify(id, { verified_result: result, verified_revenue_aud: 0, customer_id: null, evidence_ids: [] }));
    const state = await c.store.load();
    assert.equal(state.ledger.length === 0 || reconcile(state).gross_revenue_aud === 0, true);
    assert.equal(reconcile(state).gross_revenue_aud, 0);
  }
});

test('integrity: simulated execution can never be verified into revenue', async () => {
  const c = await setup();
  const id = await propose(c);
  await c.human.approve(id, { expires_in_minutes: 60 });
  await c.store.execute(id, new SimulatedExecutor());
  await c.agent.claimOutcome(claim(id));
  await assert.rejects(c.human.verifyOutcome(verify(id)), /Simulated execution/);
  assert.equal(reconcile(await c.store.load()).gross_revenue_aud, 0);
});

test('integrity: malformed monetary values fail', async () => {
  const c = await setup();
  const id = await claimed(c);
  for (const bad of [Number.NaN, Infinity, -1, 0.001, 1e15]) {
    await assert.rejects(c.human.verifyOutcome(verify(id, { verified_revenue_aud: bad })), /./, `revenue ${bad}`);
    await assert.rejects(c.human.verifyOutcome(verify(id, { verified_cost_aud: bad })), /./, `cost ${bad}`);
  }
  await assert.rejects(c.human.verifyOutcome(verify(id, { verified_revenue_aud: '500' as never })));
  assert.equal((await c.store.load()).ledger.length, 0);
});

test('integrity: reconcile detects injected, duplicated, mismatched and orphaned ledger records', async () => {
  const c = await setup();
  const id = await claimed(c);
  await c.human.verifyOutcome(verify(id));
  const base = await c.store.load();
  assert.equal(reconcile(base).ok, true);

  const dup = await c.store.load(); dup.ledger.push({ ...dup.ledger[0]! });
  assert.equal(reconcile(dup).ok, false);

  const injected = await c.store.load(); injected.ledger.push({ ...injected.ledger[0]!, ledger_id: 'ledger:ghost', action_id: 'ghost' });
  assert.equal(reconcile(injected).ok, false);

  const inflated = await c.store.load(); inflated.ledger[0]!.gross_revenue_aud = 9_999;
  assert.equal(reconcile(inflated).ok, false);

  const removed = await c.store.load(); removed.ledger.length = 0;
  assert.equal(reconcile(removed).ok, false);

  const badId = await c.store.load(); badId.ledger[0]!.ledger_id = 'ledger:other';
  assert.equal(reconcile(badId).ok, false);
});

test('integrity: return for correction archives the claim and permits one new claim, still no revenue', async () => {
  const c = await setup();
  const id = await claimed(c);
  await c.human.returnOutcome(id, 'receipt is missing');
  let rec = (await c.store.load()).actions.get(id)!;
  assert.equal(rec.state, 'EXECUTING');
  assert.equal(rec.returned_claims.length, 1);
  assert.equal(rec.claimed_outcome, null);
  assert.equal(reconcile(await c.store.load()).gross_revenue_aud, 0);
  await c.agent.claimOutcome(claim(id, { receipt_id: 'r-1' }));
  await c.human.verifyOutcome(verify(id));
  rec = (await c.store.load()).actions.get(id)!;
  assert.equal(rec.state, 'WON');
  assert.equal(rec.returned_claims.length, 1);
  assert.equal(reconcile(await c.store.load()).gross_revenue_aud, 500);
});

test('integrity: opportunity that becomes rejected cannot execute', async () => {
  const c = await setup();
  const id = await propose(c);
  await c.human.approve(id, { expires_in_minutes: 60, real_execution_permitted: true });
  const rejectedStore = new EconomicLoopStore(c.root, { now: c.now, resolveOpportunity: () => ({ status: 'REJECTED', evidence_count: 2 }) });
  await assert.rejects(rejectedStore.execute(id, realExecutor), /REJECTED/);
});

// ---------- Persistence ----------
test('persistence: restart preserves state and replay is deterministic', async () => {
  const c = await setup();
  const id = await claimed(c);
  await c.human.verifyOutcome(verify(id));
  const a = await c.store.load();
  const b = await c.make().load();
  const snap = (s: typeof a) => JSON.stringify({ actions: [...s.actions], ledger: s.ledger, ops: [...s.operators], seq: s.last_seq, hash: s.last_hash });
  assert.equal(snap(a), snap(b));
  assert.equal(reconcile(b).gross_revenue_aud, 500);
});

test('persistence: corrupted authorization, tampered event, and sequence gaps fail closed; log is never repaired', async () => {
  const c = await setup();
  const id = await claimed(c);
  await c.human.verifyOutcome(verify(id));
  const file = join(c.root, '.sink/economy/events.jsonl');
  const original = await readFile(file, 'utf8');

  const lines = original.split('\n').filter(Boolean);
  const target = lines.findIndex(l => l.includes('OUTCOME_VERIFIED'));
  const ev = JSON.parse(lines[target]!);
  ev.payload.authorization.signature = Buffer.alloc(64, 7).toString('base64');
  const corrupted = lines.slice(); corrupted[target] = JSON.stringify(ev);
  await writeFile(file, corrupted.join('\n') + '\n');
  await assert.rejects(c.store.load(), CorruptEconomicLogError);
  assert.equal(await readFile(file, 'utf8'), corrupted.join('\n') + '\n', 'not silently repaired');

  const withNoAuth = JSON.parse(lines[target]!); delete withNoAuth.payload.authorization;
  const stripped = lines.slice(); stripped[target] = JSON.stringify(withNoAuth);
  await writeFile(file, stripped.join('\n') + '\n');
  await assert.rejects(c.store.load(), CorruptEconomicLogError);

  await writeFile(file, original.replace('"verified_revenue_aud":500', '"verified_revenue_aud":50000'));
  await assert.rejects(c.store.load(), CorruptEconomicLogError);

  await writeFile(file, [lines[0], ...lines.slice(2)].join('\n') + '\n');
  await assert.rejects(c.store.load(), CorruptEconomicLogError);

  await writeFile(file, original + original.split('\n')[1] + '\n');
  await assert.rejects(c.store.load(), CorruptEconomicLogError);

  await writeFile(file, original);
  assert.equal(reconcile(await c.store.load()).gross_revenue_aud, 500);
  assert.ok((await readdir(join(c.root, '.sink/economy'))).includes('events.jsonl'));
});

test('persistence: a corrupt log blocks every mutating operation', async () => {
  const c = await setup();
  await writeFile(join(c.root, '.sink/economy/events.jsonl'), 'garbage\n');
  await assert.rejects(propose(c), CorruptEconomicLogError);
  await assert.rejects(c.human.approve('x', { expires_in_minutes: 5 }));
});
