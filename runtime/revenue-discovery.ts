import {
  RevenueOpportunitySchema,
  type RevenueMission,
  type RevenueOpportunity,
  type Verification
} from './contracts.js';

import type {
  ExecutionContext
} from './context.js';

import {
  discoverRevenueOpportunity,
  buildRevenueLedger
} from './revenue.js';

import {
  PublicResearchResultSchema
} from './public-research.js';

import {
  ControlError
} from './security.js';

export type RevenueDiscoveryResult = {
  opportunities: RevenueOpportunity[];
  report: string;
  evidence_ids: string[];
  uncertainty: string[];
};

const VERTICALS = [
  {
    label: 'landscaping',
    offer:
      'Lead capture, quote follow-up and job workflow automation'
  },
  {
    label: 'electrician',
    offer:
      'Lead capture, quote follow-up and customer intake automation'
  },
  {
    label: 'plumber',
    offer:
      'Lead capture, missed-enquiry follow-up and booking workflow automation'
  },
  {
    label: 'cleaning service',
    offer:
      'Lead qualification, quote follow-up and recurring-customer workflow automation'
  }
] as const;

/*
 * These sources can help us FIND businesses, but they are not themselves
 * the SMB customer we are trying to sell Sink Space to.
 */
const NON_CUSTOMER_HOSTS = new Set([
  'wordofmouth.com.au',
  'www.wordofmouth.com.au',
  'thequoteyard.com.au',
  'www.thequoteyard.com.au',
  'yellowpages.com.au',
  'www.yellowpages.com.au',
  'hipages.com.au',
  'www.hipages.com.au',
  'oneflare.com.au',
  'www.oneflare.com.au',
  'airtasker.com',
  'www.airtasker.com',
  'serviceseeking.com.au',
  'www.serviceseeking.com.au',
  'localsearch.com.au',
  'www.localsearch.com.au',
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'linkedin.com',
  'www.linkedin.com'
]);

function priceFor(
  vertical: string
): number {
  switch (vertical) {
    case 'landscaping':
      return 750;

    case 'electrician':
    case 'plumber':
      return 900;

    default:
      return 650;
  }
}

function recurringFor(
  vertical: string
): number {
  return vertical === 'cleaning service'
    ? 199
    : 249;
}

function hostnameOf(
  raw: string
): string | null {
  try {
    return new URL(raw)
      .hostname
      .toLowerCase()
      .replace(/\.$/, '');
  } catch {
    return null;
  }
}

function isDirectBusinessCandidate(
  raw: string
): boolean {
  const host =
    hostnameOf(raw);

  if (!host) {
    return false;
  }

  if (
    NON_CUSTOMER_HOSTS.has(host)
  ) {
    return false;
  }

  /*
   * Exclude obvious non-business documents/search/navigation URLs.
   * This is intentionally conservative.
   */
  const lower =
    raw.toLowerCase();

  if (
    lower.includes('/search') ||
    lower.includes('/directory') ||
    lower.includes('/category/') ||
    lower.includes('/best-') ||
    lower.includes('/reviews/')
  ) {
    return false;
  }

  return true;
}

function canonicalUrlFromOpportunity(
  opportunity: RevenueOpportunity
): string | null {
  const prefix =
    'Canonical business URL: ';

  const row =
    opportunity.score_basis.find(
      item =>
        item.startsWith(prefix)
    );

  if (!row) {
    return null;
  }

  const raw =
    row.slice(
      prefix.length
    ).trim();

  try {
    return new URL(raw)
      .toString();
  } catch {
    return null;
  }
}

function canonicalHostFromOpportunity(
  opportunity: RevenueOpportunity
): string | null {
  const url =
    canonicalUrlFromOpportunity(
      opportunity
    );

  return url
    ? hostnameOf(url)
    : null;
}

function directSiteLooksRelevant(
  text: string,
  vertical: string
): boolean {
  const normalized =
    text.toLowerCase();

  const terms:
    Record<string, string[]> = {
      landscaping: [
        'landscap',
        'garden'
      ],

      electrician: [
        'electric',
        'electrical'
      ],

      plumber: [
        'plumb'
      ],

      'cleaning service': [
        'clean'
      ]
    };

  return (
    terms[vertical] ?? []
  ).some(
    term =>
      normalized.includes(term)
  );
}

export async function discoverRevenue(
  ctx: ExecutionContext,
  mission: RevenueMission
): Promise<RevenueDiscoveryResult> {
  if (
    ctx.task.assigned_agent !==
      'SINK-04'
  ) {
    throw new ControlError(
      'INVALID_SPECIALIST'
    );
  }

  if (!ctx.publicResearch) {
    throw new ControlError(
      'TOOL_NOT_IMPLEMENTED'
    );
  }

  const opportunities:
    RevenueOpportunity[] = [];

  const evidenceIds:
    string[] = [];

  for (const vertical of VERTICALS) {
    const query =
      `${vertical.label} Perth WA quote services`;

    const searchObservation =
      await ctx.publicResearch({
        mode: 'search',
        query
      });

    evidenceIds.push(
      searchObservation.evidence.evidence_id
    );

    const searchResult =
      PublicResearchResultSchema.parse(
        JSON.parse(
          searchObservation.content
        )
      );

    if (
      searchResult.mode !== 'search'
    ) {
      continue;
    }

    let acceptedForVertical = 0;

    /*
     * Look deeper than two results because directories may occupy
     * the highest search positions.
     */
    for (
      const candidate
      of searchResult.results
    ) {
      if (
        acceptedForVertical >= 2
      ) {
        break;
      }

      if (
        !isDirectBusinessCandidate(
          candidate.url
        )
      ) {
        continue;
      }

      /*
       * SINK-04 must directly observe the candidate website.
       * Search snippets alone are not enough.
       */
      let directObservation;

      try {
        directObservation =
          await ctx.publicResearch({
            mode: 'fetch',
            url: candidate.url
          });
      } catch {
        /*
         * Broken, blocked or unsupported websites are not promoted
         * into the opportunity portfolio.
         */
        continue;
      }

      const direct =
        PublicResearchResultSchema.parse(
          JSON.parse(
            directObservation.content
          )
        );

      if (
        direct.mode !== 'fetch' ||
        direct.status < 200 ||
        direct.status >= 400
      ) {
        continue;
      }

      if (
        !isDirectBusinessCandidate(
          direct.final_url
        )
      ) {
        continue;
      }

      if (
        !directSiteLooksRelevant(
          `${direct.title ?? ''} ${direct.text}`,
          vertical.label
        )
      ) {
        continue;
      }

      evidenceIds.push(
        directObservation.evidence.evidence_id
      );

      const canonical =
        direct.final_url;

      const host =
        hostnameOf(
          canonical
        );

      if (!host) {
        continue;
      }

      const companyLabel =
        direct.title?.trim() ||
        candidate.title;

      const opportunity =
        discoverRevenueOpportunity({
          opportunity_id:
            ctx.id(),

          title:
            `${companyLabel} — workflow automation hypothesis`,

          target_customer:
            companyLabel,

          observed_pain:
            'NEEDS_VERIFICATION: The public business website was directly observed, but its internal lead, quote and follow-up workflow has not been observed.',

          proposed_offer:
            vertical.offer,

          proposed_price_aud:
            priceFor(
              vertical.label
            ),

          estimated_delivery_cost_aud:
            50,

          estimated_tristan_minutes:
            120,

          estimated_time_to_cash_days:
            14,

          potential_recurring_revenue_aud:
            recurringFor(
              vertical.label
            ),

          /*
           * Search discovery + direct first-party website observation.
           */
          evidence_ids: [
            searchObservation.evidence.evidence_id,
            directObservation.evidence.evidence_id
          ],

          /*
           * Still deliberately below strong confidence because
           * neither pain nor buying intent has been observed.
           */
          evidence_strength:
            0.55,

          score_basis: [
            `Public search identified a ${vertical.label} candidate in Perth.`,
            'Candidate first-party website was directly fetched.',
            `Canonical business URL: ${canonical}`,
            `Canonical host: ${host}`,
            'Website content is consistent with the target service category.',
            'Internal workflow pain remains unverified.',
            'Commercial demand and willingness to pay remain unverified.',
            'Price is a proposed test price, not observed revenue.'
          ]
        });

      opportunities.push(
        RevenueOpportunitySchema.parse(
          opportunity
        )
      );

      acceptedForVertical++;
    }
  }

  opportunities.sort(
    (a, b) =>
      b.priority_score -
      a.priority_score
  );

  const uncertainty = [
    'UNKNOWN: No candidate has confirmed willingness to pay.',
    'UNKNOWN: Internal lead and quote workflows were not observed.',
    'NEEDS_VERIFICATION: Proposed pricing is a test hypothesis.',
    'NEEDS_VERIFICATION: No outreach has occurred.',
    'KNOWN: Candidate websites were observed only as public untrusted data.',
    'KNOWN: No revenue has been earned by this read-only revenue mission.'
  ];

  const report = [
    '# Sink Clones Revenue Discovery',
    '',
    `Target market: ${mission.target_market}`,
    `Cash target: A$${mission.cash_target_aud}`,
    `Horizon: ${mission.horizon_days} days`,
    `Qualified direct-business candidates: ${opportunities.length}`,
    '',
    '## Opportunity hypotheses',
    '',
    ...opportunities.map(
      (item, index) => [
        `### ${index + 1}. ${item.title}`,
        '',
        `Target: ${item.target_customer}`,
        `Canonical URL: ${canonicalUrlFromOpportunity(item) ?? 'UNKNOWN'}`,
        `Offer: ${item.proposed_offer}`,
        `Test price: A$${item.proposed_price_aud}`,
        `Recurring hypothesis: A$${item.potential_recurring_revenue_aud}/month`,
        `Priority score: ${item.priority_score}/100`,
        `Evidence confidence: ${item.confidence}`,
        `Status: ${item.status}`,
        '',
        `Pain state: ${item.observed_pain}`,
        '',
        ...item.score_basis.map(
          basis =>
            `- ${basis}`
        ),
        ''
      ].join('\n')
    ),
    '## Preserved uncertainty',
    '',
    ...uncertainty.map(
      item =>
        `- ${item}`
    )
  ].join('\n');

  ctx.artifact(
    report,
    'text/markdown'
  );

  ctx.artifact(
    JSON.stringify(
      {
        opportunities,
        uncertainty
      },
      null,
      2
    ),
    'application/json'
  );

  return {
    opportunities,
    report,
    evidence_ids:
      [...new Set(evidenceIds)],
    uncertainty
  };
}

export async function auditRevenueDiscovery(
  ctx: ExecutionContext,
  result: RevenueDiscoveryResult
): Promise<Verification> {
  if (!ctx.publicResearch) {
    throw new ControlError(
      'TOOL_NOT_IMPLEMENTED'
    );
  }

  const failures:
    string[] = [];

  const freshEvidence:
    string[] = [];

  if (
    result.opportunities.length === 0
  ) {
    failures.push(
      'Revenue discovery produced no qualified direct-business candidates.'
    );
  }

  for (
    const opportunity
    of result.opportunities
  ) {
    if (
      opportunity.evidence_ids.length < 2
    ) {
      failures.push(
        `Opportunity ${opportunity.opportunity_id} lacks both discovery and direct-site evidence.`
      );

      continue;
    }

    const canonical =
      canonicalUrlFromOpportunity(
        opportunity
      );

    if (!canonical) {
      failures.push(
        `Opportunity ${opportunity.opportunity_id} has no canonical business URL.`
      );

      continue;
    }

    if (
      !isDirectBusinessCandidate(
        canonical
      )
    ) {
      failures.push(
        `Opportunity ${opportunity.opportunity_id} resolves to a non-customer source.`
      );

      continue;
    }

    /*
     * Independent verification now re-opens the first-party source
     * instead of searching an unstable marketing title.
     */
    let observation;

    try {
      observation =
        await ctx.publicResearch({
          mode: 'fetch',
          url: canonical
        });
    } catch {
      failures.push(
        `Independent fetch failed for ${canonical}.`
      );

      continue;
    }

    freshEvidence.push(
      observation.evidence.evidence_id
    );

    const fresh =
      PublicResearchResultSchema.parse(
        JSON.parse(
          observation.content
        )
      );

    if (
      fresh.mode !== 'fetch' ||
      fresh.status < 200 ||
      fresh.status >= 400
    ) {
      failures.push(
        `Independent fetch did not return a usable page for ${canonical}.`
      );

      continue;
    }

    const expectedHost =
      canonicalHostFromOpportunity(
        opportunity
      );

    const observedHost =
      hostnameOf(
        fresh.final_url
      );

    if (
      !expectedHost ||
      !observedHost ||
      expectedHost !== observedHost
    ) {
      failures.push(
        `Canonical host mismatch for opportunity ${opportunity.opportunity_id}.`
      );
    }

    if (
      opportunity.status ===
        'APPROVED_FOR_TEST'
    ) {
      failures.push(
        `DISCOVER mission illegally promoted ${opportunity.opportunity_id} to APPROVED_FOR_TEST.`
      );
    }

    if (
      !opportunity.observed_pain.startsWith(
        'NEEDS_VERIFICATION:'
      )
    ) {
      failures.push(
        `Opportunity ${opportunity.opportunity_id} overstates business pain.`
      );
    }
  }

  const config =
    ctx.run.agent_configs.find(
      agent =>
        agent.id === ctx.task.assigned_agent
    );

  if (!config) {
    throw new ControlError(
      'MISSING_AGENT_CONFIGURATION'
    );
  }

  /*
   * Verification identity comes from the task assignment.
   * recordVerification() remains the final authority enforcing
   * independence, agent identity and configuration version.
   */
  return {
    agent_id:
      ctx.task.assigned_agent,

    agent_version:
      ctx.task.agent_version,

    verdict:
      failures.length
        ? 'FAIL'
        : 'PASS_WITH_LIMITATIONS',

    reasons:
      failures.length
        ? failures
        : [
            'Independent direct-site retrieval corroborated each retained candidate.',
            'Directory, marketplace and obvious editorial candidates were excluded.',
            'Candidate existence and service relevance do not establish internal workflow pain.',
            'Willingness to pay and proposed pricing remain unverified.',
            'No revenue or outbound action was claimed.'
          ],

    checked_claim_ids:
      [],

    evidence_ids:
      freshEvidence,

    timestamp:
      ctx.now()
  };
}

export async function redSinkRevenueDiscovery(
  ctx: ExecutionContext,
  result: RevenueDiscoveryResult,
  prior: Verification
): Promise<{
  verification: Verification;
  findings: string[];
}> {
  const blocking:
    string[] = [];

  const limitations:
    string[] = [];

  if (
    ![
      'PASS',
      'PASS_WITH_LIMITATIONS'
    ].includes(
      prior.verdict
    )
  ) {
    blocking.push(
      'Independent audit rejected the revenue discovery portfolio.'
    );
  }

  if (
    result.opportunities.length === 0
  ) {
    blocking.push(
      'No direct-business opportunities survived qualification.'
    );
  }

  for (
    const opportunity
    of result.opportunities
  ) {
    if (
      opportunity.confidence > 0.6
    ) {
      blocking.push(
        `Opportunity ${opportunity.opportunity_id} confidence is too high for discovery-stage evidence.`
      );
    }

    if (
      !canonicalUrlFromOpportunity(
        opportunity
      )
    ) {
      blocking.push(
        `Opportunity ${opportunity.opportunity_id} lacks canonical first-party provenance.`
      );
    }

    if (
      !opportunity.observed_pain.startsWith(
        'NEEDS_VERIFICATION:'
      )
    ) {
      blocking.push(
        `Opportunity ${opportunity.opportunity_id} presents internal business pain as established fact.`
      );
    }
  }

  const required = [
    'UNKNOWN: No candidate has confirmed willingness to pay.',
    'UNKNOWN: Internal lead and quote workflows were not observed.',
    'NEEDS_VERIFICATION: Proposed pricing is a test hypothesis.',
    'NEEDS_VERIFICATION: No outreach has occurred.',
    'KNOWN: No revenue has been earned by this read-only revenue mission.'
  ];

  for (
    const limitation
    of required
  ) {
    if (
      !result.uncertainty.includes(
        limitation
      )
    ) {
      blocking.push(
        `Required limitation missing: ${limitation}`
      );
    }
  }

  limitations.push(
    'Direct public website evidence establishes candidate existence, not demand for Sink Space.'
  );

  limitations.push(
    'No purchase intent, budget, decision-maker identity or conversion probability has been established.'
  );

  limitations.push(
    'Priority score is an experiment-ranking heuristic and must not be interpreted as expected income.'
  );

  const findings = [
    ...blocking,
    ...limitations
  ];

  const config =
    ctx.run.agent_configs.find(
      agent =>
        agent.id === ctx.task.assigned_agent
    );

  if (!config) {
    throw new ControlError(
      'MISSING_AGENT_CONFIGURATION'
    );
  }

  return {
    findings,

    verification: {
      agent_id:
        ctx.task.assigned_agent,

      agent_version:
        ctx.task.agent_version,

      verdict:
        blocking.length > 0
          ? 'FAIL'
          : 'PASS_WITH_LIMITATIONS',

      reasons:
        findings,

      checked_claim_ids:
        [],

      evidence_ids:
        [],

      timestamp:
        ctx.now()
    }
  };
}

export function emptyRevenueLedger(
  opportunities: RevenueOpportunity[],
  now: string
) {
  return buildRevenueLedger({
    opportunities,
    actions: [],
    outcomes: [],
    updated_at:
      now
  });
}
