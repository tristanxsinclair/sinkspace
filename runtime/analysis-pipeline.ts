import type { WorkerOutput } from './contracts.js';
import { Blackboard } from './blackboard.js';
import { analyseBlackboard, type AnalystResult } from './analyst.js';

export interface AnalysisPipelineResult {
  analyst: AnalystResult;
  blackboard_entries: ReturnType<Blackboard['all']>;
}

export function runAnalysisPipeline(input: {
  run_id: string;
  task_id: string;
  scout_output: WorkerOutput;
  source_agent_id?: string;
  board?: Blackboard;
}): AnalysisPipelineResult {
  const board = input.board ?? new Blackboard();

  const sourceAgent =
    input.source_agent_id ?? 'SINK-01';

  for (const claim of input.scout_output.claims) {
    if (claim.classification === 'KNOWN') {
      if (claim.evidence_ids.length === 0) {
        throw new Error(
          `ANALYSIS_PIPELINE_INVALID_FACT: KNOWN claim ${claim.claim_id} has no evidence.`
        );
      }

      board.add({
        run_id: input.run_id,
        agent_id: sourceAgent,
        task_id: input.task_id,
        kind: 'FACT',
        content: claim.statement,
        evidence_ids: claim.evidence_ids
      });

      continue;
    }

    if (claim.classification === 'INFERRED') {
      board.add({
        run_id: input.run_id,
        agent_id: sourceAgent,
        task_id: input.task_id,
        kind: 'HYPOTHESIS',
        content: claim.statement,
        evidence_ids: claim.evidence_ids
      });

      continue;
    }

    board.add({
      run_id: input.run_id,
      agent_id: sourceAgent,
      task_id: input.task_id,
      kind: 'UNCERTAINTY',
      content: claim.statement,
      evidence_ids: claim.evidence_ids
    });
  }

  for (const uncertainty of input.scout_output.uncertainty) {
    board.add({
      run_id: input.run_id,
      agent_id: sourceAgent,
      task_id: input.task_id,
      kind: 'UNCERTAINTY',
      content: uncertainty
    });
  }

  const analyst = analyseBlackboard(
    board,
    input.run_id
  );

  return {
    analyst,
    blackboard_entries: board.all(input.run_id)
  };
}
