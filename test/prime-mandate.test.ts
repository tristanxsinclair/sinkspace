import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import {
  tmpdir
} from 'node:os';

import {
  FounderMandateStore
} from '../runtime/founder-mandate-store.js';

import {
  founderMandateRegisteredReply,
  interpretPrimeMandateAction,
  registerPrimeFounderMandate,
  registerPrimeFounderMandateFile
} from '../runtime/prime-mandate.js';

test(
  'ordinary Founder Mandate language does not automatically register',
  () => {
    const result =
      interpretPrimeMandateAction(
        'Founding Mandate I establishes institutions for Lake Yange.'
      );

    assert.equal(
      result.status,
      'NOT_MANDATE_ACTION'
    );
  }
);

test(
  'explicit register mandate action preserves supplied constitutional text',
  () => {
    const text =
      'Founding Mandate I establishes institutions and society.';

    const result =
      interpretPrimeMandateAction(
        `register mandate: ${text}`
      );

    assert.equal(
      result.status,
      'REGISTER_MANDATE'
    );

    if (
      result.status !==
      'REGISTER_MANDATE'
    ) {
      throw new Error(
        'expected registration action'
      );
    }

    assert.equal(
      result.original_text,
      text
    );
  }
);

test(
  'register mandate without text is clarification only',
  () => {
    const result =
      interpretPrimeMandateAction(
        'register mandate:'
      );

    assert.equal(
      result.status,
      'NEEDS_MANDATE_TEXT'
    );
  }
);

test(
  'Prime registration persists mandate without execution authority',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-prime-mandate-'
        )
      );

    const text =
      'Founding Mandate I establishes bounded constitutional institutions.';

    const mandate =
      await registerPrimeFounderMandate(
        root,
        text
      );

    assert.equal(
      mandate.status,
      'REGISTERED'
    );

    assert.equal(
      mandate.original_text,
      text
    );

    assert.deepEqual(
      mandate.proposed_missions,
      []
    );

    assert.deepEqual(
      mandate.implementation_evidence_refs,
      []
    );

    const store =
      new FounderMandateStore(
        `${root}/.sink/lake-yange/mandates`
      );

    const reopened =
      await store.load(
        mandate.mandate_id
      );

    assert.equal(
      reopened.original_text_sha256,
      mandate.original_text_sha256
    );

    const reply =
      founderMandateRegisteredReply(
        mandate
      );

    assert.match(
      reply,
      /Execution authority granted: NO/
    );
  }
);

test(
  'Prime recognises explicit canonical mandate file registration',
  () => {
    const result =
      interpretPrimeMandateAction(
        'register mandate file: docs/lake-yange/founding-mandate-i.txt'
      );

    assert.equal(
      result.status,
      'REGISTER_MANDATE_FILE'
    );

    if (
      result.status !==
      'REGISTER_MANDATE_FILE'
    ) {
      throw new Error(
        'expected mandate file registration'
      );
    }

    assert.equal(
      result.relative_path,
      'docs/lake-yange/founding-mandate-i.txt'
    );
  }
);

test(
  'canonical mandate file registration rejects path traversal',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-mandate-traversal-'
        )
      );

    await assert.rejects(
      () =>
        registerPrimeFounderMandateFile(
          root,
          '../outside.txt'
        ),
      /FOUNDER_MANDATE_FILE_NOT_ALLOWED/
    );
  }
);

test(
  'canonical mandate file registration rejects files outside constitutional directory',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-mandate-scope-'
        )
      );

    await assert.rejects(
      () =>
        registerPrimeFounderMandateFile(
          root,
          'README.txt'
        ),
      /FOUNDER_MANDATE_FILE_NOT_ALLOWED/
    );
  }
);
