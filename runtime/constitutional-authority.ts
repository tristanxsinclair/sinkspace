import {
  ConstitutionalPlanStore
} from './constitutional-plan-store.js';

import {
  createFounderAuthorization,
  type FounderAuthorization
} from './founder-authorization.js';

import {
  FounderAuthorizationStore
} from './founder-authorization-store.js';

export interface ConstitutionalAuthorizationResult {
  authorization:
    FounderAuthorization;

  engineering_executed:
    false;

  authorization_consumed:
    false;
}

export async function authorizeConstitutionalPlan(
  repositoryRoot: string,
  planId: string
): Promise<ConstitutionalAuthorizationResult> {
  const planStore =
    new ConstitutionalPlanStore(
      `${repositoryRoot}/.sink/lake-yange/pending-plans`
    );

  const authorizationStore =
    new FounderAuthorizationStore(
      `${repositoryRoot}/.sink/lake-yange/authorizations`
    );

  /*
   * load() independently recomputes the
   * proposal digest. A modified plan cannot
   * cross this boundary.
   */
  const plan =
    await planStore.load(
      planId
    );

  if (
    plan.status !==
    'PENDING'
  ) {
    throw new Error(
      `CONSTITUTIONAL_PLAN_NOT_PENDING:${plan.status}`
    );
  }

  if (
    plan.execution_authority !==
    false
  ) {
    throw new Error(
      'PENDING_PLAN_HAS_EXECUTION_AUTHORITY'
    );
  }

  /*
   * A Founder authorization is an irreversible capability. New authority may
   * only be issued for a plan that already freezes the exact local operation
   * and its safety limits. Legacy plans remain readable history but cannot
   * mint fresh execution authority.
   */
  if (!plan.engineering_spec) {
    throw new Error(
      'CONSTITUTIONAL_ENGINEERING_SPEC_REQUIRED_FOR_AUTHORIZATION'
    );
  }

  const authorization =
    createFounderAuthorization({
      mandate_id:
        plan.mandate_id,

      plan_id:
        plan.plan_id,

      proposal_id:
        plan.proposal_id,

      proposal_digest:
        plan.proposal_digest,

      target_system:
        plan.target_system,

      objective:
        plan.objective
    });

  /*
   * Deterministic authorization ID + wx means
   * the same plan cannot receive a second
   * independent authorization artifact.
   */
  await authorizationStore.create(
    authorization
  );

  return {
    authorization,
    engineering_executed: false,
    authorization_consumed: false
  };
}

export function constitutionalAuthorizationReply(
  result:
    ConstitutionalAuthorizationResult
): string {
  const authorization =
    result.authorization;

  return [
    'FOUNDER_AUTHORIZATION_RECORDED',
    `Authorization: ${authorization.authorization_id}`,
    `Mandate: ${authorization.mandate_id}`,
    `Plan: ${authorization.plan_id}`,
    `Proposal: ${authorization.proposal_id}`,
    `Proposal digest: ${authorization.proposal_digest}`,
    '',
    'Authority: BOUNDED_ENGINEERING_ONLY',
    `Execution limit: ${authorization.execution_limit}`,
    `Executions consumed: ${authorization.executions_consumed}`,
    '',
    'Permitted:',
    ...authorization
      .permitted_operations
      .map(
        value =>
          `- ${value}`
      ),
    '',
    'Prohibited:',
    ...authorization
      .prohibited_operations
      .map(
        value =>
          `- ${value}`
      ),
    '',
    'Engineering execution occurred: NO',
    'Authorization consumed: NO',
    '',
    'This authorization is bound to the plan’s frozen engineering specification.',
    'It can be consumed only once, after local-runtime preflight and an immutable execution claim.'
  ].join('\n');
}
