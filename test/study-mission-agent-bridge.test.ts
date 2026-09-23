import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  StudyMissionStore,
} from "../runtime/study-mission.js";

import {
  StudyMissionAgentBridge,
  summarizeStudyAgentAssignment,
} from "../runtime/study-mission-agent-bridge.js";

async function createStore(): Promise<StudyMissionStore> {
  const directory = await mkdtemp(
    join(tmpdir(), "lake-yange-study-bridge-"),
  );

  return new StudyMissionStore(
    join(directory, "study.json"),
  );
}

test(
  "study mission bridge creates bounded educational assignment",
  async () => {
    const store = await createStore();

    const mission = await store.create({
      topic: "AI economics",
      objectives: [
        "understand productivity",
        "understand employment",
      ],
      questions: [
        "how does AI change labour markets?",
      ],
      depth: "advanced",
    });

    const bridge =
      new StudyMissionAgentBridge(store);

    const result =
      await bridge.createAssignment({
        mission_id: mission.id,
        agent_id: "SINK-01",
      });

    assert.equal(result.accepted, true);
    assert.ok(result.assignment);

    assert.equal(
      result.assignment?.mission_id,
      mission.id,
    );

    assert.equal(
      result.assignment?.agent_id,
      "SINK-01",
    );

    assert.equal(
      result.assignment?.authority,
      "EDUCATIONAL_ONLY",
    );

    assert.equal(
      result.assignment?.topic,
      "AI economics",
    );
  },
);

test(
  "bridge preserves mission objectives and questions",
  async () => {
    const store = await createStore();

    const mission = await store.create({
      topic: "AI economics",
      objectives: [
        "understand productivity",
        "understand employment",
      ],
      questions: [
        "what changes?",
        "what evidence exists?",
      ],
      depth: "advanced",
    });

    const bridge =
      new StudyMissionAgentBridge(store);

    const result =
      await bridge.createAssignment({
        mission_id: mission.id,
        agent_id: "SINK-02",
      });

    assert.ok(result.assignment);

    assert.deepEqual(
      result.assignment?.objectives,
      [
        "understand productivity",
        "understand employment",
      ],
    );

    assert.deepEqual(
      result.assignment?.questions,
      [
        "what changes?",
        "what evidence exists?",
      ],
    );
  },
);

test(
  "bridge does not execute research",
  async () => {
    const store = await createStore();

    const mission = await store.create({
      topic: "AI economics",
      depth: "intermediate",
    });

    const bridge =
      new StudyMissionAgentBridge(store);

    const result =
      await bridge.createAssignment({
        mission_id: mission.id,
        agent_id: "SINK-01",
      });

    assert.equal(result.accepted, true);
    assert.ok(result.assignment);

    assert.deepEqual(
      result.assignment?.expected_outputs,
      [
        "evidence-backed findings",
        "source references",
        "explicit uncertainties",
      ],
    );
  },
);

test(
  "missing mission is refused",
  async () => {
    const store = await createStore();

    const bridge =
      new StudyMissionAgentBridge(store);

    const result =
      await bridge.createAssignment({
        mission_id: "study-does-not-exist",
        agent_id: "SINK-01",
      });

    assert.equal(result.accepted, false);

    assert.equal(
      result.assignment,
      null,
    );
  },
);

test(
  "completed mission cannot receive new agent work",
  async () => {
    const store = await createStore();

    const mission = await store.create({
      topic: "AI economics",
      depth: "intermediate",
    });

    await store.complete(
      mission.id,
      {
        sources: [
          {
            id: "source-1",
            title: "Example source",
            locator: "https://example.com",
            accessed_at:
              new Date().toISOString(),
            agent_id: "SINK-01",
          },
        ],
        findings: [
          {
            id: "finding-1",
            claim: "Example finding",
            evidence: "Example evidence",
            source_ids: ["source-1"],
            agent_id: "SINK-01",
            confidence: 0.8,
            created_at:
              new Date().toISOString(),
          },
        ],
        outputs: [
          {
            id: "output-1",
            title: "Study output",
            content: "Example output",
            created_at:
              new Date().toISOString(),
            agent_id: "SINK-01",
          },
        ],
      },
    );

    const bridge =
      new StudyMissionAgentBridge(store);

    await assert.rejects(
      () =>
        bridge.createAssignment({
          mission_id: mission.id,
          agent_id: "SINK-02",
        }),
      /cannot receive new agent work while completed/,
    );
  },
);

test(
  "assignment summary exposes bounded authority",
  async () => {
    const store = await createStore();

    const mission = await store.create({
      topic: "AI economics",
      depth: "advanced",
    });

    const bridge =
      new StudyMissionAgentBridge(store);

    const result =
      await bridge.createAssignment({
        mission_id: mission.id,
        agent_id: "SINK-01",
      });

    assert.ok(result.assignment);

    const summary =
      summarizeStudyAgentAssignment(
        result.assignment!,
      );

    assert.match(
      summary,
      /AI economics/,
    );

    assert.match(
      summary,
      /EDUCATIONAL_ONLY/,
    );

    assert.match(
      summary,
      /SINK-01/,
    );
  },
);