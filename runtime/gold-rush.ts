import { z } from 'zod';

/**
 * SINK // GOLD RUSH
 *
 * Deterministic opportunity-intelligence kernel.
 *
 * Doctrine:
 *   headline value != expected value
 *   expected value != attainable value
 *   attainable value != realized value
 *   realized value requires proof
 *
 * This module performs analysis only.
 * It has no wallet, transaction, credential, spending,
 * outreach or execution capability.
 */

export const GoldRushCategorySchema = z.enum([
  'BUG_BOUNTY',
  'BUILDER_GRANT',
  'HACKATHON',
  'OPEN_SOURCE_BOUNTY',
  'UNCLAIMED_ENTITLEMENT',
  'NETWORK_OPERATOR',
  'DEPIN',
  'KEEPER',
  'SOLVER',
  'PROVER',
  'RESTAKING',
  'ARBITRAGE',
  'OTHER'
]);

export type GoldRushCategory =
  z.infer<typeof GoldRushCategorySchema>;

export const GoldRushStateSchema = z.enum([
  'DISCOVERED',
  'NORMALIZED',
  'SOURCE_VERIFIED',
  'ELIGIBILITY_CHECKED',
  'ECONOMICALLY_MODELED',
  'AUDITED',
  'RED_TEAMED',
  'ACTIONABLE',
  'HUMAN_APPROVED',
  'UNCERTAIN',
  'REJECTED',
  'STALE',
  'EXPIRED'
]);

export type GoldRushState =
  z.infer<typeof GoldRushStateSchema>;

export const GoldRushRangeSchema = z
  .strictObject({
    low: z.number().finite(),
    base: z.number().finite(),
    high: z.number().finite()
  })
  .superRefine((value, ctx) => {
    if (
      value.low > value.base ||
      value.base > value.high
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Range must satisfy low <= base <= high.'
      });
    }
  });

export type GoldRushRange =
  z.infer<typeof GoldRushRangeSchema>;

export const GoldRushProbabilityRangeSchema =
  GoldRushRangeSchema.superRefine(
    (value, ctx) => {
      for (const number of [
        value.low,
        value.base,
        value.high
      ]) {
        if (number < 0 || number > 1) {
          ctx.addIssue({
            code: 'custom',
            message:
              'Probability values must be between 0 and 1.'
          });
        }
      }
    }
  );

export const GoldRushOpportunitySchema =
  z.strictObject({
    opportunity_id:
      z.string()
        .min(1)
        .max(120)
        .regex(/^[a-zA-Z0-9_-]+$/),

    canonical_key:
      z.string()
        .min(1)
        .max(500),

    category:
      GoldRushCategorySchema,

    title:
      z.string()
        .min(1)
        .max(2_000),

    provider:
      z.string()
        .min(1)
        .max(1_000),

    official_source_url:
      z.url()
        .nullable(),

    discovered_at:
      z.iso.datetime(),

    source_observed_at:
      z.iso.datetime()
        .nullable(),

    deadline:
      z.iso.datetime()
        .nullable(),

    reward_aud:
      GoldRushRangeSchema.nullable(),

    success_probability:
      GoldRushProbabilityRangeSchema.nullable(),

    hours:
      GoldRushRangeSchema.nullable(),

    direct_cost_aud:
      GoldRushRangeSchema,

    capital_required_aud:
      GoldRushRangeSchema,

    hourly_time_value_aud:
      z.number()
        .finite()
        .nonnegative()
        .default(40),

    strategic_option_value_aud:
      GoldRushRangeSchema.default({
        low: 0,
        base: 0,
        high: 0
      }),

    evidence_ids:
      z.array(
        z.string()
          .min(1)
          .max(120)
          .regex(/^[a-zA-Z0-9_-]+$/)
      ),

    evidence_confidence:
      z.number()
        .min(0)
        .max(1),

    authorization_verified:
      z.boolean(),

    eligibility_verified:
      z.boolean(),

    source_verified:
      z.boolean(),

    audit_passed:
      z.boolean(),

    red_team_passed:
      z.boolean(),

    freshness_days:
      z.number()
        .finite()
        .nonnegative(),

    state:
      GoldRushStateSchema,

    constraints:
      z.array(
        z.string().min(1).max(5_000)
      )
      .max(50),

    rejection_reasons:
      z.array(
        z.string().min(1).max(5_000)
      )
      .max(50)
  });

export type GoldRushOpportunity =
  z.infer<typeof GoldRushOpportunitySchema>;

export const GoldRushEconomicsSchema =
  z.strictObject({
    headline_value_aud:
      GoldRushRangeSchema.nullable(),

    expected_value_aud:
      GoldRushRangeSchema.nullable(),

    attainable_value_aud:
      GoldRushRangeSchema.nullable(),

    attainable_value_per_hour_aud:
      GoldRushRangeSchema.nullable(),

    freshness_factor:
      z.number()
        .min(0)
        .max(1),

    evidence_factor:
      z.number()
        .min(0)
        .max(1),

    authorization_factor:
      z.union([
        z.literal(0),
        z.literal(1)
      ]),

    priority_score:
      z.number()
        .min(0)
        .max(100),

    actionable:
      z.boolean(),

    blockers:
      z.array(
        z.string().min(1)
      ),

    model_basis:
      z.array(
        z.string().min(1)
      )
  });

export type GoldRushEconomics =
  z.infer<typeof GoldRushEconomicsSchema>;

export const GoldRushRealizationReceiptSchema =
  z.strictObject({
    receipt_id:
      z.string()
        .min(1)
        .max(120)
        .regex(/^[a-zA-Z0-9_-]+$/),

    opportunity_id:
      z.string()
        .min(1)
        .max(120)
        .regex(/^[a-zA-Z0-9_-]+$/),

    realized_value_aud:
      z.number()
        .finite()
        .nonnegative(),

    direct_cost_aud:
      z.number()
        .finite()
        .nonnegative(),

    evidence_ids:
      z.array(
        z.string()
          .min(1)
          .max(120)
          .regex(/^[a-zA-Z0-9_-]+$/)
      )
      .min(1),

    realized_at:
      z.iso.datetime()
  });

export type GoldRushRealizationReceipt =
  z.infer<
    typeof GoldRushRealizationReceiptSchema
  >;

export const GoldRushLedgerSchema =
  z.strictObject({
    schema_version:
      z.literal('1.0.0'),

    currency:
      z.literal('AUD'),

    generated_at:
      z.iso.datetime(),

    discovered:
      z.number().int().nonnegative(),

    source_verified:
      z.number().int().nonnegative(),

    actionable:
      z.number().int().nonnegative(),

    rejected:
      z.number().int().nonnegative(),

    stale:
      z.number().int().nonnegative(),

    estimated_attainable_value_aud:
      GoldRushRangeSchema,

    realized_value_aud:
      z.number().finite().nonnegative(),

    opportunities:
      z.array(
        z.strictObject({
          opportunity:
            GoldRushOpportunitySchema,

          economics:
            GoldRushEconomicsSchema
        })
      ),

    realization_receipts:
      z.array(
        GoldRushRealizationReceiptSchema
      )
  });

export type GoldRushLedger =
  z.infer<typeof GoldRushLedgerSchema>;

function roundMoney(
  value: number
): number {
  return Number(
    value.toFixed(2)
  );
}

function clamp01(
  value: number
): number {
  return Math.max(
    0,
    Math.min(1, value)
  );
}

function range(
  low: number,
  base: number,
  high: number
): GoldRushRange {
  return GoldRushRangeSchema.parse({
    low: roundMoney(low),
    base: roundMoney(base),
    high: roundMoney(high)
  });
}

/**
 * Evidence decays with age rather than becoming
 * magically false at an arbitrary timestamp.
 *
 * <= 7d  = full weight
 * 30d    = ~0.79
 * 90d    = ~0.25
 * >=180d = zero ranking weight
 */
export function goldRushFreshnessFactor(
  ageDays: number
): number {
  if (!Number.isFinite(ageDays)) {
    return 0;
  }

  if (ageDays <= 7) {
    return 1;
  }

  if (ageDays >= 180) {
    return 0;
  }

  return Number(
    (
      1 -
      (ageDays - 7) /
        (180 - 7)
    ).toFixed(4)
  );
}

function economicPoint(
  reward: number,
  probability: number,
  directCost: number,
  capitalRequired: number,
  hours: number,
  hourlyTimeValue: number,
  strategicOptionValue: number
): number {
  /*
   * Capital is not treated as fully consumed.
   * A bounded 2% capital opportunity/risk reserve
   * prevents capital-heavy opportunities from
   * appearing free while avoiding the false claim
   * that all required capital is a cost.
   */
  const capitalReserve =
    Math.max(
      0,
      capitalRequired
    ) * 0.02;

  const timeCost =
    Math.max(
      0,
      hours
    ) *
    Math.max(
      0,
      hourlyTimeValue
    );

  return (
    reward *
      clamp01(probability) -
    Math.max(0, directCost) -
    capitalReserve -
    timeCost +
    Math.max(
      0,
      strategicOptionValue
    )
  );
}

export function modelGoldRushEconomics(
  raw: GoldRushOpportunity
): GoldRushEconomics {
  const opportunity =
    GoldRushOpportunitySchema.parse(
      raw
    );

  const blockers:
    string[] = [];

  if (!opportunity.official_source_url) {
    blockers.push(
      'Missing official source.'
    );
  }

  if (!opportunity.source_verified) {
    blockers.push(
      'Official source not independently verified.'
    );
  }

  if (
    opportunity.evidence_ids.length === 0 ||
    opportunity.evidence_confidence <= 0
  ) {
    blockers.push(
      'Missing usable evidence.'
    );
  }

  if (!opportunity.authorization_verified) {
    blockers.push(
      'Authority to participate is not verified.'
    );
  }

  if (!opportunity.eligibility_verified) {
    blockers.push(
      'Eligibility is not verified.'
    );
  }

  if (!opportunity.audit_passed) {
    blockers.push(
      'Independent audit has not passed.'
    );
  }

  if (!opportunity.red_team_passed) {
    blockers.push(
      'Red Sink review has not passed.'
    );
  }

  if (
    opportunity.state === 'EXPIRED' ||
    opportunity.state === 'REJECTED' ||
    opportunity.state === 'STALE'
  ) {
    blockers.push(
      `Opportunity state is ${opportunity.state}.`
    );
  }

  if (opportunity.reward_aud === null) {
    blockers.push(
      'Reward is unknown.'
    );
  }

  if (opportunity.success_probability === null) {
    blockers.push(
      'Success probability is unknown.'
    );
  }

  if (opportunity.hours === null) {
    blockers.push(
      'Required effort is unknown.'
    );
  }

  if (
    opportunity.reward_aud === null ||
    opportunity.success_probability === null ||
    opportunity.hours === null
  ) {
    return GoldRushEconomicsSchema.parse({
      headline_value_aud:
        opportunity.reward_aud,

      expected_value_aud:
        null,

      attainable_value_aud:
        null,

      attainable_value_per_hour_aud:
        null,

      freshness_factor:
        goldRushFreshnessFactor(
          opportunity.freshness_days
        ),

      evidence_factor:
        clamp01(
          opportunity.evidence_confidence
        ),

      authorization_factor:
        opportunity.authorization_verified
          ? 1
          : 0,

      priority_score:
        0,

      actionable:
        false,

      blockers:
        [...new Set(blockers)],

      model_basis: [
        'UNKNOWN is distinct from observed zero.',
        'Expected and attainable value are not calculated without reward, success probability and effort evidence.',
        'Headline reward is never treated as realized value.',
        'Hard verification gates execute before ranking.',
        'Realized value requires a realization receipt.'
      ]
    });
  }

  /*
   * The early return above establishes these as known.
   * Keep explicit typed aliases so UNKNOWN never leaks
   * into numeric economic arithmetic.
   */
  const reward =
    opportunity.reward_aud as NonNullable<
      GoldRushOpportunity['reward_aud']
    >;

  const probability =
    opportunity.success_probability as NonNullable<
      GoldRushOpportunity['success_probability']
    >;

  const hours =
    opportunity.hours as NonNullable<
      GoldRushOpportunity['hours']
    >;

  const expectedLow =
    economicPoint(
      reward.low,
      probability.low,
      opportunity.direct_cost_aud.high,
      opportunity.capital_required_aud.high,
      hours.high,
      opportunity.hourly_time_value_aud,
      opportunity.strategic_option_value_aud.low
    );

  const expectedBase =
    economicPoint(
      reward.base,
      probability.base,
      opportunity.direct_cost_aud.base,
      opportunity.capital_required_aud.base,
      hours.base,
      opportunity.hourly_time_value_aud,
      opportunity.strategic_option_value_aud.base
    );

  const expectedHigh =
    economicPoint(
      reward.high,
      probability.high,
      opportunity.direct_cost_aud.low,
      opportunity.capital_required_aud.low,
      hours.low,
      opportunity.hourly_time_value_aud,
      opportunity.strategic_option_value_aud.high
    );

  const expected =
    range(
      Math.min(
        expectedLow,
        expectedBase,
        expectedHigh
      ),
      expectedBase,
      Math.max(
        expectedLow,
        expectedBase,
        expectedHigh
      )
    );

  const freshness =
    goldRushFreshnessFactor(
      opportunity.freshness_days
    );

  const evidence =
    clamp01(
      opportunity.evidence_confidence
    );

  const authorization:
    0 | 1 =
      opportunity.authorization_verified
        ? 1
        : 0;

  const multiplier =
    freshness *
    evidence *
    authorization;

  const attainable =
    range(
      expected.low * multiplier,
      expected.base * multiplier,
      expected.high * multiplier
    );

  const perHour =
    range(
      attainable.low /
        Math.max(
          0.25,
          hours.high
        ),

      attainable.base /
        Math.max(
          0.25,
          hours.base
        ),

      attainable.high /
        Math.max(
          0.25,
          hours.low
        )
    );

  const positiveEconomics =
    attainable.base > 0;

  if (!positiveEconomics) {
    blockers.push(
      'Base attainable economic value is not positive.'
    );
  }

  const actionable =
    blockers.length === 0;

  /*
   * Hard gates happen before ranking.
   * A blocked opportunity receives zero actionable
   * priority regardless of headline reward.
   *
   * Ranking components:
   * 40% attainability / EV per hour
   * 25% expected payout
   * 15% speed
   * 10% bounded strategic option value
   * 10% evidence quality
   */
  let priority = 0;

  if (actionable) {
    const attainabilityScore =
      clamp01(
        Math.max(
          0,
          perHour.base
        ) / 1000
      );

    const payoutScore =
      clamp01(
        Math.max(
          0,
          attainable.base
        ) / 10_000
      );

    const speedScore =
      clamp01(
        1 /
          Math.max(
            1,
            hours.base / 8
          )
      );

    const strategicScore =
      clamp01(
        Math.max(
          0,
          opportunity
            .strategic_option_value_aud
            .base
        ) / 2_000
      );

    priority =
      attainabilityScore * 40 +
      payoutScore * 25 +
      speedScore * 15 +
      strategicScore * 10 +
      evidence * 10;
  }

  return GoldRushEconomicsSchema.parse({
    headline_value_aud:
      reward,

    expected_value_aud:
      expected,

    attainable_value_aud:
      attainable,

    attainable_value_per_hour_aud:
      perHour,

    freshness_factor:
      freshness,

    evidence_factor:
      evidence,

    authorization_factor:
      authorization,

    priority_score:
      Number(
        priority.toFixed(2)
      ),

    actionable,

    blockers:
      [...new Set(blockers)],

    model_basis: [
      'Headline reward is never treated as realized value.',
      'Expected value discounts reward by success probability and modeled costs.',
      'Attainable value is further discounted by evidence, freshness and authorization.',
      'Capital requirement uses a bounded 2% opportunity/risk reserve rather than treating all capital as consumed.',
      'Strategic option value is explicitly bounded soft value, not cash.',
      'Hard verification gates execute before ranking.',
      'Realized value requires a realization receipt.'
    ]
  });
}

export function canonicalGoldRushKey(
  rawUrl: string,
  externalId = ''
): string {
  const url =
    new URL(rawUrl);

  url.hash = '';

  for (
    const key
    of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref'
    ]
  ) {
    url.searchParams.delete(key);
  }

  url.hostname =
    url.hostname
      .toLowerCase()
      .replace(/\.$/, '');

  const canonical =
    url.toString();

  return externalId
    ? `${canonical}::${externalId.trim().toLowerCase()}`
    : canonical;
}

export function dedupeGoldRushOpportunities(
  opportunities:
    GoldRushOpportunity[]
): GoldRushOpportunity[] {
  const map =
    new Map<
      string,
      GoldRushOpportunity
    >();

  for (const raw of opportunities) {
    const opportunity =
      GoldRushOpportunitySchema.parse(
        raw
      );

    const existing =
      map.get(
        opportunity.canonical_key
      );

    if (
      !existing ||
      opportunity.evidence_confidence >
        existing.evidence_confidence ||
      (
        opportunity.evidence_confidence ===
          existing.evidence_confidence &&
        opportunity.freshness_days <
          existing.freshness_days
      )
    ) {
      map.set(
        opportunity.canonical_key,
        opportunity
      );
    }
  }

  return [...map.values()];
}

export function rankGoldRush(
  opportunities:
    GoldRushOpportunity[]
): Array<{
  opportunity: GoldRushOpportunity;
  economics: GoldRushEconomics;
}> {
  return dedupeGoldRushOpportunities(
    opportunities
  )
    .map(
      opportunity => ({
        opportunity,
        economics:
          modelGoldRushEconomics(
            opportunity
          )
      })
    )
    .sort(
      (a, b) =>
        b.economics.priority_score -
          a.economics.priority_score ||
        (b.economics
          .attainable_value_aud?.base ?? Number.NEGATIVE_INFINITY) -
          (a.economics
            .attainable_value_aud?.base ?? Number.NEGATIVE_INFINITY) ||
        a.opportunity.canonical_key
          .localeCompare(
            b.opportunity.canonical_key
          )
    );
}

export function realizedGoldRushValue(
  receipts:
    GoldRushRealizationReceipt[]
): number {
  const parsed =
    receipts.map(
      item =>
        GoldRushRealizationReceiptSchema
          .parse(item)
    );

  return roundMoney(
    parsed.reduce(
      (sum, item) =>
        sum +
        item.realized_value_aud,
      0
    )
  );
}

export function buildGoldRushLedger(
  input: {
    opportunities:
      GoldRushOpportunity[];

    realization_receipts?:
      GoldRushRealizationReceipt[];

    generated_at:
      string;
  }
): GoldRushLedger {
  const ranked =
    rankGoldRush(
      input.opportunities
    );

  const receipts =
    input.realization_receipts ?? [];

  const estimated =
    ranked.reduce(
      (acc, item) => ({
        low:
          acc.low +
          (item.economics
            .attainable_value_aud?.low ?? 0),

        base:
          acc.base +
          (item.economics
            .attainable_value_aud?.base ?? 0),

        high:
          acc.high +
          (item.economics
            .attainable_value_aud?.high ?? 0)
      }),
      {
        low: 0,
        base: 0,
        high: 0
      }
    );

  return GoldRushLedgerSchema.parse({
    schema_version:
      '1.0.0',

    currency:
      'AUD',

    generated_at:
      input.generated_at,

    discovered:
      ranked.length,

    source_verified:
      ranked.filter(
        item =>
          item.opportunity
            .source_verified
      ).length,

    actionable:
      ranked.filter(
        item =>
          item.economics.actionable
      ).length,

    rejected:
      ranked.filter(
        item =>
          item.opportunity.state ===
            'REJECTED'
      ).length,

    stale:
      ranked.filter(
        item =>
          item.opportunity.state ===
            'STALE'
      ).length,

    estimated_attainable_value_aud:
      range(
        estimated.low,
        estimated.base,
        estimated.high
      ),

    realized_value_aud:
      realizedGoldRushValue(
        receipts
      ),

    opportunities:
      ranked,

    realization_receipts:
      receipts
  });
}

/**
 * Brier score for historical binary forecasts.
 * 0 = perfectly calibrated for the supplied observations.
 * 1 = maximally wrong.
 */
export function brierScore(
  observations:
    Array<{
      probability: number;
      outcome: 0 | 1;
    }>
): number | null {
  if (observations.length === 0) {
    return null;
  }

  const score =
    observations.reduce(
      (sum, item) => {
        const p =
          clamp01(
            item.probability
          );

        return (
          sum +
          (p - item.outcome) ** 2
        );
      },
      0
    ) /
    observations.length;

  return Number(
    score.toFixed(6)
  );
}
