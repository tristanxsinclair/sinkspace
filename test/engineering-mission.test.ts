import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EngineeringMissionSchema,
  engineeringPathAllowed
} from '../runtime/engineering-mission.js';

import {
  FORGE_IDENTITY,
  createForgeCitizen
} from '../runtime/forge.js';

function mission() {
  return EngineeringMissionSchema.parse({
    objective:
      'Improve Lake Yange status display.',

    repository_root:
      '/tmp/lake-yange'
  });
}

test(
  'engineering mission defaults to bounded local authority',
  () => {
    const value =
      mission();

    assert.equal(
      value.allow_network,
      false
    );

    assert.equal(
      value.allow_dependency_install,
      false
    );

    assert.equal(
      value.allow_production_deploy,
      false
    );

    assert.equal(
      value.allow_external_messages,
      false
    );

    assert.equal(
      value.allow_credentials,
      false
    );

    assert.equal(
      value.allow_destructive_operations,
      false
    );

    assert.equal(
      value.require_vera,
      true
    );

    assert.equal(
      value.require_rook,
      true
    );
  }
);

test(
  'engineering mission allows only declared source areas',
  () => {
    const value =
      mission();

    assert.equal(
      engineeringPathAllowed(
        value,
        'runtime/example.ts'
      ),
      true
    );

    assert.equal(
      engineeringPathAllowed(
        value,
        'console/app.js'
      ),
      true
    );

    assert.equal(
      engineeringPathAllowed(
        value,
        'package.json'
      ),
      false
    );

    assert.equal(
      engineeringPathAllowed(
        value,
        '../outside.ts'
      ),
      false
    );
  }
);

test(
  'security and runtime state remain forbidden',
  () => {
    const value =
      mission();

    assert.equal(
      engineeringPathAllowed(
        value,
        'runtime/security.ts'
      ),
      false
    );

    assert.equal(
      engineeringPathAllowed(
        value,
        '.sink/state.json'
      ),
      false
    );

    assert.equal(
      engineeringPathAllowed(
        value,
        'agents/registry.json'
      ),
      false
    );
  }
);

test(
  'Forge has stable Lake Yange identity',
  () => {
    assert.deepEqual(
      FORGE_IDENTITY,
      {
        system_id:
          'LY-FORGE-001',

        name:
          'Forge',

        role:
          'Software Engineer',

        home:
          'BUILDERS_QUARTER'
      }
    );
  }
);

test(
  'Forge can engineer locally but has no high-consequence authority',
  () => {
    const forge =
      createForgeCitizen(
        '2026-09-19T00:00:00.000Z'
      );

    assert.equal(
      forge.authority
        .read_repository,
      true
    );

    assert.equal(
      forge.authority
        .modify_repository,
      true
    );

    assert.equal(
      forge.authority
        .run_local_commands,
      true
    );

    assert.equal(
      forge.authority
        .create_branch,
      true
    );

    assert.equal(
      forge.authority
        .deploy_production,
      false
    );

    assert.equal(
      forge.authority
        .contact_external_people,
      false
    );

    assert.equal(
      forge.authority
        .spend_money,
      false
    );

    assert.equal(
      forge.authority
        .access_secrets,
      false
    );

    assert.equal(
      forge.authority
        .destructive_operations,
      false
    );

    assert.equal(
      forge.authority
        .modify_authority_kernel,
      false
    );

    assert.equal(
      forge.authority
        .grant_authority,
      false
    );
  }
);
