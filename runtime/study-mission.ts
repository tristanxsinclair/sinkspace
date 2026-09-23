import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export type StudyMissionStatus =
  | "queued"
  | "researching"
  | "synthesising"
  | "review"
  | "completed"
  | "failed";

export type StudyDepth =
  | "introductory"
  | "intermediate"
  | "advanced";

export interface StudySource {
  id: string;
  title: string;
  locator: string;
  accessed_at: string;
  agent_id: string;
  notes?: string;
}

export interface StudyFinding {
  id: string;
  claim: string;
  evidence: string;
  source_ids: string[];
  agent_id: string;
  confidence: number;
  created_at: string;
}

export interface StudyOutput {
  id: string;
  title: string;
  content: string;
  created_at: string;
  agent_id: string;
}

export interface StudyMission {
  id: string;
  schema_version: 1;

  settlement_id: "LAKE-YANGE";

  topic: string;
  objectives: string[];
  questions: string[];

  depth: StudyDepth;

  status: StudyMissionStatus;

  assigned_agents: string[];

  sources: StudySource[];
  findings: StudyFinding[];
  outputs: StudyOutput[];

  created_at: string;
  updated_at: string;
}

export interface StudyMissionState {
  schema_version: 1;
  settlement_id: "LAKE-YANGE";
  updated_at: string;
  missions: StudyMission[];
}

export interface CreateStudyMissionInput {
  topic: string;
  objectives?: string[];
  questions?: string[];
  depth?: StudyDepth;
  assigned_agents?: string[];
}

export interface CompleteStudyMissionInput {
  findings: StudyFinding[];
  outputs: StudyOutput[];
  sources: StudySource[];
}

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function validateMission(mission: StudyMission): void {
  if (!mission.topic.trim()) {
    throw new Error("Study mission topic cannot be empty");
  }

  if (mission.settlement_id !== "LAKE-YANGE") {
    throw new Error("Study mission belongs to an unknown settlement");
  }

  for (const finding of mission.findings) {
    if (
      finding.confidence < 0 ||
      finding.confidence > 1
    ) {
      throw new Error(
        `Finding ${finding.id} has invalid confidence`,
      );
    }
  }
}

export class StudyMissionStore {
  private state: StudyMissionState | null = null;

  constructor(private readonly statePath: string) {}

  private emptyState(): StudyMissionState {
    return {
      schema_version: 1,
      settlement_id: "LAKE-YANGE",
      updated_at: now(),
      missions: [],
    };
  }

  async load(): Promise<StudyMissionState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      const state = JSON.parse(raw) as StudyMissionState;

      if (state.schema_version !== 1) {
        throw new Error(
          `Unsupported study mission schema: ${state.schema_version}`,
        );
      }

      if (state.settlement_id !== "LAKE-YANGE") {
        throw new Error(
          "Study mission state belongs to another settlement",
        );
      }

      this.state = state;
      return state;
    } catch (error) {
      const code =
        error instanceof Error &&
        "code" in error
          ? error.code
          : undefined;

      if (code !== "ENOENT") {
        throw error;
      }

      this.state = this.emptyState();
      return this.state;
    }
  }

  private async ensureLoaded(): Promise<StudyMissionState> {
    return this.state ?? this.load();
  }

  private async save(
    state: StudyMissionState,
  ): Promise<void> {
    state.updated_at = now();

    const directory = dirname(this.statePath);
    await mkdir(directory, { recursive: true });

    const temporaryPath = `${this.statePath}.tmp`;

    await writeFile(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );

    await rename(temporaryPath, this.statePath);

    this.state = state;
  }

  async create(
    input: CreateStudyMissionInput,
  ): Promise<StudyMission> {
    const state = await this.ensureLoaded();

    const mission: StudyMission = {
      id: createId("study"),
      schema_version: 1,
      settlement_id: "LAKE-YANGE",

      topic: input.topic.trim(),
      objectives: input.objectives ?? [],
      questions: input.questions ?? [],

      depth: input.depth ?? "intermediate",

      status: "queued",

      assigned_agents: input.assigned_agents ?? [],

      sources: [],
      findings: [],
      outputs: [],

      created_at: now(),
      updated_at: now(),
    };

    validateMission(mission);

    state.missions.push(mission);

    await this.save(state);

    return mission;
  }

  async get(
    missionId: string,
  ): Promise<StudyMission | undefined> {
    const state = await this.ensureLoaded();

    return state.missions.find(
      (mission) => mission.id === missionId,
    );
  }

  async list(): Promise<StudyMission[]> {
    const state = await this.ensureLoaded();

    return [...state.missions];
  }

  async setStatus(
    missionId: string,
    status: StudyMissionStatus,
  ): Promise<StudyMission> {
    const state = await this.ensureLoaded();

    const mission = state.missions.find(
      (item) => item.id === missionId,
    );

    if (!mission) {
      throw new Error(
        `Study mission not found: ${missionId}`,
      );
    }

    mission.status = status;
    mission.updated_at = now();

    validateMission(mission);

    await this.save(state);

    return mission;
  }

  async addSource(
    missionId: string,
    source: StudySource,
  ): Promise<StudyMission> {
    const state = await this.ensureLoaded();

    const mission = state.missions.find(
      (item) => item.id === missionId,
    );

    if (!mission) {
      throw new Error(
        `Study mission not found: ${missionId}`,
      );
    }

    mission.sources.push(source);
    mission.updated_at = now();

    await this.save(state);

    return mission;
  }

  async addFinding(
    missionId: string,
    finding: StudyFinding,
  ): Promise<StudyMission> {
    const state = await this.ensureLoaded();

    const mission = state.missions.find(
      (item) => item.id === missionId,
    );

    if (!mission) {
      throw new Error(
        `Study mission not found: ${missionId}`,
      );
    }

    if (
      finding.confidence < 0 ||
      finding.confidence > 1
    ) {
      throw new Error(
        "Finding confidence must be between 0 and 1",
      );
    }

    mission.findings.push(finding);
    mission.updated_at = now();

    await this.save(state);

    return mission;
  }

  async addOutput(
    missionId: string,
    output: StudyOutput,
  ): Promise<StudyMission> {
    const state = await this.ensureLoaded();

    const mission = state.missions.find(
      (item) => item.id === missionId,
    );

    if (!mission) {
      throw new Error(
        `Study mission not found: ${missionId}`,
      );
    }

    mission.outputs.push(output);
    mission.updated_at = now();

    await this.save(state);

    return mission;
  }

  async complete(
    missionId: string,
    input: CompleteStudyMissionInput,
  ): Promise<StudyMission> {
    const state = await this.ensureLoaded();

    const mission = state.missions.find(
      (item) => item.id === missionId,
    );

    if (!mission) {
      throw new Error(
        `Study mission not found: ${missionId}`,
      );
    }

    mission.sources.push(...input.sources);
    mission.findings.push(...input.findings);
    mission.outputs.push(...input.outputs);

    mission.status = "completed";
    mission.updated_at = now();

    validateMission(mission);

    await this.save(state);

    return mission;
  }
}

