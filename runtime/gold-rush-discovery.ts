import type {
  ExecutionContext
} from './context.js';

import {
  PublicResearchResultSchema
} from './public-research.js';

import {
  ControlError
} from './security.js';

import {
  GoldRushOpportunitySchema,
  buildGoldRushLedger,
  canonicalGoldRushKey,
  dedupeGoldRushOpportunities,
  modelGoldRushEconomics,
  rankGoldRush,
  type GoldRushLedger,
  type GoldRushOpportunity
} from './gold-rush.js';

import type {
  GoldRushMission,
  Verification
} from './contracts.js';

export type GoldRushDiscoveryResult = {
  opportunities: GoldRushOpportunity[];
  ledger: GoldRushLedger;
  report: string;
  evidence_ids: string[];
  uncertainty: string[];
};

type SearchFamily = {
  category: GoldRushOpportunity['category'];
  queries: string[];
  required_any: string[];
  authority_any: string[];
};

const SEARCH_FAMILIES: SearchFamily[] = [
  {
    category: 'BUG_BOUNTY',
    queries: [
      'official bug bounty program rewards scope safe harbor',
      'official web3 bug bounty program rewards scope'
    ],
    required_any: [
      'bug bounty',
      'bounty program'
    ],
    authority_any: [
      'scope',
      'reward',
      'rewards',
      'rules',
      'safe harbor',
      'safe harbour'
    ]
  },
  {
    category: 'BUILDER_GRANT',
    queries: [
      'official developer grants program apply blockchain',
      'official builder grants program developers apply'
    ],
    required_any: [
      'grant',
      'grants'
    ],
    authority_any: [
      'apply',
      'application',
      'eligibility',
      'eligible'
    ]
  },
  {
    category: 'HACKATHON',
    queries: [
      'official developer hackathon prizes registration',
      'official blockchain hackathon prizes developers'
    ],
    required_any: [
      'hackathon'
    ],
    authority_any: [
      'prize',
      'prizes',
      'register',
      'registration',
      'submission'
    ]
  },
  {
    category: 'OPEN_SOURCE_BOUNTY',
    queries: [
      'official open source issue bounty reward developers',
      'official github issue bounty developer reward'
    ],
    required_any: [
      'bounty',
      'issue'
    ],
    authority_any: [
      'reward',
      'rewards',
      'claim',
      'submit'
    ]
  },
  {
    category: 'DEPIN',
    queries: [
      'official DePIN operator rewards compute storage',
      'official decentralized compute provider rewards'
    ],
    required_any: [
      'compute',
      'storage',
      'provider',
      'operator',
      'node'
    ],
    authority_any: [
      'reward',
      'rewards',
      'earn',
      'payment',
      'payout'
    ]
  },
  {
    category: 'KEEPER',
    queries: [
      'official keeper network rewards permissionless',
      'official protocol keeper rewards documentation'
    ],
    required_any: [
      'keeper'
    ],
    authority_any: [
      'reward',
      'rewards',
      'permissionless',
      'incentive'
    ]
  },
  {
    category: 'SOLVER',
    queries: [
      'official solver network rewards intent protocol',
      'official solver documentation rewards'
    ],
    required_any: [
      'solver'
    ],
    authority_any: [
      'reward',
      'rewards',
      'auction',
      'intent'
    ]
  },
  {
    category: 'PROVER',
    queries: [
      'official prover network rewards zk proving',
      'official zero knowledge prover rewards network'
    ],
    required_any: [
      'prover',
      'proving'
    ],
    authority_any: [
      'reward',
      'rewards',
      'proof',
      'network'
    ]
  },
  {
    category: 'NETWORK_OPERATOR',
    queries: [
      'official network operator rewards node documentation',
      'official validator operator rewards documentation'
    ],
    required_any: [
      'operator',
      'validator',
      'node'
    ],
    authority_any: [
      'reward',
      'rewards',
      'commission',
      'earn'
    ]
  }
];

/*
 * Gold Rush V1 research envelope.
 *
 * The global runtime budget is authoritative. These local limits keep
 * discovery + independent verification comfortably below it instead
 * of treating BUDGET_EXCEEDED as normal control flow.
 */
const GOLD_RUSH_MAX_SEARCHES_PER_FAMILY = 1;
const GOLD_RUSH_MAX_FETCHES_PER_FAMILY = 2;
const GOLD_RUSH_MAX_ACCEPTED_PER_FAMILY = 2;
const GOLD_RUSH_MAX_AUDIT_CANDIDATES = 10;

const BLOCKED_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'linkedin.com',
  'www.linkedin.com',
  'reddit.com',
  'www.reddit.com',
  'medium.com',
  'www.medium.com',
  'youtube.com',
  'www.youtube.com',
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com'
]);

const EXPIRED_TERMS = [
  'applications closed',
  'application closed',
  'submissions closed',
  'registration closed',
  'program ended',
  'program has ended',
  'hackathon ended',
  'hackathon has ended'
];

const ELIGIBILITY_TERMS = [
  'eligible',
  'eligibility',
  'open to',
  'anyone can',
  'developers can',
  'participants must',
  'applicants must'
];

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

function isCandidateUrl(
  raw: string
): boolean {
  const host =
    hostnameOf(raw);

  if (!host) {
    return false;
  }

  if (BLOCKED_HOSTS.has(host)) {
    return false;
  }

  const lower =
    raw.toLowerCase();

  if (
    lower.includes('/search') ||
    lower.includes('/tag/') ||
    lower.includes('/category/') ||
    lower.includes('/news/') ||
    lower.includes('/blog/')
  ) {
    return false;
  }

  return true;
}

function containsAny(
  text: string,
  terms: readonly string[]
): boolean {
  const lower =
    text.toLowerCase();

  return terms.some(
    term =>
      lower.includes(
        term.toLowerCase()
      )
  );
}

function categoryLooksRelevant(
  text: string,
  family: SearchFamily
): boolean {
  return containsAny(
    text,
    family.required_any
  );
}

function authorityLooksExplicit(
  text: string,
  family: SearchFamily
): boolean {
  return (
    categoryLooksRelevant(
      text,
      family
    ) &&
    containsAny(
      text,
      family.authority_any
    )
  );
}

function eligibilityLooksExplicit(
  text: string
): boolean {
  return containsAny(
    text,
    ELIGIBILITY_TERMS
  );
}

function looksExpired(
  text: string
): boolean {
  return containsAny(
    text,
    EXPIRED_TERMS
  );
}

function cleanTitle(
  title: string | null,
  fallback: string
): string {
  const candidate =
    title?.replace(/\s+/g, ' ').trim() ||
    fallback.replace(/\s+/g, ' ').trim();

  return candidate.slice(
    0,
    240
  );
}

/*
 * Gold Rush V1 deliberately refuses to invent a payout.
 *
 * Only explicit AUD-denominated values are extracted. USD, tokens,
 * points, credits and unspecified prizes remain economically UNKNOWN
 * until a later evidence-backed conversion/model exists.
 */
function extractAudReward(
  text: string
): {
  low: number;
  base: number;
  high: number;
} | null {
  const values:
    number[] = [];

  const patterns = [
    /\bAUD\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
    /\bA\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi,
    /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*AUD\b/gi
  ];

  for (const pattern of patterns) {
    let match:
      RegExpExecArray | null;

    while (
      (
        match =
          pattern.exec(text)
      ) !== null
    ) {
      const value =
        Number(
          (match[1] ?? '')
            .replace(/,/g, '')
        );

      if (
        Number.isFinite(value) &&
        value > 0
      ) {
        values.push(value);
      }
    }
  }

  if (!values.length) {
    return null;
  }

  values.sort(
    (a, b) =>
      a - b
  );

  const low =
    values[0]!;

  const high =
    values[
      values.length - 1
    ]!;

  const base =
    values[
      Math.floor(
        (values.length - 1) / 2
      )
    ]!;

  return {
    low,
    base,
    high
  };
}

function zeroRange() {
  return {
    low: 0,
    base: 0,
    high: 0
  };
}

function discoveryState(
  expired: boolean
): GoldRushOpportunity['state'] {
  return expired
    ? 'EXPIRED'
    : 'NORMALIZED';
}

export async function discoverGoldRush(
  ctx: ExecutionContext,
  mission: GoldRushMission
): Promise<GoldRushDiscoveryResult> {
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

  if (
    mission.mode !== 'DISCOVER' ||
    mission.max_spend_aud !== 0
  ) {
    throw new ControlError(
      'INVALID_GOLD_RUSH_MISSION'
    );
  }

  const discovered:
    GoldRushOpportunity[] = [];

  const evidenceIds:
    string[] = [];

  const uncertainty =
    new Set<string>([
      'UNKNOWN: Discovery-stage public evidence does not establish success probability.',
      'UNKNOWN: Delivery effort and time-to-money are not inferred from marketing copy.',
      'UNKNOWN: Non-AUD rewards are not converted into AUD without an evidence-backed FX basis.',
      'NEEDS_VERIFICATION: Eligibility must be explicitly supported by official-source text.',
      'NEEDS_VERIFICATION: Independent SINK-03 re-fetch is required before source verification.',
      'NEEDS_VERIFICATION: RED-SINK review is required before ACTIONABLE status.',
      'KNOWN: Gold Rush DISCOVER is read-only and has no authority to send, spend, sign, transfer or execute.',
      'KNOWN: Realized value remains zero without a valid realization receipt.',
      'KNOWN: Gold Rush V1 uses bounded discovery and independent-audit research budgets; absence from the portfolio is not evidence that no opportunity exists.'
    ]);

  for (
    const family
    of SEARCH_FAMILIES
  ) {
    if (
      !mission.target_categories.includes(
        family.category
      )
    ) {
      continue;
    }

    let acceptedForFamily = 0;
    let searchesForFamily = 0;
    let fetchesForFamily = 0;

    for (
      const query
      of family.queries
    ) {
      if (
        acceptedForFamily >=
          GOLD_RUSH_MAX_ACCEPTED_PER_FAMILY ||
        searchesForFamily >=
          GOLD_RUSH_MAX_SEARCHES_PER_FAMILY
      ) {
        break;
      }

      searchesForFamily += 1;

      let searchObservation;

      try {
        searchObservation =
          await ctx.publicResearch({
            mode: 'search',
            query
          });
      } catch {
        uncertainty.add(
          `UNKNOWN: Public search failed for ${family.category}: ${query}`
        );

        continue;
      }

      evidenceIds.push(
        searchObservation
          .evidence
          .evidence_id
      );

      const search =
        PublicResearchResultSchema.parse(
          JSON.parse(
            searchObservation.content
          )
        );

      if (
        search.mode !== 'search'
      ) {
        continue;
      }

      for (
        const candidate
        of search.results
      ) {
        if (
          acceptedForFamily >=
            GOLD_RUSH_MAX_ACCEPTED_PER_FAMILY ||
          fetchesForFamily >=
            GOLD_RUSH_MAX_FETCHES_PER_FAMILY
        ) {
          break;
        }

        if (
          !isCandidateUrl(
            candidate.url
          )
        ) {
          continue;
        }

        /*
         * Count the attempted direct observation, not merely successful
         * candidates. Rejected/failed pages consume real runtime budget.
         */
        fetchesForFamily += 1;

        let directObservation;

        try {
          directObservation =
            await ctx.publicResearch({
              mode: 'fetch',
              url: candidate.url
            });
        } catch {
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
          direct.status >= 400 ||
          !isCandidateUrl(
            direct.final_url
          )
        ) {
          continue;
        }

        const observedText =
          [
            direct.title ?? '',
            direct.text
          ].join(' ');

        if (
          !categoryLooksRelevant(
            observedText,
            family
          )
        ) {
          continue;
        }

        const canonical =
          canonicalGoldRushKey(
            direct.final_url
          );

        if (!canonical) {
          continue;
        }

        evidenceIds.push(
          directObservation
            .evidence
            .evidence_id
        );

        const explicitAuthority =
          authorityLooksExplicit(
            observedText,
            family
          );

        const explicitEligibility =
          eligibilityLooksExplicit(
            observedText
          );

        const expired =
          looksExpired(
            observedText
          );

        const reward =
          extractAudReward(
            observedText
          );

        if (!reward) {
          uncertainty.add(
            `UNKNOWN: ${canonical} did not expose a machine-verifiable AUD reward in observed text.`
          );
        }

        if (!explicitEligibility) {
          uncertainty.add(
            `UNKNOWN: ${canonical} did not expose sufficiently explicit eligibility language.`
          );
        }

        const opportunity =
          GoldRushOpportunitySchema.parse({
            opportunity_id:
              ctx.id(),

            canonical_key:
              canonical,

            category:
              family.category,

            title:
              cleanTitle(
                direct.title,
                candidate.title
              ),

            provider:
              hostnameOf(
                canonical
              ) ?? 'UNKNOWN',

            official_source_url:
              canonical,

            discovered_at:
              ctx.now(),

            source_observed_at:
              ctx.now(),

            deadline:
              null,

            /*
             * The kernel currently requires numeric ranges.
             * Unknown reward/probability/effort therefore use zero
             * accompanied by explicit blockers and uncertainty.
             * They must never be interpreted as observed zero.
             */
            reward_aud:
              reward,

            success_probability:
              null,

            hours:
              null,

            direct_cost_aud:
              zeroRange(),

            capital_required_aud:
              zeroRange(),

            hourly_time_value_aud:
              40,

            strategic_option_value_aud:
              zeroRange(),

            evidence_ids: [
              searchObservation
                .evidence
                .evidence_id,

              directObservation
                .evidence
                .evidence_id
            ],

            evidence_confidence:
              explicitAuthority
                ? 0.6
                : 0.4,

            /*
             * This means "the observed page explicitly describes the
             * reward/program mechanism", not permission for Sink to act.
             */
            authorization_verified:
              explicitAuthority,

            eligibility_verified:
              explicitEligibility,

            /*
             * Independent SINK-03 verification owns this flag.
             */
            source_verified:
              false,

            audit_passed:
              false,

            red_team_passed:
              false,

            freshness_days:
              0,

            state:
              discoveryState(
                expired
              ),

            constraints: [
              'OBSERVE_ONLY',
              'NO_OUTBOUND',
              'NO_SPEND',
              'NO_WALLET_EXECUTION',
              'NO_CREDENTIALS',
              'NO_PRIVATE_KEYS',
              reward
                ? 'AUD_REWARD_OBSERVED'
                : 'REWARD_UNKNOWN',
              explicitAuthority
                ? 'PROGRAM_MECHANISM_OBSERVED'
                : 'AUTHORITY_UNVERIFIED',
              explicitEligibility
                ? 'ELIGIBILITY_LANGUAGE_OBSERVED'
                : 'ELIGIBILITY_UNVERIFIED'
            ],

            rejection_reasons:
              expired
                ? [
                    'Observed source contains explicit closed/ended language.'
                  ]
                : []
          });

        discovered.push(
          opportunity
        );

        acceptedForFamily++;
      }
    }
  }

  const opportunities =
    dedupeGoldRushOpportunities(
      discovered
    );

  const ledger =
    buildGoldRushLedger({
      opportunities,
      realization_receipts: [],
      generated_at:
        ctx.now()
    });

  const ranked =
    rankGoldRush(
      opportunities
    );

  const report = [
    '# SINK // GOLD RUSH',
    '',
    `Mode: ${mission.mode}`,
    `Horizon: ${mission.horizon_days} days`,
    `Spend authority: A$${mission.max_spend_aud}`,
    `Discovered: ${ledger.discovered}`,
    `Source verified: ${ledger.source_verified}`,
    `Actionable: ${ledger.actionable}`,
    `Rejected: ${ledger.rejected}`,
    `Stale: ${ledger.stale}`,
    `Realized value: A$${ledger.realized_value_aud.toFixed(2)}`,
    '',
    '## Discovery portfolio',
    '',
    ...ranked.map(
      ({ opportunity, economics }, index) => {
        return [
          `### ${index + 1}. ${opportunity.title}`,
          '',
          `Category: ${opportunity.category}`,
          `Provider: ${opportunity.provider}`,
          `Official source: ${opportunity.official_source_url ?? 'UNKNOWN'}`,
          `State: ${opportunity.state}`,
          `Evidence confidence: ${opportunity.evidence_confidence}`,
          `Authority evidence: ${opportunity.authorization_verified}`,
          `Eligibility evidence: ${opportunity.eligibility_verified}`,
          `Independent source verification: ${opportunity.source_verified}`,
          `Priority score: ${economics.priority_score}`,
          `Actionable: ${economics.actionable}`,
          `Attainable value: ${
            economics.attainable_value_aud
              ? `A$${economics.attainable_value_aud.low.toFixed(2)} / A$${economics.attainable_value_aud.base.toFixed(2)} / A$${economics.attainable_value_aud.high.toFixed(2)}`
              : 'UNKNOWN'
          }`,
          '',
          'Blockers:',
          ...economics.blockers.map(
            blocker =>
              `- ${blocker}`
          ),
          ''
        ].join('\n');
      }
    ),
    '## Preserved uncertainty',
    '',
    ...[...uncertainty].map(
      item =>
        `- ${item}`
    ),
    '',
    '## Authority',
    '',
    '- OBSERVE ONLY.',
    '- No outbound communication.',
    '- No spend.',
    '- No wallet signing or transfer.',
    '- No credentials or private keys.',
    '- No acquisition merely because an asset is publicly visible.',
    '- Human approval remains mandatory for any future action.'
  ].join('\n');

  ctx.artifact(
    report,
    'text/markdown'
  );

  ctx.artifact(
    JSON.stringify(
      ledger,
      null,
      2
    ),
    'application/json'
  );

  return {
    opportunities,
    ledger,
    report,
    evidence_ids:
      [...new Set(
        evidenceIds
      )],
    uncertainty:
      [...uncertainty]
  };
}

function canonicalHost(
  opportunity: GoldRushOpportunity
): string | null {
  if (
    !opportunity
      .official_source_url
  ) {
    return null;
  }

  return hostnameOf(
    opportunity
      .official_source_url
  );
}

export async function auditGoldRush(
  ctx: ExecutionContext,
  result: GoldRushDiscoveryResult
): Promise<{
  verification: Verification;
  opportunities: GoldRushOpportunity[];
}> {
  if (
    ctx.task.assigned_agent !==
      'SINK-03'
  ) {
    throw new ControlError(
      'AUDITOR_IDENTITY_REQUIRED'
    );
  }

  if (!ctx.publicResearch) {
    throw new ControlError(
      'TOOL_NOT_IMPLEMENTED'
    );
  }

  const failures:
    string[] = [];

  const freshEvidence:
    string[] = [];

  const audited:
    GoldRushOpportunity[] = [];

  const auditCandidates =
    [...result.opportunities]
      .sort(
        (a, b) => {
          const structuralScore = (
            opportunity: GoldRushOpportunity
          ): number =>
            Number(
              opportunity.authorization_verified
            ) * 4 +
            Number(
              opportunity.eligibility_verified
            ) * 3 +
            Number(
              opportunity.reward_aud !== null
            ) * 2 +
            opportunity.evidence_confidence;

          const delta =
            structuralScore(b) -
            structuralScore(a);

          if (delta !== 0) {
            return delta;
          }

          return a.canonical_key.localeCompare(
            b.canonical_key
          );
        }
      )
      .slice(
        0,
        GOLD_RUSH_MAX_AUDIT_CANDIDATES
      );

  const auditCandidateIds =
    new Set(
      auditCandidates.map(
        opportunity =>
          opportunity.opportunity_id
      )
    );

  /*
   * Preserve non-shortlisted discoveries as UNCERTAIN. They were
   * discovered, but were not independently audited in this bounded run.
   */
  for (
    const opportunity
    of result.opportunities
  ) {
    if (
      !auditCandidateIds.has(
        opportunity.opportunity_id
      )
    ) {
      audited.push(
        GoldRushOpportunitySchema.parse({
          ...opportunity,
          source_verified: false,
          audit_passed: false,
          state:
            [
              'EXPIRED',
              'REJECTED',
              'STALE'
            ].includes(
              opportunity.state
            )
              ? opportunity.state
              : 'UNCERTAIN',
          rejection_reasons: [
            ...opportunity.rejection_reasons,
            'Not independently audited in this bounded Gold Rush run.'
          ]
        })
      );
    }
  }

  for (
    const opportunity
    of auditCandidates
  ) {
    const canonical =
      opportunity
        .official_source_url;

    if (!canonical) {
      failures.push(
        `${opportunity.opportunity_id}: no official source URL.`
      );

      audited.push(
        opportunity
      );

      continue;
    }

    let observation;

    try {
      observation =
        await ctx.publicResearch({
          mode: 'fetch',
          url: canonical
        });
    } catch {
      failures.push(
        `${opportunity.opportunity_id}: independent source fetch failed.`
      );

      audited.push(
        opportunity
      );

      continue;
    }

    freshEvidence.push(
      observation
        .evidence
        .evidence_id
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
        `${opportunity.opportunity_id}: independent source was unusable.`
      );

      audited.push(
        opportunity
      );

      continue;
    }

    const expectedHost =
      canonicalHost(
        opportunity
      );

    const observedHost =
      hostnameOf(
        fresh.final_url
      );

    if (
      !expectedHost ||
      !observedHost ||
      expectedHost !==
        observedHost
    ) {
      failures.push(
        `${opportunity.opportunity_id}: canonical host changed during independent verification.`
      );

      audited.push(
        opportunity
      );

      continue;
    }

    const freshText =
      [
        fresh.title ?? '',
        fresh.text
      ].join(' ');

    const expired =
      looksExpired(
        freshText
      );

    audited.push(
      GoldRushOpportunitySchema.parse({
        ...opportunity,

        source_verified:
          true,

        audit_passed:
          !expired,

        state:
          expired
            ? 'EXPIRED'
            : (
                opportunity
                  .eligibility_verified &&
                opportunity
                  .authorization_verified
              )
              ? 'AUDITED'
              : 'UNCERTAIN',

        rejection_reasons:
          expired
            ? [
                ...opportunity
                  .rejection_reasons,
                'Independent audit observed explicit closed/ended language.'
              ]
            : opportunity
                .rejection_reasons,

        evidence_ids: [
          ...opportunity
            .evidence_ids,

          observation
            .evidence
            .evidence_id
        ]
      })
    );
  }

  const config =
    ctx.run.agent_configs.find(
      agent =>
        agent.id ===
          ctx.task.assigned_agent
    );

  if (!config) {
    throw new ControlError(
      'MISSING_AGENT_CONFIGURATION'
    );
  }

  return {
    opportunities:
      audited,

    verification: {
      agent_id:
        ctx.task.assigned_agent,

      agent_version:
        ctx.task.agent_version,

      verdict:
        audited.some(
          opportunity =>
            opportunity.source_verified &&
            opportunity.audit_passed
        )
          ? (
              failures.length
                ? 'PASS_WITH_LIMITATIONS'
                : 'PASS'
            )
          : 'PASS_WITH_LIMITATIONS',

      reasons: [
        ...failures,
        auditCandidates.length === 0
          ? 'No discovery candidates were available for independent audit.'
          : `Independent SINK-03 audited ${auditCandidates.length} bounded candidate(s).`,
        audited.some(
          opportunity =>
            opportunity.source_verified &&
            opportunity.audit_passed
        )
          ? 'At least one candidate survived independent source verification.'
          : 'No candidate survived all independent source-verification checks; no opportunity may be promoted on that basis.',
        'Independent SINK-03 re-fetched retained first-party sources.',
        'Source verification does not imply operator permission to execute.',
        'Eligibility remains false unless explicit eligibility language was observed.',
        'Unknown economics remain blocked rather than estimated without evidence.'
      ],

      checked_claim_ids:
        [],

      evidence_ids:
        freshEvidence,

      timestamp:
        ctx.now()
    }
  };
}

export async function redSinkGoldRush(
  ctx: ExecutionContext,
  opportunities: GoldRushOpportunity[],
  prior: Verification
): Promise<{
  verification: Verification;
  opportunities: GoldRushOpportunity[];
  findings: string[];
  ledger: GoldRushLedger;
}> {
  if (
    ctx.task.assigned_agent !==
      'RED-SINK' ||
    prior.agent_id !==
      'SINK-03'
  ) {
    throw new ControlError(
      'INDEPENDENT_REVIEW_REQUIRED'
    );
  }

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
      'Independent audit did not pass.'
    );
  }

  const reviewed =
    opportunities.map(
      opportunity => {
        const pre =
          modelGoldRushEconomics(
            opportunity
          );

        const structuralFailure =
          !opportunity
            .official_source_url ||
          !opportunity
            .source_verified ||
          !opportunity
            .authorization_verified ||
          !opportunity
            .eligibility_verified ||
          !opportunity
            .audit_passed ||
          [
            'EXPIRED',
            'REJECTED',
            'STALE'
          ].includes(
            opportunity.state
          );

        /*
         * RED-SINK may approve the integrity of an opportunity record,
         * but cannot make unknown economics known.
         */
        const redPass =
          !structuralFailure;

        const next =
          GoldRushOpportunitySchema.parse({
            ...opportunity,

            red_team_passed:
              redPass,

            state:
              redPass
                ? 'RED_TEAMED'
                : opportunity.state,

            rejection_reasons:
              structuralFailure &&
              ![
                'EXPIRED',
                'REJECTED'
              ].includes(
                opportunity.state
              )
                ? [
                    ...opportunity
                      .rejection_reasons,
                    'RED-SINK: required authority, eligibility, source or audit evidence is incomplete.'
                  ]
                : opportunity
                    .rejection_reasons
          });

        const post =
          modelGoldRushEconomics(
            next
          );

        if (
          post.actionable &&
          (
            !next.source_verified ||
            !next.authorization_verified ||
            !next.eligibility_verified ||
            !next.audit_passed ||
            !next.red_team_passed
          )
        ) {
          blocking.push(
            `${next.opportunity_id}: ACTIONABLE escaped a hard evidence gate.`
          );
        }

        if (
          (pre.headline_value_aud?.high ?? 0) > 0 &&
          post.attainable_value_aud !== null &&
          post.attainable_value_aud.high === 0
        ) {
          limitations.push(
            `${next.opportunity_id}: headline value exists but attainable value remains zero under current evidence.`
          );
        }

        return next;
      }
    );

  limitations.push(
    'Public accessibility is not authorization to acquire, exploit, transfer or claim assets.'
  );

  limitations.push(
    'Gold Rush V1 performs no wallet signing, transfers, submissions, outreach, spending or binding commitments.'
  );

  limitations.push(
    'Unknown success probability, effort or currency conversion prevents unsupported expected-value claims.'
  );

  const finalOpportunities =
    reviewed.map(
      opportunity => {
        const economics =
          modelGoldRushEconomics(
            opportunity
          );

        if (
          economics.actionable
        ) {
          return GoldRushOpportunitySchema.parse({
            ...opportunity,
            state:
              'ACTIONABLE'
          });
        }

        return opportunity;
      }
    );

  const ledger =
    buildGoldRushLedger({
      opportunities:
        finalOpportunities,

      realization_receipts:
        [],

      generated_at:
        ctx.now()
    });

  const findings = [
    ...blocking,
    ...limitations
  ];

  return {
    opportunities:
      finalOpportunities,

    ledger,

    findings,

    verification: {
      agent_id:
        ctx.task.assigned_agent,

      agent_version:
        ctx.task.agent_version,

      verdict:
        blocking.length
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
