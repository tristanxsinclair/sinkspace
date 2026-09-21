import {
  LlamaCppLocalRuntime
} from './llama-cpp-local-runtime.js';

import {
  ModelCommons
} from './model-commons.js';

import {
  AcademyIntelligence
} from './academy-intelligence.js';

import {
  runNeuralAcademyCycle
} from './academy-neural-cycle.js';

import {
  runAcademyCycle
} from './academy-clock.js';

import {
  bootstrapLakeYange
} from './lake-yange-bootstrap.js';

import {
  loadAcademyState,
  saveAcademyState
} from './academy-store.js';

const MODEL_ID =
  'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M';

export async function runLiveAcademy(
  options: {
    repositoryRoot?: string;
    now?: string;
    baseUrl?: string;
  } = {}
) {
  const repositoryRoot =
    options.repositoryRoot ??
    process.cwd();

  const now =
    options.now ??
    new Date().toISOString();

  const runtime =
    new LlamaCppLocalRuntime({
      baseUrl:
        options.baseUrl ??
        'http://127.0.0.1:18181',

      timeoutMs:
        60_000
    });

  const healthy =
    await runtime.health();

  if (!healthy) {
    throw new Error(
      'ACADEMY_LOCAL_MODEL_OFFLINE'
    );
  }

  const commons =
    new ModelCommons(
      runtime
    );

  commons.register({
    model_id:
      MODEL_ID,

    name:
      'Qwen2.5 Coder 3B Instruct Q4_K_M',

    runtime:
      'llama.cpp',

    locality:
      'LOCAL',

    capabilities: [
      'REASONING',
      'RESEARCH'
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

  const intelligence =
    new AcademyIntelligence(
      commons
    );

  const before =
    await loadAcademyState(
      repositoryRoot
    );

  /*
   * Every live turn starts by enrolling current citizens and assigning the
   * next incomplete course. This makes a second turn productive rather than
   * merely re-reading a finished classroom.
   */
  const lake =
    await bootstrapLakeYange({
      repositoryRoot,
      foundedAt: now
    });

  const scheduled =
    runAcademyCycle(
      before,
      lake.state.citizens,
      now
    );

  const result =
    await runNeuralAcademyCycle(
      scheduled.state,
      intelligence,
      now
    );

  await saveAcademyState(
    repositoryRoot,
    result.state
  );

  return {
    model:
      MODEL_ID,

    cognition:
      'LOCAL' as const,

    students:
      result.state.students.length,

    assignments:
      result.state.assignments.length,

    assignments_created:
      scheduled.assignments_created.length,

    attempted:
      result.attempted,

    graded:
      result.graded,

    passed:
      result.passed,

    failed:
      result.failed,

    remediations_created:
      result.remediations_created,

    skipped_self_grading:
      result.skipped_self_grading,

    model_failures:
      result.model_failures,

    submissions_total:
      result.state.submissions.length,

    evaluations_total:
      result.state.evaluations.length,

    authority:
      'EDUCATIONAL_ONLY' as const,

    external_llm_calls:
      0,

    economic_fitness_created:
      0
  };
}

const invokedDirectly =
  process.argv[1]
    ?.replace(/\\/g, '/')
    .endsWith(
      '/runtime/academy-live.ts'
    );

if (invokedDirectly) {
  const result =
    await runLiveAcademy();

  console.log(
    [
      'LAKE_YANGE_NEURAL_ACADEMY=COMPLETE',

      `MODEL=${result.model}`,

      `COGNITION=${result.cognition}`,

      `STUDENTS=${result.students}`,

      `ASSIGNMENTS=${result.assignments}`,

      `ATTEMPTED=${result.attempted}`,

      `GRADED=${result.graded}`,

      `PASSED=${result.passed}`,

      `FAILED=${result.failed}`,

      `REMEDIATIONS_CREATED=${result.remediations_created}`,

      `SELF_GRADING_SKIPS=${result.skipped_self_grading.length}`,

      `MODEL_FAILURES=${result.model_failures.length}`,

      `SUBMISSIONS_TOTAL=${result.submissions_total}`,

      `EVALUATIONS_TOTAL=${result.evaluations_total}`,

      `AUTHORITY=${result.authority}`,

      `EXTERNAL_LLM_CALLS=${result.external_llm_calls}`,

      `ECONOMIC_FITNESS_CREATED=${result.economic_fitness_created}`
    ].join('\n')
  );

  if (
    result.model_failures
      .length > 0
  ) {
    console.log(
      'MODEL_FAILURE_DETAIL=' +
      JSON.stringify(
        result.model_failures
      )
    );
  }

  if (
    result.skipped_self_grading
      .length > 0
  ) {
    console.log(
      'SKIPPED_ASSIGNMENTS=' +
      result.skipped_self_grading
        .join(',')
    );
  }
}
