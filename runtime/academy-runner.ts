import {
  mkdir,
  writeFile
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import {
  createHash
} from 'node:crypto';

import {
  bootstrapLakeYange
} from './lake-yange-bootstrap.js';

import {
  loadAcademyState,
  saveAcademyState
} from './academy-store.js';

import {
  runAcademyCycle
} from './academy-clock.js';

export type AcademyCycleReceipt = {
  receipt_id: string;
  cycle_at: string;

  settlement_id: string;
  generation: number;

  population_observed: number;
  students_before: number;
  students_after: number;
  students_enrolled: number;

  assignments_before: number;
  assignments_after: number;
  assignments_created: number;

  assignment_ids: string[];

  authority:
    'EDUCATIONAL_ONLY';

  model_calls: 0;
  external_actions: 0;
};

function receiptId(
  input: Omit<
    AcademyCycleReceipt,
    'receipt_id'
  >
): string {
  const digest =
    createHash('sha256')
      .update(
        JSON.stringify(input)
      )
      .digest('hex')
      .slice(0, 24);

  return `LY-ACADEMY-${digest}`;
}

export async function runPersistedAcademyCycle(
  options: {
    repositoryRoot?: string;
    now?: string;
  } = {}
): Promise<AcademyCycleReceipt> {
  const repositoryRoot =
    options.repositoryRoot ??
    process.cwd();

  const now =
    options.now ??
    new Date().toISOString();

  /*
   * Canonical Lake Yange state remains authoritative
   * for who actually exists.
   *
   * Bootstrap only creates the founding settlement if
   * canonical state does not yet exist.
   */
  const lake =
    await bootstrapLakeYange();

  const academyBefore =
    await loadAcademyState(
      repositoryRoot
    );

  const cycle =
    runAcademyCycle(
      academyBefore,
      lake.state.citizens,
      now
    );

  await saveAcademyState(
    repositoryRoot,
    cycle.state
  );

  const studentsBefore =
    academyBefore.students.length;

  const studentsAfter =
    cycle.state.students.length;

  const receiptWithoutId:
    Omit<
      AcademyCycleReceipt,
      'receipt_id'
    > = {
      cycle_at:
        now,

      settlement_id:
        lake.state.settlement_id,

      generation:
        lake.state.generation,

      population_observed:
        lake.state.citizens.length,

      students_before:
        studentsBefore,

      students_after:
        studentsAfter,

      students_enrolled:
        Math.max(
          0,
          studentsAfter -
            studentsBefore
        ),

      assignments_before:
        academyBefore.assignments
          .length,

      assignments_after:
        cycle.state.assignments
          .length,

      assignments_created:
        cycle.assignments_created
          .length,

      assignment_ids:
        cycle.assignments_created
          .map(
            assignment =>
              assignment.assignment_id
          ),

      authority:
        'EDUCATIONAL_ONLY',

      model_calls:
        0,

      external_actions:
        0
    };

  const receipt:
    AcademyCycleReceipt = {
      receipt_id:
        receiptId(
          receiptWithoutId
        ),

      ...receiptWithoutId
    };

  const receiptDirectory =
    join(
      repositoryRoot,
      '.sink',
      'lake-yange',
      'academy',
      'receipts'
    );

  await mkdir(
    receiptDirectory,
    {
      recursive: true,
      mode: 0o700
    }
  );

  const receiptPath =
    join(
      receiptDirectory,
      `${receipt.receipt_id}.json`
    );

  /*
   * wx = create only.
   *
   * The same receipt cannot silently replace
   * an existing Academy receipt.
   */
  await writeFile(
    receiptPath,
    `${JSON.stringify(
      receipt,
      null,
      2
    )}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    }
  );

  return receipt;
}

const invokedDirectly =
  process.argv[1]
    ?.replace(/\\/g, '/')
    .endsWith(
      '/runtime/academy-runner.ts'
    );

if (invokedDirectly) {
  const receipt =
    await runPersistedAcademyCycle();

  console.log(
    [
      'LAKE_YANGE_ACADEMY_CYCLE=COMPLETE',

      `RECEIPT_ID=${receipt.receipt_id}`,

      `SETTLEMENT=${receipt.settlement_id}`,

      `GENERATION=${receipt.generation}`,

      `POPULATION_OBSERVED=${receipt.population_observed}`,

      `STUDENTS_ENROLLED=${receipt.students_enrolled}`,

      `STUDENTS_TOTAL=${receipt.students_after}`,

      `ASSIGNMENTS_CREATED=${receipt.assignments_created}`,

      `ASSIGNMENTS_TOTAL=${receipt.assignments_after}`,

      `AUTHORITY=${receipt.authority}`,

      `MODEL_CALLS=${receipt.model_calls}`,

      `EXTERNAL_ACTIONS=${receipt.external_actions}`
    ].join('\n')
  );
}
