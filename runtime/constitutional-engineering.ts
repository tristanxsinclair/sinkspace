import {
  ConstitutionalPlanStore
} from './constitutional-plan-store.js';

import {
  FounderAuthorizationStore
} from './founder-authorization-store.js';

import {
  ConstitutionalExecutionStore
} from './constitutional-execution-store.js';

import {
  createExecutionClaim,
  createExecutionResult,
  type ConstitutionalExecutionClaim,
  type ConstitutionalExecutionResult
} from './constitutional-execution.js';

import {
  runEngineeringMission,
  type EngineeringReceipt
} from './engineering-orchestrator.js';

import {
  LlamaCppLocalRuntime
} from './llama-cpp-local-runtime.js';

export interface ConstitutionalEngineeringResult {
  claim:
    ConstitutionalExecutionClaim;

  engineering_receipt:
    EngineeringReceipt;

  result:
    ConstitutionalExecutionResult;
}

export interface ConstitutionalEngineeringDependencies {
  localRuntimeHealth?: () => Promise<boolean>;
  runEngineering?: typeof runEngineeringMission;
}

export async function executeConstitutionalEngineering(
  repositoryRoot: string,
  authorizationId: string,
  dependencies: ConstitutionalEngineeringDependencies = {}
): Promise<ConstitutionalEngineeringResult> {
  const authorizationStore =
    new FounderAuthorizationStore(
      `${repositoryRoot}/.sink/lake-yange/authorizations`
    );

  const planStore =
    new ConstitutionalPlanStore(
      `${repositoryRoot}/.sink/lake-yange/pending-plans`
    );

  const executionStore =
    new ConstitutionalExecutionStore(
      `${repositoryRoot}/.sink/lake-yange/constitutional-executions`
    );

  /*
   * Both stores independently verify their
   * persisted digests before returning data.
   */
  const authorization =
    await authorizationStore.load(
      authorizationId
    );

  const plan =
    await planStore.load(
      authorization.plan_id
    );

  /*
   * Authority must bind the exact plan,
   * proposal and proposal digest being used.
   */
  if (
    authorization.mandate_id !==
    plan.mandate_id
  ) {
    throw new Error(
      'AUTHORIZATION_MANDATE_MISMATCH'
    );
  }

  if (
    authorization.plan_id !==
    plan.plan_id
  ) {
    throw new Error(
      'AUTHORIZATION_PLAN_MISMATCH'
    );
  }

  if (
    authorization.proposal_id !==
    plan.proposal_id
  ) {
    throw new Error(
      'AUTHORIZATION_PROPOSAL_MISMATCH'
    );
  }

  if (
    authorization.proposal_digest !==
    plan.proposal_digest
  ) {
    throw new Error(
      'AUTHORIZATION_PROPOSAL_DIGEST_MISMATCH'
    );
  }

  if (
    authorization.target_system !==
    plan.target_system
  ) {
    throw new Error(
      'AUTHORIZATION_TARGET_SYSTEM_MISMATCH'
    );
  }

  if (
    authorization.objective !==
    plan.objective
  ) {
    throw new Error(
      'AUTHORIZATION_OBJECTIVE_MISMATCH'
    );
  }

  if (
    authorization.execution_authority !==
    true
  ) {
    throw new Error(
      'AUTHORIZATION_HAS_NO_EXECUTION_AUTHORITY'
    );
  }

  if (
    authorization.execution_limit !==
    1
  ) {
    throw new Error(
      'AUTHORIZATION_EXECUTION_LIMIT_INVALID'
    );
  }

  /*
   * Schema literals make these impossible in a newly parsed artifact, but
   * retain explicit guards at the irreversible boundary. If an old or
   * malformed artifact ever reaches this code, it must fail closed before
   * health probes, claim creation or Forge invocation.
   */
  if (
    authorization.consumed ||
    authorization.executions_consumed !== 0
  ) {
    throw new Error(
      'AUTHORIZATION_ALREADY_CONSUMED'
    );
  }

  const mandatoryProhibitions = [
    'SPEND',
    'FINANCIAL_TRANSACTION',
    'EXTERNAL_PUBLICATION',
    'EXTERNAL_COMMUNICATION',
    'PRODUCTION_DEPLOY',
    'CREDENTIAL_ACCESS',
    'SECRET_ACCESS',
    'DESTRUCTIVE_OPERATION',
    'AUTHORITY_DELEGATION',
    'AUTONOMOUS_REPRODUCTION'
  ] as const;

  if (
    mandatoryProhibitions.some(
      prohibition =>
        !authorization.prohibited_operations.includes(
          prohibition
        )
    )
  ) {
    throw new Error(
      'AUTHORIZATION_PROHIBITION_SET_INVALID'
    );
  }

  if (
    !authorization
      .permitted_operations
      .includes(
        'ENGINEERING_MISSION'
      )
  ) {
    throw new Error(
      'ENGINEERING_MISSION_NOT_PERMITTED'
    );
  }

  /*
   * Legacy constitutional plans remain valid
   * history but are deliberately non-executable.
   */
  if (
    !plan.engineering_spec
  ) {
    throw new Error(
      'CONSTITUTIONAL_ENGINEERING_SPEC_REQUIRED'
    );
  }

  const spec =
    plan.engineering_spec;

  /*
   * Constitutional authority must not become
   * irreversibly spent merely because the local
   * cognition runtime is offline.
   *
   * This is a health preflight only. It performs
   * no inference and grants no execution authority.
   */
  const localRuntimeHealth =
    dependencies.localRuntimeHealth ??
    (() =>
      new LlamaCppLocalRuntime({
        baseUrl: 'http://127.0.0.1:18181'
      }).health());

  const localRuntimeHealthy =
    await localRuntimeHealth();

  if (!localRuntimeHealthy) {
    throw new Error(
      'CONSTITUTIONAL_LOCAL_MODEL_PREFLIGHT_FAILED'
    );
  }

  /*
   * Only after local cognition is confirmed healthy
   * may the irreversible one-shot claim be created.
   *
   * The claim is persisted BEFORE local Forge
   * receives any work.
   *
   * Its deterministic ID + create-only store
   * makes this authorization one-shot.
   */
  const claim =
    createExecutionClaim({
      authorization_id:
        authorization.authorization_id,

      mandate_id:
        authorization.mandate_id,

      plan_id:
        authorization.plan_id,

      proposal_id:
        authorization.proposal_id,

      proposal_digest:
        authorization.proposal_digest,

      engineering_spec:
        spec
    });

  await executionStore.createClaim(
    claim
  );

  let engineeringReceipt:
    EngineeringReceipt;

  try {
    engineeringReceipt =
      await (
        dependencies.runEngineering ??
        runEngineeringMission
      )(
        repositoryRoot,
        {
          objective:
            authorization.objective,

          target_path:
            spec.target_path,

          operation:
            spec.operation,

          expected_exports:
            spec.expected_exports,

          expected_function_exports:
            spec.expected_function_exports ?? []
        }
      );
  } catch (error) {
    /*
     * runEngineeringMission normally converts
     * operational errors into a persisted receipt.
     * A throw here is therefore an exceptional
     * boundary failure.
     *
     * The claim remains durable and the one-shot
     * authorization remains spent. We do NOT
     * silently retry.
     */
    throw new Error(
      `CONSTITUTIONAL_ENGINEERING_BOUNDARY_FAILED:${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  const status:
    'VERIFIED' |
    'REJECTED' |
    'FAILED' =
      engineeringReceipt.status ===
      'VERIFIED'
        ? 'VERIFIED'
        : engineeringReceipt.failure
          ? 'REJECTED'
          : 'FAILED';

  const result =
    createExecutionResult({
      claim_id:
        claim.claim_id,

      authorization_id:
        authorization.authorization_id,

      engineering_receipt_id:
        engineeringReceipt.receipt_id,

      status,

      vera:
        engineeringReceipt.vera,

      rook:
        engineeringReceipt.rook
    });

  await executionStore.createResult(
    result
  );

  return {
    claim,
    engineering_receipt:
      engineeringReceipt,
    result
  };
}

export function constitutionalEngineeringReply(
  value: ConstitutionalEngineeringResult
): string {
  return [
    'CONSTITUTIONAL_ENGINEERING_COMPLETE',
    `Claim: ${value.claim.claim_id}`,
    `Authorization: ${value.claim.authorization_id}`,
    `Engineering receipt: ${value.engineering_receipt.receipt_id}`,
    `Result: ${value.result.result_id}`,
    '',
    `Engineering status: ${value.engineering_receipt.status}`,
    `Vera: ${value.engineering_receipt.vera}`,
    `Rook: ${value.engineering_receipt.rook}`,
    `Workspace destroyed: ${value.engineering_receipt.workspace_destroyed ? 'YES' : 'NO'}`,
    `Canonical promotion: ${value.engineering_receipt.promotion}`,
    '',
    'Authorization execution claim: SPENT',
    'Automatic retry: NO'
  ].join('\n');
}
