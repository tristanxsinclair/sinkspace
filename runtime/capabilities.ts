import { z } from 'zod';
import {
  AgentDefinitionSchema,
  ArtifactSchema,
  EvidenceSchema,
  Id,
  MemorySchema,
  RiskSchema,
  type AgentDefinition,
  type Task
} from './contracts.js';
import type { ExecutionContext, Observation } from './context.js';
import { RememberInputSchema } from './memory.js';
import { authorize, ControlError, enforceBudget, hash, TOOL_POLICY } from './security.js';
import { PublicResearchRequestSchema, PublicResearchResultSchema, type PublicResearchRequest } from './public-research.js';
import { SystemProbeSchema } from './system-probe.js';

const CapabilityResourcesSchema = z.strictObject({
  max_tool_calls: z.number().int().nonnegative(),
  max_tokens: z.number().int().nonnegative(),
  max_cost_usd: z.number().finite().nonnegative()
});
type Risk = z.infer<typeof RiskSchema>;

export const CapabilityDescriptorSchema = z.strictObject({
  id: Id,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  risk: RiskSchema,
  required_permissions: z.array(Id),
  resources: CapabilityResourcesSchema,
  evidence_required: z.boolean()
});

export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

export interface CapabilityDefinition<Input, Output> extends CapabilityDescriptor {
  input_schema: z.ZodType<Input>;
  output_schema: z.ZodType<Output>;
  execute(input: Input, context: ExecutionContext): Promise<Output> | Output;
  evidence_ids?(output: Output): string[];
}

interface RegisteredCapability {
  descriptor: CapabilityDescriptor;
  parseInput(value: unknown): unknown;
  execute(input: unknown, context: ExecutionContext): Promise<unknown>;
  parseOutput(value: unknown): unknown;
  evidenceIds(value: unknown): string[];
}

const riskRank: Record<Risk, number> = {LOW: 0, MEDIUM: 1, HIGH: 2};

export class CapabilityRegistry {
  private readonly definitions = new Map<string, RegisteredCapability>();

  register<Input, Output>(definition: CapabilityDefinition<Input, Output>): void {
    const descriptor = CapabilityDescriptorSchema.parse({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      version: definition.version,
      risk: definition.risk,
      required_permissions: definition.required_permissions,
      resources: definition.resources,
      evidence_required: definition.evidence_required
    });
    if (this.definitions.has(descriptor.id)) {
      throw new ControlError('DUPLICATE_CAPABILITY', descriptor.id);
    }

    for (const permission of descriptor.required_permissions) {
      if (!Object.hasOwn(TOOL_POLICY, permission)) {
        throw new ControlError('UNKNOWN_PERMISSION', permission);
      }
      const policy = TOOL_POLICY[permission as keyof typeof TOOL_POLICY];
      if (!policy) throw new ControlError('UNKNOWN_PERMISSION', permission);
      const permissionRisk = policy.risk;
      if (riskRank[descriptor.risk] < riskRank[permissionRisk]) {
        throw new ControlError('CAPABILITY_RISK_MISMATCH', descriptor.id);
      }
    }

    this.definitions.set(descriptor.id, {
      descriptor,
      parseInput: value => definition.input_schema.parse(value),
      execute: async (input, context) => await definition.execute(definition.input_schema.parse(input), context),
      parseOutput: value => definition.output_schema.parse(value),
      evidenceIds: value => definition.evidence_ids?.(definition.output_schema.parse(value)) ?? []
    });
  }

  list(): CapabilityDescriptor[] {
    return [...this.definitions.values()].map(({descriptor}) => structuredClone(descriptor));
  }

  discover(agent: AgentDefinition, task: Task): CapabilityDescriptor[] {
    const checkedAgent = AgentDefinitionSchema.parse(agent);
    if (task.assigned_agent !== checkedAgent.id) {
      throw new ControlError('AUTHORITY_CONTEXT_MISMATCH');
    }
    if (!checkedAgent.enabled) return [];

    return [...this.definitions.values()]
      .filter(({descriptor}) =>
        checkedAgent.capabilities.includes(descriptor.id) &&
        (!task.capability_requirements || task.capability_requirements.includes(descriptor.id)) &&
        descriptor.required_permissions.every(permission =>
          checkedAgent.allowed_tools.includes(permission) &&
          task.permissions.includes(permission) &&
          !checkedAgent.denied_tools.includes(permission)
        )
      )
      .map(({descriptor}) => structuredClone(descriptor));
  }

  async execute(id: string, input: unknown, context: ExecutionContext): Promise<unknown> {
    const registered = this.definitions.get(id);
    if (!registered) throw new ControlError('CAPABILITY_NOT_FOUND', id);
    let inputHash = hash(input);
    try {
      const agent = context.run.agent_configs.find(item => item.id === context.task.assigned_agent);
      if (!agent) throw new ControlError('MISSING_AGENT_CONFIGURATION');
      if (!this.discover(agent, context.task).some(item => item.id === id)) {
        throw new ControlError('CAPABILITY_UNAVAILABLE', id);
      }

      for (const permission of registered.descriptor.required_permissions) {
        authorize(agent, context.task, permission);
      }
      enforceBudget(context.run, Date.parse(context.now()), {
        tools: registered.descriptor.resources.max_tool_calls,
        tokens: registered.descriptor.resources.max_tokens,
        cost: registered.descriptor.resources.max_cost_usd
      });
      const parsedInput = registered.parseInput(input);
      inputHash = hash(parsedInput);
      const result = registered.parseOutput(await registered.execute(parsedInput, context));
      const evidenceIds = registered.evidenceIds(result);
      if (registered.descriptor.evidence_required && evidenceIds.length === 0) {
        throw new ControlError('CAPABILITY_EVIDENCE_REQUIRED', id);
      }
      context.emit(
        'CAPABILITY_EXECUTED',
        `${id}@${registered.descriptor.version} permission=${registered.descriptor.required_permissions.join(',') || 'agent-capability'} input_hash=${inputHash} output_hash=${hash(result)}`,
        {capability_id: id, evidence_ids: evidenceIds}
      );
      return result;
    } catch (error) {
      context.emit(
        'CAPABILITY_FAILED',
        `${id}@${registered.descriptor.version} permission=${registered.descriptor.required_permissions.join(',') || 'agent-capability'} input_hash=${inputHash} error=${error instanceof ControlError ? error.code : 'EXECUTOR_FAILURE'}`,
        {capability_id: id}
      );
      throw error;
    }
  }
}

export const ObservationSchema = z.strictObject({
  content: z.string(),
  evidence: EvidenceSchema,
  artifact: ArtifactSchema
});

const SystemProbeObservationSchema = ObservationSchema.extend({
  content: z.string().refine(content => {
    try {
      SystemProbeSchema.parse(JSON.parse(content));
      return true;
    } catch {
      return false;
    }
  }, 'INVALID_SYSTEM_PROBE_OUTPUT')
});

const PublicResearchObservationSchema = ObservationSchema.extend({
  content: z.string().refine(content => {
    try {
      PublicResearchResultSchema.parse(JSON.parse(content));
      return true;
    } catch {
      return false;
    }
  }, 'INVALID_PUBLIC_RESEARCH_OUTPUT')
});

export async function observeWithCapability(
  context: ExecutionContext,
  id: string,
  input: unknown,
  fallback: () => Promise<Observation>
): Promise<Observation> {
  if (!context.invokeCapability) return fallback();
  return ObservationSchema.parse(await context.invokeCapability(id, input));
}

export function publicResearchThroughCapability(context: ExecutionContext, request: PublicResearchRequest) {
  return observeWithCapability(context,'public_research',request,()=>{
    if (!context.publicResearch) throw new ControlError('CAPABILITY_UNAVAILABLE','public_research');
    return context.publicResearch(request);
  });
}

export function systemProbeThroughCapability(context: ExecutionContext) {
  return observeWithCapability(context,'system_probe',{},()=>{
    if (!context.systemProbe) throw new ControlError('CAPABILITY_UNAVAILABLE','system_probe');
    return context.systemProbe();
  });
}

async function publicResearchObservation(context: ExecutionContext, request: PublicResearchRequest) {
  if (!context.publicResearch) throw new ControlError('CAPABILITY_UNAVAILABLE', 'public_research');
  return context.publicResearch(request);
}

export function coreCapabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register({
    id: 'repo_read',
    name: 'Read pinned repository file',
    description: 'Read one allowlisted tracked file from the run pinned commit and record its evidence.',
    version: '1.0.0',
    risk: 'LOW',
    required_permissions: ['repo_read'],
    resources: {max_tool_calls: 1, max_tokens: 0, max_cost_usd: 0},
    evidence_required: true,
    input_schema: z.strictObject({path: z.string().min(1).max(300)}),
    output_schema: ObservationSchema,
    execute: (input, context) => context.read(input.path),
    evidence_ids: output => [output.evidence.evidence_id]
  });
  registry.register({
    id: 'repo_inventory',
    name: 'List pinned repository files',
    description: 'List the tracked files from the run pinned commit and record its evidence.',
    version: '1.0.0',
    risk: 'LOW',
    required_permissions: ['repo_inventory'],
    resources: {max_tool_calls: 1, max_tokens: 0, max_cost_usd: 0},
    evidence_required: true,
    input_schema: z.strictObject({}),
    output_schema: ObservationSchema,
    execute: (_input, context) => context.inventory(),
    evidence_ids: output => [output.evidence.evidence_id]
  });
  registry.register({
    id: 'system_probe',
    name: 'Inspect host system',
    description: 'Collect bounded host facts using the existing system probe and evidence path.',
    version: '1.0.0',
    risk: 'LOW',
    required_permissions: ['system_probe'],
    resources: {max_tool_calls: 1, max_tokens: 0, max_cost_usd: 0},
    evidence_required: true,
    input_schema: z.strictObject({}),
    output_schema: SystemProbeObservationSchema,
    execute: (_input, context) => {
      if (!context.systemProbe) throw new ControlError('CAPABILITY_UNAVAILABLE', 'system_probe');
      return context.systemProbe();
    },
    evidence_ids: output => [output.evidence.evidence_id]
  });
  registry.register({
    id: 'public_research',
    name: 'Research public sources',
    description: 'Search or fetch public sources through the bounded public-research adapter.',
    version: '1.0.0',
    risk: 'LOW',
    required_permissions: ['public_research'],
    resources: {max_tool_calls: 1, max_tokens: 0, max_cost_usd: 0},
    evidence_required: true,
    input_schema: PublicResearchRequestSchema,
    output_schema: PublicResearchObservationSchema,
    execute: (request, context) => publicResearchObservation(context, request),
    evidence_ids: output => [output.evidence.evidence_id]
  });
  registry.register({
    id: 'mission_memory_write',
    name: 'Write scoped mission memory',
    description: 'Store evidence-linked memory in the current run or the writing agent’s private working scope.',
    version: '1.0.0',
    risk: 'LOW',
    required_permissions: [],
    resources: {max_tool_calls: 0, max_tokens: 0, max_cost_usd: 0},
    evidence_required: true,
    input_schema: RememberInputSchema,
    output_schema: MemorySchema,
    execute: (input, context) => {
      if (!context.memory) throw new ControlError('MEMORY_UNAVAILABLE');
      return context.memory.remember(input);
    },
    evidence_ids: output => output.provenance
  });
  return registry;
}
