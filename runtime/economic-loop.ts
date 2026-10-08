import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  AuthorizationSchema,
  MAX_AUTH_TTL_MS,
  authorizationMessage,
  canonical,
  fingerprint,
  parsePublicKey,
  verifySignature,
  type AuthOperation,
  type Authorization,
  type OperatorSigner
} from './operator-identity.js';

/**
 * LAKE YANGE — GOVERNED ECONOMIC EXECUTION LOOP
 *
 * Append-only, hash-chained event log. All state is derived by folding events,
 * so history can never be rewritten by a later event.
 *
 * Invariant: ESTIMATE != PIPELINE != APPROVED ACTION != REALISED REVENUE.
 * Only a HUMAN-verified outcome from a REAL execution can create ledger value.
 * Agents can propose, revise, cancel and claim outcomes. They cannot approve,
 * verify or write revenue. Simulated executions never produce revenue.
 */

export class GovernanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GovernanceError';
  }
}

export class CorruptEconomicLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptEconomicLogError';
  }
}

const Id = z.string().min(1).max(200);
const Text = z.string().min(1).max(5000);
const Money = z.number().finite().nonnegative().max(1_000_000_000)
  .refine(v => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Money must be in whole cents.');

export const ACTION_TYPES = [
  'RESEARCH', 'DRAFT', 'CONTACT', 'FOLLOW_UP', 'PROPOSAL', 'DELIVERY', 'PAYMENT_REQUEST', 'OTHER'
] as const;

export const ActionScopeSchema = z
  .strictObject({
    type: z.enum(ACTION_TYPES),
    channel: Text.nullable(),
    recipient: Text.nullable(),
    payload_summary: Text,
    max_cost_aud: Money,
    money_involved: z.boolean(),
    external_communication: z.boolean(),
    real_execution: z.boolean()
  })
  .superRefine((scope, ctx) => {
    if (scope.max_cost_aud > 0 && !scope.money_involved) {
      ctx.addIssue({ code: 'custom', message: 'max_cost_aud > 0 requires money_involved=true.' });
    }
    if (['CONTACT', 'FOLLOW_UP', 'PROPOSAL', 'PAYMENT_REQUEST'].includes(scope.type) && !scope.external_communication) {
      ctx.addIssue({ code: 'custom', message: `${scope.type} must declare external_communication=true.` });
    }
  });
export type ActionScope = z.infer<typeof ActionScopeSchema>;

export type ActorKind = 'HUMAN' | 'AGENT' | 'EXECUTOR';
export interface Actor { kind: ActorKind; id: string }

export const OUTCOME_RESULTS = ['SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED', 'NO_RESPONSE', 'REJECTED'] as const;
export type OutcomeResult = (typeof OUTCOME_RESULTS)[number];

export type ActionState =
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'OUTCOME_PENDING'
  | 'WON'
  | 'LOST'
  | 'CANCELLED'
  | 'FAILED'
  | 'REJECTED';

/** Explicit transition table. Anything not listed fails closed. */
export const ACTION_TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
  AWAITING_APPROVAL: ['AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['AWAITING_APPROVAL', 'EXECUTING', 'CANCELLED'],
  EXECUTING: ['OUTCOME_PENDING', 'LOST', 'CANCELLED', 'FAILED'],
  OUTCOME_PENDING: ['WON', 'LOST', 'FAILED', 'CANCELLED', 'EXECUTING'],
  WON: [],
  LOST: [],
  CANCELLED: [],
  FAILED: [],
  REJECTED: []
};

const Actor = z.strictObject({ kind: z.enum(['HUMAN', 'AGENT', 'EXECUTOR']), id: Id });

const Payloads = {
  ACTION_PROPOSED: z.strictObject({
    action_id: Id,
    opportunity_id: Id,
    evidence_ids: z.array(Id).min(1).max(50),
    rationale: Text,
    scope: ActionScopeSchema
  }),
  ACTION_REVISED: z.strictObject({ action_id: Id, scope: ActionScopeSchema, reason: Text }),
  APPROVAL_GRANTED: z.strictObject({
    action_id: Id,
    scope_hash: z.string().length(64),
    expires_at: z.iso.datetime(),
    spend_cap_aud: Money,
    real_execution_permitted: z.boolean(),
    authorization: AuthorizationSchema
  }),
  APPROVAL_REJECTED: z.strictObject({ action_id: Id, reason: Text, authorization: AuthorizationSchema }),
  /** Agents may cancel unsigned; a human cancel must be signed. */
  ACTION_CANCELLED: z.strictObject({ action_id: Id, reason: Text, authorization: AuthorizationSchema.optional() }),
  EXECUTION_STARTED: z.strictObject({
    action_id: Id,
    mode: z.enum(['SIMULATED', 'REAL']),
    executor_id: Id,
    scope_hash: z.string().length(64)
  }),
  OUTCOME_RECORDED: z.strictObject({
    action_id: Id,
    claimed_result: z.enum(OUTCOME_RESULTS),
    claimed_revenue_aud: Money,
    claimed_cost_aud: Money,
    evidence_ids: z.array(Id).max(50),
    receipt_id: Id.nullable(),
    notes: z.string().max(5000)
  }),
  OUTCOME_VERIFIED: z.strictObject({
    action_id: Id,
    verified_result: z.enum(OUTCOME_RESULTS),
    verified_revenue_aud: Money,
    verified_cost_aud: Money,
    customer_id: Id.nullable(),
    evidence_ids: z.array(Id).max(50),
    notes: z.string().max(5000),
    authorization: AuthorizationSchema
  }),
  OUTCOME_RETURNED: z.strictObject({ action_id: Id, reason: Text, authorization: AuthorizationSchema }),
  OPERATOR_ENROLLED: z.strictObject({
    operator_id: z.string().min(3).max(40),
    public_key: z.string().min(40).max(200),
    label: Text,
    authorization: AuthorizationSchema
  }),
  OPERATOR_REVOKED: z.strictObject({ operator_id: z.string().min(3).max(40), reason: Text, authorization: AuthorizationSchema })
} as const;
export type Unsigned<T extends EventType> = Omit<EventPayload<T>, 'authorization'>;

export type EventType = keyof typeof Payloads;
export type EventPayload<T extends EventType> = z.infer<(typeof Payloads)[T]>;

export interface EconomicEvent<T extends EventType = EventType> {
  seq: number;
  event_id: string;
  type: T;
  at: string;
  actor: Actor;
  payload: EventPayload<T>;
  prev_hash: string;
  hash: string;
}

export interface OpportunityFacts {
  status: string;
  evidence_count: number;
}

export interface ActionRecord {
  action_id: string;
  opportunity_id: string;
  evidence_ids: string[];
  rationale: string;
  proposed_by: Actor;
  proposed_at: string;
  scope: ActionScope;
  scope_hash: string;
  state: ActionState;
  approval: null | {
    approved_by: Actor;
    approved_at: string;
    scope_hash: string;
    expires_at: string;
    spend_cap_aud: number;
    real_execution_permitted: boolean;
    authorization: Authorization;
  };
  execution: null | { mode: 'SIMULATED' | 'REAL'; executor_id: string; started_at: string };
  claimed_outcome: null | EventPayload<'OUTCOME_RECORDED'> & { at: string; claimed_by: Actor };
  verified_outcome: null | EventPayload<'OUTCOME_VERIFIED'> & { at: string; verified_by: Actor };
  returned_claims: (EventPayload<'OUTCOME_RECORDED'> & { at: string; claimed_by: Actor; returned_at: string; returned_by: string; reason: string })[];
  human_decisions: { seq: number; at: string; operator_id: string; operation: string }[];
  history: { seq: number; type: EventType; at: string; to: ActionState }[];
}

export interface LedgerEntry {
  ledger_id: string;
  action_id: string;
  opportunity_id: string;
  customer_id: string | null;
  gross_revenue_aud: number;
  direct_cost_aud: number;
  recorded_at: string;
  event_seq: number;
}

export interface OperatorRecord {
  operator_id: string;
  public_key: string;
  fingerprint: string;
  label: string;
  enrolled_seq: number;
  enrolled_at: string;
  revoked_seq: number | null;
  revoked_at: string | null;
}

export interface EconomicLoopState {
  operators: Map<string, OperatorRecord>;
  nonces: Set<string>;
  actions: Map<string, ActionRecord>;
  ledger: LedgerEntry[];
  event_ids: Map<string, string>;
  last_seq: number;
  last_hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export function scopeHash(opportunityId: string, scope: ActionScope): string {
  return sha(canonical({ opportunity_id: opportunityId, scope }));
}

function eventHash(e: Omit<EconomicEvent, 'hash'>): string {
  return sha(canonical(e));
}

export function emptyState(): EconomicLoopState {
  return { operators: new Map(), nonces: new Set(), actions: new Map(), ledger: [], event_ids: new Map(), last_seq: 0, last_hash: GENESIS_HASH };
}

function transition(record: ActionRecord, to: ActionState, event: EconomicEvent): void {
  if (!ACTION_TRANSITIONS[record.state].includes(to)) {
    throw new GovernanceError(`Invalid transition ${record.state} -> ${to} for action ${record.action_id}.`);
  }
  record.state = to;
  record.history.push({ seq: event.seq, type: event.type, at: event.at, to });
}

function need(state: EconomicLoopState, id: string): ActionRecord {
  const record = state.actions.get(id);
  if (!record) throw new GovernanceError(`Unknown action ${id}.`);
  return record;
}

function requireHuman(actor: Actor, what: string): void {
  if (actor.kind !== 'HUMAN') throw new GovernanceError(`${what} requires a HUMAN actor; ${actor.kind} is not permitted.`);
}

export function isApprovalValid(record: ActionRecord, at: string): boolean {
  const a = record.approval;
  return (
    !!a &&
    a.scope_hash === record.scope_hash &&
    Date.parse(a.expires_at) > Date.parse(at)
  );
}

const MAX_SKEW_MS = 5_000;

/** Every human decision must carry a valid, unexpired, unreplayed signature bound to action, scope and payload. */
function checkAuthorization(
  state: EconomicLoopState,
  event: EconomicEvent,
  operation: AuthOperation,
  actionId: string | null,
  scopeHash: string | null,
  payload: Record<string, any>,
  enrolling?: { public_key: string }
): void {
  requireHuman(event.actor, operation);
  const auth = payload.authorization as Authorization | undefined;
  if (!auth) throw new GovernanceError(`Unsigned human event refused (${operation}).`);
  if (auth.operation !== operation) throw new GovernanceError(`Authorization is for ${auth.operation}, not ${operation}.`);
  if (auth.action_id !== actionId) throw new GovernanceError('Authorization action does not match this action.');
  if (auth.scope_hash !== scopeHash) throw new GovernanceError('Authorization scope does not match the current action scope.');
  if (auth.operator_id !== event.actor.id) throw new GovernanceError('Authorization operator does not match the event actor.');
  let publicKey: string;
  if (enrolling) {
    publicKey = enrolling.public_key;
  } else {
    const operator = state.operators.get(auth.operator_id);
    if (!operator) throw new GovernanceError(`Unknown operator ${auth.operator_id}.`);
    if (operator.revoked_seq !== null) throw new GovernanceError(`Operator ${auth.operator_id} has been revoked.`);
    publicKey = operator.public_key;
  }
  const at = Date.parse(event.at);
  const from = Date.parse(auth.signed_at);
  const until = Date.parse(auth.valid_until);
  if (from > at + MAX_SKEW_MS) throw new GovernanceError('Authorization is dated in the future.');
  if (until < at) throw new GovernanceError('Authorization has expired.');
  if (until - from > MAX_AUTH_TTL_MS) throw new GovernanceError('Authorization lifetime exceeds the maximum.');
  if (state.nonces.has(auth.nonce)) throw new GovernanceError('Authorization replay refused (nonce already used).');
  const { authorization: _discard, ...params } = payload;
  const { signature, ...fields } = auth;
  if (!verifySignature(publicKey, authorizationMessage(fields, params), signature)) {
    throw new GovernanceError('Invalid operator signature.');
  }
  state.nonces.add(auth.nonce);
}

function decide(record: ActionRecord, event: EconomicEvent, operation: string): void {
  record.human_decisions.push({ seq: event.seq, at: event.at, operator_id: event.actor.id, operation });
}

/** Pure fold step. Throws GovernanceError on any rule violation (fail closed). */
const HUMAN_ONLY_EVENTS = new Set<string>(['APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'OUTCOME_VERIFIED', 'OUTCOME_RETURNED', 'OPERATOR_ENROLLED', 'OPERATOR_REVOKED']);

export function applyEvent(state: EconomicLoopState, event: EconomicEvent): void {
  const schema = Payloads[event.type];
  if (!schema) throw new GovernanceError(`Unknown event type ${String(event.type)}.`);
  if (HUMAN_ONLY_EVENTS.has(event.type) && event.actor?.kind !== 'HUMAN') {
    throw new GovernanceError(`${event.type} requires a HUMAN actor; got ${String(event.actor?.kind)}.`);
  }
  const payload = schema.parse(event.payload) as never as Record<string, any>;
  Actor.parse(event.actor);

  switch (event.type) {
    case 'ACTION_PROPOSED': {
      if (event.actor.kind === 'EXECUTOR') throw new GovernanceError('Executors cannot propose actions.');
      if (state.actions.has(payload.action_id)) throw new GovernanceError(`Action ${payload.action_id} already exists.`);
      const record: ActionRecord = {
        action_id: payload.action_id,
        opportunity_id: payload.opportunity_id,
        evidence_ids: payload.evidence_ids,
        rationale: payload.rationale,
        proposed_by: event.actor,
        proposed_at: event.at,
        scope: payload.scope,
        scope_hash: scopeHash(payload.opportunity_id, payload.scope),
        state: 'AWAITING_APPROVAL',
        approval: null,
        execution: null,
        claimed_outcome: null,
        verified_outcome: null,
        returned_claims: [],
        human_decisions: [],
        history: [{ seq: event.seq, type: event.type, at: event.at, to: 'AWAITING_APPROVAL' }]
      };
      state.actions.set(record.action_id, record);
      break;
    }
    case 'ACTION_REVISED': {
      const r = need(state, payload.action_id);
      if (event.actor.kind === 'EXECUTOR') throw new GovernanceError('Executors cannot revise actions.');
      transition(r, 'AWAITING_APPROVAL', event);
      r.scope = payload.scope;
      r.scope_hash = scopeHash(r.opportunity_id, payload.scope);
      r.approval = null;
      break;
    }
    case 'APPROVAL_GRANTED': {
      requireHuman(event.actor, 'Approval');
      const r = need(state, payload.action_id);
      if (payload.scope_hash !== r.scope_hash) throw new GovernanceError('Approval scope does not match the current action scope.');
      checkAuthorization(state, event, 'APPROVE_ACTION', r.action_id, r.scope_hash, payload);
      if (Date.parse(payload.expires_at) <= Date.parse(event.at)) throw new GovernanceError('Approval is already expired.');
      if (payload.spend_cap_aud > 0 && !r.scope.money_involved) throw new GovernanceError('Spend cap given for an action with no money involved.');
      if (payload.spend_cap_aud < r.scope.max_cost_aud) throw new GovernanceError('Spend cap is below the action maximum cost.');
      if (payload.real_execution_permitted && !r.scope.real_execution) throw new GovernanceError('Real execution permitted but not declared in scope.');
      transition(r, 'APPROVED', event);
      r.approval = {
        approved_by: event.actor,
        approved_at: event.at,
        scope_hash: payload.scope_hash,
        expires_at: payload.expires_at,
        spend_cap_aud: payload.spend_cap_aud,
        real_execution_permitted: payload.real_execution_permitted,
        authorization: payload.authorization
      };
      decide(r, event, 'APPROVE_ACTION');
      break;
    }
    case 'APPROVAL_REJECTED': {
      requireHuman(event.actor, 'Rejection');
      const r = need(state, payload.action_id);
      checkAuthorization(state, event, 'REJECT_ACTION', r.action_id, r.scope_hash, payload);
      transition(r, 'REJECTED', event);
      decide(r, event, 'REJECT_ACTION');
      break;
    }
    case 'ACTION_CANCELLED': {
      const r = need(state, payload.action_id);
      if (event.actor.kind === 'EXECUTOR') throw new GovernanceError('Executors cannot cancel actions.');
      if (event.actor.kind === 'HUMAN') {
        checkAuthorization(state, event, 'CANCEL_ACTION', r.action_id, r.scope_hash, payload);
        decide(r, event, 'CANCEL_ACTION');
      }
      transition(r, 'CANCELLED', event);
      break;
    }
    case 'EXECUTION_STARTED': {
      if (event.actor.kind !== 'EXECUTOR') throw new GovernanceError('Only an executor may start execution.');
      const r = need(state, payload.action_id);
      if (r.execution) throw new GovernanceError(`Action ${r.action_id} has already been executed.`);
      if (!isApprovalValid(r, event.at)) throw new GovernanceError('No valid, in-scope, unexpired approval.');
      if (payload.scope_hash !== r.scope_hash) throw new GovernanceError('Execution scope differs from the approved scope.');
      if (payload.mode === 'REAL' && !(r.approval!.real_execution_permitted && r.scope.real_execution)) {
        throw new GovernanceError('Real execution was not explicitly approved.');
      }
      transition(r, 'EXECUTING', event);
      r.execution = { mode: payload.mode, executor_id: payload.executor_id, started_at: event.at };
      break;
    }
    case 'OUTCOME_RECORDED': {
      const r = need(state, payload.action_id);
      if (event.actor.kind === 'EXECUTOR') throw new GovernanceError('Executors cannot claim outcomes.');
      if (r.claimed_outcome) throw new GovernanceError('An outcome has already been recorded for this action.');
      if (payload.claimed_result !== 'SUCCESS' && payload.claimed_result !== 'PARTIAL' && payload.claimed_revenue_aud > 0) {
        throw new GovernanceError(`Result ${payload.claimed_result} cannot carry revenue.`);
      }
      // Every claim, including claimed failures, waits for human verification.
      transition(r, 'OUTCOME_PENDING', event);
      r.claimed_outcome = { ...payload, at: event.at, claimed_by: event.actor } as ActionRecord['claimed_outcome'];
      break;
    }
    case 'OUTCOME_RETURNED': {
      requireHuman(event.actor, 'Outcome return');
      const r = need(state, payload.action_id);
      checkAuthorization(state, event, 'RETURN_OUTCOME', r.action_id, r.scope_hash, payload);
      if (r.state !== 'OUTCOME_PENDING' || !r.claimed_outcome) throw new GovernanceError(`Action is ${r.state}, no pending claim to return.`);
      transition(r, 'EXECUTING', event);
      r.returned_claims.push({ ...r.claimed_outcome, returned_at: event.at, returned_by: event.actor.id, reason: payload.reason });
      r.claimed_outcome = null;
      decide(r, event, 'RETURN_OUTCOME');
      break;
    }
    case 'OUTCOME_VERIFIED': {
      requireHuman(event.actor, 'Outcome verification');
      const r = need(state, payload.action_id);
      checkAuthorization(state, event, 'VERIFY_OUTCOME', r.action_id, r.scope_hash, payload);
      if (r.verified_outcome) throw new GovernanceError('Outcome already verified; replay refused.');
      if (r.state !== 'OUTCOME_PENDING') throw new GovernanceError(`Action is ${r.state}, not awaiting verification.`);
      const revenue = payload.verified_revenue_aud;
      const wins = payload.verified_result === 'SUCCESS' || payload.verified_result === 'PARTIAL';
      if (revenue > 0 && !wins) throw new GovernanceError(`Result ${payload.verified_result} cannot carry revenue.`);
      if (revenue > 0) {
        if (r.execution?.mode !== 'REAL') throw new GovernanceError('Simulated execution can never create realised revenue.');
        if (payload.evidence_ids.length === 0) throw new GovernanceError('Revenue requires payment evidence.');
        if (!payload.customer_id) throw new GovernanceError('Revenue requires a customer id.');
      }
      if (payload.verified_cost_aud > (r.approval?.spend_cap_aud ?? 0)) {
        throw new GovernanceError('Verified cost exceeds the approved spend cap.');
      }
      const to: ActionState = payload.verified_result === 'FAILED' ? 'FAILED'
        : payload.verified_result === 'CANCELLED' ? 'CANCELLED'
        : revenue > 0 ? 'WON' : 'LOST';
      transition(r, to, event);
      r.verified_outcome = { ...payload, at: event.at, verified_by: event.actor } as ActionRecord['verified_outcome'];
      decide(r, event, 'VERIFY_OUTCOME');
      if (revenue > 0 || payload.verified_cost_aud > 0) {
        state.ledger.push({
          ledger_id: `ledger:${r.action_id}`,
          action_id: r.action_id,
          opportunity_id: r.opportunity_id,
          customer_id: payload.customer_id,
          gross_revenue_aud: revenue,
          direct_cost_aud: payload.verified_cost_aud,
          recorded_at: event.at,
          event_seq: event.seq
        });
      }
      break;
    }
    case 'OPERATOR_ENROLLED': {
      requireHuman(event.actor, 'Operator enrollment');
      try {
        parsePublicKey(payload.public_key);
      } catch {
        throw new GovernanceError('Operator public key is not a valid Ed25519 key.');
      }
      if (state.operators.has(payload.operator_id)) throw new GovernanceError(`Operator id ${payload.operator_id} was already used.`);
      if ([...state.operators.values()].some(o => o.public_key === payload.public_key)) throw new GovernanceError('Operator key is already enrolled.');
      const first = state.operators.size === 0;
      if (first && event.actor.id !== payload.operator_id) throw new GovernanceError('First operator enrollment must be self-signed.');
      checkAuthorization(state, event, 'ENROLL_OPERATOR', null, null, payload, first ? { public_key: payload.public_key } : undefined);
      state.operators.set(payload.operator_id, {
        operator_id: payload.operator_id,
        public_key: payload.public_key,
        fingerprint: fingerprint(payload.public_key),
        label: payload.label,
        enrolled_seq: event.seq,
        enrolled_at: event.at,
        revoked_seq: null,
        revoked_at: null
      });
      break;
    }
    case 'OPERATOR_REVOKED': {
      requireHuman(event.actor, 'Operator revocation');
      const target = state.operators.get(payload.operator_id);
      if (!target) throw new GovernanceError(`Unknown operator ${payload.operator_id}.`);
      if (target.revoked_seq !== null) throw new GovernanceError(`Operator ${payload.operator_id} is already revoked.`);
      checkAuthorization(state, event, 'REVOKE_OPERATOR', null, null, payload);
      target.revoked_seq = event.seq;
      target.revoked_at = event.at;
      break;
    }
  }
}

/** Rebuild state from a log, verifying sequence and hash chain. Fails closed on corruption. */
export function foldEvents(events: readonly EconomicEvent[]): EconomicLoopState {
  const state = emptyState();
  for (const event of events) {
    if (event.seq !== state.last_seq + 1) throw new CorruptEconomicLogError(`Sequence gap at ${event.seq}.`);
    if (event.prev_hash !== state.last_hash) throw new CorruptEconomicLogError(`Broken hash chain at ${event.seq}.`);
    const { hash, ...rest } = event;
    if (hash !== eventHash(rest)) throw new CorruptEconomicLogError(`Hash mismatch at ${event.seq}.`);
    if (state.event_ids.has(event.event_id)) throw new CorruptEconomicLogError(`Duplicate event id ${event.event_id}.`);
    try {
      applyEvent(state, event);
    } catch (error) {
      throw new CorruptEconomicLogError(`Event ${event.seq} violates governance: ${(error as Error).message}`);
    }
    state.event_ids.set(event.event_id, event.hash);
    state.last_seq = event.seq;
    state.last_hash = event.hash;
  }
  return state;
}

export interface Reconciliation {
  ok: boolean;
  gross_revenue_aud: number;
  direct_costs_aud: number;
  net_cash_aud: number;
  customers_won: number;
  problems: string[];
}

/** Recompute realised totals from verified outcomes and check ledger integrity. */
export function reconcile(state: EconomicLoopState): Reconciliation {
  const problems: string[] = [];
  const seen = new Set<string>();
  let gross = 0;
  let cost = 0;
  const customers = new Set<string>();
  for (const entry of state.ledger) {
    const r = state.actions.get(entry.action_id);
    if (!r?.verified_outcome) problems.push(`Ledger ${entry.ledger_id} has no verified outcome.`);
    if (seen.has(entry.action_id)) problems.push(`Duplicate ledger entry for ${entry.action_id}.`);
    seen.add(entry.action_id);
    if (r?.execution?.mode !== 'REAL' && entry.gross_revenue_aud > 0) problems.push(`Revenue from non-real execution ${entry.action_id}.`);
    if (entry.ledger_id !== `ledger:${entry.action_id}`) problems.push(`Ledger id ${entry.ledger_id} is malformed.`);
    if (entry.gross_revenue_aud > 0 && r?.state !== 'WON') problems.push(`Revenue on ${entry.action_id} which is ${r?.state ?? 'unknown'}, not WON.`);
    const v = r?.verified_outcome;
    if (v && (Math.abs(v.verified_revenue_aud - entry.gross_revenue_aud) > 1e-6 || Math.abs(v.verified_cost_aud - entry.direct_cost_aud) > 1e-6 || v.customer_id !== entry.customer_id || r!.opportunity_id !== entry.opportunity_id)) {
      problems.push(`Ledger ${entry.ledger_id} disagrees with its verified outcome.`);
    }
    if (!(entry.gross_revenue_aud >= 0) || !(entry.direct_cost_aud >= 0)) problems.push(`Invalid amount in ${entry.ledger_id}.`);
    gross += entry.gross_revenue_aud;
    cost += entry.direct_cost_aud;
    if (entry.customer_id && entry.gross_revenue_aud > 0) customers.add(entry.customer_id);
  }
  for (const r of state.actions.values()) {
    if (r.state === 'WON' && !state.ledger.some(e => e.action_id === r.action_id)) problems.push(`WON action ${r.action_id} has no ledger entry.`);
    if (r.verified_outcome && r.verified_outcome.verified_revenue_aud > 0 && !seen.has(r.action_id)) problems.push(`Verified revenue for ${r.action_id} missing from ledger.`);
  }
  return {
    ok: problems.length === 0,
    gross_revenue_aud: Number(gross.toFixed(2)),
    direct_costs_aud: Number(cost.toFixed(2)),
    net_cash_aud: Number((gross - cost).toFixed(2)),
    customers_won: customers.size,
    problems
  };
}

export type OpportunityResolver = (opportunityId: string) => Promise<OpportunityFacts | null> | OpportunityFacts | null;

const PROPOSABLE = new Set(['VALIDATING', 'APPROVED_FOR_TEST']);

export interface ExecutionRequest { action_id: string; opportunity_id: string; scope: ActionScope; scope_hash: string }
export interface EconomicExecutor {
  readonly id: string;
  readonly mode: 'SIMULATED' | 'REAL';
  execute(request: ExecutionRequest): Promise<{ note: string }>;
}

/** Default executor: records that a dry run happened. No side effects, never yields revenue. */
export class SimulatedExecutor implements EconomicExecutor {
  readonly id = 'simulated-executor';
  readonly mode = 'SIMULATED' as const;
  async execute(request: ExecutionRequest): Promise<{ note: string }> {
    return { note: `Dry run of ${request.scope.type}; no external effect.` };
  }
}

export interface StoreOptions {
  now?: () => Date;
  resolveOpportunity: OpportunityResolver;
}

export type HumanOptsObject = { scope_hash?: string | undefined; event_id?: string | undefined; ttl_ms?: number | undefined };
export type HumanOpts = string | HumanOptsObject;
type PayloadBuilder<T extends EventType> = EventPayload<T> | ((ctx: { at: Date; state: EconomicLoopState }) => EventPayload<T>);

function normaliseOpts(opts: HumanOpts | undefined): HumanOptsObject {
  return typeof opts === 'string' ? { event_id: opts } : opts ?? {};
}

function stripAuth(payload: unknown): unknown {
  if (payload && typeof payload === 'object') {
    const { authorization: _a, ...rest } = payload as Record<string, unknown>;
    return rest;
  }
  return payload;
}

export class EconomicLoopStore {
  private readonly file: string;
  private readonly now: () => Date;
  private readonly resolve: OpportunityResolver;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string, options: StoreOptions) {
    this.file = join(root, '.sink/economy/events.jsonl');
    this.now = options.now ?? (() => new Date());
    this.resolve = options.resolveOpportunity;
  }

  async readEvents(): Promise<EconomicEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return raw.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line) as EconomicEvent;
      } catch {
        throw new CorruptEconomicLogError(`Unparseable line ${index + 1}.`);
      }
    });
  }

  async load(): Promise<EconomicLoopState> {
    return foldEvents(await this.readEvents());
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Validate against current state and append. A repeated event_id with identical content
   * (ignoring the signature, which is regenerated) is a no-op.
   */
  private submit<T extends EventType>(type: T, actor: Actor, payload: PayloadBuilder<T>, eventId?: string): Promise<EconomicEvent> {
    return this.serial(async () => {
      const events = await this.readEvents();
      const state = foldEvents(events);
      const id = eventId ?? randomUUID();
      const nowDate = this.now();
      const at = nowDate.toISOString();
      const resolved = typeof payload === 'function' ? payload({ at: nowDate, state }) : payload;
      const existingHash = state.event_ids.get(id);
      if (existingHash) {
        const existing = events.find(e => e.event_id === id)!;
        if (existing.type !== type || canonical(stripAuth(existing.payload)) !== canonical(stripAuth(resolved)) || canonical(existing.actor) !== canonical(actor)) {
          throw new GovernanceError(`Event id ${id} was already used with different content.`);
        }
        return existing;
      }
      const base = { seq: state.last_seq + 1, event_id: id, type, at, actor, payload: resolved, prev_hash: state.last_hash };
      const event = { ...base, hash: eventHash(base as never) } as EconomicEvent;
      applyEvent(state, event);
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, `${JSON.stringify(event)}\n`, 'utf8');
      return event;
    });
  }

  private async checkOpportunity(opportunityId: string): Promise<void> {
    const facts = await this.resolve(opportunityId);
    if (!facts) throw new GovernanceError(`Opportunity ${opportunityId} is not in any persisted ledger.`);
    if (facts.evidence_count < 1) throw new GovernanceError('Opportunity has no evidence and cannot advance.');
    if (!PROPOSABLE.has(facts.status)) throw new GovernanceError(`Opportunity status ${facts.status} cannot be actioned.`);
  }

  /** Agent-facing facade: no approval, verification or revenue capability exists on it. */
  asAgent(agentId: string) {
    const actor: Actor = { kind: 'AGENT', id: agentId };
    return {
      propose: async (input: { action_id?: string; opportunity_id: string; evidence_ids: string[]; rationale: string; scope: ActionScope; event_id?: string }) => {
        await this.checkOpportunity(input.opportunity_id);
        const action_id = input.action_id ?? randomUUID();
        await this.submit('ACTION_PROPOSED', actor, { action_id, opportunity_id: input.opportunity_id, evidence_ids: input.evidence_ids, rationale: input.rationale, scope: input.scope }, input.event_id);
        return action_id;
      },
      revise: (action_id: string, scope: ActionScope, reason: string, event_id?: string) =>
        this.submit('ACTION_REVISED', actor, { action_id, scope, reason }, event_id),
      cancel: (action_id: string, reason: string, event_id?: string) =>
        this.submit('ACTION_CANCELLED', actor, { action_id, reason }, event_id),
      claimOutcome: (payload: EventPayload<'OUTCOME_RECORDED'>, event_id?: string) =>
        this.submit('OUTCOME_RECORDED', actor, payload, event_id)
    };
  }

  /**
   * Human facade. Requires the operator's signer, so every decision is cryptographically signed.
   * Callers should pass `scope_hash` for the scope the human actually reviewed; it is signed and
   * must still equal the action's current scope when applied.
   */
  asHuman(signer: OperatorSigner) {
    const actor: Actor = { kind: 'HUMAN', id: signer.operator_id };
    const signed = <T extends 'APPROVAL_GRANTED' | 'APPROVAL_REJECTED' | 'ACTION_CANCELLED' | 'OUTCOME_VERIFIED' | 'OUTCOME_RETURNED'>(
      type: T,
      operation: AuthOperation,
      action_id: string,
      body: Unsigned<T>,
      opts: HumanOpts | undefined
    ) => {
      const o = normaliseOpts(opts);
      return this.submit(type, actor, (({ at, state }: { at: Date; state: EconomicLoopState }) => {
        const record = need(state, action_id);
        const authorization = signer.sign({ operation, action_id, scope_hash: o.scope_hash ?? record.scope_hash, params: body, now: at, ttl_ms: o.ttl_ms });
        return { ...body, authorization } as unknown as EventPayload<T>;
      }) as PayloadBuilder<T>, o.event_id);
    };
    return {
      operator_id: signer.operator_id,
      approve: async (action_id: string, options: { expires_in_minutes: number; spend_cap_aud?: number; real_execution_permitted?: boolean; event_id?: string; ttl_ms?: number }) => {
        const record = need(await this.load(), action_id);
        const expires = new Date(this.now().getTime() + options.expires_in_minutes * 60_000).toISOString();
        return signed('APPROVAL_GRANTED', 'APPROVE_ACTION', action_id, {
          action_id,
          scope_hash: record.scope_hash,
          expires_at: expires,
          spend_cap_aud: options.spend_cap_aud ?? record.scope.max_cost_aud,
          real_execution_permitted: options.real_execution_permitted ?? false
        }, { scope_hash: record.scope_hash, event_id: options.event_id, ttl_ms: options.ttl_ms });
      },
      /** Approve a specific scope hash the human actually reviewed. */
      approveReviewed: (action_id: string, scope_hash: string, options: { expires_at: string; spend_cap_aud: number; real_execution_permitted: boolean; event_id?: string; ttl_ms?: number }) =>
        signed('APPROVAL_GRANTED', 'APPROVE_ACTION', action_id, {
          action_id, scope_hash, expires_at: options.expires_at, spend_cap_aud: options.spend_cap_aud, real_execution_permitted: options.real_execution_permitted
        }, { scope_hash, event_id: options.event_id, ttl_ms: options.ttl_ms }),
      reject: (action_id: string, reason: string, opts?: HumanOpts) =>
        signed('APPROVAL_REJECTED', 'REJECT_ACTION', action_id, { action_id, reason }, opts),
      cancel: (action_id: string, reason: string, opts?: HumanOpts) =>
        signed('ACTION_CANCELLED', 'CANCEL_ACTION', action_id, { action_id, reason }, opts),
      verifyOutcome: (payload: Unsigned<'OUTCOME_VERIFIED'>, opts?: HumanOpts) =>
        signed('OUTCOME_VERIFIED', 'VERIFY_OUTCOME', payload.action_id, payload, opts),
      returnOutcome: (action_id: string, reason: string, opts?: HumanOpts) =>
        signed('OUTCOME_RETURNED', 'RETURN_OUTCOME', action_id, { action_id, reason }, opts)
    };
  }

  /** The first operator self-enrols (trust on first use). Later enrolments must be signed by an active operator. */
  enrollOperator(newOperator: OperatorSigner, label: string, approver?: OperatorSigner): Promise<EconomicEvent> {
    const signer = approver ?? newOperator;
    const body = { operator_id: newOperator.operator_id, public_key: newOperator.public_key, label };
    return this.submit('OPERATOR_ENROLLED', { kind: 'HUMAN', id: signer.operator_id }, (({ at }: { at: Date }) => ({
      ...body,
      authorization: signer.sign({ operation: 'ENROLL_OPERATOR', action_id: null, scope_hash: null, params: body, now: at })
    })) as PayloadBuilder<'OPERATOR_ENROLLED'>);
  }

  revokeOperator(approver: OperatorSigner, operatorId: string, reason: string): Promise<EconomicEvent> {
    const body = { operator_id: operatorId, reason };
    return this.submit('OPERATOR_REVOKED', { kind: 'HUMAN', id: approver.operator_id }, (({ at }: { at: Date }) => ({
      ...body,
      authorization: approver.sign({ operation: 'REVOKE_OPERATOR', action_id: null, scope_hash: null, params: body, now: at })
    })) as PayloadBuilder<'OPERATOR_REVOKED'>);
  }

  /** Executes an approved action through an explicit executor. Re-checks the opportunity and approval. */
  async execute(actionId: string, executor: EconomicExecutor = new SimulatedExecutor(), eventId?: string): Promise<EconomicEvent> {
    const state = await this.load();
    const record = need(state, actionId);
    await this.checkOpportunity(record.opportunity_id);
    const actor: Actor = { kind: 'EXECUTOR', id: executor.id };
    const id = eventId ?? `exec:${actionId}`;
    const replay = state.event_ids.has(id);
    const event = await this.submit('EXECUTION_STARTED', actor, {
      action_id: actionId,
      mode: executor.mode,
      executor_id: executor.id,
      scope_hash: record.scope_hash
    }, id);
    if (replay) return event;
    await executor.execute({ action_id: actionId, opportunity_id: record.opportunity_id, scope: record.scope, scope_hash: record.scope_hash });
    return event;
  }
}
