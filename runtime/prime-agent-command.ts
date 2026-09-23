import { runLiveAcademy } from './academy-live.js';
import { runPersistedAcademyCycle, type AcademyCycleReceipt } from './academy-runner.js';

export type PrimeAgentCommand =
  | { kind: 'ACADEMY_CYCLE'; dryRun: boolean }
  | { kind: 'REPORT_WORK'; }
  | { kind: 'UNSUPPORTED'; reason: string };

export type PrimeAgentCommandResult = {
  status: 'COMPLETED' | 'UNSUPPORTED' | 'REQUIRES_APPROVAL' | 'FAILED';
  reply: string;
  command: PrimeAgentCommand;
  academy?: AcademyCycleReceipt | Record<string, unknown>;
};

export function interpretPrimeAgentCommand(input: string): PrimeAgentCommand {
  const normalized = input.trim().toLowerCase();
  if (/\b(what are|report|show|tell me)\b.*\b(agent|mission|work|doing|result)/i.test(normalized)) return { kind: 'REPORT_WORK' };
  if (/\b(run|continue|advance|start|cycle)\b.*\b(academy|learning|class|course)/i.test(normalized)) return { kind: 'ACADEMY_CYCLE', dryRun: false };
  if (/\b(research|investigate|study|analyse|analyze)\b/i.test(normalized)) return { kind: 'UNSUPPORTED', reason: 'Arbitrary topic research is not currently exposed as an executable Prime mission. The local Academy runtime supports its persisted curriculum only.' };
  return { kind: 'UNSUPPORTED', reason: 'Prime could not map that request to a supported bounded agent operation.' };
}

export async function executePrimeAgentCommand(repositoryRoot: string, input: string): Promise<PrimeAgentCommandResult> {
  const command = interpretPrimeAgentCommand(input);
  if (command.kind === 'UNSUPPORTED') return { status: 'UNSUPPORTED', reply: command.reason, command };
  if (command.kind === 'REPORT_WORK') return { status: 'COMPLETED', reply: 'I can report persisted work from the Operations and Mission views. No new execution was requested.', command };
  try {
    const academy = await runLiveAcademy({ repositoryRoot });
    return { status: 'COMPLETED', reply: `Academy cycle completed through the local runtime. ${academy.assignments_created} assignment(s) created; ${academy.passed} passed and ${academy.failed} failed.`, command, academy };
  } catch (error) {
    if (error instanceof Error && error.message === 'ACADEMY_LOCAL_MODEL_OFFLINE') return { status: 'UNSUPPORTED', reply: 'The local Academy model is offline. No agent work was executed.', command };
    return { status: 'FAILED', reply: error instanceof Error ? error.message : String(error), command };
  }
}

export async function executePrimePersistedAcademyCommand(repositoryRoot: string): Promise<PrimeAgentCommandResult> {
  const command: PrimeAgentCommand = { kind: 'ACADEMY_CYCLE', dryRun: false };
  const academy = await runPersistedAcademyCycle({ repositoryRoot });
  return { status: 'COMPLETED', reply: `Academy curriculum cycle persisted. Receipt ${academy.receipt_id}.`, command, academy };
}
