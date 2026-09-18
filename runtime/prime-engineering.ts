import {
  runEngineeringMission,
  type EngineeringReceipt
} from './engineering-orchestrator.js';

export interface PrimeEngineeringCommand {
  objective: string;
  target_path: string;
  expected_exports: string[];
}

export interface PrimeEngineeringInterpretation {
  status:
    | 'ENGINEERING_READY'
    | 'NOT_ENGINEERING'
    | 'NEEDS_TARGET';

  reply: string;

  command?: PrimeEngineeringCommand;
}


function expectedExportsFromObjective(
  objective: string
): string[] {
  const names =
    new Set<string>();

  const pattern =
    /\bexport\s+(?:a\s+)?function\s+named\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gi;

  for (
    const match
    of objective.matchAll(pattern)
  ) {
    const name = match[1];

    if (name) {
      names.add(name);
    }
  }

  return [...names];
}

export function interpretPrimeEngineering(
  message: string
): PrimeEngineeringInterpretation {
  const trimmed =
    message.trim();

  if (
    !trimmed
      .toLowerCase()
      .startsWith('build:')
  ) {
    return {
      status:
        'NOT_ENGINEERING',

      reply:
        'Not an explicit engineering command.'
    };
  }

  const body =
    trimmed
      .slice(
        'build:'.length
      )
      .trim();

  const separator =
    body.indexOf('::');

  if (
    separator === -1
  ) {
    return {
      status:
        'NEEDS_TARGET',

      reply:
        'Engineering command needs a target path. Use: build: <objective> :: <repo-relative-path>'
    };
  }

  const objective =
    body
      .slice(
        0,
        separator
      )
      .trim();

  const targetPath =
    body
      .slice(
        separator + 2
      )
      .trim();

  if (
    !objective ||
    !targetPath
  ) {
    return {
      status:
        'NEEDS_TARGET',

      reply:
        'Use: build: <objective> :: <repo-relative-path>'
    };
  }

  return {
    status:
      'ENGINEERING_READY',

    reply:
      `Engineering mission ready for ${targetPath}.`,

    command: {
      objective,
      target_path:
        targetPath,
      expected_exports:
        expectedExportsFromObjective(
          objective
        )
    }
  };
}

export async function executePrimeEngineering(
  repositoryRoot: string,
  command: PrimeEngineeringCommand
): Promise<{
  reply: string;
  receipt: EngineeringReceipt;
}> {
  const receipt =
    await runEngineeringMission(
      repositoryRoot,
      command
    );

  if (
    receipt.status ===
    'VERIFIED'
  ) {
    return {
      reply:
        [
          'Workshop engineering completed.',
          `Target: ${receipt.target_path}`,
          'Vera: PASS',
          `Rook: ${receipt.rook}`,
          'TYPECHECK: PASS',
          'Canonical repository: UNCHANGED',
          'Promotion: NOT AUTHORIZED',
          `Receipt: ${receipt.receipt_id}`
        ].join('\n'),

      receipt
    };
  }

  return {
    reply:
      [
        'Workshop engineering rejected.',
        `Target: ${receipt.target_path}`,
        `Vera: ${receipt.vera}`,
        `Rook: ${receipt.rook}`,
        `Failure: ${receipt.failure ?? 'UNKNOWN'}`,
        'Canonical repository: UNCHANGED',
        `Receipt: ${receipt.receipt_id}`
      ].join('\n'),

    receipt
  };
}
