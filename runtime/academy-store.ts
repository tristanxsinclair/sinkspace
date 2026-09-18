import {
  mkdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';

import {
  dirname,
  join
} from 'node:path';

import { z } from 'zod';

import {
  AcademyAssignmentSchema,
  AcademyEvaluationSchema,
  AcademyStudentSchema
} from './academy.js';

import {
  AcademySubmissionSchema,
  AcademyGradeSchema,
  AcademyRemediationSchema,
  CapabilityRecordSchema,
  AcademyResearchArtifactSchema
} from './academy-learning.js';

export const AcademyStateSchema =
  z.object({
    version:
      z.literal(2),

    students:
      z.array(
        AcademyStudentSchema
      ),

    assignments:
      z.array(
        AcademyAssignmentSchema
      ),

    evaluations:
      z.array(
        AcademyEvaluationSchema
      ),

    submissions:
      z.array(
        AcademySubmissionSchema
      ),

    grades:
      z.array(
        AcademyGradeSchema
      ),

    remediations:
      z.array(
        AcademyRemediationSchema
      ),

    capability_records:
      z.array(
        CapabilityRecordSchema
      ),

    research_artifacts:
      z.array(
        AcademyResearchArtifactSchema
      ),

    last_cycle_at:
      z.string()
        .datetime()
        .nullable()
  })
  .strict();

export type AcademyState =
  z.infer<
    typeof AcademyStateSchema
  >;

const LegacyAcademyStateSchema =
  z.object({
    version:
      z.literal(1),

    students:
      z.array(
        AcademyStudentSchema
      ),

    assignments:
      z.array(
        AcademyAssignmentSchema
      ),

    evaluations:
      z.array(
        AcademyEvaluationSchema
      ),

    last_cycle_at:
      z.string()
        .datetime()
        .nullable()
  })
  .strict();

export function emptyAcademyState():
  AcademyState {
  return {
    version: 2,

    students: [],
    assignments: [],
    evaluations: [],

    submissions: [],
    grades: [],
    remediations: [],
    capability_records: [],
    research_artifacts: [],

    last_cycle_at:
      null
  };
}

function migrateAcademyState(
  input: unknown
): AcademyState {
  const current =
    AcademyStateSchema
      .safeParse(input);

  if (current.success) {
    return current.data;
  }

  const legacy =
    LegacyAcademyStateSchema
      .safeParse(input);

  if (!legacy.success) {
    throw new Error(
      'ACADEMY_STATE_INVALID'
    );
  }

  return AcademyStateSchema.parse({
    ...legacy.data,

    version: 2,

    submissions: [],
    grades: [],
    remediations: [],
    capability_records: [],
    research_artifacts: []
  });
}

export function academyStatePath(
  repositoryRoot: string
): string {
  return join(
    repositoryRoot,
    '.sink',
    'lake-yange',
    'academy',
    'state.json'
  );
}

export async function loadAcademyState(
  repositoryRoot: string
): Promise<AcademyState> {
  const path =
    academyStatePath(
      repositoryRoot
    );

  try {
    const raw =
      await readFile(
        path,
        'utf8'
      );

    return migrateAcademyState(
      JSON.parse(raw)
    );
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return emptyAcademyState();
    }

    throw error;
  }
}

export async function saveAcademyState(
  repositoryRoot: string,
  input: AcademyState
): Promise<void> {
  const state =
    AcademyStateSchema.parse(
      input
    );

  const path =
    academyStatePath(
      repositoryRoot
    );

  await mkdir(
    dirname(path),
    {
      recursive: true,
      mode: 0o700
    }
  );

  const temporary =
    `${path}.tmp`;

  await writeFile(
    temporary,
    `${JSON.stringify(
      state,
      null,
      2
    )}\n`,
    {
      encoding: 'utf8',
      mode: 0o600
    }
  );

  await rename(
    temporary,
    path
  );
}
