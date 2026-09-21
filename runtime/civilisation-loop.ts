import {
  runLiveAcademy
} from './academy-live.js';

export type CivilisationCycle = {
  attempted: number;
  graded: number;
  passed: number;
  failed: number;
  assignments_created?: number;
  authority: 'EDUCATIONAL_ONLY';
  external_llm_calls: 0;
  economic_fitness_created: 0;
};

export type CivilisationLoopResult = {
  status: 'COMPLETED' | 'STOPPED';
  cycles_requested: number;
  cycles_completed: number;
  total_attempted: number;
  total_graded: number;
  total_passed: number;
  failures: Array<{ cycle: number; reason: string }>;
  authority: 'EDUCATIONAL_ONLY';
  external_actions: 0;
};

const MAX_CYCLES = 96;
const MAX_INTERVAL_MS = 86_400_000;

function wait(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Bounded, local-only supervisor for the civilisation's learning life cycle.
 * It may enrol, assign, learn and independently grade. It cannot execute
 * missions, spend, contact anyone, access secrets or alter authority.
 */
export async function runCivilisationLoop(
  options: {
    cycles?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    runCycle?: () => Promise<CivilisationCycle>;
  } = {}
): Promise<CivilisationLoopResult> {
  const cycles =
    options.cycles ?? 1;
  const intervalMs =
    options.intervalMs ?? 0;

  if (
    !Number.isInteger(cycles) ||
    cycles < 1 ||
    cycles > MAX_CYCLES
  ) {
    throw new Error('CIVILISATION_LOOP_CYCLES_INVALID');
  }

  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < 0 ||
    intervalMs > MAX_INTERVAL_MS
  ) {
    throw new Error('CIVILISATION_LOOP_INTERVAL_INVALID');
  }

  const runCycle =
    options.runCycle ??
    (() => runLiveAcademy());

  let completed = 0;
  let attempted = 0;
  let graded = 0;
  let passed = 0;
  const failures: Array<{ cycle: number; reason: string }> = [];

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    if (options.signal?.aborted) {
      return {
        status: 'STOPPED',
        cycles_requested: cycles,
        cycles_completed: completed,
        total_attempted: attempted,
        total_graded: graded,
        total_passed: passed,
        failures,
        authority: 'EDUCATIONAL_ONLY',
        external_actions: 0
      };
    }

    try {
      const result = await runCycle();
      completed += 1;
      attempted += result.attempted;
      graded += result.graded;
      passed += result.passed;
    } catch (error) {
      failures.push({
        cycle,
        reason: error instanceof Error ? error.message : 'UNKNOWN_CYCLE_FAILURE'
      });
    }

    if (cycle < cycles && !options.signal?.aborted) {
      await wait(intervalMs, options.signal);
    }
  }

  return {
    status: options.signal?.aborted ? 'STOPPED' : 'COMPLETED',
    cycles_requested: cycles,
    cycles_completed: completed,
    total_attempted: attempted,
    total_graded: graded,
    total_passed: passed,
    failures,
    authority: 'EDUCATIONAL_ONLY',
    external_actions: 0
  };
}

const invokedDirectly =
  process.argv[1]
    ?.replace(/\\/g, '/')
    .endsWith('/runtime/civilisation-loop.ts');

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const cycles = Number(
    option('--cycles') ??
    process.env.SINK_CIVILISATION_CYCLES ??
    '1'
  );
  const intervalMs = Number(
    option('--interval-ms') ??
    process.env.SINK_CIVILISATION_INTERVAL_MS ??
    '0'
  );
  const result = await runCivilisationLoop({ cycles, intervalMs });
  console.log(JSON.stringify(result, null, 2));
}
