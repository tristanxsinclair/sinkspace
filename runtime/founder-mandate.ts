import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const FounderMandateStatusSchema = z.enum([
  'REGISTERED',
  'PLANNING',
  'PARTIALLY_IMPLEMENTED',
  'IMPLEMENTED',
  'SUPERSEDED',
  'REVOKED'
]);

export type FounderMandateStatus =
  z.infer<typeof FounderMandateStatusSchema>;

export const ProposedMandateMissionSchema = z.object({
  proposal_id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  target_system: z.string().min(1),
  status: z.literal('PROPOSED'),
  execution_authority: z.literal(false)
}).strict();

export type ProposedMandateMission =
  z.infer<typeof ProposedMandateMissionSchema>;

export const FounderMandateSchema = z.object({
  schema_version: z.literal(1),

  mandate_id: z.string().min(1),

  title: z.string().min(1),

  original_text: z.string().min(1),

  original_text_sha256: z.string().regex(
    /^[a-f0-9]{64}$/
  ),

  issued_by: z.literal('FOUNDER'),

  issued_at: z.string().datetime(),

  status: FounderMandateStatusSchema,

  constraints: z.array(z.string()),

  reserved_powers: z.array(z.string()),

  prohibited_actions: z.array(z.string()),

  evidence_refs: z.array(z.string()),

  proposed_missions: z.array(
    ProposedMandateMissionSchema
  ),

  implementation_evidence_refs:
    z.array(z.string())
}).strict();

export type FounderMandate =
  z.infer<typeof FounderMandateSchema>;

export function createFounderMandate(
  originalText: string,
  options: {
    title?: string;
    issuedAt?: string;
    constraints?: string[];
    reservedPowers?: string[];
    prohibitedActions?: string[];
    evidenceRefs?: string[];
  } = {}
): FounderMandate {
  const text = originalText.trim();

  if (!text) {
    throw new Error(
      'FOUNDER_MANDATE_TEXT_REQUIRED'
    );
  }

  const issuedAt =
    options.issuedAt ??
    new Date().toISOString();

  const digest =
    createHash('sha256')
      .update(text, 'utf8')
      .digest('hex');

  return FounderMandateSchema.parse({
    schema_version: 1,

    mandate_id:
      `LY-MANDATE-${randomUUID()}`,

    title:
      options.title ??
      'Founder Mandate',

    original_text: text,

    original_text_sha256: digest,

    issued_by: 'FOUNDER',

    issued_at: issuedAt,

    status: 'REGISTERED',

    constraints:
      options.constraints ?? [],

    reserved_powers:
      options.reservedPowers ?? [],

    prohibited_actions:
      options.prohibitedActions ?? [],

    evidence_refs:
      options.evidenceRefs ?? [],

    proposed_missions: [],

    implementation_evidence_refs: []
  });
}

/**
 * Planning creates proposals only.
 *
 * It does not grant execution authority and does not change the
 * mandate to an implementation status.
 */
export function proposeMandateMission(
  mandate: FounderMandate,
  input: {
    title: string;
    objective: string;
    target_system: string;
  }
): FounderMandate {
  const current =
    FounderMandateSchema.parse(mandate);

  if (
    current.status === 'REVOKED' ||
    current.status === 'SUPERSEDED' ||
    current.status === 'IMPLEMENTED'
  ) {
    throw new Error(
      'FOUNDER_MANDATE_NOT_PLANNABLE'
    );
  }

  const proposal =
    ProposedMandateMissionSchema.parse({
      proposal_id:
        `LY-PROPOSAL-${randomUUID()}`,

      title: input.title,

      objective: input.objective,

      target_system:
        input.target_system,

      status: 'PROPOSED',

      execution_authority: false
    });

  return FounderMandateSchema.parse({
    ...current,
    status: 'PLANNING',
    proposed_missions: [
      ...current.proposed_missions,
      proposal
    ]
  });
}
