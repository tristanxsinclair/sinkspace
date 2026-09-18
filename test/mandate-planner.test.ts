import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtemp,
  mkdir
} from 'node:fs/promises';

import {
  tmpdir
} from 'node:os';

import {
  join
} from 'node:path';

import {
  createFounderMandate
} from '../runtime/founder-mandate.js';

import {
  FounderMandateStore
} from '../runtime/founder-mandate-store.js';

import {
  createFoundingLakeYange
} from '../runtime/lake-yange-founders.js';

import {
  LakeYangeStore
} from '../runtime/lake-yange-store.js';

import {
  planFounderMandate
} from '../runtime/mandate-planner.js';

test(
  'planning a Founder Mandate proposes work without granting execution authority',
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          'lake-yange-plan-'
        )
      );

    await mkdir(
      join(
        root,
        '.sink/lake-yange/mandates'
      ),
      {
        recursive: true
      }
    );

    const mandate =
      createFounderMandate(
        'Establish durable Lake Yange institutions.'
      );

    const mandateStore =
      new FounderMandateStore(
        join(
          root,
          '.sink/lake-yange/mandates'
        )
      );

    await mandateStore.save(
      mandate
    );

    const lakeStore =
      new LakeYangeStore(
        join(
          root,
          '.sink/lake-yange/state.json'
        )
      );

    await lakeStore.save(
      createFoundingLakeYange()
    );

    const result =
      await planFounderMandate(
        root,
        mandate.mandate_id
      );

    assert.equal(
      result.plan.execution_authority,
      false
    );

    assert.equal(
      result.plan.executed,
      false
    );

    assert.equal(
      result.plan.proposal.status,
      'PROPOSED'
    );

    assert.equal(
      result.plan.proposal.execution_authority,
      false
    );

    const reloaded =
      await mandateStore.load(
        mandate.mandate_id
      );

    assert.equal(
      reloaded.status,
      'REGISTERED'
    );

    assert.equal(
      reloaded.proposed_missions.length,
      0
    );

    assert.equal(
      reloaded.implementation_evidence_refs.length,
      0
    );
  }
);
