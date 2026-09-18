import {
  ZERO_AUTHORITY,
  createFounderCitizen,
  createLakeYange,
  type Authority,
  type Citizen,
  type CitizenGenome,
  type District,
  type LakeYangeState,
  type TraitVector
} from './lake-yange.js';

/**
 * LAKE YANGE — FOUNDING POPULATION
 *
 * Machine IDs remain stable.
 * Lake Yange names are presentation / citizen identities.
 *
 * We deliberately do NOT mutate agents/registry.json here.
 * The existing runtime remains authoritative for current execution.
 *
 * This module is the bridge into the generational civilisation.
 */

type FounderSpec = {
  systemId: string;
  name: string;
  role: string;
  home: District;
  traits: TraitVector;
  capabilities: CitizenGenome['capabilities'];
  allowedTools: string[];
  deniedTools?: string[];
  authority?: Partial<Authority>;
};

const genome = (
  spec: FounderSpec
): CitizenGenome => ({
  genome_version: 1,

  traits: spec.traits,

  capabilities:
    spec.capabilities,

  strategies: [
    {
      id: 'proof-over-intention',
      description:
        'Prefer persisted proof over intention.',
      source: 'FOUNDER'
    },
    {
      id: 'no-artifact-no-claim',
      description:
        'No artifact / no claim.',
      source: 'FOUNDER'
    },
    {
      id: 'preserve-uncertainty',
      description:
        'Keep hypotheses, estimates and unknowns distinct from verified facts.',
      source: 'FOUNDER'
    }
  ],

  model_policy: {
    preferred_capabilities: [
      'REASONING'
    ],

    max_cost_usd_per_mission:
      0,

    allowed_sensitivity:
      'PUBLIC'
  },

  tool_policy: {
    allowed_tools:
      spec.allowedTools,

    denied_tools:
      spec.deniedTools ?? [
        'deploy',
        'send_message',
        'spend',
        'delete_data',
        'merge',
        'credentials',
        'branch_write'
      ]
  }
});

const traits = (
  values: Partial<TraitVector>
): TraitVector => ({
  research: 0.2,
  coding: 0.2,
  verification: 0.2,
  commercial: 0.2,
  planning: 0.2,
  adversarial: 0.2,
  ux: 0.2,
  orchestration: 0.2,
  ...values
});

const authority = (
  partial: Partial<Authority> = {}
): Authority => ({
  ...ZERO_AUTHORITY,
  ...partial
});

const FOUNDER_SPECS: FounderSpec[] = [
  {
    systemId: 'SINK-PRIME',
    name: 'Prime',
    role: 'Steward of Lake Yange',
    home: 'PRIME_TOWER',

    traits: traits({
      planning: 0.95,
      orchestration: 1,
      verification: 0.75,
      adversarial: 0.6
    }),

    capabilities: [
      'PLANNING',
      'ORCHESTRATION'
    ],

    allowedTools: [],

    authority: {}
  },

  {
    systemId: 'SINK-00',
    name: 'Marshal',
    role: 'Mission Marshal',
    home: 'PRIME_TOWER',

    traits: traits({
      planning: 0.95,
      orchestration: 0.95,
      verification: 0.65
    }),

    capabilities: [
      'PLANNING',
      'ORCHESTRATION'
    ],

    allowedTools: [],

    authority: {}
  },

  {
    systemId: 'SINK-01',
    name: 'Atlas',
    role: 'Repository Pathfinder',
    home: 'SCOUT_OUTPOST',

    traits: traits({
      research: 0.95,
      coding: 0.45,
      planning: 0.65,
      verification: 0.55
    }),

    capabilities: [
      'RESEARCH'
    ],

    allowedTools: [
      'repo_read',
      'repo_inventory'
    ],

    authority: {
      read_repository: true
    }
  },

  {
    systemId: 'SINK-02',
    name: 'Scribe',
    role: 'Artifact Builder',
    home: 'BUILDERS_QUARTER',

    traits: traits({
      coding: 0.45,
      planning: 0.55,
      verification: 0.6,
      ux: 0.4
    }),

    capabilities: [
      'PLANNING'
    ],

    allowedTools: [],

    authority: {}
  },

  {
    systemId: 'SINK-03',
    name: 'Vera',
    role: 'Evidence Auditor',
    home: 'VERA_ARCHIVE',

    traits: traits({
      research: 0.8,
      verification: 1,
      planning: 0.7,
      adversarial: 0.85
    }),

    capabilities: [
      'RESEARCH',
      'VERIFICATION',
      'ADVERSARIAL_REVIEW'
    ],

    allowedTools: [
      'repo_read',
      'repo_inventory',
      'system_probe',
      'public_research'
    ],

    authority: {
      read_repository: true,
      use_public_network: true
    }
  },

  {
    systemId: 'RED-SINK',
    name: 'Rook',
    role: 'Adversarial Sentinel',
    home: 'ROOK_KEEP',

    traits: traits({
      research: 0.7,
      verification: 0.95,
      planning: 0.55,
      adversarial: 1
    }),

    capabilities: [
      'RESEARCH',
      'VERIFICATION',
      'ADVERSARIAL_REVIEW'
    ],

    allowedTools: [
      'repo_read',
      'repo_inventory',
      'system_probe',
      'public_research'
    ],

    authority: {
      read_repository: true,
      use_public_network: true
    }
  },

  {
    systemId: 'SINK-04',
    name: 'Scout',
    role: 'Opportunity Ranger',
    home: 'SCOUT_OUTPOST',

    traits: traits({
      research: 1,
      commercial: 0.85,
      planning: 0.65,
      verification: 0.5
    }),

    capabilities: [
      'RESEARCH',
      'COMMERCIAL_ANALYSIS'
    ],

    allowedTools: [
      'public_research'
    ],

    authority: {
      use_public_network: true
    }
  },

  {
    systemId: 'SINK-05',
    name: 'Ledger',
    role: 'Commercial Economist',
    home: 'LEDGER_HOUSE',

    traits: traits({
      research: 0.6,
      commercial: 1,
      planning: 0.85,
      verification: 0.7
    }),

    capabilities: [
      'COMMERCIAL_ANALYSIS',
      'PLANNING',
      'VERIFICATION'
    ],

    allowedTools: [],

    authority: {}
  },

  {
    systemId: 'SINK-06',
    name: 'Ember',
    role: 'Compute Prospector',
    home: 'MODEL_COMMONS',

    traits: traits({
      research: 0.65,
      commercial: 0.45,
      planning: 0.6,
      verification: 0.8,
      adversarial: 0.55
    }),

    capabilities: [
      'RESEARCH',
      'VERIFICATION'
    ],

    allowedTools: [
      'system_probe'
    ],

    authority: {}
  }
];

export function createFoundingCitizens(
  bornAt =
    '2026-09-18T00:00:00.000Z'
): Citizen[] {
  return FOUNDER_SPECS.map(
    (spec) =>
      createFounderCitizen({
        name: spec.name,

        systemId:
          spec.systemId,

        role:
          spec.role,

        rank:
          spec.systemId ===
          'SINK-PRIME'
            ? 'STEWARD'
            : 'SPECIALIST',

        home:
          spec.home,

        genome:
          genome(spec),

        authority:
          authority(
            spec.authority
          ),

        bornAt
      })
  );
}

export function createFoundingLakeYange(
  foundedAt =
    '2026-09-18T00:00:00.000Z'
): LakeYangeState {
  return createLakeYange(
    createFoundingCitizens(
      foundedAt
    ),
    {
      foundedAt,

      /**
       * Population pressure is intentional.
       *
       * Lake Yange may grow, but reproduction
       * cannot become unbounded process creation.
       */
      populationLimit: 32,
      traineeLimit: 8
    }
  );
}

export function findCitizenBySystemId(
  state: LakeYangeState,
  systemId: string
): Citizen | undefined {
  return state.citizens.find(
    (citizen) =>
      citizen.system_id ===
      systemId
  );
}
