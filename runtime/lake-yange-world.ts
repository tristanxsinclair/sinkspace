import {
  readdir,
  readFile
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import {
  LakeYangeStore
} from './lake-yange-store.js';

import {
  citizenPublicRecord
} from './lake-yange.js';

import type {
  EngineeringReceipt
} from './engineering-orchestrator.js';

const RECEIPT_DIRECTORY =
  '.sink/lake-yange/engineering-receipts';

const MAX_RECENT_RECEIPTS = 12;

export interface LakeYangeWorldCitizen {
  citizen_id: string;
  system_id: string;
  name: string;
  role: string;
  rank: string;
  status: string;
  home: string;
  generation: number;
  fitness: number;
  missions_completed: number;
  missions_failed: number;
}

export interface LakeYangeWorldEngineering {
  receipt_id: string;
  created_at: string;
  status: 'PROPOSED' | 'VERIFIED' | 'REJECTED';
  objective: string;
  target_path: string;
  changed_files: string[];
  vera: 'PASS' | 'FAIL';
  rook: 'PASS' | 'FAIL';
  promotion: 'NOT_AUTHORIZED';
  cognition: 'LOCAL';
  failure: string | null;
}

export interface LakeYangeWorldProjection {
  projection_version: 1;
  generated_at: string;

  settlement: {
    settlement_id: 'LAKE-YANGE';
    founded_at: string;
    generation: number;
    population: number;
    population_limit: number;
    trainee_limit: number;
    births_total: number;
    admissions_total: number;
    archived_total: number;
  };

  cognition: {
    locality: 'LOCAL';
    external_model_api: false;
  };

  citizens: LakeYangeWorldCitizen[];

  engineering: {
    recent: LakeYangeWorldEngineering[];
    latest: LakeYangeWorldEngineering | null;
    verified_total: number;
    rejected_total: number;
    workshop_active: false;
  };

  resources: {
    state: 'UNQUANTIFIED';
    telemetry_backed: false;
    harvesting_enabled: false;
  };

  truth: {
    source: 'PERSISTED_STATE_AND_RECEIPTS';
    simulation_fabricated_activity: false;
  };
}

function receiptProjection(
  receipt: EngineeringReceipt
): LakeYangeWorldEngineering {
  return {
    receipt_id:
      receipt.receipt_id,

    created_at:
      receipt.created_at,

    status:
      receipt.status,

    objective:
      receipt.objective,

    target_path:
      receipt.target_path,

    changed_files:
      [...receipt.changed_files],

    vera:
      receipt.vera,

    rook:
      receipt.rook,

    promotion:
      receipt.promotion,

    cognition:
      receipt.cognition,

    failure:
      receipt.failure ?? null
  };
}

async function loadEngineeringReceipts(
  repositoryRoot: string
): Promise<EngineeringReceipt[]> {
  const directory =
    join(
      repositoryRoot,
      RECEIPT_DIRECTORY
    );

  let names: string[];

  try {
    names =
      await readdir(directory);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return [];
    }

    throw error;
  }

  const receipts: EngineeringReceipt[] = [];

  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }

    try {
      const raw =
        await readFile(
          join(directory, name),
          'utf8'
        );

      const candidate =
        JSON.parse(raw) as EngineeringReceipt;

      if (
        typeof candidate.receipt_id !== 'string' ||
        typeof candidate.created_at !== 'string' ||
        (
          candidate.status !== 'PROPOSED' &&
          candidate.status !== 'VERIFIED' &&
          candidate.status !== 'REJECTED'
        )
      ) {
        continue;
      }

      receipts.push(candidate);
    } catch {
      /*
       * Projection is read-only and conservative.
       *
       * One malformed historical receipt must not make
       * the civilisation console unavailable.
       */
    }
  }

  return receipts.sort(
    (left, right) =>
      Date.parse(right.created_at) -
      Date.parse(left.created_at)
  );
}

export async function projectLakeYangeWorld(
  repositoryRoot: string
): Promise<LakeYangeWorldProjection> {
  const store =
    new LakeYangeStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/state.json'
      )
    );

  const state =
    await store.load();

  const receipts =
    await loadEngineeringReceipts(
      repositoryRoot
    );

  const recent =
    receipts
      .slice(0, MAX_RECENT_RECEIPTS)
      .map(receiptProjection);

  const citizens =
    state.citizens.map(
      citizen => {
        const record =
          citizenPublicRecord(citizen);

        return {
          citizen_id:
            record.citizen_id,

          system_id:
            record.system_id,

          name:
            record.name,

          role:
            record.role,

          rank:
            record.rank,

          status:
            record.status,

          home:
            record.home,

          generation:
            record.generation,

          fitness:
            record.fitness,

          missions_completed:
            record.missions_completed,

          missions_failed:
            record.missions_failed
        };
      }
    );

  return {
    projection_version: 1,

    generated_at:
      new Date().toISOString(),

    settlement: {
      settlement_id:
        state.settlement_id,

      founded_at:
        state.founded_at,

      generation:
        state.generation,

      population:
        state.citizens.filter(
          citizen =>
            citizen.status !== 'ARCHIVED'
        ).length,

      population_limit:
        state.population_limit,

      trainee_limit:
        state.trainee_limit,

      births_total:
        state.births_total,

      admissions_total:
        state.admissions_total,

      archived_total:
        state.archived_total
    },

    cognition: {
      locality: 'LOCAL',
      external_model_api: false
    },

    citizens,

    engineering: {
      recent,

      latest:
        recent[0] ?? null,

      verified_total:
        receipts.filter(
          receipt =>
            receipt.status === 'VERIFIED'
        ).length,

      rejected_total:
        receipts.filter(
          receipt =>
            receipt.status === 'REJECTED'
        ).length,

      /*
       * Receipts are completed historical evidence.
       * They cannot prove that Forge is working NOW.
       *
       * A future persisted RUN_STARTED/RUN_FINISHED
       * event can legitimately drive this field.
       */
      workshop_active: false
    },

    resources: {
      state: 'UNQUANTIFIED',
      telemetry_backed: false,
      harvesting_enabled: false
    },

    truth: {
      source:
        'PERSISTED_STATE_AND_RECEIPTS',

      simulation_fabricated_activity:
        false
    }
  };
}
