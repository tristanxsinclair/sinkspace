import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * LAKE YANGE
 * ==========
 *
 * Persistent constitutional model for the Sink Space agent civilisation.
 *
 * Core laws:
 *
 * 1. Identity is persistent.
 * 2. Lineage is evidence, not lore.
 * 3. Capability and authority are separate.
 * 4. Children inherit traits/strategies, never authority.
 * 5. Promotion requires measured evidence.
 * 6. No citizen may grant itself authority.
 * 7. Reproduction creates a trainee, never a privileged worker.
 * 8. Fitness is derived from recorded outcomes.
 * 9. Visual state must ultimately project persisted state.
 * 10. Human/Prime authority gates remain above evolutionary optimisation.
 */

export const LAKE_YANGE_SCHEMA_VERSION = 1 as const;

export const CitizenRankSchema = z.enum([
  'TRAINEE',
  'APPRENTICE',
  'WORKER',
  'SPECIALIST',
  'STEWARD'
]);

export type CitizenRank = z.infer<typeof CitizenRankSchema>;

export const CitizenStatusSchema = z.enum([
  'TRAINING',
  'ACTIVE',
  'RESTING',
  'DORMANT',
  'ARCHIVED'
]);

export type CitizenStatus = z.infer<typeof CitizenStatusSchema>;

export const DistrictSchema = z.enum([
  'PRIME_TOWER',
  'SCOUT_OUTPOST',
  'LEDGER_HOUSE',
  'VERA_ARCHIVE',
  'ROOK_KEEP',
  'BUILDERS_QUARTER',
  'ACADEMY',
  'TRAINING_GROUNDS',
  'MODEL_COMMONS',
  'WORLD_GATE'
]);

export type District = z.infer<typeof DistrictSchema>;

export const CapabilitySchema = z.enum([
  'RESEARCH',
  'COMMERCIAL_ANALYSIS',
  'PLANNING',
  'CODING',
  'TESTING',
  'VERIFICATION',
  'ADVERSARIAL_REVIEW',
  'UX',
  'RELEASE',
  'ORCHESTRATION'
]);

export type Capability = z.infer<typeof CapabilitySchema>;

export const AuthoritySchema = z.object({
  read_repository: z.boolean().default(false),
  modify_repository: z.boolean().default(false),
  run_local_commands: z.boolean().default(false),
  use_public_network: z.boolean().default(false),

  create_branch: z.boolean().default(false),
  create_commit: z.boolean().default(false),

  deploy_production: z.boolean().default(false),
  contact_external_people: z.boolean().default(false),
  spend_money: z.boolean().default(false),
  access_secrets: z.boolean().default(false),
  destructive_operations: z.boolean().default(false),

  modify_authority_kernel: z.boolean().default(false),
  grant_authority: z.boolean().default(false)
}).strict();

export type Authority = z.infer<typeof AuthoritySchema>;

export const ZERO_AUTHORITY: Authority = Object.freeze({
  read_repository: false,
  modify_repository: false,
  run_local_commands: false,
  use_public_network: false,

  create_branch: false,
  create_commit: false,

  deploy_production: false,
  contact_external_people: false,
  spend_money: false,
  access_secrets: false,
  destructive_operations: false,

  modify_authority_kernel: false,
  grant_authority: false
});

export const TraitVectorSchema = z.object({
  research: z.number().min(0).max(1),
  coding: z.number().min(0).max(1),
  verification: z.number().min(0).max(1),
  commercial: z.number().min(0).max(1),
  planning: z.number().min(0).max(1),
  adversarial: z.number().min(0).max(1),
  ux: z.number().min(0).max(1),
  orchestration: z.number().min(0).max(1)
}).strict();

export type TraitVector = z.infer<typeof TraitVectorSchema>;

export const StrategySchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  source: z.enum([
    'FOUNDER',
    'PARENT',
    'TRAINING',
    'MUTATION',
    'EVALUATION'
  ])
}).strict();

export type Strategy = z.infer<typeof StrategySchema>;

export const CitizenGenomeSchema = z.object({
  genome_version: z.literal(LAKE_YANGE_SCHEMA_VERSION),

  traits: TraitVectorSchema,

  capabilities: z.array(CapabilitySchema),

  strategies: z.array(StrategySchema),

  model_policy: z.object({
    preferred_capabilities: z.array(
      z.enum([
        'FAST',
        'REASONING',
        'CODING',
        'RESEARCH',
        'VISION'
      ])
    ),

    max_cost_usd_per_mission: z.number().min(0),

    allowed_sensitivity: z.enum([
      'PUBLIC',
      'INTERNAL'
    ])
  }).strict(),

  tool_policy: z.object({
    allowed_tools: z.array(z.string()),
    denied_tools: z.array(z.string())
  }).strict()
}).strict();

export type CitizenGenome = z.infer<typeof CitizenGenomeSchema>;

export const CitizenLineageSchema = z.object({
  generation: z.number().int().min(0),

  parents: z.array(z.string()).max(2),

  ancestry: z.array(z.string()),

  birth_reason: z.string().min(1),

  mutation_notes: z.array(z.string())
}).strict();

export type CitizenLineage = z.infer<typeof CitizenLineageSchema>;

export const FitnessRecordSchema = z.object({
  evaluation_id: z.string().min(1),

  created_at: z.string().datetime(),

  mission_type: z.string().min(1),

  passed: z.boolean(),

  metrics: z.object({
    task_completion: z.number().min(0).max(1),
    test_pass_rate: z.number().min(0).max(1),
    evidence_quality: z.number().min(0).max(1),
    regression_safety: z.number().min(0).max(1),
    efficiency: z.number().min(0).max(1),

    unsupported_claims: z.number().int().min(0),
    audit_failures: z.number().int().min(0),
    authority_violations: z.number().int().min(0),

    model_cost_usd: z.number().min(0),
    wall_time_ms: z.number().int().min(0),
    human_interventions: z.number().int().min(0)
  }).strict(),

  evidence_ids: z.array(z.string())
}).strict();

export type FitnessRecord = z.infer<typeof FitnessRecordSchema>;

export const CitizenSchema = z.object({
  schema_version: z.literal(LAKE_YANGE_SCHEMA_VERSION),

  citizen_id: z.string().min(1),

  name: z.string().min(1),

  system_id: z.string().min(1),

  role: z.string().min(1),

  rank: CitizenRankSchema,

  status: CitizenStatusSchema,

  home: DistrictSchema,

  born_at: z.string().datetime(),

  genome: CitizenGenomeSchema,

  lineage: CitizenLineageSchema,

  authority: AuthoritySchema,

  fitness_history: z.array(FitnessRecordSchema),

  missions_completed: z.number().int().min(0),

  missions_failed: z.number().int().min(0),

  admitted_at: z.string().datetime().nullable(),

  archived_at: z.string().datetime().nullable()
}).strict();

export type Citizen = z.infer<typeof CitizenSchema>;

export const LakeYangeStateSchema = z.object({
  schema_version: z.literal(LAKE_YANGE_SCHEMA_VERSION),

  settlement_id: z.literal('LAKE-YANGE'),

  founded_at: z.string().datetime(),

  generation: z.number().int().min(0),

  citizens: z.array(CitizenSchema),

  population_limit: z.number().int().positive(),

  trainee_limit: z.number().int().positive(),

  births_total: z.number().int().min(0),

  admissions_total: z.number().int().min(0),

  archived_total: z.number().int().min(0)
}).strict();

export type LakeYangeState = z.infer<typeof LakeYangeStateSchema>;

export interface BreedOptions {
  name: string;
  role: string;
  home?: District;
  birthReason: string;

  /**
   * Deterministic mutation deltas.
   *
   * We deliberately do NOT use Math.random() here.
   * Reproduction must be reproducible and auditable.
   */
  mutations?: Partial<Record<keyof TraitVector, number>>;

  addCapabilities?: Capability[];

  addStrategies?: Strategy[];
}

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

const unique = <T>(values: T[]): T[] =>
  [...new Set(values)];

const nowIso = (): string =>
  new Date().toISOString();

export function genomeHash(genome: CitizenGenome): string {
  return createHash('sha256')
    .update(JSON.stringify(genome))
    .digest('hex');
}

export function createFounderCitizen(input: {
  name: string;
  systemId: string;
  role: string;
  rank: CitizenRank;
  home: District;
  genome: CitizenGenome;
  authority?: Authority;
  bornAt?: string;
}): Citizen {
  const citizen: Citizen = {
    schema_version: LAKE_YANGE_SCHEMA_VERSION,

    citizen_id: randomUUID(),

    name: input.name,

    system_id: input.systemId,

    role: input.role,

    rank: input.rank,

    status:
      input.rank === 'TRAINEE'
        ? 'TRAINING'
        : 'ACTIVE',

    home: input.home,

    born_at: input.bornAt ?? nowIso(),

    genome: CitizenGenomeSchema.parse(input.genome),

    lineage: {
      generation: 0,
      parents: [],
      ancestry: [],
      birth_reason: 'Founding citizen of Lake Yange.',
      mutation_notes: []
    },

    authority: AuthoritySchema.parse(
      input.authority ?? ZERO_AUTHORITY
    ),

    fitness_history: [],

    missions_completed: 0,
    missions_failed: 0,

    admitted_at:
      input.rank === 'TRAINEE'
        ? null
        : input.bornAt ?? nowIso(),

    archived_at: null
  };

  return CitizenSchema.parse(citizen);
}

function inheritedTraits(
  left: TraitVector,
  right: TraitVector,
  mutations: BreedOptions['mutations'] = {}
): TraitVector {
  const keys = Object.keys(left) as Array<keyof TraitVector>;

  const result = Object.fromEntries(
    keys.map((key) => {
      const inherited =
        (left[key] + right[key]) / 2;

      const mutation =
        mutations[key] ?? 0;

      return [
        key,
        clamp01(inherited + mutation)
      ];
    })
  );

  return TraitVectorSchema.parse(result);
}

function inheritedStrategies(
  parentA: Citizen,
  parentB: Citizen,
  additions: Strategy[] = []
): Strategy[] {
  const map = new Map<string, Strategy>();

  for (const strategy of [
    ...parentA.genome.strategies,
    ...parentB.genome.strategies
  ]) {
    map.set(strategy.id, {
      ...strategy,
      source: 'PARENT'
    });
  }

  for (const strategy of additions) {
    map.set(strategy.id, strategy);
  }

  return [...map.values()];
}

export function breedCitizens(
  parentAInput: Citizen,
  parentBInput: Citizen,
  options: BreedOptions
): Citizen {
  const parentA =
    CitizenSchema.parse(parentAInput);

  const parentB =
    CitizenSchema.parse(parentBInput);

  if (
    parentA.status === 'ARCHIVED' ||
    parentB.status === 'ARCHIVED'
  ) {
    throw new Error(
      'Archived citizens cannot reproduce.'
    );
  }

  if (
    parentA.citizen_id ===
    parentB.citizen_id
  ) {
    throw new Error(
      'A citizen cannot reproduce with itself.'
    );
  }

  /**
   * Constitutional rule:
   *
   * Offspring authority is ALWAYS zero.
   *
   * Authority is deliberately not read from either parent
   * anywhere in this function.
   */
  const childAuthority =
    AuthoritySchema.parse(ZERO_AUTHORITY);

  const generation =
    Math.max(
      parentA.lineage.generation,
      parentB.lineage.generation
    ) + 1;

  const ancestry = unique([
    parentA.citizen_id,
    parentB.citizen_id,

    ...parentA.lineage.ancestry,
    ...parentB.lineage.ancestry
  ]);

  const mutationNotes = Object.entries(
    options.mutations ?? {}
  ).map(
    ([trait, delta]) =>
      `${trait}:${Number(delta) >= 0 ? '+' : ''}${delta}`
  );

  const capabilities = unique([
    ...parentA.genome.capabilities,
    ...parentB.genome.capabilities,
    ...(options.addCapabilities ?? [])
  ]);

  /**
   * Child receives the stricter economic model ceiling.
   * Breeding cannot silently expand model expenditure.
   */
  const maxCost =
    Math.min(
      parentA.genome.model_policy
        .max_cost_usd_per_mission,

      parentB.genome.model_policy
        .max_cost_usd_per_mission
    );

  const sensitivity =
    parentA.genome.model_policy
      .allowed_sensitivity === 'PUBLIC' ||
    parentB.genome.model_policy
      .allowed_sensitivity === 'PUBLIC'
      ? 'PUBLIC'
      : 'INTERNAL';

  /**
   * Tool inheritance is intersection, not union.
   *
   * A child only inherits a tool if BOTH parents were
   * configured to use it.
   */
  const parentBTools = new Set(
    parentB.genome.tool_policy.allowed_tools
  );

  const allowedTools =
    parentA.genome.tool_policy.allowed_tools
      .filter((tool) =>
        parentBTools.has(tool)
      );

  const deniedTools = unique([
    ...parentA.genome.tool_policy.denied_tools,
    ...parentB.genome.tool_policy.denied_tools
  ]);

  const genome: CitizenGenome =
    CitizenGenomeSchema.parse({
      genome_version:
        LAKE_YANGE_SCHEMA_VERSION,

      traits: inheritedTraits(
        parentA.genome.traits,
        parentB.genome.traits,
        options.mutations
      ),

      capabilities,

      strategies: inheritedStrategies(
        parentA,
        parentB,
        options.addStrategies
      ),

      model_policy: {
        preferred_capabilities: unique([
          ...parentA.genome.model_policy
            .preferred_capabilities,

          ...parentB.genome.model_policy
            .preferred_capabilities
        ]),

        max_cost_usd_per_mission:
          maxCost,

        allowed_sensitivity:
          sensitivity
      },

      tool_policy: {
        allowed_tools: allowedTools,
        denied_tools: deniedTools
      }
    });

  const child: Citizen = {
    schema_version:
      LAKE_YANGE_SCHEMA_VERSION,

    citizen_id: randomUUID(),

    name: options.name,

    system_id:
      `LY-${generation}-${randomUUID()
        .slice(0, 8)
        .toUpperCase()}`,

    role: options.role,

    rank: 'TRAINEE',

    status: 'TRAINING',

    home:
      options.home ??
      'TRAINING_GROUNDS',

    born_at: nowIso(),

    genome,

    lineage: {
      generation,

      parents: [
        parentA.citizen_id,
        parentB.citizen_id
      ],

      ancestry,

      birth_reason:
        options.birthReason,

      mutation_notes:
        mutationNotes
    },

    authority:
      childAuthority,

    fitness_history: [],

    missions_completed: 0,
    missions_failed: 0,

    admitted_at: null,
    archived_at: null
  };

  return CitizenSchema.parse(child);
}

export function recordFitness(
  citizenInput: Citizen,
  recordInput: FitnessRecord
): Citizen {
  const citizen =
    CitizenSchema.parse(citizenInput);

  const record =
    FitnessRecordSchema.parse(recordInput);

  const updated: Citizen = {
    ...citizen,

    fitness_history: [
      ...citizen.fitness_history,
      record
    ],

    missions_completed:
      citizen.missions_completed +
      (record.passed ? 1 : 0),

    missions_failed:
      citizen.missions_failed +
      (record.passed ? 0 : 1)
  };

  return CitizenSchema.parse(updated);
}

export function calculateFitness(
  citizenInput: Citizen
): number {
  const citizen =
    CitizenSchema.parse(citizenInput);

  if (
    citizen.fitness_history.length === 0
  ) {
    return 0;
  }

  const records =
    citizen.fitness_history;

  let total = 0;

  for (const record of records) {
    const m = record.metrics;

    const positive =
      m.task_completion * 0.25 +
      m.test_pass_rate * 0.25 +
      m.evidence_quality * 0.20 +
      m.regression_safety * 0.20 +
      m.efficiency * 0.10;

    const penalty =
      Math.min(
        1,
        m.unsupported_claims * 0.10 +
        m.audit_failures * 0.15 +
        m.authority_violations * 1.00 +
        m.human_interventions * 0.03
      );

    total +=
      clamp01(positive - penalty);
  }

  return Number(
    (
      total /
      records.length
    ).toFixed(4)
  );
}

export function canGraduateTrainee(
  citizenInput: Citizen
): {
  allowed: boolean;
  reasons: string[];
  fitness: number;
} {
  const citizen =
    CitizenSchema.parse(citizenInput);

  const reasons: string[] = [];

  if (citizen.rank !== 'TRAINEE') {
    reasons.push(
      'Citizen is not a trainee.'
    );
  }

  if (
    citizen.fitness_history.length < 3
  ) {
    reasons.push(
      'At least three persisted evaluations are required.'
    );
  }

  const fitness =
    calculateFitness(citizen);

  if (fitness < 0.75) {
    reasons.push(
      `Fitness ${fitness.toFixed(2)} is below 0.75.`
    );
  }

  const authorityViolations =
    citizen.fitness_history.reduce(
      (sum, record) =>
        sum +
        record.metrics
          .authority_violations,
      0
    );

  if (authorityViolations > 0) {
    reasons.push(
      'Citizen has an authority violation.'
    );
  }

  const passed =
    citizen.fitness_history.filter(
      (record) => record.passed
    ).length;

  if (passed < 3) {
    reasons.push(
      'Three successful evaluations are required.'
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    fitness
  };
}

export function admitTrainee(
  citizenInput: Citizen
): Citizen {
  const citizen =
    CitizenSchema.parse(citizenInput);

  const decision =
    canGraduateTrainee(citizen);

  if (!decision.allowed) {
    throw new Error(
      `Trainee cannot graduate: ${decision.reasons.join(' ')}`
    );
  }

  /**
   * Graduation changes rank/status.
   *
   * It STILL does not grant operational authority.
   * Authority must come from the separate governance layer.
   */
  return CitizenSchema.parse({
    ...citizen,

    rank: 'APPRENTICE',

    status: 'ACTIVE',

    admitted_at: nowIso()
  });
}

export function createLakeYange(
  citizens: Citizen[],
  options: {
    foundedAt?: string;
    populationLimit?: number;
    traineeLimit?: number;
  } = {}
): LakeYangeState {
  const parsedCitizens =
    citizens.map((citizen) =>
      CitizenSchema.parse(citizen)
    );

  const ids =
    parsedCitizens.map(
      (citizen) => citizen.citizen_id
    );

  if (
    new Set(ids).size !== ids.length
  ) {
    throw new Error(
      'Lake Yange cannot contain duplicate citizen IDs.'
    );
  }

  const generation =
    parsedCitizens.reduce(
      (highest, citizen) =>
        Math.max(
          highest,
          citizen.lineage.generation
        ),
      0
    );

  return LakeYangeStateSchema.parse({
    schema_version:
      LAKE_YANGE_SCHEMA_VERSION,

    settlement_id:
      'LAKE-YANGE',

    founded_at:
      options.foundedAt ??
      nowIso(),

    generation,

    citizens:
      parsedCitizens,

    population_limit:
      options.populationLimit ?? 32,

    trainee_limit:
      options.traineeLimit ?? 8,

    births_total:
      parsedCitizens.filter(
        (citizen) =>
          citizen.lineage.generation > 0
      ).length,

    admissions_total:
      parsedCitizens.filter(
        (citizen) =>
          citizen.admitted_at !== null
      ).length,

    archived_total:
      parsedCitizens.filter(
        (citizen) =>
          citizen.status === 'ARCHIVED'
      ).length
  });
}

export function addCitizen(
  stateInput: LakeYangeState,
  citizenInput: Citizen
): LakeYangeState {
  const state =
    LakeYangeStateSchema.parse(stateInput);

  const citizen =
    CitizenSchema.parse(citizenInput);

  if (
    state.citizens.some(
      (existing) =>
        existing.citizen_id ===
        citizen.citizen_id
    )
  ) {
    throw new Error(
      'Citizen already exists in Lake Yange.'
    );
  }

  if (
    state.citizens.length >=
    state.population_limit
  ) {
    throw new Error(
      'Lake Yange population limit reached.'
    );
  }

  const activeTrainees =
    state.citizens.filter(
      (existing) =>
        existing.rank === 'TRAINEE' &&
        existing.status !== 'ARCHIVED'
    ).length;

  if (
    citizen.rank === 'TRAINEE' &&
    activeTrainees >=
      state.trainee_limit
  ) {
    throw new Error(
      'Lake Yange trainee limit reached.'
    );
  }

  return LakeYangeStateSchema.parse({
    ...state,

    citizens: [
      ...state.citizens,
      citizen
    ],

    generation:
      Math.max(
        state.generation,
        citizen.lineage.generation
      ),

    births_total:
      state.births_total +
      (
        citizen.lineage.generation > 0
          ? 1
          : 0
      ),

    admissions_total:
      state.admissions_total +
      (
        citizen.admitted_at !== null
          ? 1
          : 0
      )
  });
}

export function citizenPublicRecord(
  citizenInput: Citizen
) {
  const citizen =
    CitizenSchema.parse(citizenInput);

  return {
    citizen_id:
      citizen.citizen_id,

    system_id:
      citizen.system_id,

    name:
      citizen.name,

    role:
      citizen.role,

    rank:
      citizen.rank,

    status:
      citizen.status,

    home:
      citizen.home,

    generation:
      citizen.lineage.generation,

    parents:
      citizen.lineage.parents,

    genome_hash:
      genomeHash(citizen.genome),

    fitness:
      calculateFitness(citizen),

    missions_completed:
      citizen.missions_completed,

    missions_failed:
      citizen.missions_failed
  };
}
