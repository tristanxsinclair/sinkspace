import { z } from 'zod';
import { Id, WorkflowSchema, type Workflow } from './contracts.js';
import { ControlError } from './security.js';

export const WorkflowStepSchema = z.strictObject({
  stage: z.enum(['RESEARCH', 'ANALYSIS', 'BUILD', 'AUDIT', 'CHALLENGE']),
  agent_capability: Id,
  objective: z.string().min(1).max(2000),
  required_capabilities: z.array(Id)
});

export const WorkflowDefinitionSchema = z.strictObject({
  id: WorkflowSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  steps: z.tuple([
    WorkflowStepSchema.extend({stage: z.literal('RESEARCH')}),
    WorkflowStepSchema.extend({stage: z.literal('ANALYSIS')}),
    WorkflowStepSchema.extend({stage: z.literal('BUILD')}),
    WorkflowStepSchema.extend({stage: z.literal('AUDIT')}),
    WorkflowStepSchema.extend({stage: z.literal('CHALLENGE')})
  ])
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export class WorkflowRegistry {
  private readonly definitions = new Map<Workflow, WorkflowDefinition>();

  register(input: WorkflowDefinition): void {
    const definition = WorkflowDefinitionSchema.parse(input);
    if (this.definitions.has(definition.id)) {
      throw new ControlError('DUPLICATE_WORKFLOW', definition.id);
    }
    this.definitions.set(definition.id, structuredClone(definition));
  }

  get(id: Workflow): WorkflowDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new ControlError('WORKFLOW_NOT_REGISTERED', id);
    return structuredClone(definition);
  }

  list(): WorkflowDefinition[] {
    return [...this.definitions.values()].map(definition => structuredClone(definition));
  }
}

export function coreWorkflowRegistry(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.register({
    id: 'capability-inventory',
    version: '1.0.0',
    steps: [
      {
        stage: 'RESEARCH',
        agent_capability: 'repository_research',
        objective: 'Inspect pinned repository evidence for visible capabilities',
        required_capabilities: ['repo_read', 'repo_inventory', 'mission_memory_write']
      },
      {
        stage: 'ANALYSIS',
        agent_capability: 'evidence_analysis',
        objective: 'Separate verified facts from inference and preserved uncertainty',
        required_capabilities: []
      },
      {
        stage: 'BUILD',
        agent_capability: 'report_artifact',
        objective: 'Create capability inventory artifacts from Scout evidence and Analyst structure',
        required_capabilities: []
      },
      {
        stage: 'AUDIT',
        agent_capability: 'independent_audit',
        objective: 'Independently verify inventory claims',
        required_capabilities: ['repo_read', 'repo_inventory']
      },
      {
        stage: 'CHALLENGE',
        agent_capability: 'adversarial_review',
        objective: 'Challenge evidence and scope',
        required_capabilities: ['repo_read', 'repo_inventory']
      }
    ]
  });
  return registry;
}
