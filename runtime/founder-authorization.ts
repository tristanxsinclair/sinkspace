import { createHash } from 'node:crypto';
import { z } from 'zod';

export const FounderProhibitionSchema = z.enum([
  'SPEND',
  'FINANCIAL_TRANSACTION',
  'SUPPLIER_PURCHASE',
  'EXTERNAL_PUBLICATION',
  'EXTERNAL_COMMUNICATION',
  'PRODUCTION_DEPLOY',
  'CREDENTIAL_ACCESS',
  'SECRET_ACCESS',
  'DESTRUCTIVE_OPERATION',
  'AUTHORITY_DELEGATION',
  'AUTONOMOUS_REPRODUCTION'
]);

export const FounderAuthorizationSchema = z.object({
  schema_version: z.literal(1),

  authorization_id: z
    .string()
    .regex(/^LY-AUTH-[a-f0-9]{32}$/),

  mandate_id: z
    .string()
    .regex(/^LY-MANDATE-[A-Za-z0-9-]+$/),

  plan_id: z
    .string()
    .regex(/^LY-PLAN-[A-Za-z0-9-]+$/),

  proposal_id: z
    .string()
    .regex(/^LY-PROPOSAL-[A-Za-z0-9-]+$/),

  proposal_digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/),

  issued_by: z.literal('FOUNDER'),

  target_system:
    z.string().min(1).max(200),

  objective:
    z.string().min(1).max(8_000),

  permitted_operations:
    z.tuple([
      z.literal('ENGINEERING_MISSION')
    ]),

  prohibited_operations:
    z.array(
      FounderProhibitionSchema
    ).min(1),

  execution_limit: z.literal(1),

  executions_consumed:
    z.literal(0),

  execution_authority:
    z.literal(true),

  issued_at:
    z.string().datetime(),

  consumed:
    z.literal(false),

  authorization_digest:
    z.string().regex(/^[a-f0-9]{64}$/)
});

export type FounderAuthorization =
  z.infer<
    typeof FounderAuthorizationSchema
  >;

const PROHIBITIONS = [
  'SPEND',
  'FINANCIAL_TRANSACTION',
  'SUPPLIER_PURCHASE',
  'EXTERNAL_PUBLICATION',
  'EXTERNAL_COMMUNICATION',
  'PRODUCTION_DEPLOY',
  'CREDENTIAL_ACCESS',
  'SECRET_ACCESS',
  'DESTRUCTIVE_OPERATION',
  'AUTHORITY_DELEGATION',
  'AUTONOMOUS_REPRODUCTION'
] as const;

export function founderAuthorizationId(
  planId: string
): string {
  return (
    'LY-AUTH-' +
    createHash('sha256')
      .update(planId)
      .digest('hex')
      .slice(0, 32)
  );
}

export function founderAuthorizationDigest(
  input: {
    authorization_id: string;
    mandate_id: string;
    plan_id: string;
    proposal_id: string;
    proposal_digest: string;
    target_system: string;
    objective: string;
    issued_at: string;
  }
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(input)
    )
    .digest('hex');
}

export function createFounderAuthorization(
  input: {
    mandate_id: string;
    plan_id: string;
    proposal_id: string;
    proposal_digest: string;
    target_system: string;
    objective: string;
  },
  now = new Date().toISOString()
): FounderAuthorization {
  const authorizationId =
    founderAuthorizationId(
      input.plan_id
    );

  const digest =
    founderAuthorizationDigest({
      authorization_id:
        authorizationId,

      mandate_id:
        input.mandate_id,

      plan_id:
        input.plan_id,

      proposal_id:
        input.proposal_id,

      proposal_digest:
        input.proposal_digest,

      target_system:
        input.target_system,

      objective:
        input.objective,

      issued_at:
        now
    });

  return FounderAuthorizationSchema.parse({
    schema_version: 1,

    authorization_id:
      authorizationId,

    mandate_id:
      input.mandate_id,

    plan_id:
      input.plan_id,

    proposal_id:
      input.proposal_id,

    proposal_digest:
      input.proposal_digest,

    issued_by:
      'FOUNDER',

    target_system:
      input.target_system,

    objective:
      input.objective,

    permitted_operations: [
      'ENGINEERING_MISSION'
    ],

    prohibited_operations:
      [...PROHIBITIONS],

    execution_limit: 1,
    executions_consumed: 0,
    execution_authority: true,

    issued_at: now,
    consumed: false,

    authorization_digest:
      digest
  });
}

export function verifyFounderAuthorization(
  authorization:
    FounderAuthorization
): FounderAuthorization {
  const parsed =
    FounderAuthorizationSchema.parse(
      authorization
    );

  const expectedId =
    founderAuthorizationId(
      parsed.plan_id
    );

  if (
    parsed.authorization_id !==
    expectedId
  ) {
    throw new Error(
      'FOUNDER_AUTHORIZATION_ID_INVALID'
    );
  }

  const expectedDigest =
    founderAuthorizationDigest({
      authorization_id:
        parsed.authorization_id,

      mandate_id:
        parsed.mandate_id,

      plan_id:
        parsed.plan_id,

      proposal_id:
        parsed.proposal_id,

      proposal_digest:
        parsed.proposal_digest,

      target_system:
        parsed.target_system,

      objective:
        parsed.objective,

      issued_at:
        parsed.issued_at
    });

  if (
    expectedDigest !==
    parsed.authorization_digest
  ) {
    throw new Error(
      'FOUNDER_AUTHORIZATION_DIGEST_INVALID'
    );
  }

  return parsed;
}
