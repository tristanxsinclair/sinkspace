// ============================================================
// LAKE YANGE — STUDY MISSION → AGENT BRIDGE
// ============================================================
//
// Converts a persisted StudyMission into one bounded agent
// assignment.
//
// This layer deliberately does NOT:
// - perform research
// - call the web
// - call an LLM
// - grant operational authority
// - spend money
// - communicate externally
// - mutate governance
// - execute the study itself
//
// Its job is:
//
//   persisted StudyMission
//            ↓
//      bounded assignment
//            ↓
//       Lake Yange agent
//
// ============================================================

import {
  StudyMissionStore,
  type StudyMission,
} from "./study-mission.js";

// ============================================================
// TYPES
// ============================================================

export interface StudyAgentAssignment {
  assignment_id: string;
  mission_id: string;
  settlement_id: "LAKE-YANGE";
  agent_id: string;

  authority: "EDUCATIONAL_ONLY";

  topic: string;
  objectives: string[];
  questions: string[];
  depth: StudyMission["depth"];

  task: string;

  expected_outputs: string[];

  constraints: string[];

  created_at: string;
}

export interface CreateStudyAgentAssignmentInput {
  mission_id: string;
  agent_id: string;
}

export interface StudyAgentAssignmentResult {
  accepted: boolean;
  reason: string;
  assignment: StudyAgentAssignment | null;
}

// ============================================================
// CONSTANTS
// ============================================================

const SETTLEMENT_ID = "LAKE-YANGE";

const EDUCATIONAL_AUTHORITY = "EDUCATIONAL_ONLY";

const EXPECTED_OUTPUTS = [
  "evidence-backed findings",
  "source references",
  "explicit uncertainties",
];

const CONSTRAINTS = [
  "Remain within the assigned study topic.",
  "Use only bounded educational authority.",
  "Do not infer operational authority from study work.",
  "Do not spend money.",
  "Do not communicate externally.",
  "Do not modify governance or constitutional state.",
  "Do not claim completion without evidence.",
];

// ============================================================
// HELPERS
// ============================================================

function now(): string {
  return new Date().toISOString();
}

function createAssignmentId(
  missionId: string,
  agentId: string,
): string {
  return `study-assignment-${missionId}-${agentId}`;
}

function buildTask(
  mission: StudyMission,
): string {
  const objectiveText =
    mission.objectives.length > 0
      ? mission.objectives
          .map((objective) => `- ${objective}`)
          .join("\n")
      : "- No explicit objectives supplied.";

  const questionText =
    mission.questions.length > 0
      ? mission.questions
          .map((question) => `- ${question}`)
          .join("\n")
      : "- No explicit questions supplied.";

  return [
    `Study the topic: ${mission.topic}`,
    "",
    `Depth: ${mission.depth}`,
    "",
    "Objectives:",
    objectiveText,
    "",
    "Questions:",
    questionText,
    "",
    "Produce bounded educational research.",
    "Separate evidence, findings, and uncertainty.",
    "Do not convert study findings into operational authority.",
  ].join("\n");
}

// ============================================================
// VALIDATION
// ============================================================

function validateAgentId(agentId: string): void {
  if (!agentId.trim()) {
    throw new Error(
      "Study agent assignment requires an agent id",
    );
  }
}

function validateMissionForAssignment(
  mission: StudyMission,
): void {
  if (mission.settlement_id !== SETTLEMENT_ID) {
    throw new Error(
      "Study mission belongs to an unknown settlement",
    );
  }

  if (!mission.topic.trim()) {
    throw new Error(
      "Study mission topic cannot be empty",
    );
  }

  if (
    mission.status === "completed" ||
    mission.status === "failed"
  ) {
    throw new Error(
      `Study mission cannot receive new agent work while ${mission.status}`,
    );
  }
}

// ============================================================
// BRIDGE
// ============================================================

export class StudyMissionAgentBridge {
  public constructor(
    private readonly store: StudyMissionStore,
  ) {}

  /**
   * Convert one persisted StudyMission into one bounded
   * educational assignment.
   *
   * This method does not execute the assignment.
   */
  public async createAssignment(
    input: CreateStudyAgentAssignmentInput,
  ): Promise<StudyAgentAssignmentResult> {
    validateAgentId(input.agent_id);

    const mission = await this.store.get(
      input.mission_id,
    );

    if (!mission) {
      return {
        accepted: false,
        reason: `Study mission not found: ${input.mission_id}`,
        assignment: null,
      };
    }

    validateMissionForAssignment(mission);

    const assignment: StudyAgentAssignment = {
      assignment_id: createAssignmentId(
        mission.id,
        input.agent_id,
      ),

      mission_id: mission.id,

      settlement_id: SETTLEMENT_ID,

      agent_id: input.agent_id,

      authority: EDUCATIONAL_AUTHORITY,

      topic: mission.topic,

      objectives: [...mission.objectives],

      questions: [...mission.questions],

      depth: mission.depth,

      task: buildTask(mission),

      expected_outputs: [...EXPECTED_OUTPUTS],

      constraints: [...CONSTRAINTS],

      created_at: now(),
    };

    return {
      accepted: true,
      reason:
        "Study mission converted into a bounded educational agent assignment.",
      assignment,
    };
  }
}

// ============================================================
// HUMAN-READABLE REPORT
// ============================================================

export function summarizeStudyAgentAssignment(
  assignment: StudyAgentAssignment,
): string {
  return [
    `Assignment: ${assignment.assignment_id}`,
    `Mission: ${assignment.mission_id}`,
    `Agent: ${assignment.agent_id}`,
    `Topic: ${assignment.topic}`,
    `Depth: ${assignment.depth}`,
    `Authority: ${assignment.authority}`,
    `Objectives: ${assignment.objectives.length}`,
    `Questions: ${assignment.questions.length}`,
    `Expected outputs: ${assignment.expected_outputs.length}`,
    `Constraints: ${assignment.constraints.length}`,
  ].join("\n");
}