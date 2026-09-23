import type { Blackboard } from './blackboard.js';

export interface AnalystResult {
  facts: string[];
  hypotheses: string[];
  uncertainties: string[];
  next_actions: string[];
}

export function analyseBlackboard(
  board: Blackboard,
  runId: string
): AnalystResult {

  const facts = board
    .byKind(runId, 'FACT')
    .map(entry => entry.content);

  const hypotheses = board
    .byKind(runId, 'HYPOTHESIS')
    .map(entry => entry.content);

  const uncertainties = board
    .byKind(runId, 'UNCERTAINTY')
    .map(entry => entry.content);

  const next_actions = board
    .byKind(runId, 'NEXT_ACTION')
    .map(entry => entry.content);

  return {
    facts,
    hypotheses,
    uncertainties,
    next_actions
  };
}
