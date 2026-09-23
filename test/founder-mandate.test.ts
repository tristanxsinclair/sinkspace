import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  readFile,
  stat
} from 'node:fs/promises';

import {
  join
} from 'node:path';

import {
  tmpdir
} from 'node:os';

import {
  createFounderMandate,
  proposeMandateMission
} from '../runtime/founder-mandate.js';

import {
  FounderMandateStore
} from '../runtime/founder-mandate-store.js';

test(
  'Founder Mandate registration grants no execution authority',
  () => {
    const mandate =
      createFounderMandate(
        'Establish constitutional institutions for Lake Yange.',
        {
          issuedAt:
            '2026-09-19T00:00:00.000Z'
        }
      );

    assert.equal(
      mandate.status,
      'REGISTERED'
    );

    assert.equal(
      mandate.issued_by,
      'FOUNDER'
    );

    assert.deepEqual(
      mandate.proposed_missions,
      []
    );

    assert.deepEqual(
      mandate.implementation_evidence_refs,
      []
    );
  }
);

test(
  'planning creates a proposal without execution authority',
  () => {
    const mandate =
      createFounderMandate(
        'Establish a Mandate Register.',
        {
          issuedAt:
            '2026-09-19T00:00:00.000Z'
        }
      );

    const planned =
      proposeMandateMission(
        mandate,
        {
          title:
            'Create constitutional institution registry',

          objective:
            'Represent institutions and jurisdiction as typed persisted state.',

          target_system:
            'STATE_HOUSE'
        }
      );

    assert.equal(
      planned.status,
      'PLANNING'
    );

    assert.equal(
      planned.proposed_missions.length,
      1
    );

    assert.equal(
      planned.proposed_missions[0]
        ?.execution_authority,
      false
    );

    assert.deepEqual(
      planned.implementation_evidence_refs,
      []
    );
  }
);

test(
  'Mandate Store persists and reloads constitutional state',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-mandate-'
        )
      );

    const directory =
      join(
        root,
        'mandates'
      );

    const store =
      new FounderMandateStore(
        directory
      );

    const mandate =
      createFounderMandate(
        'Founding Mandate I',
        {
          issuedAt:
            '2026-09-19T00:00:00.000Z',

          constraints: [
            'No fabricated implementation claims.'
          ],

          reservedPowers: [
            'Founder approval for constitutional authority changes.'
          ],

          prohibitedActions: [
            'No autonomous authority escalation.'
          ]
        }
      );

    await store.save(mandate);

    const reopened =
      await store.load(
        mandate.mandate_id
      );

    assert.deepEqual(
      reopened,
      mandate
    );

    const path =
      join(
        directory,
        `${mandate.mandate_id}.json`
      );

    const raw =
      await readFile(
        path,
        'utf8'
      );

    assert.match(
      raw,
      /"status": "REGISTERED"/
    );

    const metadata =
      await stat(path);

    assert.equal(
      metadata.mode & 0o777,
      0o600
    );
  }
);

test(
  'registered mandate preserves original text by digest',
  () => {
    const text =
      'Founding Mandate I: Institutions and Society';

    const mandate =
      createFounderMandate(
        text,
        {
          issuedAt:
            '2026-09-19T00:00:00.000Z'
        }
      );

    assert.equal(
      mandate.original_text,
      text
    );

    assert.equal(
      mandate.original_text_sha256.length,
      64
    );
  }
);
