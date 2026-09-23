import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export const AGENT_WORLD_SCHEMA_VERSION = 1 as const;

export const ObservationSchema = z.object({
  observation_id: z.string().min(1),
  citizen_id: z.string().min(1),
  created_at: z.string().datetime(),
  content: z.string().min(1).max(4_000),
}).strict();

export const LearningOutcomeSchema = z.object({
  learning_id: z.string().min(1),
  citizen_id: z.string().min(1),
  created_at: z.string().datetime(),
  subject: z.string().min(1).max(500),
  outcome: z.string().min(1).max(4_000),
}).strict();

export const RestRecordSchema = z.object({
  rest_id: z.string().min(1),
  citizen_id: z.string().min(1),
  created_at: z.string().datetime(),
}).strict();

export const ProjectProposalSchema = z.object({
  project_id: z.string().min(1),
  citizen_id: z.string().min(1),
  created_at: z.string().datetime(),
  objective: z.string().min(1).max(2_000),
  expected_outcome: z.string().min(1).max(2_000),
  status: z.literal('PROPOSED'),
}).strict();

export const ProjectContributionSchema = z.object({
  contribution_id: z.string().min(1),
  project_id: z.string().min(1),
  citizen_id: z.string().min(1),
  created_at: z.string().datetime(),
  contribution: z.string().min(1).max(4_000),
}).strict();

export const LakeYangeAgentWorldSchema = z.object({
  schema_version: z.literal(AGENT_WORLD_SCHEMA_VERSION),
  observations: z.array(ObservationSchema),
  learning_outcomes: z.array(LearningOutcomeSchema),
  rest_records: z.array(RestRecordSchema),
  project_proposals: z.array(ProjectProposalSchema),
  project_contributions: z.array(ProjectContributionSchema),
}).strict();

export type LakeYangeAgentWorld =
  z.infer<typeof LakeYangeAgentWorldSchema>;

export const EMPTY_LAKE_YANGE_AGENT_WORLD:
  LakeYangeAgentWorld = {
    schema_version: AGENT_WORLD_SCHEMA_VERSION,
    observations: [],
    learning_outcomes: [],
    rest_records: [],
    project_proposals: [],
    project_contributions: [],
  };

export class LakeYangeAgentWorldStore {
  public constructor(
    private readonly filePath: string =
      '.sink/lake-yange/agents/world.json',
  ) {}

  public async load(): Promise<LakeYangeAgentWorld> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return LakeYangeAgentWorldSchema.parse(
        JSON.parse(raw),
      );
    } catch (error) {
      const code =
        error &&
        typeof error === 'object' &&
        'code' in error
          ? error.code
          : undefined;

      if (code !== 'ENOENT') {
        throw error;
      }

      return EMPTY_LAKE_YANGE_AGENT_WORLD;
    }
  }

  public async save(
    worldInput: LakeYangeAgentWorld,
  ): Promise<void> {
    const world =
      LakeYangeAgentWorldSchema.parse(worldInput);

    await mkdir(dirname(this.filePath), {
      recursive: true,
    });

    const temporaryPath =
      `${this.filePath}.tmp`;

    await writeFile(
      temporaryPath,
      `${JSON.stringify(world, null, 2)}\n`,
      'utf8',
    );

    await rename(
      temporaryPath,
      this.filePath,
    );
  }
}
