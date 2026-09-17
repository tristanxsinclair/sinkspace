import { z } from 'zod';


import { BlackboardEntrySchema } from './blackboard.js';
export const Id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const Text = z.string().min(1).max(20000);
const Timestamp = z.iso.datetime();
export const WorkflowSchema = z.enum([
  'capability-inventory',
  'crypto-mining',
  'revenue'
]);

export type Workflow =
  z.infer<typeof WorkflowSchema>;

export const MiningModeSchema = z.enum([
  'ASSESS',
  'BENCHMARK',
  'MINE'
]);

export const CryptoMiningMissionSchema = z.strictObject({
  mode: MiningModeSchema,

  miner: z.literal('xmrig').default('xmrig'),

  pool: z
    .string()
    .min(1)
    .max(300)
    .nullable()
    .default(null),

  wallet: z
    .string()
    .min(1)
    .max(300)
    .nullable()
    .default(null),

  worker: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('sink-clone'),

  max_minutes: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(15),

  threads: z
    .number()
    .int()
    .min(1)
    .max(32)
    .default(1)
});

export type CryptoMiningMission =
  z.infer<typeof CryptoMiningMissionSchema>;

export const RevenueModeSchema = z.enum([
  'DISCOVER',
  'VALIDATE',
  'OPERATE'
]);

export type RevenueMode =
  z.infer<typeof RevenueModeSchema>;

export const RevenueChannelSchema = z.enum([
  'EMAIL',
  'PHONE',
  'INSTAGRAM',
  'LINKEDIN',
  'IN_PERSON',
  'WEB_FORM',
  'OTHER'
]);

export type RevenueChannel =
  z.infer<typeof RevenueChannelSchema>;

export const RevenueMissionSchema = z.strictObject({
  mode: RevenueModeSchema,

  cash_target_aud: z
    .number()
    .finite()
    .nonnegative()
    .max(1000000000),

  horizon_days: z
    .number()
    .int()
    .min(1)
    .max(365),

  max_spend_aud: z
    .number()
    .finite()
    .nonnegative()
    .max(1000000)
    .default(0),

  max_tristan_minutes: z
    .number()
    .int()
    .nonnegative()
    .max(100000)
    .default(60),

  target_market: Text,

  allowed_channels: z
    .array(RevenueChannelSchema)
    .max(10)
    .default([]),

  offer_constraints: z
    .array(Text)
    .max(30)
    .default([]),

  operator_email: z
    .email()
    .nullable()
    .default(null)
});

export type RevenueMission =
  z.infer<typeof RevenueMissionSchema>;

export const RevenueOpportunitySchema = z.strictObject({
  opportunity_id: Id,

  title: Text,

  target_customer: Text,

  observed_pain: Text,

  proposed_offer: Text,

  proposed_price_aud: z
    .number()
    .finite()
    .nonnegative(),

  estimated_delivery_cost_aud: z
    .number()
    .finite()
    .nonnegative(),

  estimated_tristan_minutes: z
    .number()
    .int()
    .nonnegative(),

  estimated_time_to_cash_days: z
    .number()
    .int()
    .positive()
    .max(365),

  potential_recurring_revenue_aud: z
    .number()
    .finite()
    .nonnegative(),

  evidence_ids: z
    .array(Id),

  confidence: z
    .number()
    .min(0)
    .max(1),

  priority_score: z
    .number()
    .min(0)
    .max(100),

  score_basis: z
    .array(Text)
    .min(1)
    .max(20),

  status: z.enum([
    'DISCOVERED',
    'VALIDATING',
    'APPROVED_FOR_TEST',
    'REJECTED',
    'WON',
    'LOST'
  ])
});

export type RevenueOpportunity =
  z.infer<typeof RevenueOpportunitySchema>;

export const RevenueActionSchema = z.strictObject({
  action_id: Id,

  opportunity_id: Id,

  type: z.enum([
    'RESEARCH',
    'DRAFT',
    'CONTACT',
    'FOLLOW_UP',
    'PROPOSAL',
    'DELIVERY',
    'PAYMENT_REQUEST',
    'OTHER'
  ]),

  channel: RevenueChannelSchema.nullable(),

  recipient: Text.nullable(),

  payload_summary: Text,

  upside_case_aud: z
    .number()
    .finite()
    .nonnegative(),

  upside_basis: z
    .array(Text)
    .min(1)
    .max(20),

  max_cost_aud: z
    .number()
    .finite()
    .nonnegative(),

  approval_required: z.boolean(),

  approval_status: z.enum([
    'NOT_REQUIRED',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'EXPIRED'
  ]),

  status: z.enum([
    'PLANNED',
    'READY',
    'EXECUTED',
    'CANCELLED',
    'FAILED'
  ])
});

export type RevenueAction =
  z.infer<typeof RevenueActionSchema>;

export const RevenueOutcomeSchema = z
  .strictObject({
    action_id: Id,

    opportunity_id: Id,

    contacted: z.boolean(),

    replied: z.boolean(),

    meeting_booked: z.boolean(),

    proposal_sent: z.boolean(),

    paid: z.boolean(),

    gross_revenue_aud: z
      .number()
      .finite()
      .nonnegative(),

    direct_cost_aud: z
      .number()
      .finite()
      .nonnegative(),

    tristan_minutes: z
      .number()
      .int()
      .nonnegative(),

    payment_evidence_ids: z
      .array(Id),

    loss_reason: Text.nullable()
  })
  .superRefine((value, ctx) => {
    if (
      value.paid &&
      (
        value.gross_revenue_aud <= 0 ||
        value.payment_evidence_ids.length === 0
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Paid revenue requires positive gross revenue and payment evidence.'
      });
    }

    if (
      !value.paid &&
      value.gross_revenue_aud > 0
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Gross revenue cannot be recorded without paid=true.'
      });
    }
  });

export type RevenueOutcome =
  z.infer<typeof RevenueOutcomeSchema>;

export const RevenueLedgerSchema = z
  .strictObject({
    currency: z.literal('AUD'),

    gross_revenue_aud: z
      .number()
      .finite()
      .nonnegative(),

    direct_costs_aud: z
      .number()
      .finite()
      .nonnegative(),

    net_cash_aud: z
      .number()
      .finite(),

    tristan_minutes: z
      .number()
      .int()
      .nonnegative(),

    net_cash_per_tristan_hour: z
      .number()
      .finite()
      .nullable(),

    opportunities_tested: z
      .number()
      .int()
      .nonnegative(),

    actions_taken: z
      .number()
      .int()
      .nonnegative(),

    customers_won: z
      .number()
      .int()
      .nonnegative(),

    opportunities: z
      .array(RevenueOpportunitySchema),

    actions: z
      .array(RevenueActionSchema),

    outcomes: z
      .array(RevenueOutcomeSchema),

    updated_at: Timestamp
  })
  .superRefine((value, ctx) => {
    const expected =
      value.gross_revenue_aud -
      value.direct_costs_aud;

    if (
      Math.abs(
        expected -
        value.net_cash_aud
      ) > 0.000001
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'net_cash_aud must equal gross revenue minus direct costs.'
      });
    }

    if (
      value.tristan_minutes === 0 &&
      value.net_cash_per_tristan_hour !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'net_cash_per_tristan_hour must be null when Tristan time is zero.'
      });
    }
  });

export type RevenueLedger =
  z.infer<typeof RevenueLedgerSchema>;

export const MissionSchema = z.union([
  CryptoMiningMissionSchema,
  RevenueMissionSchema
]);

export type Mission =
  z.infer<typeof MissionSchema>;

export const StatusSchema = z.enum(['QUEUED', 'PLANNING', 'WAITING_FOR_APPROVAL', 'RUNNING', 'WAITING_ON_DEPENDENCY', 'VERIFYING', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED']);
export type Status = z.infer<typeof StatusSchema>;
export const VerdictSchema = z.enum(['PASS', 'PASS_WITH_LIMITATIONS', 'FAIL', 'BLOCKED', 'UNVERIFIED']);
export const RiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const BudgetSchema = z.strictObject({
  max_tool_calls: z.number().int().nonnegative().max(200), max_tokens: z.number().int().nonnegative(),
  max_cost_usd: z.number().finite().nonnegative(), max_wall_ms: z.number().int().positive().max(300000),
  max_depth: z.number().int().nonnegative().max(4), max_children: z.number().int().positive().max(20), max_retries: z.number().int().nonnegative().max(3),
});
export type Budget = z.infer<typeof BudgetSchema>;
export const DEFAULT_BUDGET: Budget = Object.freeze({max_tool_calls: 80, max_tokens: 0, max_cost_usd: 0, max_wall_ms: 60000, max_depth: 2, max_children: 8, max_retries: 1});
export const AgentDefinitionSchema = z.strictObject({
  id: Id, name: Text, version: Text, purpose: Text, system_instructions: Text,
  capabilities: z.array(Text), allowed_tools: z.array(Id), denied_tools: z.array(Id),
  accepted_input_types: z.array(Text), output_contract: Text, maximum_delegation_depth: z.number().int().nonnegative(),
  default_model: z.string().nullable(), cost_class: z.enum(['NONE', 'LOW', 'HIGH']), risk_class: RiskSchema,
  approval_requirements: z.array(Text), verification_requirements: z.array(Text), enabled: z.boolean(),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export const UsageSchema = z.strictObject({tool_calls: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), estimated_cost_usd: z.number().finite().nonnegative(), model: z.string().nullable()});
export const TaskSchema = z.strictObject({
  task_id: Id, parent_task_id: Id.nullable(), run_id: Id, objective: Text, success_criteria: z.array(Text).min(1),
  assigned_agent: Id, agent_version: Text, status: StatusSchema, priority: z.number().int(), dependencies: z.array(Id),
  inputs: z.array(Text), constraints: z.array(Text), permissions: z.array(Id), budget: BudgetSchema,
  created_at: Timestamp, started_at: Timestamp.nullable(), completed_at: Timestamp.nullable(),
  artifacts: z.array(Id), evidence: z.array(Id), uncertainty: z.array(Text), errors: z.array(Text),
  verification_status: VerdictSchema, auditor: Id.nullable(), next_action: Text, attempts: z.number().int().nonnegative(),
});
export type Task = z.infer<typeof TaskSchema>;
export const ArtifactSchema = z.strictObject({artifact_id: Id, media_type: Text, sha256: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().max(2000000), created_at: Timestamp, agent_id: Id, task_id: Id});
export type Artifact = z.infer<typeof ArtifactSchema>;
export const EvidenceSchema = z.strictObject({
  evidence_id: Id, artifact_id: Id, commit_sha: z.string().regex(/^[a-f0-9]{40,64}$/), tool: Id, agent_id: Id, task_id: Id,
  timestamp: Timestamp, source: Text, trust: z.literal('UNTRUSTED_DATA'),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export const PredicateSchema = z.strictObject({kind: z.enum(['FILE_EXISTS', 'TEXT_CONTAINS', 'JSON_FIELD_EQUALS']), path: Text, key: z.string().nullable(), expected: z.string()});
export type Predicate = z.infer<typeof PredicateSchema>;
export const ClaimSchema = z.strictObject({claim_id: Id, statement: Text, classification: z.enum(['KNOWN', 'INFERRED', 'UNKNOWN', 'NEEDS_VERIFICATION']), evidence_ids: z.array(Id), predicate: PredicateSchema.nullable(), agent_id: Id});
export type Claim = z.infer<typeof ClaimSchema>;
export const WorkerOutputSchema = z.strictObject({report: Text, claims: z.array(ClaimSchema).min(1).max(30), uncertainty: z.array(Text).min(1).max(30)});
export type WorkerOutput = z.infer<typeof WorkerOutputSchema>;
export const VerificationSchema = z.strictObject({agent_id: Id, agent_version: Text, verdict: VerdictSchema, reasons: z.array(Text).min(1), checked_claim_ids: z.array(Id), evidence_ids: z.array(Id), timestamp: Timestamp});
export type Verification = z.infer<typeof VerificationSchema>;
export const ApprovalSchema = z.strictObject({approval_id: Id, run_id: Id, task_id: Id, agent_id: Id, tool: Id, arguments_hash: z.string(), status: z.enum(['PENDING', 'GRANTED', 'DENIED']), requested_at: Timestamp, expires_at: Timestamp, decided_by: z.string().nullable(), decided_at: Timestamp.nullable(), consumed: z.boolean()});
export type Approval = z.infer<typeof ApprovalSchema>;
export const EventSchema = z.strictObject({event_id: Id, type: z.enum(['RUN_CREATED','PLAN_CREATED','TASK_CREATED','AGENT_ASSIGNED','TOOL_REQUESTED','TOOL_COMPLETED','ARTIFACT_CREATED','CLAIM_CREATED','EVIDENCE_ATTACHED','BLACKBOARD_ENTRY_CREATED','APPROVAL_REQUESTED','APPROVAL_GRANTED','APPROVAL_DENIED','AUDIT_STARTED','AUDIT_FAILED','AUDIT_PASSED','RED_SINK_COMPLETED','RUN_COMPLETED','RUN_FAILED','RUN_CANCELLED','STATE_CHANGED','RETRY']), timestamp: Timestamp, agent_id: Id, task_id: Id.nullable(), summary: Text});
export type Event = z.infer<typeof EventSchema>;
export const ReceiptSchema = z.strictObject({
  schema_version: z.literal('1.0.0'), receipt_id: Id, run_id: Id, objective: Text, agent: Id,
  adapter: Text,
  commit_sha: z.string(),
  mission: MissionSchema.nullable().optional(),
  started_at: Timestamp,
  completed_at: Timestamp,
  actions_taken: z.array(EventSchema), artifacts_created: z.array(ArtifactSchema), evidence: z.array(EvidenceSchema), claims: z.array(ClaimSchema),
  verification: z.array(VerificationSchema), blackboard_entries: z.array(BlackboardEntrySchema).optional(), revenue_ledger: RevenueLedgerSchema.nullable().optional(), tests: z.array(Text), unresolved_items: z.array(Text), red_sink_findings: z.array(Text),
  confidence: z.enum(['BOUNDED', 'UNVERIFIED']), cost: UsageSchema, human_approvals: z.array(ApprovalSchema), final_status: StatusSchema,
  agent_configs: z.array(AgentDefinitionSchema), hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Receipt = z.infer<typeof ReceiptSchema>;
export const RunSchema = z.strictObject({
  schema_version: z.literal('1.0.0'),
  run_id: Id,
  objective: Text,
  workflow: WorkflowSchema,
  mission: MissionSchema.nullable().default(null),
  adapter: Text,
  status: StatusSchema, commit_sha: z.string(), repository: Text, created_at: Timestamp, started_at: Timestamp.nullable(), completed_at: Timestamp.nullable(),
  tasks: z.array(TaskSchema), artifacts: z.array(ArtifactSchema), evidence: z.array(EvidenceSchema), claims: z.array(ClaimSchema), verification: z.array(VerificationSchema), blackboard_entries: z.array(BlackboardEntrySchema).default([]), revenue_ledger: RevenueLedgerSchema.nullable().default(null),
  approvals: z.array(ApprovalSchema), events: z.array(EventSchema), errors: z.array(Text), uncertainty: z.array(Text), red_sink_findings: z.array(Text),
  usage: UsageSchema, budget: BudgetSchema, agent_configs: z.array(AgentDefinitionSchema), receipt: ReceiptSchema.nullable(),
});
export type Run = z.infer<typeof RunSchema>;
export const HEALTH_OBJECTIVE =
  'Inspect the Sink Space repository and produce a concise capability inventory identifying the major current product/business capabilities visible in repository evidence.';

export const IntakeSchema = z.strictObject({
  workflow: z.literal('capability-inventory'),
  objective: z.literal(HEALTH_OBJECTIVE),
  mission: z.null().default(null)
});

export const CryptoMiningIntakeSchema = z.strictObject({
  workflow: z.literal('crypto-mining'),

  objective: z
    .string()
    .min(1)
    .max(20000),

  mission: CryptoMiningMissionSchema
});

export const RevenueIntakeSchema = z.strictObject({
  workflow: z.literal('revenue'),

  objective: z
    .string()
    .min(1)
    .max(20000),

  mission: RevenueMissionSchema
});

export const MissionIntakeSchema = z.union([
  IntakeSchema,
  CryptoMiningIntakeSchema,
  RevenueIntakeSchema
]);

export type MissionIntake =
  z.infer<typeof MissionIntakeSchema>;

export const MemorySchema = z.strictObject({id: Id, kind: z.enum(['RUN','WORKING','PROJECT','OPERATOR','EVIDENCE','PERFORMANCE']), scope: Text, content: Text, source: Text, timestamp: Timestamp, confidence: z.number().min(0).max(1), provenance: z.array(Text).min(1), expires_at: Timestamp.nullable(), supersedes: Id.nullable()});
export function memoryFreshness(item: z.infer<typeof MemorySchema>, now: Date): 'FRESH' | 'STALE' | 'UNKNOWN' {
  MemorySchema.parse(item);
  return item.expires_at === null ? 'UNKNOWN' : Date.parse(item.expires_at) <= now.getTime() ? 'STALE' : 'FRESH';
}
