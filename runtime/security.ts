import { createHash } from 'node:crypto';
import type { AgentDefinition, Approval, Budget, Run, Task } from './contracts.js';

export class ControlError extends Error {
  constructor(public readonly code: string, message: string = code) { super(message); this.name = 'ControlError'; }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function redact(text: string): string {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-(?:proj-)?[\w-]{8,}|gh[pousr]_[\w]{8,}|github_pat_[\w]{8,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|password|secret|token)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]');
}
export const TOOL_POLICY = Object.freeze({
  repo_read: {risk: 'LOW', executable: true}, repo_inventory: {risk: 'LOW', executable: true},
  deploy: {risk: 'HIGH', executable: false}, send_message: {risk: 'HIGH', executable: false},
  spend: {risk: 'HIGH', executable: false}, delete_data: {risk: 'HIGH', executable: false},
  merge: {risk: 'HIGH', executable: false}, credentials: {risk: 'HIGH', executable: false},
  branch_write: {risk: 'MEDIUM', executable: false},
} as const);
export type ToolName = keyof typeof TOOL_POLICY;
export function authorize(agent: AgentDefinition, task: Task, tool: string, approval?: Approval, argsHash = '', now = Date.now()): void {
  if (!Object.hasOwn(TOOL_POLICY, tool) || !agent.enabled || task.assigned_agent !== agent.id || agent.denied_tools.includes(tool) || !agent.allowed_tools.includes(tool) || !task.permissions.includes(tool)) throw new ControlError('UNAUTHORIZED_TOOL');
  const policy = TOOL_POLICY[tool as ToolName];
  if (policy.risk === 'HIGH') {
    if (!approval) throw new ControlError('APPROVAL_REQUIRED');
    if (approval.status === 'DENIED') throw new ControlError('HUMAN_REJECTED');
    if (approval.status !== 'GRANTED' || approval.decided_by !== 'TRISTAN' || approval.agent_id !== agent.id || approval.task_id !== task.task_id || approval.run_id !== task.run_id || approval.tool !== tool || approval.arguments_hash !== argsHash || approval.consumed || Date.parse(approval.expires_at) <= now) throw new ControlError('INVALID_APPROVAL');
  }
  if (!policy.executable) throw new ControlError('TOOL_NOT_IMPLEMENTED');
}
// Authority is supplied by the trusted operator transport, never by agent/tool JSON.
export function decideApproval(approval: Approval, actor: {kind: 'agent' | 'operator'; id: string}, granted: boolean, now: string): Approval {
  if (actor.kind !== 'operator' || actor.id !== 'TRISTAN' || approval.status !== 'PENDING' || Date.parse(approval.expires_at) <= Date.parse(now)) throw new ControlError('INVALID_APPROVER');
  return {...approval, status: granted ? 'GRANTED' : 'DENIED', decided_by: actor.id, decided_at: now};
}
export function enforceBudget(run: Pick<Run,'usage' | 'budget' | 'started_at'>, now: number, reserve = {tools: 0, tokens: 0, cost: 0}): void {
  const b = run.budget;
  if (run.usage.tool_calls + reserve.tools > b.max_tool_calls || run.usage.tokens + reserve.tokens > b.max_tokens || run.usage.estimated_cost_usd + reserve.cost > b.max_cost_usd || (run.started_at && now - Date.parse(run.started_at) >= b.max_wall_ms)) throw new ControlError('BUDGET_EXCEEDED');
}
export function validateGraph(tasks: Task[], budget: Budget): void {
  const map = new Map(tasks.map(t => [t.task_id, t]));
  if (map.size !== tasks.length || tasks.length > budget.max_children) throw new ControlError('CHILD_LIMIT');
  const visited = new Set<string>(); const active = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new ControlError('CIRCULAR_DEPENDENCY');
    if (visited.has(id)) return;
    const task = map.get(id); if (!task) throw new ControlError('MISSING_DEPENDENCY');
    active.add(id); for (const dep of task.dependencies) visit(dep); active.delete(id); visited.add(id);
  }
  for (const t of tasks) {
    visit(t.task_id); let depth = 0; let parent = t.parent_task_id; const ancestors = new Set([t.task_id]);
    while (parent) {
      if (ancestors.has(parent)) throw new ControlError('CIRCULAR_DELEGATION'); ancestors.add(parent);
      const p = map.get(parent); if (!p) throw new ControlError('MISSING_PARENT');
      depth++; if (depth > budget.max_depth) throw new ControlError('DEPTH_LIMIT'); parent = p.parent_task_id;
    }
  }
}
