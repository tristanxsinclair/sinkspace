import {
  EngineeringMissionSchema
} from './engineering-mission.js';

import {
  LocalEngineeringIntelligence
} from './engineering-intelligence.js';

import {
  ModelCommons
} from './model-commons.js';

import {
  ModelCommonsTransport
} from './model-commons-transport.js';

import {
  LlamaCppLocalRuntime
} from './llama-cpp-local-runtime.js';

async function main() {
  const runtime =
    new LlamaCppLocalRuntime({
      baseUrl:
        'http://127.0.0.1:18181',

      timeoutMs:
        90_000
    });

  const commons =
    new ModelCommons(
      runtime
    );

  commons.register({
    model_id:
      'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M',

    name:
      'Forge Bootstrap 01',

    runtime:
      'llama.cpp',

    locality:
      'LOCAL',

    capabilities: [
      'CODING',
      'REASONING'
    ],

    context_tokens:
      4096,

    enabled:
      true,

    loaded:
      true,

    memory_class_gb:
      3,

    endpoint:
      'http://127.0.0.1:18181'
  });

  const transport =
    new ModelCommonsTransport(
      commons
    );

  const forge =
    new LocalEngineeringIntelligence(
      transport
    );

  const mission =
    EngineeringMissionSchema.parse({
      objective:
        [
          'Create one tiny browser-side Lake Yange utility.',
          'It must export a function named formatCitizenStatus.',
          'The function accepts a citizen name and status',
          'and returns the string "NAME — STATUS".',
          'Change exactly one file.'
        ].join(' '),

      repository_root:
        process.cwd(),

      allowed_paths: [
        'console'
      ],

      max_files_changed:
        1,

      max_patch_bytes:
        5_000,

      max_model_calls:
        1,

      verification_commands: [
        'TYPECHECK'
      ]
    });

  const proposal =
    await forge.propose(
      mission,
      [
        {
          path:
            'console/lake-yange.js',

          content:
            [
              '// Existing Lake Yange browser module.',
              '// Keep changes minimal.'
            ].join('\n')
        }
      ]
    );

  console.log(
    JSON.stringify(
      {
        proof:
          'LAKE_YANGE_REAL_NEURAL_FORGE',

        locality:
          forge.locality,

        intelligence:
          forge.name,

        proposal
      },
      null,
      2
    )
  );
}

main().catch(
  error => {
    console.error(
      'REAL_NEURAL_FORGE_FAILED'
    );

    console.error(
      error instanceof Error
        ? error.message
        : String(error)
    );

    process.exitCode = 1;
  }
);
