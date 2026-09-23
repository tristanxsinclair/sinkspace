import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ConstitutionalEngineeringSpecSchema =
  z.object({
    schema_version:
      z.literal(1),

    target_path:
      z.string()
        .min(1)
        .max(500)
        .refine(
          value =>
            !value.startsWith('/') &&
            !value.startsWith('\\\\') &&
            !value.split('/').includes('..') &&
            !value.split('\\').includes('..') &&
            !value.includes('\0'),
          'CONSTITUTIONAL_ENGINEERING_TARGET_PATH_INVALID'
        ),

    operation:
      z.enum([
        'CREATE',
        'REPLACE'
      ]),

    expected_exports:
      z.array(
        z.string()
          .regex(
            /^[A-Za-z_$][A-Za-z0-9_$]*$/
          )
      )
      .max(16),

    expected_function_exports:
      z.array(
        z.string()
          .regex(
            /^[A-Za-z_$][A-Za-z0-9_$]*$/
          )
      )
      .max(16)
      .optional(),

    verification_commands:
      z.tuple([
        z.literal('TYPECHECK')
      ]),

    max_files_changed:
      z.literal(1),

    network:
      z.literal(false),

    credentials:
      z.literal(false),

    external_messages:
      z.literal(false),

    deployment:
      z.literal(false),

    dependency_installation:
      z.literal(false),

    destructive_operations:
      z.literal(false)
  });

export type ConstitutionalEngineeringSpec =
  z.infer<
    typeof ConstitutionalEngineeringSpecSchema
  >;

export function engineeringSpecDigest(
  spec: ConstitutionalEngineeringSpec
): string {
  const parsed =
    ConstitutionalEngineeringSpecSchema.parse(
      spec
    );

  return createHash('sha256')
    .update(
      JSON.stringify(parsed)
    )
    .digest('hex');
}

export const ConstitutionalExecutionClaimSchema =
  z.object({
    schema_version:
      z.literal(1),

    claim_id:
      z.string()
        .regex(
          /^LY-CLAIM-[a-f0-9]{32}$/
        ),

    authorization_id:
      z.string()
        .regex(
          /^LY-AUTH-[a-f0-9]{32}$/
        ),

    mandate_id:
      z.string()
        .regex(
          /^LY-MANDATE-[A-Za-z0-9-]+$/
        ),

    plan_id:
      z.string()
        .regex(
          /^LY-PLAN-[A-Za-z0-9-]+$/
        ),

    proposal_id:
      z.string()
        .regex(
          /^LY-PROPOSAL-[A-Za-z0-9-]+$/
        ),

    proposal_digest:
      z.string()
        .regex(/^[a-f0-9]{64}$/),

    engineering_spec:
      ConstitutionalEngineeringSpecSchema,

    engineering_spec_digest:
      z.string()
        .regex(/^[a-f0-9]{64}$/),

    execution_number:
      z.literal(1),

    claimed_at:
      z.string().datetime(),

    claim_digest:
      z.string()
        .regex(/^[a-f0-9]{64}$/)
  });

export type ConstitutionalExecutionClaim =
  z.infer<
    typeof ConstitutionalExecutionClaimSchema
  >;

function claimId(
  authorizationId: string
): string {
  return (
    'LY-CLAIM-' +
    createHash('sha256')
      .update(
        `constitutional-execution:${authorizationId}`
      )
      .digest('hex')
      .slice(0, 32)
  );
}

function claimDigest(
  input: Omit<
    ConstitutionalExecutionClaim,
    'claim_digest'
  >
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(input)
    )
    .digest('hex');
}

export function createExecutionClaim(
  input: {
    authorization_id: string;
    mandate_id: string;
    plan_id: string;
    proposal_id: string;
    proposal_digest: string;
    engineering_spec:
      ConstitutionalEngineeringSpec;
  },
  now = new Date().toISOString()
): ConstitutionalExecutionClaim {
  const spec =
    ConstitutionalEngineeringSpecSchema.parse(
      input.engineering_spec
    );

  const unsigned = {
    schema_version: 1 as const,

    claim_id:
      claimId(
        input.authorization_id
      ),

    authorization_id:
      input.authorization_id,

    mandate_id:
      input.mandate_id,

    plan_id:
      input.plan_id,

    proposal_id:
      input.proposal_id,

    proposal_digest:
      input.proposal_digest,

    engineering_spec:
      spec,

    engineering_spec_digest:
      engineeringSpecDigest(spec),

    execution_number:
      1 as const,

    claimed_at:
      now
  };

  return ConstitutionalExecutionClaimSchema.parse({
    ...unsigned,
    claim_digest:
      claimDigest(unsigned)
  });
}

export function verifyExecutionClaim(
  claim:
    ConstitutionalExecutionClaim
): ConstitutionalExecutionClaim {
  const parsed =
    ConstitutionalExecutionClaimSchema.parse(
      claim
    );

  const expectedClaimId =
    claimId(
      parsed.authorization_id
    );

  if (
    parsed.claim_id !==
    expectedClaimId
  ) {
    throw new Error(
      'CONSTITUTIONAL_CLAIM_ID_INVALID'
    );
  }

  if (
    engineeringSpecDigest(
      parsed.engineering_spec
    ) !==
    parsed.engineering_spec_digest
  ) {
    throw new Error(
      'CONSTITUTIONAL_ENGINEERING_SPEC_DIGEST_INVALID'
    );
  }

  const {
    claim_digest: _,
    ...unsigned
  } = parsed;

  if (
    claimDigest(unsigned) !==
    parsed.claim_digest
  ) {
    throw new Error(
      'CONSTITUTIONAL_CLAIM_DIGEST_INVALID'
    );
  }

  return parsed;
}

export const ConstitutionalExecutionResultSchema =
  z.object({
    schema_version:
      z.literal(1),

    result_id:
      z.string()
        .regex(
          /^LY-RESULT-[a-f0-9]{32}$/
        ),

    claim_id:
      z.string()
        .regex(
          /^LY-CLAIM-[a-f0-9]{32}$/
        ),

    authorization_id:
      z.string()
        .regex(
          /^LY-AUTH-[a-f0-9]{32}$/
        ),

    engineering_receipt_id:
      z.string().min(1),

    status:
      z.enum([
        'VERIFIED',
        'REJECTED',
        'FAILED'
      ]),

    vera:
      z.enum([
        'PASS',
        'FAIL'
      ]),

    rook:
      z.enum([
        'PASS',
        'FAIL'
      ]),

    promotion:
      z.literal(
        'NOT_AUTHORIZED'
      ),

    completed_at:
      z.string().datetime(),

    result_digest:
      z.string()
        .regex(/^[a-f0-9]{64}$/)
  });

export type ConstitutionalExecutionResult =
  z.infer<
    typeof ConstitutionalExecutionResultSchema
  >;

function resultId(
  claimIdValue: string
): string {
  return (
    'LY-RESULT-' +
    createHash('sha256')
      .update(
        `constitutional-result:${claimIdValue}`
      )
      .digest('hex')
      .slice(0, 32)
  );
}

function resultDigest(
  input: Omit<
    ConstitutionalExecutionResult,
    'result_digest'
  >
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(input)
    )
    .digest('hex');
}

export function createExecutionResult(
  input: {
    claim_id: string;
    authorization_id: string;
    engineering_receipt_id: string;
    status:
      | 'VERIFIED'
      | 'REJECTED'
      | 'FAILED';
    vera:
      | 'PASS'
      | 'FAIL';
    rook:
      | 'PASS'
      | 'FAIL';
  },
  now = new Date().toISOString()
): ConstitutionalExecutionResult {
  const unsigned = {
    schema_version:
      1 as const,

    result_id:
      resultId(
        input.claim_id
      ),

    claim_id:
      input.claim_id,

    authorization_id:
      input.authorization_id,

    engineering_receipt_id:
      input.engineering_receipt_id,

    status:
      input.status,

    vera:
      input.vera,

    rook:
      input.rook,

    promotion:
      'NOT_AUTHORIZED' as const,

    completed_at:
      now
  };

  return ConstitutionalExecutionResultSchema.parse({
    ...unsigned,
    result_digest:
      resultDigest(unsigned)
  });
}

export function verifyExecutionResult(
  result:
    ConstitutionalExecutionResult
): ConstitutionalExecutionResult {
  const parsed =
    ConstitutionalExecutionResultSchema.parse(
      result
    );

  if (
    parsed.result_id !==
    resultId(
      parsed.claim_id
    )
  ) {
    throw new Error(
      'CONSTITUTIONAL_RESULT_ID_INVALID'
    );
  }

  const {
    result_digest: _,
    ...unsigned
  } = parsed;

  if (
    resultDigest(unsigned) !==
    parsed.result_digest
  ) {
    throw new Error(
      'CONSTITUTIONAL_RESULT_DIGEST_INVALID'
    );
  }

  return parsed;
}
