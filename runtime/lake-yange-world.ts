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
  citizenPublicRecord,
  type Authority,
  type Citizen
} from './lake-yange.js';

import {
  LakeYangeAgentWorldStore,
  type LakeYangeAgentWorld
} from './lake-yange-agent-world.js';

import {
  LakeYangeAgentStore,
  type AgentState
} from './lake-yange-agent.js';

import {
  loadAcademyState
} from './academy-store.js';

import {
  StudyMissionStore
} from './study-mission.js';

import {
  LAKE_YANGE_INSTITUTIONS
} from './lake-yange-institutions.js';

import {
  entertainmentCatalogueSnapshot
} from './prime-entertainment.js';

import type {
  EngineeringReceipt
} from './engineering-orchestrator.js';

const RECEIPT_DIRECTORY =
  '.sink/lake-yange/engineering-receipts';

const MAX_RECENT_RECEIPTS = 12;
const MAX_OPERATIONS = 24;

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

export interface LakeYangeWorldAgentActivity {
  observations: number;
  learning_outcomes: number;
  rest_records: number;
  project_proposals: number;
  project_contributions: number;
  total: number;
}

export type LakeYangeAgentPresence =
  | 'IDLE'
  | 'DORMANT'
  | 'TRAINING'
  | 'RESTING'
  | 'ARCHIVED'
  | 'OFFLINE'
  | 'PLANNED';

export interface LakeYangeWorldAgentRecord {
  citizen_id: string;
  system_id: string;
  name: string;
  role: string;
  rank: string;
  citizen_status: string;
  presence: LakeYangeAgentPresence;
  current_mission: string | null;
  last_action: string | null;
  last_activity_at: string | null;
  wake_count: number;
  evidence_produced: number;
  granted_authority: string[];
  conceptual: false;
}

export interface LakeYangeWorldInstitution {
  institution_id: string;
  name: string;
  purpose: string;
  kind: string;
  district: string;
  status: 'FOUNDED';
  authority_boundary: string;
  landmark_id: string | null;
  occupants: number;
  occupant_names: string[];
}

export interface LakeYangeWorldMission {
  mission_id: string;
  kind: 'STUDY' | 'ACADEMY' | 'ENGINEERING';
  title: string;
  status: string;
  responsible: string[];
  updated_at: string | null;
  evidence_count: number;
}

export interface LakeYangeWorldOperation {
  operation_id: string;
  kind: string;
  title: string;
  status: string;
  occurred_at: string;
  agents: string[];
  evidence_id: string | null;
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

  agents: LakeYangeWorldAgentActivity;

  agent_records: LakeYangeWorldAgentRecord[];

  institutions: LakeYangeWorldInstitution[];

  missions: LakeYangeWorldMission[];

  operations: LakeYangeWorldOperation[];

  governance: {
    pending_plans: number;
    authorizations: number;
    execution_claims: number;
    execution_results: number;
    plans_are_not_execution: true;
  };

  academy: {
    students: number;
    assignments: number;
    submissions: number;
    grades: number;
    last_cycle_at: string | null;
  };

  entertainment: {
    source: 'EDITORIAL_BOOTSTRAP';
    item_count: number;
    music_count: number;
    film_count: number;
    persisted_taste_profile: false;
  };

  health: {
    persistence: 'OK';
    academy: 'OK' | 'EMPTY';
    study_missions: 'OK' | 'EMPTY';
    agent_runtime: 'OK' | 'EMPTY';
    local_ai: {
      status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
      runtime: 'llama.cpp';
      endpoint: string | null;
      probed_at: string | null;
    };
    overall: 'OK' | 'DEGRADED';
  };

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

export type LakeYangeWorldProjectionOptions = {
  localAi?: {
    status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
    endpoint: string | null;
    probed_at: string | null;
  };
};

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

function isMissing(
  error: unknown
): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function grantedAuthority(
  authority: Authority
): string[] {
  return (
    Object.entries(authority) as Array<
      [keyof Authority, boolean]
    >
  )
    .filter(([, granted]) => granted)
    .map(([key]) => String(key));
}

function presenceFor(
  citizen: Citizen,
  agent: AgentState | undefined
): LakeYangeAgentPresence {
  if (citizen.status === 'ARCHIVED') {
    return 'ARCHIVED';
  }

  if (citizen.status === 'DORMANT') {
    return 'DORMANT';
  }

  if (citizen.status === 'TRAINING') {
    return 'TRAINING';
  }

  if (citizen.status === 'RESTING') {
    return 'RESTING';
  }

  if (!agent || agent.wake_count === 0) {
    return 'OFFLINE';
  }

  return 'IDLE';
}

function countCitizenEvidence(
  citizenId: string,
  agentWorld: LakeYangeAgentWorld,
  agent: AgentState | undefined
): number {
  const worldCount =
    agentWorld.observations.filter(
      item => item.citizen_id === citizenId
    ).length +
    agentWorld.learning_outcomes.filter(
      item => item.citizen_id === citizenId
    ).length +
    agentWorld.project_proposals.filter(
      item => item.citizen_id === citizenId
    ).length +
    agentWorld.project_contributions.filter(
      item => item.citizen_id === citizenId
    ).length;

  const memoryEvidence =
    agent?.memories.reduce(
      (total, memory) =>
        total + memory.evidence_ids.length,
      0
    ) ?? 0;

  return worldCount + memoryEvidence;
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
    if (isMissing(error)) {
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

async function countJsonRecords(
  directory: string
): Promise<number> {
  let names: string[];

  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) {
      return 0;
    }

    throw error;
  }

  return names.filter(
    name => name.endsWith('.json')
  ).length;
}

export async function projectLakeYangeWorld(
  repositoryRoot: string,
  options: LakeYangeWorldProjectionOptions = {}
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

  const agentWorldStore =
    new LakeYangeAgentWorldStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/agents/world.json'
      )
    );

  const agentWorld =
    await agentWorldStore.load();

  const agentRuntime =
    await new LakeYangeAgentStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/agents/state.json'
      )
    ).load();

  const academy =
    await loadAcademyState(
      repositoryRoot
    );

  const studyState =
    await new StudyMissionStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/study-missions.json'
      )
    ).load();

  const pendingPlans =
    await countJsonRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/pending-plans'
      )
    );

  const authorizations =
    await countJsonRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/authorizations'
      )
    );

  const executionClaims =
    await countJsonRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/constitutional-executions/claims'
      )
    );

  const executionResults =
    await countJsonRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/constitutional-executions/results'
      )
    );

  const agentActivity = {
    observations:
      agentWorld.observations.length,

    learning_outcomes:
      agentWorld.learning_outcomes.length,

    rest_records:
      agentWorld.rest_records.length,

    project_proposals:
      agentWorld.project_proposals.length,

    project_contributions:
      agentWorld.project_contributions.length,

    total:
      agentWorld.observations.length +
      agentWorld.learning_outcomes.length +
      agentWorld.rest_records.length +
      agentWorld.project_proposals.length +
      agentWorld.project_contributions.length
  };

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

  const agentByCitizen = new Map(
    agentRuntime.agents.map(
      agent => [agent.citizen_id, agent]
    )
  );

  const studyByAgent = new Map<string, string[]>();

  for (const mission of studyState.missions) {
    if (
      mission.status === 'completed' ||
      mission.status === 'failed'
    ) {
      continue;
    }

    for (const agentId of mission.assigned_agents) {
      const current =
        studyByAgent.get(agentId) ?? [];

      current.push(mission.topic);
      studyByAgent.set(agentId, current);
    }
  }

  const agentRecords: LakeYangeWorldAgentRecord[] =
    state.citizens.map(citizen => {
      const agent =
        agentByCitizen.get(citizen.citizen_id);

      const assigned =
        studyByAgent.get(citizen.citizen_id) ??
        studyByAgent.get(citizen.system_id) ??
        [];

      return {
        citizen_id: citizen.citizen_id,
        system_id: citizen.system_id,
        name: citizen.name,
        role: citizen.role,
        rank: citizen.rank,
        citizen_status: citizen.status,
        presence: presenceFor(citizen, agent),
        current_mission:
          assigned[0] ?? null,
        last_action:
          agent?.last_action ?? null,
        last_activity_at:
          agent?.last_wake_at ?? null,
        wake_count:
          agent?.wake_count ?? 0,
        evidence_produced:
          countCitizenEvidence(
            citizen.citizen_id,
            agentWorld,
            agent
          ),
        granted_authority:
          grantedAuthority(citizen.authority),
        conceptual: false
      };
    });

  const institutions: LakeYangeWorldInstitution[] =
    LAKE_YANGE_INSTITUTIONS.map(definition => {
      const occupants =
        definition.district === 'FORGE_WORKSHOP'
          ? []
          : state.citizens.filter(
              citizen =>
                citizen.status !== 'ARCHIVED' &&
                citizen.home === definition.district
            );

      return {
        institution_id:
          definition.institution_id,
        name: definition.name,
        purpose: definition.purpose,
        kind: definition.kind,
        district: definition.district,
        status: 'FOUNDED',
        authority_boundary:
          definition.authority_boundary,
        landmark_id:
          definition.landmark_id,
        occupants: occupants.length,
        occupant_names:
          occupants.map(citizen => citizen.name)
      };
    });

  const missions: LakeYangeWorldMission[] = [
    ...studyState.missions.map(mission => ({
      mission_id: mission.id,
      kind: 'STUDY' as const,
      title: mission.topic,
      status: mission.status.toUpperCase(),
      responsible: [...mission.assigned_agents],
      updated_at: mission.updated_at,
      evidence_count:
        mission.findings.length +
        mission.outputs.length +
        mission.sources.length
    })),
    ...academy.assignments.map(assignment => ({
      mission_id: assignment.assignment_id,
      kind: 'ACADEMY' as const,
      title: assignment.objective,
      status: assignment.status,
      responsible: [assignment.citizen_id],
      updated_at: assignment.created_at,
      evidence_count: 0
    })),
    ...receipts.map(receipt => ({
      mission_id: receipt.receipt_id,
      kind: 'ENGINEERING' as const,
      title: receipt.objective,
      status: receipt.status,
      responsible: ['Forge', 'Vera', 'Rook'],
      updated_at: receipt.created_at,
      evidence_count: 1
    }))
  ];

  const operations: LakeYangeWorldOperation[] = [
    ...receipts.map(receipt => ({
      operation_id: receipt.receipt_id,
      kind: 'ENGINEERING_RECEIPT',
      title: receipt.objective,
      status: receipt.status,
      occurred_at: receipt.created_at,
      agents: ['Forge', 'Vera', 'Rook'],
      evidence_id: receipt.receipt_id
    })),
    ...agentRuntime.agents.flatMap(agent => {
      const citizen =
        state.citizens.find(
          candidate =>
            candidate.citizen_id === agent.citizen_id
        );

      if (!agent.last_wake_at) {
        return [];
      }

      return [{
        operation_id:
          `${agent.citizen_id}:${agent.last_wake_at}`,
        kind: 'AGENT_WAKE',
        title:
          agent.last_action
            ? `${citizen?.name ?? agent.citizen_id} ${agent.last_action}`
            : `${citizen?.name ?? agent.citizen_id} last wake`,
        status: 'RECORDED',
        occurred_at: agent.last_wake_at,
        agents: [citizen?.name ?? agent.citizen_id],
        evidence_id: null
      }];
    })
  ]
    .sort(
      (left, right) =>
        Date.parse(right.occurred_at) -
        Date.parse(left.occurred_at)
    )
    .slice(0, MAX_OPERATIONS);

  const localAi = options.localAi ?? {
    status: 'UNKNOWN' as const,
    endpoint: null,
    probed_at: null
  };

  const academyEmpty =
    academy.students.length === 0 &&
    academy.assignments.length === 0;

  const studyEmpty =
    studyState.missions.length === 0;

  const agentRuntimeEmpty =
    agentRuntime.agents.length === 0;

  const overall =
    localAi.status === 'OFFLINE'
      ? 'DEGRADED'
      : 'OK';

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

    agents: agentActivity,

    agent_records: agentRecords,

    institutions,

    missions,

    operations,

    governance: {
      pending_plans: pendingPlans,
      authorizations,
      execution_claims: executionClaims,
      execution_results: executionResults,
      plans_are_not_execution: true
    },

    academy: {
      students: academy.students.length,
      assignments: academy.assignments.length,
      submissions: academy.submissions.length,
      grades: academy.grades.length,
      last_cycle_at: academy.last_cycle_at
    },

    entertainment:
      entertainmentCatalogueSnapshot(),

    health: {
      persistence: 'OK',
      academy: academyEmpty ? 'EMPTY' : 'OK',
      study_missions: studyEmpty ? 'EMPTY' : 'OK',
      agent_runtime:
        agentRuntimeEmpty ? 'EMPTY' : 'OK',
      local_ai: {
        status: localAi.status,
        runtime: 'llama.cpp',
        endpoint: localAi.endpoint,
        probed_at: localAi.probed_at
      },
      overall
    },

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
