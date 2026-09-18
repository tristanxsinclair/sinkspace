import {
  planFounderMandate,
  type MandatePlan
} from './mandate-planner.js';

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
): Promise<MandatePlan> {
  const result =
    await planFounderMandate(
      repositoryRoot,
      mandateId
    );

  return result.plan;
}

export function mandatePlanReply(
  plan: MandatePlan
): string {
  return [
    'FOUNDER_MANDATE_PLAN_READY',
    `Mandate: ${plan.mandate_id}`,
    `Selected primitive: ${plan.selected_primitive}`,
    `Reason: ${plan.reason}`,
    '',
    `Proposal: ${plan.proposal.proposal_id}`,
    `Title: ${plan.proposal.title}`,
    `Objective: ${plan.proposal.objective}`,
    `Target system: ${plan.proposal.target_system}`,
    `Proposal status: ${plan.proposal.status}`,
    '',
    'Execution authority granted: NO',
    'Execution occurred: NO',
    'Constitutional state mutated: NO',
    '',
    'Founder may inspect this proposal before any later persistence or authorisation.'
  ].join('\n');
}
