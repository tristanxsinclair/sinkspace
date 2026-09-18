import {
  randomUUID
} from 'node:crypto';

import {
  projectLakeYangeWorld
} from './lake-yange-world.js';

import {
  createPendingConstitutionalPlan
} from './constitutional-plan.js';

import {
  ConstitutionalPlanStore
} from './constitutional-plan-store.js';

import type {
  ConstitutionalEngineeringSpec
} from './constitutional-execution.js';

export type PrimeConstitutionalPlanAction =
  | {
      status:
        'NOT_CONSTITUTIONAL_PLAN';
    }
  | {
      status:
        'PLAN_CONSTITUTIONAL_ENGINEERING';

      mandate_id:
        string;

      objective:
        string;

      target_path:
        string;

      operation:
        'CREATE' | 'REPLACE';

      expected_export:
        string;
    };

const PLAN_ENGINEERING =
  /^\s*prime,?\s+plan\s+engineering\s+for\s+mandate\s+(LY-MANDATE-[A-Za-z0-9-]+)\s*:\s*(.+?)\s*::\s*([A-Za-z0-9_./-]+)\s*::\s*(CREATE|REPLACE)\s*::\s*export\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[.!]?\s*$/i;

export function interpretPrimeConstitutionalPlan(
  input: string
): PrimeConstitutionalPlanAction {
  const match =
    input.match(
      PLAN_ENGINEERING
    );

  const mandateId =
    match?.[1];

  const objective =
    match?.[2]?.trim();

  const targetPath =
    match?.[3];

  const operation =
    match?.[4]?.toUpperCase();

  const expectedExport =
    match?.[5];

  if (
    !mandateId ||
    !objective ||
    !targetPath ||
    (
      operation !== 'CREATE' &&
      operation !== 'REPLACE'
    ) ||
    !expectedExport
  ) {
    return {
      status:
        'NOT_CONSTITUTIONAL_PLAN'
    };
  }

  return {
    status:
      'PLAN_CONSTITUTIONAL_ENGINEERING',

    mandate_id:
      mandateId,

    objective,

    target_path:
      targetPath,

    operation,

    expected_export:
      expectedExport
  };
}

export async function executePrimeConstitutionalPlan(
  repositoryRoot: string,
  action: Extract<
    PrimeConstitutionalPlanAction,
    {
      status:
        'PLAN_CONSTITUTIONAL_ENGINEERING';
    }
  >
) {
  /*
   * Reuse the persisted Lake Yange state as the
   * inspected-state truth source.
   */
  const world =
    await projectLakeYangeWorld(
      repositoryRoot
    );

  const engineeringSpec:
    ConstitutionalEngineeringSpec = {
      schema_version:
        1,

      target_path:
        action.target_path,

      operation:
        action.operation,

      expected_exports: [
        action.expected_export
      ],

      verification_commands: [
        'TYPECHECK'
      ],

      max_files_changed:
        1,

      network:
        false,

      credentials:
        false,

      external_messages:
        false,

      deployment:
        false,

      dependency_installation:
        false,

      destructive_operations:
        false
    };

  const plan =
    createPendingConstitutionalPlan({
      mandate_id:
        action.mandate_id,

      proposal_id:
        `LY-PROPOSAL-${randomUUID()}`,

      title:
        'Bounded constitutional engineering mission',

      objective:
        action.objective,

      target_system:
        'BUILDERS_GUILD_WORKSHOP',

      engineering_spec:
        engineeringSpec,

      inspected_state: {
        population:
          world.settlement.population,

        generation:
          world.settlement.generation,

        cognition:
          'LOCAL',

        external_model_api:
          false
      }
    });

  const store =
    new ConstitutionalPlanStore(
      `${repositoryRoot}/.sink/lake-yange/pending-plans`
    );

  await store.create(
    plan
  );

  return plan;
}

export function constitutionalPlanReply(
  plan: Awaited<
    ReturnType<
      typeof executePrimeConstitutionalPlan
    >
  >
): string {
  const spec =
    plan.engineering_spec;

  if (!spec) {
    throw new Error(
      'CONSTITUTIONAL_ENGINEERING_SPEC_REQUIRED'
    );
  }

  return [
    'CONSTITUTIONAL_ENGINEERING_PLAN_READY',
    `Plan: ${plan.plan_id}`,
    `Mandate: ${plan.mandate_id}`,
    `Proposal: ${plan.proposal_id}`,
    `Proposal digest: ${plan.proposal_digest}`,
    '',
    `Objective: ${plan.objective}`,
    `Target: ${spec.target_path}`,
    `Operation: ${spec.operation}`,
    `Expected exports: ${spec.expected_exports.join(', ')}`,
    `Verification: ${spec.verification_commands.join(', ')}`,
    `Max files changed: ${spec.max_files_changed}`,
    '',
    `Network: ${spec.network ? 'YES' : 'NO'}`,
    `Credentials: ${spec.credentials ? 'YES' : 'NO'}`,
    `External communication: ${spec.external_messages ? 'YES' : 'NO'}`,
    `Deployment: ${spec.deployment ? 'YES' : 'NO'}`,
    `Dependency installation: ${spec.dependency_installation ? 'YES' : 'NO'}`,
    `Destructive operations: ${spec.destructive_operations ? 'YES' : 'NO'}`,
    '',
    'Execution authority: NO',
    'Execution occurred: NO',
    '',
    'Founder authorization is required before this plan can execute.'
  ].join('\n');
}
