import { z } from 'zod';

export const EngineeringMissionSchema =
  z.object({
    objective:
      z.string()
        .min(1)
        .max(20_000),

    repository_root:
      z.string()
        .min(1),

    allowed_paths:
      z.array(
        z.string().min(1)
      )
        .max(100)
        .default([
          'runtime',
          'console',
          'test'
        ]),

    forbidden_paths:
      z.array(
        z.string().min(1)
      )
        .max(100)
        .default([
          '.git',
          '.sink',
          '.env',
          'agents/registry.json',
          'runtime/security.ts'
        ]),

    verification_commands:
      z.array(
        z.enum([
          'TYPECHECK',
          'TEST',
          'EVAL',
          'BUILD'
        ])
      )
        .min(1)
        .max(4)
        .default([
          'TYPECHECK',
          'TEST'
        ]),

    max_files_changed:
      z.number()
        .int()
        .min(1)
        .max(20)
        .default(8),

    max_patch_bytes:
      z.number()
        .int()
        .min(1)
        .max(1_000_000)
        .default(250_000),

    max_model_calls:
      z.number()
        .int()
        .min(1)
        .max(10)
        .default(3),

    max_wall_time_ms:
      z.number()
        .int()
        .min(1_000)
        .max(30 * 60 * 1000)
        .default(5 * 60 * 1000),

    allow_network:
      z.literal(false)
        .default(false),

    allow_dependency_install:
      z.literal(false)
        .default(false),

    allow_production_deploy:
      z.literal(false)
        .default(false),

    allow_external_messages:
      z.literal(false)
        .default(false),

    allow_credentials:
      z.literal(false)
        .default(false),

    allow_destructive_operations:
      z.literal(false)
        .default(false),

    require_vera:
      z.literal(true)
        .default(true),

    require_rook:
      z.literal(true)
        .default(true)
  })
  .strict();

export type EngineeringMission =
  z.infer<
    typeof EngineeringMissionSchema
  >;

export function engineeringPathAllowed(
  missionInput: EngineeringMission,
  pathInput: string
): boolean {
  const mission =
    EngineeringMissionSchema.parse(
      missionInput
    );

  const path =
    pathInput
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '');

  if (
    !path ||
    path.startsWith('/') ||
    path.split('/').includes('..')
  ) {
    return false;
  }

  const matches =
    (
      candidate: string,
      prefix: string
    ) =>
      candidate === prefix ||
      candidate.startsWith(
        `${prefix}/`
      );

  if (
    mission.forbidden_paths.some(
      forbidden =>
        matches(
          path,
          forbidden.replace(
            /\/+$/,
            ''
          )
        )
    )
  ) {
    return false;
  }

  return mission.allowed_paths.some(
    allowed =>
      matches(
        path,
        allowed.replace(
          /\/+$/,
          ''
        )
      )
  );
}
