import {
  RevenueLedgerSchema,
  type RevenueAction,
  type RevenueLedger,
  type RevenueOpportunity,
  type RevenueOutcome
} from './contracts.js';

export function scoreRevenueOpportunity(
  input: {
    evidence_strength: number;
    time_to_cash_days: number;
    proposed_price_aud: number;
    estimated_delivery_cost_aud: number;
    estimated_tristan_minutes: number;
    recurring_revenue_aud: number;
  }
): number {
  const evidence =
    Math.max(
      0,
      Math.min(
        1,
        input.evidence_strength
      )
    );

  const speed =
    1 /
    Math.max(
      1,
      input.time_to_cash_days
    );

  const margin =
    Math.max(
      0,
      input.proposed_price_aud -
      input.estimated_delivery_cost_aud
    );

  const humanHours =
    Math.max(
      0.25,
      input.estimated_tristan_minutes /
        60
    );

  const leverage =
    (
      margin +
      input.recurring_revenue_aud
    ) /
    humanHours;

  const leverageScore =
    Math.min(
      1,
      leverage /
        2000
    );

  const score =
    (
      evidence * 45 +
      Math.min(
        1,
        speed * 7
      ) * 25 +
      leverageScore * 30
    );

  return Number(
    score.toFixed(2)
  );
}

export function buildRevenueLedger(
  input: {
    opportunities?: RevenueOpportunity[];
    actions?: RevenueAction[];
    outcomes?: RevenueOutcome[];
    updated_at: string;
  }
): RevenueLedger {
  const opportunities =
    input.opportunities ?? [];

  const actions =
    input.actions ?? [];

  const outcomes =
    input.outcomes ?? [];

  const gross =
    outcomes.reduce(
      (sum, item) =>
        sum +
        item.gross_revenue_aud,
      0
    );

  const costs =
    outcomes.reduce(
      (sum, item) =>
        sum +
        item.direct_cost_aud,
      0
    );

  const minutes =
    outcomes.reduce(
      (sum, item) =>
        sum +
        item.tristan_minutes,
      0
    );

  const net =
    gross -
    costs;

  const netPerHour =
    minutes === 0
      ? null
      : net /
        (minutes / 60);

  const tested =
    new Set(
      outcomes.map(
        item =>
          item.opportunity_id
      )
    ).size;

  const won =
    new Set(
      outcomes
        .filter(
          item =>
            item.paid
        )
        .map(
          item =>
            item.opportunity_id
        )
    ).size;

  return RevenueLedgerSchema.parse({
    currency: 'AUD',

    gross_revenue_aud:
      Number(
        gross.toFixed(2)
      ),

    direct_costs_aud:
      Number(
        costs.toFixed(2)
      ),

    net_cash_aud:
      Number(
        net.toFixed(2)
      ),

    tristan_minutes:
      minutes,

    net_cash_per_tristan_hour:
      netPerHour === null
        ? null
        : Number(
            netPerHour.toFixed(2)
          ),

    opportunities_tested:
      tested,

    actions_taken:
      outcomes.length,

    customers_won:
      won,

    opportunities,

    actions,

    outcomes,

    updated_at:
      input.updated_at
  });
}


export type RevenueDiscoveryInput = {
  opportunity_id: string;
  title: string;
  target_customer: string;
  observed_pain: string;
  proposed_offer: string;
  proposed_price_aud: number;
  estimated_delivery_cost_aud: number;
  estimated_tristan_minutes: number;
  estimated_time_to_cash_days: number;
  potential_recurring_revenue_aud: number;
  evidence_ids?: string[];
  evidence_strength?: number;
  score_basis: string[];
};

export function discoverRevenueOpportunity(
  input: RevenueDiscoveryInput
): RevenueOpportunity {
  const evidenceIds =
    input.evidence_ids ?? [];

  const evidenceStrength =
    evidenceIds.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            input.evidence_strength ?? 0
          )
        );

  const score =
    scoreRevenueOpportunity({
      evidence_strength:
        evidenceStrength,

      time_to_cash_days:
        input.estimated_time_to_cash_days,

      proposed_price_aud:
        input.proposed_price_aud,

      estimated_delivery_cost_aud:
        input.estimated_delivery_cost_aud,

      estimated_tristan_minutes:
        input.estimated_tristan_minutes,

      recurring_revenue_aud:
        input.potential_recurring_revenue_aud
    });

  return {
    opportunity_id:
      input.opportunity_id,

    title:
      input.title,

    target_customer:
      input.target_customer,

    observed_pain:
      input.observed_pain,

    proposed_offer:
      input.proposed_offer,

    proposed_price_aud:
      input.proposed_price_aud,

    estimated_delivery_cost_aud:
      input.estimated_delivery_cost_aud,

    estimated_tristan_minutes:
      input.estimated_tristan_minutes,

    estimated_time_to_cash_days:
      input.estimated_time_to_cash_days,

    potential_recurring_revenue_aud:
      input.potential_recurring_revenue_aud,

    evidence_ids:
      evidenceIds,

    confidence:
      evidenceStrength,

    priority_score:
      score,

    score_basis:
      input.score_basis,

    status:
      evidenceIds.length === 0
        ? 'DISCOVERED'
        : 'VALIDATING'
  };
}

export function revenueOpportunityCanAdvance(
  opportunity: RevenueOpportunity
): boolean {
  return (
    opportunity.evidence_ids.length > 0 &&
    opportunity.confidence > 0
  );
}

export function assertRevenueOpportunitySafe(
  opportunity: RevenueOpportunity
): void {
  if (
    opportunity.status ===
      'APPROVED_FOR_TEST' &&
    !revenueOpportunityCanAdvance(
      opportunity
    )
  ) {
    throw new Error(
      'UNVERIFIED_REVENUE_OPPORTUNITY'
    );
  }
}
