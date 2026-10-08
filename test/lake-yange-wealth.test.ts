import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWealthCommand } from '../runtime/lake-yange-wealth.js';

const base = {
  gross_revenue_aud: 0,
  net_cash_aud: 0,
  customers_won: 0,
  opportunities_by_status: { DISCOVERED: 0, VALIDATING: 0, APPROVED_FOR_TEST: 0, REJECTED: 0, WON: 0, LOST: 0 },
  top_opportunities: [] as any[]
};
const opp = (id: string, status: any, price: number, confidence: number, evidence = 1) => ({
  opportunity_id: id, title: id, target_customer: 'x', proposed_offer: 'y',
  proposed_price_aud: price, priority_score: 1, confidence, status, evidence_count: evidence, evidence_ids: []});

test('zero data yields zeros and no actions', () => {
  const w = computeWealthCommand(base);
  assert.equal(w.pipeline_estimate.expected_value_aud, 0);
  assert.equal(w.next_actions.length, 0);
  assert.equal(w.target.remaining_aud, 1000);
});

test('rejected, unevidenced and won are excluded; estimates never change realised', () => {
  const w = computeWealthCommand({
    ...base,
    gross_revenue_aud: 200,
    top_opportunities: [
      opp('a', 'APPROVED_FOR_TEST', 400, 0.5),
      opp('b', 'REJECTED', 9999, 1),
      opp('c', 'DISCOVERED', 500, 1, 0),
      opp('d', 'WON', 700, 1)
    ]
  });
  assert.equal(w.pipeline_estimate.expected_value_aud, 100);
  assert.equal(w.pipeline_estimate.opportunities_counted, 1);
  assert.equal(w.realised.gross_aud, 200);
  assert.equal(w.target.remaining_aud, 800);
  assert.equal(w.next_actions[0]!.spend_required_aud, 0);
  assert.equal(w.next_actions[0]!.requires_approval, true);
});

test('wealth exposes human decisions, operators and every action with full detail', async () => {
  const { createOperatorSigner } = await import('../runtime/operator-identity.js');
  const { EconomicLoopStore } = await import('../runtime/economic-loop.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'wealth-'));
  const store = new EconomicLoopStore(root, { resolveOpportunity: () => ({ status: 'VALIDATING', evidence_count: 1 }) });
  const signer = await createOperatorSigner(root, 'tristan');
  await store.enrollOperator(signer, 'Op');
  const id = await store.asAgent('a1').propose({ opportunity_id: 'outside', evidence_ids: ['e'], rationale: 'r', scope: { type: 'DRAFT', channel: null, recipient: null, payload_summary: 'x', max_cost_aud: 0, money_involved: false, external_communication: false, real_execution: false } });
  const state = await store.load();
  const w = computeWealthCommand({ gross_revenue_aud: 0, net_cash_aud: 0, customers_won: 0, opportunities_by_status: {}, top_opportunities: [] } as never, 1000, state);
  assert.equal(w.loop!.operators[0]!.status, 'ACTIVE');
  assert.equal(w.loop!.recent_actions[0]!.scope_hash.length > 10, true);
  assert.ok(w.next_actions.some(a => a.action_id === id && a.governance_step === 'AWAIT_HUMAN_APPROVAL' && a.requires_approval));
  await store.asHuman(signer).reject(id, 'no');
  const w2 = computeWealthCommand({ gross_revenue_aud: 0, net_cash_aud: 0, customers_won: 0, opportunities_by_status: {}, top_opportunities: [] } as never, 1000, await store.load());
  assert.equal(w2.loop!.human_decisions.rejections, 1);
  assert.equal(w2.realised.gross_aud, 0);
});
