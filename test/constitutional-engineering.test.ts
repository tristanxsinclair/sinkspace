import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  mkdir
} from 'node:fs/promises';

import {
  tmpdir
} from 'node:os';

import {
  join
} from 'node:path';

import {
  createPendingConstitutionalPlan
} from '../runtime/constitutional-plan.js';

import {
  ConstitutionalPlanStore
} from '../runtime/constitutional-plan-store.js';

import {
  createFounderAuthorization
} from '../runtime/founder-authorization.js';

import {
  FounderAuthorizationStore
} from '../runtime/founder-authorization-store.js';

import {
  executeConstitutionalEngineering
} from '../runtime/constitutional-engineering.js';

async function root() {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        'ly-constitutional-engineering-'
      )
    );

  await mkdir(
    join(
      value,
      '.sink',
      'lake-yange'
    ),
    {
      recursive: true
    }
  );

  return value;
}

test(
  'legacy plan without engineering spec cannot consume authorization',
  async () => {
    const repositoryRoot =
      await root();

    const plan =
      createPendingConstitutionalPlan({
        mandate_id:
          'LY-MANDATE-legacy',

        proposal_id:
          'LY-PROPOSAL-legacy',

        title:
          'Legacy plan',

        objective:
          'Historical authorization only.',

        target_system:
          'STATE_HOUSE_MANDATE_AUTHORITY',

        inspected_state: {
          population: 9,
          generation: 0,
          cognition: 'LOCAL',
          external_model_api: false
        }
      });

    const planStore =
      new ConstitutionalPlanStore(
        join(
          repositoryRoot,
          '.sink/lake-yange/pending-plans'
        )
      );

    await planStore.create(
      plan
    );

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

    const authorizationStore =
      new FounderAuthorizationStore(
        join(
          repositoryRoot,
          '.sink/lake-yange/authorizations'
        )
      );

    await authorizationStore.create(
      authorization
    );

    await assert.rejects(
      () =>
        executeConstitutionalEngineering(
          repositoryRoot,
          authorization.authorization_id
        ),
      /CONSTITUTIONAL_ENGINEERING_SPEC_REQUIRED/
    );
  }
);

async function executableAuthorization(
  repositoryRoot: string
) {
  const plan =
    createPendingConstitutionalPlan({
      mandate_id:
        'LY-MANDATE-preflight',

      proposal_id:
        'LY-PROPOSAL-preflight',

      title:
        'Preflight plan',

      objective:
        'Verify constitutional local cognition preflight.',

      target_system:
        'BUILDERS_GUILD_WORKSHOP',

      engineering_spec: {
        schema_version: 1,
        target_path:
          'runtime/preflight-proof.ts',
        operation:
          'CREATE',
        expected_exports: [
          'preflightProof'
        ],

        expected_function_exports: [
          'preflightProof'
        ],
        verification_commands: [
          'TYPECHECK'
        ],
        max_files_changed: 1,
        network: false,
        credentials: false,
        external_messages: false,
        deployment: false,
        dependency_installation: false,
        destructive_operations: false
      },

      inspected_state: {
        population: 9,
        generation: 0,
        cognition: 'LOCAL',
        external_model_api: false
      }
    });

  const planStore =
    new ConstitutionalPlanStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/pending-plans'
      )
    );

  await planStore.create(plan);

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

  const authorizationStore =
    new FounderAuthorizationStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/authorizations'
      )
    );

  await authorizationStore.create(
    authorization
  );

  return {
    plan,
    authorization
  };
}

test(
  'unavailable local runtime creates no claim and invokes no engineering mission',
  async () => {
    const repositoryRoot =
      await root();

    const {
      authorization
    } =
      await executableAuthorization(
        repositoryRoot
      );

    let engineeringInvocations = 0;

    await assert.rejects(
      () =>
        executeConstitutionalEngineering(
          repositoryRoot,
          authorization.authorization_id,
          {
            localRuntimeHealth:
              async () => false,

            runEngineering:
              async () => {
                engineeringInvocations += 1;
                throw new Error(
                  'ENGINEERING_SHOULD_NOT_RUN'
                );
              }
          }
        ),
      /CONSTITUTIONAL_LOCAL_MODEL_PREFLIGHT_FAILED/
    );

    assert.equal(
      engineeringInvocations,
      0
    );

    const claimId =
      `LY-CLAIM-${(
        await import(
          'node:crypto'
        )
      ).createHash('sha256')
        .update(
          `constitutional-execution:${authorization.authorization_id}`
        )
        .digest('hex')
        .slice(0, 32)}`;

    const {
      access
    } =
      await import(
        'node:fs/promises'
      );

    await assert.rejects(
      () =>
        access(
          join(
            repositoryRoot,
            '.sink/lake-yange/constitutional-executions/claims',
            `${claimId}.json`
          )
        )
    );
  }
);

test(
  'healthy local runtime permits the irreversible execution boundary',
  async () => {
    const repositoryRoot =
      await root();

    const {
      authorization
    } =
      await executableAuthorization(
        repositoryRoot
      );

    let engineeringInvocations = 0;

    let observedEngineeringRequest:
      Parameters<
        NonNullable<
          import('../runtime/constitutional-engineering.js')
            .ConstitutionalEngineeringDependencies['runEngineering']
        >
      >[1] | undefined;


    await assert.rejects(
      () =>
        executeConstitutionalEngineering(
          repositoryRoot,
          authorization.authorization_id,
          {
            localRuntimeHealth:
              async () => true,

            runEngineering:
              async (
                _repositoryRoot,
                request
              ) => {
                engineeringInvocations += 1;
                observedEngineeringRequest =
                  request;
                throw new Error(
                  'TEST_BOUNDARY_REACHED'
                );
              }
          }
        ),
      /CONSTITUTIONAL_ENGINEERING_BOUNDARY_FAILED:TEST_BOUNDARY_REACHED/
    );

    assert.equal(
      engineeringInvocations,
      1
    );

    assert.deepEqual(
      observedEngineeringRequest
        ?.expected_exports,
      [
        'preflightProof'
      ]
    );

    assert.deepEqual(
      observedEngineeringRequest
        ?.expected_function_exports,
      [
        'preflightProof'
      ]
    );


    const {
      readdir
    } =
      await import(
        'node:fs/promises'
      );

    const claims =
      await readdir(
        join(
          repositoryRoot,
          '.sink/lake-yange/constitutional-executions/claims'
        )
      );

    assert.equal(
      claims.length,
      1
    );
  }
);
