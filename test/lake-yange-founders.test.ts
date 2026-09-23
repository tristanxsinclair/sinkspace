import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ZERO_AUTHORITY
} from '../runtime/lake-yange.js';

import {
  createFoundingLakeYange,
  findCitizenBySystemId
} from '../runtime/lake-yange-founders.js';

test(
  'Lake Yange has the expected founding population',
  () => {
    const state =
      createFoundingLakeYange();

    assert.equal(
      state.citizens.length,
      9
    );

    assert.equal(
      state.generation,
      0
    );

    const ids =
      state.citizens.map(
        (citizen) =>
          citizen.system_id
      );

    assert.deepEqual(
      ids,
      [
        'SINK-PRIME',
        'SINK-00',
        'SINK-01',
        'SINK-02',
        'SINK-03',
        'RED-SINK',
        'SINK-04',
        'SINK-05',
        'SINK-06'
      ]
    );
  }
);

test(
  'Prime is Steward of Lake Yange',
  () => {
    const state =
      createFoundingLakeYange();

    const prime =
      findCitizenBySystemId(
        state,
        'SINK-PRIME'
      );

    assert.ok(prime);

    assert.equal(
      prime.name,
      'Prime'
    );

    assert.equal(
      prime.rank,
      'STEWARD'
    );

    assert.equal(
      prime.home,
      'PRIME_TOWER'
    );
  }
);

test(
  'existing runtime identities receive Lake Yange names',
  () => {
    const state =
      createFoundingLakeYange();

    const expected = {
      'SINK-00': 'Marshal',
      'SINK-01': 'Atlas',
      'SINK-02': 'Scribe',
      'SINK-03': 'Vera',
      'RED-SINK': 'Rook',
      'SINK-04': 'Scout',
      'SINK-05': 'Ledger',
      'SINK-06': 'Ember'
    };

    for (
      const [
        systemId,
        name
      ] of Object.entries(expected)
    ) {
      assert.equal(
        findCitizenBySystemId(
          state,
          systemId
        )?.name,
        name
      );
    }
  }
);

test(
  'citizen permissions remain bounded',
  () => {
    const state =
      createFoundingLakeYange();

    for (
      const citizen of
      state.citizens
    ) {
      assert.equal(
        citizen.authority
          .deploy_production,
        false
      );

      assert.equal(
        citizen.authority
          .contact_external_people,
        false
      );

      assert.equal(
        citizen.authority
          .spend_money,
        false
      );

      assert.equal(
        citizen.authority
          .access_secrets,
        false
      );

      assert.equal(
        citizen.authority
          .destructive_operations,
        false
      );

      assert.equal(
        citizen.authority
          .modify_authority_kernel,
        false
      );

      assert.equal(
        citizen.authority
          .grant_authority,
        false
      );
    }
  }
);

test(
  'Prime does not secretly receive operational authority',
  () => {
    const state =
      createFoundingLakeYange();

    const prime =
      findCitizenBySystemId(
        state,
        'SINK-PRIME'
      );

    assert.ok(prime);

    assert.deepEqual(
      prime.authority,
      ZERO_AUTHORITY
    );
  }
);

test(
  'Vera receives only evidence-gathering authority',
  () => {
    const state =
      createFoundingLakeYange();

    const vera =
      findCitizenBySystemId(
        state,
        'SINK-03'
      );

    assert.ok(vera);

    assert.equal(
      vera.authority
        .read_repository,
      true
    );

    assert.equal(
      vera.authority
        .use_public_network,
      true
    );

    assert.equal(
      vera.authority
        .modify_repository,
      false
    );
  }
);

test(
  'founding state reserves capacity for future generations',
  () => {
    const state =
      createFoundingLakeYange();

    assert.equal(
      state.population_limit,
      32
    );

    assert.equal(
      state.trainee_limit,
      8
    );

    assert.ok(
      state.citizens.length <
      state.population_limit
    );
  }
);
