import { z } from 'zod';

import {
  ZERO_AUTHORITY,
  createFounderCitizen,
  type Citizen
} from './lake-yange.js';

export const FORGE_SYSTEM_ID =
  'LY-FORGE-001';

export const ForgeIdentitySchema =
  z.object({
    system_id:
      z.literal(
        FORGE_SYSTEM_ID
      ),

    name:
      z.literal('Forge'),

    role:
      z.literal(
        'Software Engineer'
      ),

    home:
      z.literal(
        'BUILDERS_QUARTER'
      )
  })
  .strict();

export const FORGE_IDENTITY =
  ForgeIdentitySchema.parse({
    system_id:
      FORGE_SYSTEM_ID,

    name:
      'Forge',

    role:
      'Software Engineer',

    home:
      'BUILDERS_QUARTER'
  });

export function createForgeCitizen(
  bornAt =
    new Date()
      .toISOString()
): Citizen {
  return createFounderCitizen({
    name:
      FORGE_IDENTITY.name,

    systemId:
      FORGE_IDENTITY.system_id,

    role:
      FORGE_IDENTITY.role,

    rank:
      'SPECIALIST',

    home:
      FORGE_IDENTITY.home,

    bornAt,

    genome: {
      genome_version: 1,

      traits: {
        research: 0.65,
        coding: 0.98,
        verification: 0.78,
        commercial: 0.30,
        planning: 0.82,
        adversarial: 0.55,
        ux: 0.72,
        orchestration: 0.62
      },

      capabilities: [
        'CODING',
        'TESTING',
        'PLANNING'
      ],

      strategies: [
        {
          id:
            'forge-isolated-worktree',

          description:
            'Modify only an isolated engineering worktree and never the canonical repository.',

          source:
            'FOUNDER'
        },

        {
          id:
            'forge-minimal-change',

          description:
            'Prefer the smallest change that satisfies the engineering objective and preserves existing behaviour.',

          source:
            'FOUNDER'
        },

        {
          id:
            'forge-no-self-certification',

          description:
            'Forge may implement and test but cannot independently certify its own completion.',

          source:
            'FOUNDER'
        }
      ],

      model_policy: {
        preferred_capabilities: [
          'CODING',
          'REASONING'
        ],

        max_cost_usd_per_mission:
          1,

        allowed_sensitivity:
          'INTERNAL'
      },

      tool_policy: {
        allowed_tools: [
          'engineering_read',
          'engineering_write',
          'engineering_diff',
          'engineering_typecheck',
          'engineering_test'
        ],

        denied_tools: [
          'deploy',
          'send_message',
          'spend',
          'delete_data',
          'credentials',
          'merge'
        ]
      }
    },

    authority: {
      ...ZERO_AUTHORITY,

      /**
       * Citizen authority is a ceiling.
       *
       * Actual engineering access is still
       * restricted by the mission and isolated
       * workspace.
       */
      read_repository: true,
      modify_repository: true,
      run_local_commands: true,
      create_branch: true
    }
  });
}
