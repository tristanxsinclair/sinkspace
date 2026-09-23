import { mkdir, readFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { hash } from './security.js';
import { FileRunStore, type RunStore } from './store.js';
import { projectLakeYangeWorld, type LakeYangeWorldProjection } from './lake-yange-world.js';
import type { Run } from './contracts.js';

const FindingSchema = z.strictObject({
  finding_id: z.string().min(1),
  observation_id: z.string().min(1),
  kind: z.enum(['FAILED_RUN', 'INCOMPLETE_EVIDENCE', 'SYSTEM_HEALTH', 'ATTENTION']),
  summary: z.string().min(1),
  source_id: z.string().min(1),
  risk_class: z.enum(['OBSERVATIONAL', 'LOW_RISK', 'BOUNDED_OPERATIONAL', 'ENGINEERING', 'HIGH_IMPACT'])
});
const ProposalSchema = z.strictObject({
  proposal_id: z.string().min(1),
  observation_id: z.string().min(1),
  finding_id: z.string().min(1),
  mission_type: z.string().min(1),
  objective: z.string().min(1),
  reason: z.string().min(1),
  proposed_agent: z.string().min(1),
  required_authority: z.string().min(1),
  risk_class: z.enum(['OBSERVATIONAL', 'LOW_RISK', 'BOUNDED_OPERATIONAL', 'ENGINEERING', 'HIGH_IMPACT'])
});
const DecisionSchema = z.strictObject({
  proposal_id: z.string().min(1),
  status: z.enum(['AUTHORIZED', 'DENIED', 'REQUIRES_APPROVAL']),
  reason: z.string().min(1),
  decided_at: z.string().datetime()
});
const ExecutionSchema = z.strictObject({
  proposal_id: z.string().min(1),
  status: z.enum(['NOT_EXECUTED', 'EXECUTING', 'COMPLETED', 'FAILED', 'BLOCKED', 'RECONCILED']),
  reason: z.string().min(1),
  run_id: z.string().nullable(),
  evidence_ids: z.array(z.string()),
  completed_at: z.string().datetime().nullable()
});
const ObservationSchema = z.strictObject({
  observation_id: z.string().min(1),
  observed_at: z.string().datetime(),
  projection_version: z.number().int(),
  settlement: z.object({ population: z.number(), generation: z.number(), institutions: z.number(), agents: z.number(), missions: z.number() }).strict(),
  attention_run_ids: z.array(z.string()),
  health: z.record(z.string(), z.string())
});
export const AutonomousCycleSchema = z.strictObject({
  cycle_id: z.string().min(1),
  status: z.enum(['COMPLETED', 'REQUIRES_APPROVAL', 'FAILED']),
  dry_run: z.boolean(),
  observation: ObservationSchema,
  findings: z.array(FindingSchema),
  proposals: z.array(ProposalSchema),
  authorization_decisions: z.array(DecisionSchema),
  executions: z.array(ExecutionSchema),
  verification_results: z.array(z.object({ proposal_id: z.string(), status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']), reason: z.string() }).strict()),
  outcomes: z.array(z.object({ proposal_id: z.string(), status: z.enum(['PENDING', 'COMMITTED', 'REJECTED']), reason: z.string() }).strict()),
  attention_items: z.array(z.string()),
  audit_receipts: z.array(z.string())
});
export type AutonomousCycle = z.infer<typeof AutonomousCycleSchema>;
export type AutonomousObservation = z.infer<typeof ObservationSchema>;
export type AutonomousProposal = z.infer<typeof ProposalSchema>;
export type AutonomousExecution = z.infer<typeof ExecutionSchema>;

export interface AutonomousExecutor {
  execute(proposal: AutonomousProposal): Promise<{ run_id: string; evidence_ids: string[] }>;
}
export interface AutonomousEngineDependencies {
  runStore?: RunStore;
  observe?: () => Promise<{ projection: LakeYangeWorldProjection; runs: Run[] }>;
  authorize?: (proposal: AutonomousProposal) => Promise<z.infer<typeof DecisionSchema>>;
  executor?: AutonomousExecutor;
  now?: () => Date;
  cycleRoot?: string;
}

function defaultObserve(repositoryRoot: string, runStore: RunStore) {
  return async () => ({
    projection: await projectLakeYangeWorld(repositoryRoot),
    runs: await runStore.list()
  });
}
function cycleDirectory(repositoryRoot: string, override?: string) { return override ?? join(repositoryRoot, '.sink/lake-yange/autonomous-cycles'); }
async function saveCycle(root: string, cycle: AutonomousCycle): Promise<void> { await mkdir(root, { recursive: true, mode: 0o700 }); const path = join(root, `${cycle.cycle_id}.json`); const temporary = `${path}.tmp`; await renameSafe(temporary, path, cycle); }
async function renameSafe(temporary: string, path: string, cycle: AutonomousCycle): Promise<void> { const { writeFile } = await import('node:fs/promises'); await writeFile(temporary, JSON.stringify(cycle, null, 2), { mode: 0o600 }); await rename(temporary, path); }
async function priorCycles(root: string): Promise<AutonomousCycle[]> { try { const names = (await readdir(root)).filter(name => name.endsWith('.json')); return await Promise.all(names.map(async name => AutonomousCycleSchema.parse(JSON.parse(await readFile(join(root, name), 'utf8'))))); } catch { return []; } }
function findings(observation: AutonomousObservation, runs: Run[]): z.infer<typeof FindingSchema>[] { return runs.flatMap(run => { if (!['FAILED', 'BLOCKED', 'CANCELLED'].includes(run.status)) return []; return [{ finding_id: hash(`FAILED_RUN:${run.run_id}`), observation_id: observation.observation_id, kind: 'FAILED_RUN' as const, summary: `Run ${run.run_id} requires review: ${run.status}.`, source_id: run.run_id, risk_class: 'OBSERVATIONAL' as const }]; }); }
function proposalsFor(items: z.infer<typeof FindingSchema>[]): AutonomousProposal[] { return items.map(finding => ({ proposal_id: hash(`proposal:${finding.finding_id}`), observation_id: finding.observation_id, finding_id: finding.finding_id, mission_type: 'REVIEW_FAILED_RUN', objective: `Review ${finding.source_id}`, reason: finding.summary, proposed_agent: 'SINK-03', required_authority: 'evidence_gathering', risk_class: 'OBSERVATIONAL' })); }
async function defaultAuthorize(proposal: AutonomousProposal): Promise<z.infer<typeof DecisionSchema>> { return { proposal_id: proposal.proposal_id, status: 'REQUIRES_APPROVAL', reason: `Explicit approval is required for ${proposal.required_authority}.`, decided_at: new Date().toISOString() }; }

export async function runAutonomousCycle(repositoryRoot: string, options: { dryRun?: boolean; dependencies?: AutonomousEngineDependencies } = {}): Promise<AutonomousCycle> {
  const dependencies = options.dependencies ?? {};
  const now = dependencies.now ?? (() => new Date());
  const runStore = dependencies.runStore ?? new FileRunStore(join(repositoryRoot, '.sink/runs'));
  const source = dependencies.observe ?? defaultObserve(repositoryRoot, runStore);
  const observed = await source();
  const observation: AutonomousObservation = {
    observation_id: hash(`observation:${now().toISOString()}:${observed.projection.generated_at}`),
    observed_at: now().toISOString(),
    projection_version: observed.projection.projection_version,
    settlement: { population: observed.projection.settlement.population, generation: observed.projection.settlement.generation, institutions: observed.projection.institutions.length, agents: observed.projection.agent_records.length, missions: observed.projection.missions.length },
    attention_run_ids: observed.runs.filter(run => ['FAILED', 'BLOCKED', 'CANCELLED'].includes(run.status)).map(run => run.run_id),
    health: { persistence: observed.projection.health.persistence, overall: observed.projection.health.overall, local_ai: observed.projection.health.local_ai.status }
  };
  const cycleId = hash(`cycle:${observation.observation_id}`);
  const findingList = findings(observation, observed.runs);
  const proposalList = proposalsFor(findingList);
  const authorize = dependencies.authorize ?? defaultAuthorize;
  const decisions = await Promise.all(proposalList.map(authorize));
  const previous = await priorCycles(cycleDirectory(repositoryRoot, dependencies.cycleRoot));
  const executions: AutonomousExecution[] = [];
  for (const proposal of proposalList) {
    const decision = decisions.find(item => item.proposal_id === proposal.proposal_id)!;
    const prior = previous.flatMap(item => item.executions).find(item => item.proposal_id === proposal.proposal_id && ['COMPLETED', 'EXECUTING', 'RECONCILED'].includes(item.status));
    if (prior) { executions.push({ ...prior, status: 'RECONCILED', reason: 'Existing execution recovered; duplicate execution prevented.' }); continue; }
    if (options.dryRun || decision.status !== 'AUTHORIZED' || !dependencies.executor) { executions.push({ proposal_id: proposal.proposal_id, status: 'NOT_EXECUTED', reason: options.dryRun ? 'Dry run stops before execution.' : decision.status === 'AUTHORIZED' ? 'No executor was provided for this cycle.' : decision.reason, run_id: null, evidence_ids: [], completed_at: null }); continue; }
    try { const result = await dependencies.executor.execute(proposal); executions.push({ proposal_id: proposal.proposal_id, status: 'COMPLETED', reason: 'Authorized bounded executor completed.', run_id: result.run_id, evidence_ids: result.evidence_ids, completed_at: now().toISOString() }); } catch (error) { executions.push({ proposal_id: proposal.proposal_id, status: 'FAILED', reason: error instanceof Error ? error.message : String(error), run_id: null, evidence_ids: [], completed_at: now().toISOString() }); }
  }
  const verificationResults = executions.map(execution => ({ proposal_id: execution.proposal_id, status: execution.status === 'COMPLETED' && execution.evidence_ids.length > 0 ? 'VERIFIED' as const : execution.status === 'COMPLETED' || execution.status === 'NOT_EXECUTED' ? 'PENDING' as const : 'REJECTED' as const, reason: execution.status === 'COMPLETED' && execution.evidence_ids.length > 0 ? 'Evidence was returned by the bounded executor.' : execution.status === 'COMPLETED' ? 'Execution completed without sufficient evidence.' : execution.reason }));
  const outcomes = verificationResults.map(result => ({ proposal_id: result.proposal_id, status: result.status === 'VERIFIED' ? 'COMMITTED' as const : result.status === 'REJECTED' ? 'REJECTED' as const : 'PENDING' as const, reason: result.reason }));
  const cycle = AutonomousCycleSchema.parse({ cycle_id: cycleId, status: executions.some(item => item.status === 'FAILED') ? 'FAILED' : decisions.some(item => item.status === 'REQUIRES_APPROVAL') ? 'REQUIRES_APPROVAL' : 'COMPLETED', dry_run: options.dryRun ?? false, observation, findings: findingList, proposals: proposalList, authorization_decisions: decisions, executions, verification_results: verificationResults, outcomes, attention_items: [...observation.attention_run_ids, ...verificationResults.filter(item => item.status !== 'VERIFIED').map(item => item.proposal_id)], audit_receipts: [] });
  await saveCycle(cycleDirectory(repositoryRoot, dependencies.cycleRoot), cycle);
  return cycle;
}
export async function readAutonomousCycle(repositoryRoot: string, cycleId: string, cycleRoot?: string): Promise<AutonomousCycle> { return AutonomousCycleSchema.parse(JSON.parse(await readFile(join(cycleDirectory(repositoryRoot, cycleRoot), `${cycleId}.json`), 'utf8'))); }
export async function listAutonomousCycles(repositoryRoot: string, cycleRoot?: string): Promise<AutonomousCycle[]> { return (await priorCycles(cycleDirectory(repositoryRoot, cycleRoot))).sort((left, right) => right.observation.observed_at.localeCompare(left.observation.observed_at)); }
