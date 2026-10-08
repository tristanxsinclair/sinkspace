import type { LakeYangeEconomyProjection } from './lake-yange-economy.js';
import {
  isApprovalValid,
  reconcile,
  type ActionRecord,
  type EconomicLoopState,
  type Reconciliation
} from './economic-loop.js';

export const WEALTH_TARGET_AUD = 1000;

/** PLANNING ASSUMPTION: likelihood a stage converts, on top of each opportunity's own confidence. */
const STAGE_FACTOR: Record<string, number> = {
  DISCOVERED: 0.1,
  VALIDATING: 0.25,
  APPROVED_FOR_TEST: 0.5
};

const MIN_LEARNING_SAMPLE = 3;

export type Provenance = 'RECORDED_FACT' | 'ESTIMATE' | 'MODEL_INFERENCE' | 'PLANNING_ASSUMPTION';

export interface WealthNextAction {
  opportunity_id: string;
  title: string;
  stage: string;
  expected_value_aud: number;
  requires_approval: boolean;
  requires_approval_label: 'YES' | 'NO (inside existing valid human approval)';
  spend_required_aud: number;
  governance_step: 'EXECUTE_APPROVED' | 'VERIFY_OUTCOME' | 'AWAIT_HUMAN_APPROVAL' | 'PROPOSE_ACTION';
  action_id: string | null;
  blockers: string[];
  reason: string;
}

export interface LearningSignal {
  label: string;
  value: string;
  provenance: Provenance;
  sample_size: number;
}

export interface WealthLoopSummary {
  funnel: { stage: string; count: number }[];
  pending_approvals: number;
  approved_ready: number;
  expired_approvals: number;
  in_progress: number;
  awaiting_verification: number;
  realised_outcomes: number;
  failed_or_cancelled: number;
  reconciliation: Reconciliation;
  human_decisions: { approvals: number; rejections: number; verifications: number; returned_for_correction: number; human_cancellations: number };
  operators: { operator_id: string; fingerprint: string; label: string; status: 'ACTIVE' | 'REVOKED' }[];
  /** Active actions first, then the most recent finished ones. Full records, including approval and claims, for human review. */
  recent_actions: (ActionRecord & { type: string; approved: boolean; execution_mode: string | null })[];
}

export interface WealthCommand {
  basis: 'PERSISTED_LEDGERS_ESTIMATE';
  realised: {
    gross_aud: number;
    net_aud: number;
    customers: number;
    from_run_ledgers_aud: number;
    from_verified_loop_aud: number;
  };
  pipeline_estimate: {
    expected_value_aud: number;
    unweighted_aud: number;
    opportunities_counted: number;
    assumptions: string[];
  };
  target: { target_aud: number; realised_fraction: number; remaining_aud: number };
  funnel: { stage: string; count: number }[];
  next_actions: WealthNextAction[];
  blocked: { opportunity_id: string; title: string; blockers: string[] }[];
  loop: WealthLoopSummary | null;
  learning: { signals: LearningSignal[]; ranking_multiplier: number; applied: boolean };
  disclaimer: string;
}

type EconomyInput = Pick<
  LakeYangeEconomyProjection,
  'gross_revenue_aud' | 'net_cash_aud' | 'customers_won' | 'opportunities_by_status' | 'top_opportunities'
>;

const TERMINAL_BAD = new Set(['FAILED', 'CANCELLED', 'REJECTED']);
const FINISHED = new Set(['WON', 'LOST', 'CANCELLED', 'FAILED', 'REJECTED']);
const countDecisions = (actions: ActionRecord[], operation: string) =>
  actions.reduce((n, a) => n + a.human_decisions.filter(d => d.operation === operation).length, 0);

/** Learning uses VERIFIED outcomes only; it never edits history, only a bounded ranking multiplier. */
export function computeLearning(loop: EconomicLoopState | undefined): WealthCommand['learning'] {
  const verified = loop ? [...loop.actions.values()].filter(a => a.verified_outcome) : [];
  const n = verified.length;
  const signals: LearningSignal[] = [];
  if (n === 0) {
    signals.push({ label: 'Verified outcomes', value: 'none yet; ranking uses planning assumptions only', provenance: 'RECORDED_FACT', sample_size: 0 });
    return { signals, ranking_multiplier: 1, applied: false };
  }
  const wins = verified.filter(a => a.state === 'WON').length;
  signals.push({ label: 'Verified outcomes', value: `${n} (${wins} won)`, provenance: 'RECORDED_FACT', sample_size: n });
  const byResult = new Map<string, number>();
  for (const a of verified) byResult.set(a.verified_outcome!.verified_result, (byResult.get(a.verified_outcome!.verified_result) ?? 0) + 1);
  signals.push({ label: 'Result mix', value: [...byResult].map(([k, v]) => `${k} ${v}`).join(', '), provenance: 'RECORDED_FACT', sample_size: n });
  const hours = verified.map(a => (Date.parse(a.verified_outcome!.at) - Date.parse(a.proposed_at)) / 3_600_000).filter(h => h >= 0);
  if (hours.length) {
    signals.push({ label: 'Mean time to verified outcome', value: `${(hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(1)} h`, provenance: 'RECORDED_FACT', sample_size: hours.length });
  }
  const rate = (wins + 1) / (n + 2);
  const applied = n >= MIN_LEARNING_SAMPLE;
  const multiplier = applied ? Math.min(1.5, Math.max(0.5, rate / 0.5)) : 1;
  signals.push({
    label: 'Smoothed win rate',
    value: `${(rate * 100).toFixed(0)}%${applied ? '' : ` (needs ${MIN_LEARNING_SAMPLE}+ verified outcomes before it affects ranking)`}`,
    provenance: 'MODEL_INFERENCE',
    sample_size: n
  });
  if (applied) {
    signals.push({ label: 'Ranking multiplier (bounded 0.5-1.5)', value: multiplier.toFixed(2), provenance: 'MODEL_INFERENCE', sample_size: n });
  }
  return { signals, ranking_multiplier: Number(multiplier.toFixed(4)), applied };
}

const STEP_TIER: Record<WealthNextAction['governance_step'], number> = {
  EXECUTE_APPROVED: 0,
  VERIFY_OUTCOME: 1,
  AWAIT_HUMAN_APPROVAL: 2,
  PROPOSE_ACTION: 3
};

function summariseLoop(loop: EconomicLoopState, evidenceBacked: number, opportunities: number, nowIso: string): WealthLoopSummary {
  const actions = [...loop.actions.values()];
  const rec = reconcile(loop);
  const ever = (pred: (a: ActionRecord) => boolean) => actions.filter(pred).length;
  const approvedReady = actions.filter(a => a.state === 'APPROVED' && isApprovalValid(a, nowIso)).length;
  return {
    funnel: [
      { stage: 'OPPORTUNITIES', count: opportunities },
      { stage: 'EVIDENCE-BACKED', count: evidenceBacked },
      { stage: 'APPROVAL REQUIRED', count: actions.length },
      { stage: 'APPROVED', count: ever(a => a.history.some(h => h.to === 'APPROVED')) },
      { stage: 'ACTIONED', count: ever(a => a.execution !== null) },
      { stage: 'OUTCOME', count: ever(a => a.claimed_outcome !== null) },
      { stage: 'VERIFIED', count: ever(a => a.verified_outcome !== null) },
      { stage: 'REALISED', count: loop.ledger.filter(l => l.gross_revenue_aud > 0).length }
    ],
    pending_approvals: ever(a => a.state === 'AWAITING_APPROVAL'),
    approved_ready: approvedReady,
    expired_approvals: ever(a => a.state === 'APPROVED' && !isApprovalValid(a, nowIso)),
    in_progress: ever(a => a.state === 'EXECUTING'),
    awaiting_verification: ever(a => a.state === 'OUTCOME_PENDING'),
    realised_outcomes: ever(a => a.state === 'WON'),
    failed_or_cancelled: ever(a => TERMINAL_BAD.has(a.state)),
    reconciliation: rec,
    human_decisions: {
      approvals: countDecisions(actions, 'APPROVE_ACTION'),
      rejections: countDecisions(actions, 'REJECT_ACTION'),
      verifications: countDecisions(actions, 'VERIFY_OUTCOME'),
      returned_for_correction: countDecisions(actions, 'RETURN_OUTCOME'),
      human_cancellations: countDecisions(actions, 'CANCEL_ACTION')
    },
    operators: [...loop.operators.values()].map(o => ({
      operator_id: o.operator_id,
      fingerprint: o.fingerprint,
      label: o.label,
      status: o.revoked_seq === null ? ('ACTIVE' as const) : ('REVOKED' as const)
    })),
    recent_actions: [
      ...actions.filter(a => !FINISHED.has(a.state)).reverse(),
      ...actions.filter(a => FINISHED.has(a.state)).slice(-10).reverse()
    ].map(a => ({
      ...a,
      type: a.scope.type,
      approved: a.approval !== null,
      execution_mode: a.execution?.mode ?? null
    }))
  };
}

/** Pure projection. Estimates never feed realised totals. */
export function computeWealthCommand(
  economy: EconomyInput,
  targetAud: number = WEALTH_TARGET_AUD,
  loop?: EconomicLoopState,
  now: Date = new Date()
): WealthCommand {
  const nowIso = now.toISOString();
  const learning = computeLearning(loop);
  const rec = loop ? reconcile(loop) : null;
  const loopGross = rec?.ok ? rec.gross_revenue_aud : 0;
  const loopNet = rec?.ok ? rec.net_cash_aud : 0;
  const loopCustomers = rec?.ok ? rec.customers_won : 0;
  const actions = loop ? [...loop.actions.values()] : [];

  const blocked: WealthCommand['blocked'] = [];
  const candidates: WealthNextAction[] = [];

  for (const o of economy.top_opportunities) {
    const factor = STAGE_FACTOR[o.status];
    const blockers: string[] = [];
    if (o.status === 'REJECTED' || o.status === 'LOST' || o.status === 'WON') blockers.push(`Opportunity is ${o.status}.`);
    else if (factor === undefined) blockers.push(`Status ${o.status} is not actionable.`);
    if (o.evidence_count <= 0) blockers.push('No evidence recorded.');
    if (!(o.proposed_price_aud > 0)) blockers.push('No priced offer.');
    const existing = actions.filter(a => a.opportunity_id === o.opportunity_id && !['WON', 'LOST', 'CANCELLED', 'FAILED', 'REJECTED'].includes(a.state)).at(-1);

    let step: WealthNextAction['governance_step'] = 'PROPOSE_ACTION';
    if (existing) {
      if (existing.state === 'APPROVED') {
        if (isApprovalValid(existing, nowIso)) step = 'EXECUTE_APPROVED';
        else blockers.push('Approval expired or no longer matches scope; re-approval needed.');
        step = blockers.length ? 'AWAIT_HUMAN_APPROVAL' : step;
      } else if (existing.state === 'AWAITING_APPROVAL') step = 'AWAIT_HUMAN_APPROVAL';
      else if (existing.state === 'OUTCOME_PENDING') step = 'VERIFY_OUTCOME';
      else if (existing.state === 'EXECUTING') blockers.push('Execution in progress; outcome not yet recorded.');
    }
    if (blockers.length && !(existing && (step === 'AWAIT_HUMAN_APPROVAL' || step === 'VERIFY_OUTCOME'))) {
      blocked.push({ opportunity_id: o.opportunity_id, title: o.title, blockers });
      continue;
    }
    if (blockers.length) {
      blocked.push({ opportunity_id: o.opportunity_id, title: o.title, blockers });
    }
    const ev = Number((o.proposed_price_aud * Math.min(Math.max(o.confidence, 0), 1) * (factor ?? 0) * learning.ranking_multiplier).toFixed(2));
    const why: Record<WealthNextAction['governance_step'], string> = {
      EXECUTE_APPROVED: 'A valid, in-scope human approval exists; execution may proceed within that scope.',
      VERIFY_OUTCOME: 'An outcome is claimed but unverified; a human must verify it before any ledger effect.',
      AWAIT_HUMAN_APPROVAL: 'A proposal exists but has no valid human approval.',
      PROPOSE_ACTION: 'Evidence-backed and priced; an agent may draft a bounded proposal. Nothing executes without approval.'
    };
    candidates.push({
      opportunity_id: o.opportunity_id,
      title: o.title,
      stage: o.status,
      expected_value_aud: ev,
      requires_approval: step !== 'EXECUTE_APPROVED',
      requires_approval_label: step === 'EXECUTE_APPROVED' ? 'NO (inside existing valid human approval)' : 'YES',
      spend_required_aud: existing?.scope.max_cost_aud ?? 0,
      governance_step: step,
      action_id: existing?.action_id ?? null,
      blockers,
      reason: `${why[step]} Estimated value ${ev} AUD (price x confidence x stage assumption x learning multiplier).`
    });
  }

  // Active actions whose opportunity fell outside the ranked list must still surface (e.g. a pending verification).
  const covered = new Set(economy.top_opportunities.map(o => o.opportunity_id));
  for (const a of actions) {
    if (covered.has(a.opportunity_id) || !['AWAITING_APPROVAL', 'APPROVED', 'OUTCOME_PENDING'].includes(a.state)) continue;
    const step: WealthNextAction['governance_step'] =
      a.state === 'OUTCOME_PENDING' ? 'VERIFY_OUTCOME'
      : a.state === 'APPROVED' && isApprovalValid(a, nowIso) ? 'EXECUTE_APPROVED'
      : 'AWAIT_HUMAN_APPROVAL';
    candidates.push({
      opportunity_id: a.opportunity_id,
      title: `Action ${a.action_id.slice(0, 8)} (opportunity outside ranked list)`,
      stage: 'UNRANKED',
      expected_value_aud: 0,
      requires_approval: step !== 'EXECUTE_APPROVED',
      requires_approval_label: step === 'EXECUTE_APPROVED' ? 'NO (inside existing valid human approval)' : 'YES',
      spend_required_aud: a.scope.max_cost_aud,
      governance_step: step,
      action_id: a.action_id,
      blockers: [],
      reason: 'An active governed action exists for this opportunity; governance readiness outranks value.'
    });
  }

  // Governance readiness outranks raw value: a high-value, unauthorised action never beats a lower-value ready one.
  candidates.sort((a, b) => STEP_TIER[a.governance_step] - STEP_TIER[b.governance_step] || b.expected_value_aud - a.expected_value_aud);

  const counted = candidates.filter(c => c.governance_step === 'PROPOSE_ACTION' || c.governance_step === 'AWAIT_HUMAN_APPROVAL' || c.governance_step === 'EXECUTE_APPROVED' || c.governance_step === 'VERIFY_OUTCOME');
  const expected = counted.reduce((s, c) => s + c.expected_value_aud, 0);
  const unweighted = economy.top_opportunities
    .filter(o => counted.some(c => c.opportunity_id === o.opportunity_id))
    .reduce((s, o) => s + o.proposed_price_aud, 0);

  const gross = Number((economy.gross_revenue_aud + loopGross).toFixed(2));
  const evidenceBacked = economy.top_opportunities.filter(o => o.evidence_count > 0).length;

  return {
    basis: 'PERSISTED_LEDGERS_ESTIMATE',
    realised: {
      gross_aud: gross,
      net_aud: Number((economy.net_cash_aud + loopNet).toFixed(2)),
      customers: economy.customers_won + loopCustomers,
      from_run_ledgers_aud: economy.gross_revenue_aud,
      from_verified_loop_aud: loopGross
    },
    pipeline_estimate: {
      expected_value_aud: Number(expected.toFixed(2)),
      unweighted_aud: Number(unweighted.toFixed(2)),
      opportunities_counted: counted.length,
      assumptions: [
        'Only evidence-backed, priced, non-rejected opportunities among the top ranked are counted.',
        'Value = price x recorded confidence x stage factor (discovered 10%, validating 25%, approved-for-test 50%) x learning multiplier.',
        'Stage factors are fixed planning assumptions, not measured conversion rates.',
        learning.applied
          ? 'Learning multiplier is a MODEL_INFERENCE from verified outcomes, bounded 0.5-1.5.'
          : `Learning multiplier is 1.0 until ${MIN_LEARNING_SAMPLE}+ verified outcomes exist.`
      ]
    },
    target: {
      target_aud: targetAud,
      realised_fraction: targetAud > 0 ? Math.min(gross / targetAud, 1) : 0,
      remaining_aud: Math.max(Number((targetAud - gross).toFixed(2)), 0)
    },
    funnel: Object.entries(economy.opportunities_by_status).map(([stage, count]) => ({ stage, count })),
    next_actions: candidates.slice(0, 5),
    blocked,
    loop: loop ? summariseLoop(loop, evidenceBacked, Object.values(economy.opportunities_by_status).reduce((s, n) => s + n, 0), nowIso) : null,
    learning,
    disclaimer: 'Pipeline figures are estimates. Only human-verified outcomes from real execution count as income.'
  };
}
