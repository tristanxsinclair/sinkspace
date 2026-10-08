import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CapabilityRegistry } from '../runtime/capabilities.js';
import { DEFAULT_BUDGET, RunSchema, TaskSchema, type Event } from '../runtime/contracts.js';
import { loadRegistry } from '../runtime/registry.js';
import { coreWorkflowRegistry } from '../runtime/workflow-registry.js';
import { ControlError } from '../runtime/security.js';
import type { ExecutionContext } from '../runtime/context.js';

const now = '2026-10-03T00:00:00.000Z';

function task(assignedAgent: string, requirements: string[], permissions: string[]) {
  return TaskSchema.parse({
    task_id: 'task_test',
    parent_task_id: null,
    run_id: 'run_test',
    objective: 'Verify scoped capability discovery.',
    success_criteria: ['Only authorized capabilities are discoverable.'],
    assigned_agent: assignedAgent,
    agent_version: '0.2.0',
    status: 'RUNNING',
    priority: 0,
    dependencies: [],
    inputs: [],
    constraints: [],
    permissions,
    capability_requirements: requirements,
    budget: {...DEFAULT_BUDGET},
    created_at: now,
    started_at: now,
    completed_at: null,
    artifacts: [],
    evidence: [],
    uncertainty: [],
    errors: [],
    verification_status: 'UNVERIFIED',
    auditor: null,
    next_action: 'Execute bounded task.',
    attempts: 1
  });
}

test('capability plugins register and discovery enforces agent, task, and permission boundaries', async () => {
  const registry = new CapabilityRegistry();
  const definition = {
    id: 'fixture_summary',
    name: 'Fixture summary',
    description: 'A test capability registered outside the core registry.',
    version: '1.0.0',
    risk: 'LOW' as const,
    required_permissions: ['repo_read'],
    resources: {max_tool_calls: 1, max_tokens: 0, max_cost_usd: 0},
    evidence_required: false,
    input_schema: z.strictObject({value: z.string()}),
    output_schema: z.string(),
    execute: ({value}: {value: string}) => value
  };
  registry.register(definition);

  const scout = loadRegistry().find(agent => agent.id === 'SINK-01')!;
  const pluginAgent = {...scout, capabilities: [...scout.capabilities, definition.id]};
  const authorizedTask = task(scout.id, [definition.id], ['repo_read']);
  assert.deepEqual(registry.discover(pluginAgent, authorizedTask).map(item => item.id), [definition.id]);
  assert.deepEqual(registry.discover(pluginAgent, task(scout.id, [], ['repo_read'])), []);

  const permissionDenied = {...pluginAgent, denied_tools: [...pluginAgent.denied_tools, 'repo_read']};
  assert.deepEqual(registry.discover(permissionDenied, authorizedTask), []);
  assert.throws(
    () => registry.discover(pluginAgent, task('SINK-03', [definition.id], ['repo_read'])),
    error => error instanceof ControlError && error.code === 'AUTHORITY_CONTEXT_MISMATCH'
  );
  assert.throws(
    () => registry.register(definition),
    error => error instanceof ControlError && error.code === 'DUPLICATE_CAPABILITY'
  );

  const failingDefinition = {
    ...definition,
    id: 'fixture_failure',
    name: 'Fixture failure',
    execute: () => {
      throw new Error('fixture executor failure');
    }
  };
  registry.register(failingDefinition);
  const agent = {...pluginAgent, capabilities: [...pluginAgent.capabilities, failingDefinition.id]};
  const runnableTask = task(agent.id, [definition.id, failingDefinition.id], ['repo_read']);
  const run = RunSchema.parse({
    schema_version: '1.0.0',
    run_id: runnableTask.run_id,
    objective: 'Run a registered plugin capability.',
    workflow: 'capability-inventory',
    mission: null,
    adapter: 'test',
    status: 'RUNNING',
    commit_sha: 'a'.repeat(40),
    repository: '/fixture',
    created_at: now,
    started_at: now,
    completed_at: null,
    tasks: [runnableTask],
    artifacts: [],
    evidence: [],
    claims: [],
    verification: [],
    blackboard_entries: [],
    memories: [],
    revenue_ledger: null,
    approvals: [],
    events: [],
    errors: [],
    uncertainty: [],
    red_sink_findings: [],
    usage: {tool_calls: 0, tokens: 0, estimated_cost_usd: 0, model: null},
    budget: {...DEFAULT_BUDGET},
    agent_configs: loadRegistry().map(item => item.id === agent.id ? agent : item),
    receipt: null
  });
  const events: Event[] = [];
  const context: ExecutionContext = {
    run,
    task: runnableTask,
    now: () => now,
    id: () => 'id_test',
    read: async () => { throw new Error('unused'); },
    inventory: async () => { throw new Error('unused'); },
    artifact: () => { throw new Error('unused'); },
    emit: (type, summary, metadata = {}) => events.push({
      event_id: `event_${events.length}`,
      type,
      timestamp: now,
      agent_id: agent.id,
      task_id: runnableTask.task_id,
      summary,
      ...metadata
    })
  };
  assert.equal(await registry.execute(definition.id, {value: 'plugin executed'}, context), 'plugin executed');
  await assert.rejects(registry.execute(failingDefinition.id, {value: 'fail'}, context), /fixture executor failure/);
  assert.deepEqual(events.map(event => event.type), ['CAPABILITY_EXECUTED', 'CAPABILITY_FAILED']);
});

test('workflow definitions declare capability requirements outside the orchestrator', () => {
  const workflow = coreWorkflowRegistry().get('capability-inventory');
  assert.equal(workflow.version, '1.0.0');
  assert.deepEqual(workflow.steps[0].required_capabilities, [
    'repo_read',
    'repo_inventory',
    'mission_memory_write'
  ]);
  assert.deepEqual(workflow.steps[3].required_capabilities, ['repo_read', 'repo_inventory']);
  assert.deepEqual(workflow.steps[4].required_capabilities, ['repo_read', 'repo_inventory']);
});
