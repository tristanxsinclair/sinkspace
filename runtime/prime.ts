import {
  GoldRushIntakeSchema,
  IntakeSchema,
  MissionIntakeSchema,
  RevenueIntakeSchema,
  type MissionIntake
} from './contracts.js';

export type PrimeInterpretation = {
  status:
    | 'READY'
    | 'NEEDS_CLARIFICATION'
    | 'UNSUPPORTED';

  reply: string;

  mission:
    | MissionIntake
    | null;

  confidence:
    | 'HIGH'
    | 'MEDIUM'
    | 'LOW';

  assumptions: string[];
};

const GOLD_RUSH_CATEGORIES = [
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
  'ARBITRAGE'
] as const;

function extractDays(
  input: string
): number | null {
  const days =
    input.match(
      /\b(\d{1,3})\s*days?\b/i
    );

  if (days) {
    return Math.min(
      90,
      Math.max(
        1,
        Number(days[1])
      )
    );
  }

  const weeks =
    input.match(
      /\b(\d{1,2})\s*weeks?\b/i
    );

  if (weeks) {
    return Math.min(
      90,
      Math.max(
        1,
        Number(weeks[1]) * 7
      )
    );
  }

  if (
    /\bthis week\b/i.test(input)
  ) {
    return 7;
  }

  if (
    /\bthis month\b/i.test(input)
  ) {
    return 30;
  }

  return null;
}

function extractCashTarget(
  input: string
): number | null {
  const match =
    input.match(
      /(?:\$|a\$)\s*([\d,.]+)\s*([km])?/i
    );

  if (!match) {
    return null;
  }

  let value =
    Number(
      match[1]!.replace(/,/g, '')
    );

  if (!Number.isFinite(value)) {
    return null;
  }

  const suffix =
    match[2]?.toLowerCase();

  if (suffix === 'k') {
    value *= 1000;
  }

  if (suffix === 'm') {
    value *= 1_000_000;
  }

  return Math.min(
    1_000_000_000,
    Math.max(0, value)
  );
}

function looksLikeValidation(
  input: string
): boolean {
  return /\b(validate|verify|audit|challenge|check)\b/i
    .test(input);
}

function looksLikeRevenue(
  input: string
): boolean {
  return /\b(revenue|customer|customers|client|clients|sales|sell|selling|businesses|msp|agency|agencies|lead|leads)\b/i
    .test(input);
}

function looksLikeGoldRush(
  input: string
): boolean {
  return /\b(gold rush|bount(?:y|ies)|grant|grants|hackathon|opportunit(?:y|ies)|reward|rewards|dep(?:in)?|restaking|solver|prover)\b/i
    .test(input);
}

function looksLikeSystemScan(
  input: string
): boolean {
  return /\b(system scan|capability inventory|scan sink|inspect sink|inspect repository)\b/i
    .test(input);
}

function revenueMission(
  input: string
): MissionIntake {
  const mode =
    looksLikeValidation(input)
      ? 'VALIDATE' as const
      : 'DISCOVER' as const;

  const cashTarget =
    extractCashTarget(input) ??
    1000;

  const horizon =
    Math.min(
      365,
      extractDays(input) ?? 30
    );

  const market =
    /\bperth\b/i.test(input)
      ? 'Perth service businesses'
      : 'Service businesses relevant to Sink Space';

  return RevenueIntakeSchema.parse({
    workflow: 'revenue',

    objective:
      mode === 'VALIDATE'
        ? `Validate evidence-backed revenue opportunities relevant to this operator request: ${input}`
        : `Discover evidence-backed revenue opportunities relevant to this operator request: ${input}`,

    mission: {
      mode,
      cash_target_aud:
        cashTarget,

      horizon_days:
        horizon,

      max_spend_aud: 0,

      max_tristan_minutes: 60,

      target_market:
        market,

      allowed_channels: [
        'EMAIL',
        'PHONE',
        'INSTAGRAM',
        'LINKEDIN',
        'IN_PERSON',
        'WEB_FORM'
      ],

      offer_constraints: [
        'No fabricated claims.',
        'No outbound execution.',
        'No spending.',
        'No revenue claim without payment evidence.',
        'Prefer services that can later become recurring software revenue.'
      ],

      operator_email: null
    }
  });
}

function goldRushMission(
  input: string
): MissionIntake {
  return GoldRushIntakeSchema.parse({
    workflow: 'gold-rush',

    objective:
      `Discover, verify and economically model legitimate public opportunities relevant to this operator request: ${input}`,

    mission: {
      mode: 'DISCOVER',

      horizon_days:
        extractDays(input) ?? 30,

      max_spend_aud: 0,

      max_operator_minutes: 120,

      target_categories:
        [...GOLD_RUSH_CATEGORIES],

      constraints: [
        'Read-only public research only.',
        'Official or independently verifiable source evidence is required.',
        'Public accessibility does not imply authority to acquire or exploit.',
        'No wallet signing or transaction execution.',
        'No private keys, seed phrases or credentials.',
        'No spending.',
        'No outbound communication.',
        'No Sybil behaviour or eligibility evasion.',
        'Security research requires explicit bounty or safe-harbour scope.',
        'No realized-value claim without realization evidence.'
      ]
    }
  });
}

export function interpretPrimeCommand(
  rawInput: string
): PrimeInterpretation {
  const input =
    rawInput.trim();

  if (!input) {
    return {
      status:
        'NEEDS_CLARIFICATION',

      reply:
        'Give me an objective for the Sink Clones.',

      mission: null,
      confidence: 'HIGH',
      assumptions: []
    };
  }

  if (
    input.length > 4000
  ) {
    return {
      status: 'UNSUPPORTED',

      reply:
        'That command is too large for Prime v0. Reduce it to one bounded objective.',

      mission: null,
      confidence: 'HIGH',
      assumptions: []
    };
  }

  if (
    looksLikeSystemScan(input)
  ) {
    const mission =
      IntakeSchema.parse({
        workflow:
          'capability-inventory',

        objective:
          'Inspect the Sink Space repository and produce a concise capability inventory identifying the major current product/business capabilities visible in repository evidence.',

        mission: null
      });

    return {
      status: 'READY',

      reply:
        'I interpreted that as a Sink Space capability inventory.',

      mission:
        MissionIntakeSchema.parse(
          mission
        ),

      confidence: 'HIGH',
      assumptions: []
    };
  }

  if (
    looksLikeRevenue(input)
  ) {
    const mission =
      revenueMission(input);

    return {
      status: 'READY',

      reply:
        `I interpreted that as ${mission.mission?.mode === 'VALIDATE' ? 'Revenue Validation' : 'Revenue Discovery'}.`,

      mission:
        MissionIntakeSchema.parse(
          mission
        ),

      confidence: 'HIGH',

      assumptions: [
        'Spend authority remains A$0.',
        'Outbound execution remains disabled.'
      ]
    };
  }

  if (
    looksLikeGoldRush(input)
  ) {
    const mission =
      goldRushMission(input);

    return {
      status: 'READY',

      reply:
        'I interpreted that as Gold Rush opportunity discovery.',

      mission:
        MissionIntakeSchema.parse(
          mission
        ),

      confidence: 'HIGH',

      assumptions: [
        'Spend authority remains A$0.',
        'Wallet and transaction execution remain disabled.',
        'Public research does not imply authority to acquire an asset.'
      ]
    };
  }

  return {
    status:
      'NEEDS_CLARIFICATION',

    reply:
      'I cannot safely map that command to an executable Sink workflow yet. Tell me whether you want revenue discovery, revenue validation, Gold Rush opportunity discovery, or a Sink Space system scan.',

    mission: null,

    confidence: 'LOW',

    assumptions: []
  };
}
