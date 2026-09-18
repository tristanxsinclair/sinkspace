import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  readFile,
  writeFile
} from 'node:fs/promises';

import {
  tmpdir
} from 'node:os';

import {
  join
} from 'node:path';

import {
  createExecutionClaim,
  createExecutionResult,
  verifyExecutionClaim
} from '../runtime/constitutional-execution.js';

import {
  ConstitutionalExecutionStore
} from '../runtime/constitutional-execution-store.js';

function spec() {
  return {
    schema_version:
      1 as const,

    target_path:
      'runtime/example.ts',

    operation:
      'CREATE' as const,

    expected_exports: [
      'example'
    ],

    verification_commands: [
      'TYPECHECK'
    ] as ['TYPECHECK'],

    max_files_changed:
      1 as const,

    network:
      false as const,

    credentials:
      false as const,

    external_messages:
      false as const,

    deployment:
      false as const,

    dependency_installation:
      false as const,

    destructive_operations:
      false as const
  };
}

function claim() {
  return createExecutionClaim(
    {
      authorization_id:
        'LY-AUTH-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',

      mandate_id:
        'LY-MANDATE-test',

      plan_id:
        'LY-PLAN-test',

      proposal_id:
        'LY-PROPOSAL-test',

      proposal_digest:
        'b'.repeat(64),

      engineering_spec:
        spec()
    },
    '2026-09-19T00:00:00.000Z'
  );
}

test(
  'execution claim binds one authorization to one exact engineering spec',
  () => {
    const value =
      claim();

    assert.equal(
      value.execution_number,
      1
    );

    assert.equal(
      value.engineering_spec.max_files_changed,
      1
    );

    assert.equal(
      value.engineering_spec.network,
      false
    );

    assert.equal(
      value.engineering_spec.verification_commands[0],
      'TYPECHECK'
    );
  }
);

test(
  'same authorization cannot create a second execution claim',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-claim-'
        )
      );

    const store =
      new ConstitutionalExecutionStore(
        root
      );

    const value =
      claim();

    await store.createClaim(
      value
    );

    await assert.rejects(
      () =>
        store.createClaim(
          value
        ),
      error =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST'
    );
  }
);

test(
  'tampered engineering spec invalidates execution claim',
  () => {
    const value =
      claim();

    const tampered = {
      ...value,

      engineering_spec: {
        ...value.engineering_spec,
        target_path:
          'runtime/other.ts'
      }
    };

    assert.throws(
      () =>
        verifyExecutionClaim(
          tampered
        ),
      /CONSTITUTIONAL_ENGINEERING_SPEC_DIGEST_INVALID|CONSTITUTIONAL_CLAIM_DIGEST_INVALID/
    );
  }
);

test(
  'persisted tampered claim is rejected on reload',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'ly-claim-tamper-'
        )
      );

    const store =
      new ConstitutionalExecutionStore(
        root
      );

    const value =
      claim();

    await store.createClaim(
      value
    );

    const path =
      join(
        root,
        'claims',
        `${value.claim_id}.json`
      );

    const raw =
      JSON.parse(
        await readFile(
          path,
          'utf8'
        )
      );

    raw.engineering_spec.target_path =
      'runtime/tampered.ts';

    await writeFile(
      path,
      `${JSON.stringify(
        raw,
        null,
        2
      )}\n`,
      'utf8'
    );

    await assert.rejects(
      () =>
        store.loadClaim(
          value.claim_id
        ),
      /CONSTITUTIONAL_ENGINEERING_SPEC_DIGEST_INVALID|CONSTITUTIONAL_CLAIM_DIGEST_INVALID/
    );
  }
);

test(
  'execution result remains non-promoting even when verified',
  () => {
    const value =
      claim();

    const result =
      createExecutionResult(
        {
          claim_id:
            value.claim_id,

          authorization_id:
            value.authorization_id,

          engineering_receipt_id:
            'receipt-test',

          status:
            'VERIFIED',

          vera:
            'PASS',

          rook:
            'PASS'
        },
        '2026-09-19T00:01:00.000Z'
      );

    assert.equal(
      result.status,
      'VERIFIED'
    );

    assert.equal(
      result.promotion,
      'NOT_AUTHORIZED'
    );
  }
);
