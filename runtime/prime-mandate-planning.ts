import {
  planFounderMandate,
  type MandatePlan
} from './mandate-planner.js';

import {
  createPendingConstitutionalPlan
} from './constitutional-plan.js';

import {
  ConstitutionalPlanStore
} from './constitutional-plan-store.js';

export type PrimeMandatePlanningInterpretation =
  | {
      status:
        'NOT_MANDATE_PLANNING';
    }
  | {
      status:
        'PLAN_MANDATE';

      mandate_id:
        string;
    };

export type PersistedMandatePlan =
  MandatePlan & {
    pending_plan_id: string;
    proposal_digest: string;
  };

const PLAN =
  /^\s*prime,?\s*plan\s+mandate\s+(LY-MANDATE-[A-Za-z0-9-]+)\b/i;

export function interpretPrimeMandatePlanning(
  rawInput: string
): PrimeMandatePlanningInterpretation {
  const match =
    rawInput.match(PLAN);

  if (!match?.[1]) {
    return {
      status:
        'NOT_MANDATE_PLANNING'
    };
  }

  return {
    status:
      'PLAN_MANDATE',

    mandate_id:
      match[1]
  };
}

export async function executePrimeMandatePlanning(
  repositoryRoot: string,
  mandateId: string
): Promise<PersistedMandatePlan> {
  const result =
    await planFounderMandate(
      repositoryRoot,
      mandateId
    );

  const pending =
    createPendingConstitutionalPlan({
      mandate_id:
        result.plan.mandate_id,

      proposal_id:
        result.plan.proposal.proposal_id,

      title:
        result.plan.proposal.title,

      objective:
        result.plan.proposal.objective,

      target_system:
        result.plan.proposal.target_system,

      inspected_state:
        result.plan.inspected_state
    });

  const store =
    new ConstitutionalPlanStore(
      `${repositoryRoot}/.sink/lake-yange/pending-plans`
    );

  await store.create(pending);

  return {
    ...result.plan,

    pending_plan_id:
      pending.plan_id,

    proposal_digest:
      pending.proposal_digest
  };
}

export function mandatePlanReply(
  plan:
    MandatePlan |
    PersistedMandatePlan
): string {
  const persisted =
    'pending_plan_id' in plan;

  return [
    'FOUNDER_MANDATE_PLAN_READY',
    `Mandate: ${plan.mandate_id}`,
    `Selected primitive: ${plan.selected_primitive}`,
    `Reason: ${plan.reason}`,
    '',

    persisted
      ? `Pending plan: ${plan.pending_plan_id}`
      : 'Pending plan: NOT_PERSISTED',

    `Proposal: ${plan.proposal.proposal_id}`,
    `Title: ${plan.proposal.title}`,
    `Objective: ${plan.proposal.objective}`,
    `Target system: ${plan.proposal.target_system}`,
    `Proposal status: ${plan.proposal.status}`,

    persisted
      ? `Proposal digest: ${plan.proposal_digest}`
      : 'Proposal digest: NOT_PERSISTED',

    '',
    `Inspected population: ${plan.inspected_state.population}`,
    `Inspected generation: ${plan.inspected_state.generation}`,
    `Cognition: ${plan.inspected_state.cognition}`,
    `External model API: ${plan.inspected_state.external_model_api}`,
    '',
    'Execution authority granted: NO',
    'Execution occurred: NO',
    'Founder Mandate mutated: NO',
    '',
    persisted
      ? 'The exact displayed plan is now frozen as a non-authoritative pending plan.'
      : 'No durable pending plan exists.'
  ].join('\n');
}
