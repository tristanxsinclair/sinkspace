import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  ConstitutionalEngineeringSpecSchema,
  type ConstitutionalEngineeringSpec
} from './constitutional-execution.js';

export const ConstitutionalPlanStatusSchema = z.enum([
  'PENDING',
  'AUTHORISED',
  'CONSUMED',
  'REJECTED',
  'SUPERSEDED'
]);

export const ConstitutionalPlanSchema = z.object({
  schema_version: z.literal(1),

  plan_id: z
    .string()
    .regex(/^LY-PLAN-[A-Za-z0-9-]+$/),

  mandate_id: z
    .string()
    .regex(/^LY-MANDATE-[A-Za-z0-9-]+$/),

  proposal_id: z
    .string()
    .regex(/^LY-PROPOSAL-[A-Za-z0-9-]+$/),

  title: z.string().min(1).max(300),
  objective: z.string().min(1).max(8_000),
  target_system: z.string().min(1).max(200),

  /*
   * Legacy constitutional plans may omit this field.
   * Such plans can be authorized as historical bounded
   * authority records, but they cannot be consumed for
   * engineering execution.
   *
   * New executable plans must bind this exact specification
   * before Founder authorization.
   */
  engineering_spec:
    ConstitutionalEngineeringSpecSchema.optional(),

  inspected_state: z.object({
    population: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative(),
    cognition: z.literal('LOCAL'),
    external_model_api: z.literal(false)
  }),

  proposal_digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/),

  status: ConstitutionalPlanStatusSchema,

  execution_authority: z.literal(false),

  created_at: z.string().datetime()
});

export type ConstitutionalPlan =
  z.infer<typeof ConstitutionalPlanSchema>;

export type ConstitutionalPlanInput = {
  mandate_id: string;
  proposal_id: string;
  title: string;
  objective: string;
  target_system: string;

  engineering_spec?:
    ConstitutionalEngineeringSpec;

  inspected_state: {
    population: number;
    generation: number;
    cognition: 'LOCAL';
    external_model_api: false;
  };
};

export function constitutionalProposalDigest(
  input: ConstitutionalPlanInput
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        mandate_id: input.mandate_id,
        proposal_id: input.proposal_id,
        title: input.title,
        objective: input.objective,
        target_system: input.target_system,
        engineering_spec:
          input.engineering_spec,
        inspected_state: input.inspected_state
      })
    )
    .digest('hex');
}

export function createPendingConstitutionalPlan(
  input: ConstitutionalPlanInput,
  now = new Date().toISOString()
): ConstitutionalPlan {
  return ConstitutionalPlanSchema.parse({
    schema_version: 1,

    plan_id:
      `LY-PLAN-${randomUUID()}`,

    mandate_id:
      input.mandate_id,

    proposal_id:
      input.proposal_id,

    title:
      input.title,

    objective:
      input.objective,

    target_system:
      input.target_system,

    engineering_spec:
      input.engineering_spec,

    inspected_state:
      input.inspected_state,

    proposal_digest:
      constitutionalProposalDigest(input),

    status:
      'PENDING',

    execution_authority:
      false,

    created_at:
      now
  });
}
