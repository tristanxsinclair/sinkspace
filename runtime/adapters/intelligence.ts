import type { ExecutionContext } from '../context.js';
import type { Task, WorkerOutput } from '../contracts.js';

export interface CommanderInput {
  objective: string;
  availableAgents: Array<{
    id: string;
    capabilities: string[];
  }>;
}

export interface CommanderTaskPlan {
  objective: string;
  specialist: string;
  dependencies: string[];
  successCriteria: string[];
  permissions: string[];
}

export interface CommanderOutput {
  interpretation: string;
  tasks: CommanderTaskPlan[];
  stopConditions: string[];
  humanApprovalRequired: boolean;
}

export interface BuilderOutput {
  report: string;
  uncertainty: string[];
}

export interface IntelligenceAdapter {
  readonly name: string;

  plan(input: CommanderInput): Promise<CommanderOutput>;

  research(
    ctx: ExecutionContext,
    task: Task
  ): Promise<WorkerOutput>;

  build(
    ctx: ExecutionContext,
    task: Task,
    research: WorkerOutput
  ): Promise<BuilderOutput>;
}
