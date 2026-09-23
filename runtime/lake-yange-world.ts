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
  EMPTY_LAKE_YANGE_AGENT_WORLD,
  LakeYangeAgentWorldStore,
  type LakeYangeAgentWorld
} from './lake-yange-agent-world.js';

import {
  LakeYangeAgentStore,
  type AgentRuntimeState,
  type AgentState
} from './lake-yange-agent.js';

import {
  emptyAcademyState,
  loadAcademyState,
  type AcademyState
} from './academy-store.js';

import {
  StudyMissionStore,
  type StudyMissionState
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

/**
 * Agent presence is an agent-process state, derived only from
 * persisted agent runtime data:
 *
 * - ACTIVE   — the agent process woke within the active window.
 * - IDLE     — the agent has woken before, but not recently.
 * - PLANNED  — no agent process record exists yet for this citizen.
 * - OFFLINE  — an agent record exists but has never woken, or the
 *              citizen is archived and will not be scheduled.
 * - QUEUED   — reserved vocabulary for a persisted scheduler queue.
 * - BLOCKED  — reserved vocabulary for a persisted block record.
 * - ERROR    — the agent runtime store could not be read, so no
 *              process claim can be made either way.
 *
 * Civic state (TRAINING / RESTING / DORMANT / ARCHIVED) is reported
 * separately via `citizen_status` and is never conflated with
 * agent-process presence.
 */
export type LakeYangeAgentPresence =
  | 'ACTIVE'
  | 'IDLE'
  | 'PLANNED'
  | 'OFFLINE'
  | 'QUEUED'
  | 'BLOCKED'
  | 'ERROR';

export interface LakeYangeWorldAgentRecord {
  citizen_id: string;
  system_id: string;
  name: string;
  role: string;
  rank: string;
  citizen_status: string;
  presence: LakeYangeAgentPresence;
  current_mission: string | null;
  current_operation: string | null;
  objective: string | null;
  last_action: string | null;
  last_activity_at: string | null;
  latest_activity: string | null;
  wake_count: number;
  evidence_produced: number;
  evidence_sample: string[];
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

/**
 * A bounded summary of a persisted governance artifact. Field `status`
 * is the record's own persisted status — never inferred.
 */
export interface LakeYangeGovernanceRecord {
  record_id: string;
  kind: 'MANDATE' | 'PLAN' | 'AUTHORIZATION' | 'CLAIM' | 'RESULT';
  title: string;
  status: string;
  created_at: string;
  detail: string | null;
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
    records: {
      mandates: LakeYangeGovernanceRecord[];
      plans: LakeYangeGovernanceRecord[];
      authorizations: LakeYangeGovernanceRecord[];
      claims: LakeYangeGovernanceRecord[];
      results: LakeYangeGovernanceRecord[];
      invalid_records: number;
    };
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
    academy: 'OK' | 'EMPTY' | 'ERROR';
    study_missions: 'OK' | 'EMPTY' | 'ERROR';
    agent_runtime: 'OK' | 'EMPTY' | 'ERROR';
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

/**
 * Presence is measured from persisted agent runtime records only.
 *
 * ACTIVE means the agent process executed a wake within
 * `ACTIVE_WINDOW_MS` of `nowMs` — a measurement against persisted
 * timestamps, not a claim that a process is running right now.
 */
const ACTIVE_WINDOW_MS = 10 * 60_000;

function presenceFor(
  citizen: Citizen,
  agent: AgentState | undefined,
  agentStoreHealthy: boolean,
  nowMs: number
): LakeYangeAgentPresence {
  if (!agentStoreHealthy) {
    return 'ERROR';
  }

  if (citizen.status === 'ARCHIVED') {
    return 'OFFLINE';
  }

  if (!agent) {
    return 'PLANNED';
  }

  if (agent.wake_count === 0) {
    return 'OFFLINE';
  }

  const lastWake = agent.last_wake_at
    ? Date.parse(agent.last_wake_at)
    : Number.NaN;

  if (
    Number.isFinite(lastWake) &&
    nowMs - lastWake <= ACTIVE_WINDOW_MS
  ) {
    return 'ACTIVE';
  }

  return 'IDLE';
}

/**
 * The most recent persisted world record a citizen produced, plus a
 * bounded sample of evidence identifiers. Returns nulls for citizens
 * with no persisted activity — never an invented summary.
 */
function citizenActivity(
  citizenId: string,
  agentWorld: LakeYangeAgentWorld,
  agent: AgentState | undefined
): {
  latest_kind: string | null;
  latest_summary: string | null;
  latest_at: string | null;
  evidence_sample: string[];
} {
  type WorldRecord = {
    kind: string;
    summary: string;
    at: string;
    id: string;
  };

  const records: WorldRecord[] = [
    ...agentWorld.observations
      .filter(item => item.citizen_id === citizenId)
      .map(item => ({
        kind: 'OBSERVATION',
        summary: item.content,
        at: item.created_at,
        id: item.observation_id
      })),
    ...agentWorld.learning_outcomes
      .filter(item => item.citizen_id === citizenId)
      .map(item => ({
        kind: 'STUDY',
        summary: `${item.subject}: ${item.outcome}`,
        at: item.created_at,
        id: item.learning_id
      })),
    ...agentWorld.rest_records
      .filter(item => item.citizen_id === citizenId)
      .map(item => ({
        kind: 'REST',
        summary: 'Rest recorded',
        at: item.created_at,
        id: item.rest_id
      })),
    ...agentWorld.project_proposals
      .filter(item => item.citizen_id === citizenId)
      .map(item => ({
        kind: 'PROPOSE_PROJECT',
        summary: item.objective,
        at: item.created_at,
        id: item.project_id
      })),
    ...agentWorld.project_contributions
      .filter(item => item.citizen_id === citizenId)
      .map(item => ({
        kind: 'CONTRIBUTE_PROJECT',
        summary: item.contribution,
        at: item.created_at,
        id: item.contribution_id
      }))
  ].sort(
    (left, right) => Date.parse(right.at) - Date.parse(left.at)
  );

  const latest = records[0];

  const memoryEvidence =
    agent?.memories.flatMap(
      memory => memory.evidence_ids
    ) ?? [];

  const evidence_sample = [
    ...new Set([
      ...records.map(record => record.id),
      ...memoryEvidence
    ])
  ].slice(0, 5);

  return {
    latest_kind: latest?.kind ?? null,
    latest_summary: latest
      ? latest.summary.slice(0, 240)
      : null,
    latest_at: latest?.at ?? null,
    evidence_sample
  };
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

const MAX_GOVERNANCE_RECORDS = 12;

/**
 * Load bounded governance record summaries from a directory of
 * persisted JSON artifacts. Malformed files are counted in
 * `invalid` instead of breaking the projection.
 */
async function loadGovernanceRecords(
  directory: string,
  kind: LakeYangeGovernanceRecord['kind'],
  map: (raw: Record<string, unknown>) =>
    LakeYangeGovernanceRecord | null
): Promise<{
  records: LakeYangeGovernanceRecord[];
  invalid: number;
}> {
  let names: string[];

  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) {
      return { records: [], invalid: 0 };
    }

    throw error;
  }

  const records: LakeYangeGovernanceRecord[] = [];

  let invalid = 0;

  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }

    try {
      const raw = JSON.parse(
        await readFile(join(directory, name), 'utf8')
      ) as Record<string, unknown>;

      const record = map(raw);

      if (record && record.kind === kind) {
        records.push(record);
      } else {
        invalid += 1;
      }
    } catch {
      invalid += 1;
    }
  }

  records.sort(
    (left, right) =>
      Date.parse(right.created_at) -
      Date.parse(left.created_at)
  );

  return {
    records: records.slice(0, MAX_GOVERNANCE_RECORDS),
    invalid
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function textOr(value: unknown, fallback: string): string {
  return asString(value) ?? fallback;
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

  /*
   * A malformed secondary store must never take the whole
   * civilisation console offline. Core state.json failures still
   * throw (without citizens there is nothing truthful to show),
   * but agent / academy / study stores degrade to EMPTY or ERROR
   * and the health block reports exactly which one broke.
   */
  let agentWorld: LakeYangeAgentWorld =
    EMPTY_LAKE_YANGE_AGENT_WORLD;

  let agentWorldHealth: 'OK' | 'EMPTY' | 'ERROR' = 'OK';

  try {
    const loaded = await agentWorldStore.load();

    agentWorld = loaded;

    const emptyWorld =
      loaded.observations.length === 0 &&
      loaded.learning_outcomes.length === 0 &&
      loaded.rest_records.length === 0 &&
      loaded.project_proposals.length === 0 &&
      loaded.project_contributions.length === 0;

    agentWorldHealth = emptyWorld ? 'EMPTY' : 'OK';
  } catch {
    agentWorldHealth = 'ERROR';
  }

  let agentRuntime: AgentRuntimeState = {
    schema_version: 1,
    settlement_id: 'LAKE-YANGE',
    updated_at: new Date(0).toISOString(),
    agents: []
  };

  let agentRuntimeHealth: 'OK' | 'EMPTY' | 'ERROR' = 'OK';

  try {
    const loaded = await new LakeYangeAgentStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/agents/state.json'
      )
    ).load();

    agentRuntime = loaded;

    agentRuntimeHealth =
      loaded.agents.length === 0 ? 'EMPTY' : 'OK';
  } catch {
    agentRuntimeHealth = 'ERROR';
  }

  const agentStoreHealthy =
    agentRuntimeHealth !== 'ERROR' &&
    agentWorldHealth !== 'ERROR';

  let academyHealth: 'OK' | 'EMPTY' | 'ERROR' = 'OK';

  let academy: AcademyState;

  try {
    academy = await loadAcademyState(
      repositoryRoot
    );

    const emptyAcademy =
      academy.students.length === 0 &&
      academy.assignments.length === 0;

    academyHealth = emptyAcademy ? 'EMPTY' : 'OK';
  } catch {
    academy = emptyAcademyState();

    academyHealth = 'ERROR';
  }

  let studyHealth: 'OK' | 'EMPTY' | 'ERROR' = 'OK';

  let studyState: StudyMissionState;

  try {
    studyState = await new StudyMissionStore(
      join(
        repositoryRoot,
        '.sink/lake-yange/study-missions.json'
      )
    ).load();

    studyHealth =
      studyState.missions.length === 0 ? 'EMPTY' : 'OK';
  } catch {
    studyState = {
      schema_version: 1,
      settlement_id: 'LAKE-YANGE',
      missions: [],
      updated_at: new Date(0).toISOString()
    };

    studyHealth = 'ERROR';
  }

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

  const [
    mandateRecords,
    planRecords,
    authorizationRecords,
    claimRecords,
    resultRecords
  ] = await Promise.all([
    loadGovernanceRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/mandates'
      ),
      'MANDATE',
      raw => {
        const recordId = asString(raw.mandate_id);
        const createdAt = asString(raw.issued_at);

        if (!recordId || !createdAt) {
          return null;
        }

        return {
          record_id: recordId,
          kind: 'MANDATE',
          title: textOr(
            raw.title,
            'Untitled mandate'
          ),
          status: textOr(raw.status, 'UNKNOWN'),
          created_at: createdAt,
          detail: asString(raw.issued_by)
        };
      }
    ),

    loadGovernanceRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/pending-plans'
      ),
      'PLAN',
      raw => {
        const recordId = asString(raw.plan_id);
        const createdAt = asString(raw.created_at);

        if (!recordId || !createdAt) {
          return null;
        }

        return {
          record_id: recordId,
          kind: 'PLAN',
          title: textOr(raw.title, 'Untitled plan'),
          status: textOr(raw.status, 'UNKNOWN'),
          created_at: createdAt,
          detail: asString(raw.target_system)
        };
      }
    ),

    loadGovernanceRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/authorizations'
      ),
      'AUTHORIZATION',
      raw => {
        const recordId =
          asString(raw.authorization_id);
        const createdAt = asString(raw.issued_at);

        if (!recordId || !createdAt) {
          return null;
        }

        return {
          record_id: recordId,
          kind: 'AUTHORIZATION',
          title: textOr(
            raw.target_system,
            'Authorization'
          ),
          status:
            raw.consumed === true
              ? 'CONSUMED'
              : 'OUTSTANDING',
          created_at: createdAt,
          detail: asString(raw.issued_by)
        };
      }
    ),

    loadGovernanceRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/constitutional-executions/claims'
      ),
      'CLAIM',
      raw => {
        const recordId = asString(raw.claim_id);
        const createdAt = asString(raw.claimed_at);

        if (!recordId || !createdAt) {
          return null;
        }

        return {
          record_id: recordId,
          kind: 'CLAIM',
          title: textOr(
            raw.authorization_id,
            'Execution claim'
          ),
          status: 'CLAIMED',
          created_at: createdAt,
          detail: asString(raw.plan_id)
        };
      }
    ),

    loadGovernanceRecords(
      join(
        repositoryRoot,
        '.sink/lake-yange/constitutional-executions/results'
      ),
      'RESULT',
      raw => {
        const recordId = asString(raw.result_id);
        const createdAt =
          asString(raw.completed_at) ??
          asString(raw.created_at);

        if (!recordId || !createdAt) {
          return null;
        }

        const vera = asString(raw.vera);
        const rook = asString(raw.rook);

        return {
          record_id: recordId,
          kind: 'RESULT',
          title: textOr(
            raw.engineering_receipt_id,
            'Execution result'
          ),
          status: textOr(raw.status, 'UNKNOWN'),
          created_at: createdAt,
          detail:
            vera && rook
              ? `VERA ${vera} · ROOK ${rook}`
              : null
        };
      }
    )
  ]);

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

      const activity = citizenActivity(
        citizen.citizen_id,
        agentWorld,
        agent
      );

      const latestDecision =
        agent?.decisions.at(-1) ?? null;

      const lastActivityAt =
        agent?.last_wake_at ?? activity.latest_at;

      return {
        citizen_id: citizen.citizen_id,
        system_id: citizen.system_id,
        name: citizen.name,
        role: citizen.role,
        rank: citizen.rank,
        citizen_status: citizen.status,
        presence: presenceFor(
          citizen,
          agent,
          agentStoreHealthy,
          Date.now()
        ),
        current_mission:
          assigned[0] ?? null,
        current_operation:
          activity.latest_kind ??
          agent?.last_action ??
          null,
        objective:
          latestDecision?.objective ?? null,
        last_action:
          agent?.last_action ?? null,
        last_activity_at: lastActivityAt,
        latest_activity: activity.latest_summary,
        wake_count:
          agent?.wake_count ?? 0,
        evidence_produced:
          countCitizenEvidence(
            citizen.citizen_id,
            agentWorld,
            agent
          ),
        evidence_sample:
          activity.evidence_sample,
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

  const overall =
    localAi.status === 'OFFLINE' ||
    academyHealth === 'ERROR' ||
    studyHealth === 'ERROR' ||
    agentRuntimeHealth === 'ERROR'
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
      records: {
        mandates: mandateRecords.records,
        plans: planRecords.records,
        authorizations: authorizationRecords.records,
        claims: claimRecords.records,
        results: resultRecords.records,
        invalid_records:
          mandateRecords.invalid +
          planRecords.invalid +
          authorizationRecords.invalid +
          claimRecords.invalid +
          resultRecords.invalid
      },
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
      academy: academyHealth,
      study_missions: studyHealth,
      agent_runtime: agentRuntimeHealth,
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
