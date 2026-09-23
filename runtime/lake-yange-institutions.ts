import type { District } from './lake-yange.js';

export type LakeYangeInstitutionKind =
  | 'GOVERNMENT'
  | 'SECURITY'
  | 'VERIFICATION'
  | 'ECONOMY'
  | 'ENGINEERING'
  | 'LEARNING'
  | 'COGNITION'
  | 'EXPLORATION'
  | 'BOUNDARY';

export interface LakeYangeInstitutionDefinition {
  institution_id: string;
  district: District | 'FORGE_WORKSHOP';
  name: string;
  purpose: string;
  kind: LakeYangeInstitutionKind;
  authority_boundary: string;
  landmark_id: string | null;
  implemented: true;
}

/**
 * Canonical Lake Yange institutions.
 *
 * Occupancy and activity are projected from persisted
 * citizens and receipts. This catalogue does not invent
 * operational work.
 */
export const LAKE_YANGE_INSTITUTIONS:
  readonly LakeYangeInstitutionDefinition[] = [
    {
      institution_id: 'STATE-HOUSE',
      district: 'PRIME_TOWER',
      name: 'State House',
      purpose:
        'Seat of Prime stewardship, mandates and bounded governance.',
      kind: 'GOVERNMENT',
      authority_boundary:
        'Prime plans and coordinates. Execution requires explicit authority.',
      landmark_id: 'state-house',
      implemented: true
    },
    {
      institution_id: 'LEDGER-BANK',
      district: 'LEDGER_HOUSE',
      name: 'Ledger Bank',
      purpose:
        'Evidence-bound resource and ownership records. No fabricated wealth.',
      kind: 'ECONOMY',
      authority_boundary:
        'Spend and financial action remain Founder-gated.',
      landmark_id: 'ledger-bank',
      implemented: true
    },
    {
      institution_id: 'VERA-ARCHIVE',
      district: 'VERA_ARCHIVE',
      name: 'Vera Archive',
      purpose:
        'Independent evidence review of artifacts and engineering receipts.',
      kind: 'VERIFICATION',
      authority_boundary:
        'Vera evaluates evidence. Vera cannot grant execution authority.',
      landmark_id: 'vera-archive',
      implemented: true
    },
    {
      institution_id: 'ROOK-KEEP',
      district: 'ROOK_KEEP',
      name: 'Rook Keep',
      purpose:
        'Adversarial review and defensive scrutiny (Red Sink).',
      kind: 'SECURITY',
      authority_boundary:
        'Rook may reject. Rook cannot promote or spend.',
      landmark_id: 'rook-keep',
      implemented: true
    },
    {
      institution_id: 'MODEL-COMMONS',
      district: 'MODEL_COMMONS',
      name: 'Model Commons',
      purpose:
        'Local cognition infrastructure. Separated from repository authority.',
      kind: 'COGNITION',
      authority_boundary:
        'Local models have zero operational authority by default.',
      landmark_id: 'model-commons',
      implemented: true
    },
    {
      institution_id: 'SCOUT-OUTPOST',
      district: 'SCOUT_OUTPOST',
      name: 'Scout Outpost',
      purpose:
        'Observation and opportunity discovery. External action remains gated.',
      kind: 'EXPLORATION',
      authority_boundary:
        'Discovery is not deployment, spend, or contact.',
      landmark_id: 'scout-outpost',
      implemented: true
    },
    {
      institution_id: 'FORGE-WORKSHOP',
      district: 'FORGE_WORKSHOP',
      name: 'Forge Workshop',
      purpose:
        'Bounded engineering environment constrained by plans and authorizations.',
      kind: 'ENGINEERING',
      authority_boundary:
        'A plan is not execution. Promotion remains Founder-gated.',
      landmark_id: 'forge-workshop',
      implemented: true
    },
    {
      institution_id: 'BUILDERS-QUARTER',
      district: 'BUILDERS_QUARTER',
      name: "Builders' Quarter",
      purpose:
        'Engineering and artifact construction district for builder citizens.',
      kind: 'ENGINEERING',
      authority_boundary:
        'Repository mutation requires explicit modify_repository authority.',
      landmark_id: null,
      implemented: true
    },
    {
      institution_id: 'ACADEMY',
      district: 'ACADEMY',
      name: 'Academy',
      purpose:
        'Citizen development. Educational authority only.',
      kind: 'LEARNING',
      authority_boundary:
        'Academy grades learning. It cannot grant civic power.',
      landmark_id: null,
      implemented: true
    },
    {
      institution_id: 'TRAINING-GROUNDS',
      district: 'TRAINING_GROUNDS',
      name: 'Training Grounds',
      purpose:
        'Trainee development without inherited authority.',
      kind: 'LEARNING',
      authority_boundary:
        'Children inherit traits, never authority.',
      landmark_id: null,
      implemented: true
    },
    {
      institution_id: 'WORLD-GATE',
      district: 'WORLD_GATE',
      name: 'World Gate',
      purpose:
        'Boundary between Lake Yange and consequential external action.',
      kind: 'BOUNDARY',
      authority_boundary:
        'Outbound contact, deploy, credentials and spend are denied by default.',
      landmark_id: 'world-gate',
      implemented: true
    }
  ];
