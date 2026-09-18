import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import {
  AcademyAssignmentSchema,
  AcademyEvaluationSchema,
  AcademyStudentSchema
} from './academy.js';

export const AcademyStateSchema = z.object({
  version: z.literal(1),
  students: z.array(AcademyStudentSchema),
  assignments: z.array(AcademyAssignmentSchema),
  evaluations: z.array(AcademyEvaluationSchema),
  last_cycle_at: z.string().datetime().nullable()
}).strict();

export type AcademyState =
  z.infer<typeof AcademyStateSchema>;

export function emptyAcademyState(): AcademyState {
  return {
    version: 1,
    students: [],
    assignments: [],
    evaluations: [],
    last_cycle_at: null
  };
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
    academyStatePath(repositoryRoot);

  try {
    const raw =
      await readFile(path, 'utf8');

    return AcademyStateSchema.parse(
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
    AcademyStateSchema.parse(input);

  const path =
    academyStatePath(repositoryRoot);

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
    `${JSON.stringify(state, null, 2)}\n`,
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
