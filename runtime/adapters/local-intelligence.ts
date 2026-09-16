import type {
  BuilderOutput,
  CommanderInput,
  CommanderOutput,
  IntelligenceAdapter
} from './intelligence.js';

import type { ExecutionContext } from '../context.js';
import type { Task, WorkerOutput } from '../contracts.js';

import { scout } from '../specialists.js';

export const localIntelligenceAdapter: IntelligenceAdapter = {
  name: 'local-intelligence-v1',

  async plan(input: CommanderInput): Promise<CommanderOutput> {
    return {
      interpretation: input.objective,

      tasks: [
        {
          objective: input.objective,
          specialist: 'SINK-01',
          dependencies: [],
          successCriteria: [
            'Produce repository-grounded claims.',
            'Attach evidence to known claims.',
            'Preserve uncertainty.'
          ],
          permissions: ['repo_read', 'repo_inventory']
        }
      ],

      stopConditions: [
        'Required evidence is unavailable.',
        'A task requires human approval.',
        'Independent verification rejects completion.'
      ],

      humanApprovalRequired: false
    };
  },

  async research(
    ctx: ExecutionContext,
    _task: Task
  ): Promise<WorkerOutput> {
    return scout(ctx);
  },

  async build(
    _ctx: ExecutionContext,
    _task: Task,
    research: WorkerOutput
  ): Promise<BuilderOutput> {
    return {
      report: research.report,
      uncertainty: research.uncertainty
    };
  }
};
