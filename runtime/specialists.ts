import { WorkerOutputSchema, type Claim, type Predicate, type Verification, type WorkerOutput } from './contracts.js';
import type { ExecutionContext, Observation } from './context.js';
import { ControlError, hash } from './security.js';
import { PERMITTED_FILES } from './repository.js';

const LIMITATIONS = [
  'UNKNOWN: Production deployment identity and current production behaviour were not observed.',
  'NEEDS_VERIFICATION: Tests, build, lint and runtime behaviour were not executed by this workflow.',
  'UNKNOWN: Commercial impact and the globally highest-leverage improvement cannot be determined from these bounded repository checks.',
];
const RECOMMENDATION = 'INFERRED recommendation: Treat this as a repository-visible capability inventory only; verify delivery, customer use, and commercial value before using these entries as external performance claims.';
const HEADER = '# Sink Space capability inventory\n\nDeterministic development adapter. Scope: immutable repository evidence; no model, code execution, customer validation, or production observation.';

/** Canonical assertion language: a true predicate cannot legitimise unrelated prose. */
export function statementFor(predicate: Predicate): string {
  switch (predicate.kind) {
    case 'FILE_EXISTS': return `Tracked path ${JSON.stringify(predicate.path)} exists: ${predicate.expected}.`;
    case 'TEXT_CONTAINS': return `Blob ${JSON.stringify(predicate.path)} contains literal ${JSON.stringify(predicate.expected)}.`;
    case 'JSON_FIELD_EQUALS': return `JSON blob ${JSON.stringify(predicate.path)} field ${JSON.stringify(predicate.key)} equals string ${JSON.stringify(predicate.expected)}.`;
  }
}
function reportFor(output: Pick<WorkerOutput, 'claims' | 'uncertainty'>): string {
  return `${HEADER}\n\n## Repository-visible capabilities\n\n${output.claims.map(c => `- [${c.classification}] ${c.statement} Evidence: ${c.evidence_ids.join(', ') || 'none'}`).join('\n')}\n\n## Limitations\n\n${output.uncertainty.map(item => `- ${item}`).join('\n')}`;
}
function inventoryPaths(observation: Observation): string[] {
  const parsed: unknown = JSON.parse(observation.content);
  if (!Array.isArray(parsed) || parsed.some(p => typeof p !== 'string')) throw new ControlError('MALFORMED_INVENTORY');
  return parsed as string[];
}

export async function scout(ctx: ExecutionContext): Promise<unknown> {
  if (ctx.task.assigned_agent !== 'SINK-01') throw new ControlError('INVALID_SPECIALIST');
  const inventory = await ctx.inventory();
  const paths = inventoryPaths(inventory);
  const claims: Claim[] = [];
  const add = (predicate: Predicate, observation: Observation): void => {
    claims.push({claim_id: ctx.id(), statement: statementFor(predicate), classification: 'KNOWN', evidence_ids: [observation.evidence.evidence_id], predicate, agent_id: 'SINK-01'});
  };
  const essentials = ['README.md', 'dist/index.html', '.github/workflows/static.yml', 'dist/release.json', 'dist/app.js'];
  for (const path of essentials) add({kind: 'FILE_EXISTS', path, key: null, expected: String(paths.includes(path))}, inventory);
  const observations = new Map<string, Observation>();
  for (const path of essentials.filter(path => paths.includes(path))) observations.set(path, await ctx.read(path));
  const readme = observations.get('README.md');
  for (const capability of ['Business and service websites','Lead capture, quote and customer intake systems','Focused custom software','AI and automation where it creates measurable value','Eblocki','WorkProof']) {
    if (readme?.content.includes(capability)) add({kind:'TEXT_CONTAINS',path:'README.md',key:null,expected:capability},readme);
  }
  const workflow = observations.get('.github/workflows/static.yml');
  if (workflow?.content.includes('path: ./dist')) add({kind: 'TEXT_CONTAINS', path: '.github/workflows/static.yml', key: null, expected: 'path: ./dist'}, workflow);
  const page = observations.get('dist/index.html');
  if (page?.content.includes('https://sinkspace.com.au/')) add({kind: 'TEXT_CONTAINS', path: 'dist/index.html', key: null, expected: 'https://sinkspace.com.au/'}, page);
  const release = observations.get('dist/release.json');
  const uncertainty = [...LIMITATIONS];
  if (release) {
    try {
      const metadata: unknown = JSON.parse(release.content);
      if (typeof metadata === 'object' && metadata !== null && 'hosting' in metadata && metadata.hosting === 'GitHub Pages') add({kind: 'JSON_FIELD_EQUALS', path: 'dist/release.json', key: 'hosting', expected: 'GitHub Pages'}, release);
      else uncertainty.push('NEEDS_VERIFICATION: Release metadata does not provide the expected GitHub Pages hosting string.');
    } catch { uncertainty.push('NEEDS_VERIFICATION: Release metadata is not valid JSON.'); }
  }
  claims.push({claim_id: ctx.id(), statement: RECOMMENDATION, classification: 'INFERRED', evidence_ids: [inventory.evidence.evidence_id], predicate: null, agent_id: 'SINK-01'});
  const output = {claims, uncertainty, report: ''};
  output.report = reportFor(output);
  return WorkerOutputSchema.parse(output);
}

function verification(ctx: ExecutionContext, verdict: Verification['verdict'], reasons: string[], claims: string[], evidence: string[]): Verification {
  const config = ctx.run.agent_configs.find(a => a.id === ctx.task.assigned_agent);
  if (!config) throw new ControlError('MISSING_AGENT_CONFIGURATION');
  return {agent_id: config.id, agent_version: config.version, verdict, reasons, checked_claim_ids: claims, evidence_ids: [...new Set(evidence)], timestamp: ctx.now()};
}

/** Independent verifier interprets the assertion grammar and rereads pinned repository blobs. */
export async function audit(ctx: ExecutionContext, raw: WorkerOutput): Promise<Verification> {
  if (ctx.task.assigned_agent !== 'SINK-03') throw new ControlError('AUDITOR_IDENTITY_REQUIRED');
  const output = WorkerOutputSchema.parse(raw);
  if (output.claims.some(c => c.agent_id === ctx.task.assigned_agent)) throw new ControlError('SELF_AUDIT');
  const failures: string[] = [];
  const reportExists = ctx.run.artifacts.some(a => {
    const task = ctx.run.tasks.find(t => t.task_id === a.task_id);
    if (a.agent_id !== 'SINK-02' || task?.assigned_agent !== 'SINK-02' || task.run_id !== ctx.run.run_id || !task.artifacts.includes(a.artifact_id) || a.media_type !== 'application/json' || a.sha256 !== hash(a.content)) return false;
    try { return hash(WorkerOutputSchema.parse(JSON.parse(a.content))) === hash(output); } catch { return false; }
  });
  if (!reportExists) failures.push('The complete structured output has no intact Builder artifact with task provenance.');
  const checked: string[] = [];
  const observedEvidence: string[] = [];
  const cache = new Map<string, Observation>();
  let inventory: Observation | undefined;
  const seen = new Set<string>();
  for (const claim of output.claims) {
    if (seen.has(claim.claim_id)) failures.push(`Duplicate claim identity: ${claim.claim_id}.`);
    seen.add(claim.claim_id);
    if (claim.agent_id !== 'SINK-01') failures.push(`Unrecognised worker provenance: ${claim.claim_id}.`);
    if (claim.classification !== 'KNOWN') {
      if (claim.predicate !== null) failures.push(`Uncertain claim attempts a verified predicate: ${claim.claim_id}.`);
      continue;
    }
    checked.push(claim.claim_id);
    const p = claim.predicate;
    if (!p || !PERMITTED_FILES.includes(p.path) || !claim.evidence_ids.length) { failures.push(`Missing or unsupported assertion/evidence: ${claim.claim_id}.`); continue; }
    // Deliberately not statementFor: this parser defines auditor's independently owned grammar.
    const asserted = p.kind === 'FILE_EXISTS'
      ? `Tracked path ${JSON.stringify(p.path)} exists: ${p.expected}.`
      : p.kind === 'TEXT_CONTAINS'
        ? `Blob ${JSON.stringify(p.path)} contains literal ${JSON.stringify(p.expected)}.`
        : `JSON blob ${JSON.stringify(p.path)} field ${JSON.stringify(p.key)} equals string ${JSON.stringify(p.expected)}.`;
    if (asserted !== claim.statement || (p.kind !== 'JSON_FIELD_EQUALS' && p.key !== null) || (p.kind === 'JSON_FIELD_EQUALS' && (!p.key || ['__proto__', 'constructor', 'prototype'].includes(p.key))) || (p.kind === 'FILE_EXISTS' && !['true', 'false'].includes(p.expected)) || (p.kind !== 'FILE_EXISTS' && !p.expected)) {
      failures.push(`Assertion wording or shape is unsupported: ${claim.claim_id}.`); continue;
    }
    let fresh: Observation;
    if (p.kind === 'FILE_EXISTS') { inventory ??= await ctx.inventory(); fresh = inventory; }
    else { const previous = cache.get(p.path); fresh = previous ?? await ctx.read(p.path); cache.set(p.path, fresh); }
    observedEvidence.push(fresh.evidence.evidence_id);
    for (const id of claim.evidence_ids) {
      const e = ctx.run.evidence.find(e => e.evidence_id === id);
      const a = e && ctx.run.artifacts.find(a => a.artifact_id === e.artifact_id);
      const task = e && ctx.run.tasks.find(t => t.task_id === e.task_id);
      if (!e || !a || !task || e.commit_sha !== ctx.run.commit_sha || e.source !== fresh.evidence.source || e.tool !== fresh.evidence.tool || e.trust !== 'UNTRUSTED_DATA' || e.agent_id !== claim.agent_id || task.assigned_agent !== claim.agent_id || task.run_id !== ctx.run.run_id || a.task_id !== e.task_id || a.agent_id !== e.agent_id || a.sha256 !== hash(a.content) || a.content !== fresh.content) failures.push(`Evidence provenance/content mismatch: ${claim.claim_id}/${id}.`);
    }
    let supported = false;
    if (p.kind === 'FILE_EXISTS') supported = String(inventoryPaths(fresh).includes(p.path)) === p.expected;
    if (p.kind === 'TEXT_CONTAINS') supported = fresh.content.includes(p.expected);
    if (p.kind === 'JSON_FIELD_EQUALS') {
      try { const obj: unknown = JSON.parse(fresh.content); supported = !!obj && typeof obj === 'object' && Object.hasOwn(obj, p.key!) && (obj as Record<string, unknown>)[p.key!] === p.expected; } catch { supported = false; }
    }
    if (!supported) failures.push(`Evidence does not entail assertion: ${claim.claim_id}.`);
  }
  if (!checked.length) failures.push('No independently verifiable claims.');
  return verification(ctx, failures.length ? 'FAIL' : 'PASS_WITH_LIMITATIONS', failures.length ? failures : ['Structured repository assertions were independently reread at the pinned commit; runtime, production, and recommendation value remain unverified.'], checked, observedEvidence);
}

export async function redSink(ctx: ExecutionContext, raw: WorkerOutput, prior: Verification): Promise<{verification: Verification; findings: string[]}> {
  if (ctx.task.assigned_agent !== 'RED-SINK' || prior.agent_id !== 'SINK-03') throw new ControlError('INDEPENDENT_REVIEW_REQUIRED');
  const output = WorkerOutputSchema.parse(raw);
  const failures: string[] = [];
  const freshSources = new Map<string, Observation>();
  const independentEvidence: string[] = [];
  if (!prior.evidence_ids.length || prior.evidence_ids.some(id => !ctx.run.evidence.some(e => e.evidence_id === id && e.agent_id === 'SINK-03' && e.commit_sha === ctx.run.commit_sha))) failures.push('Auditor verdict lacks independent source evidence at the pinned commit.');
  if (!['PASS', 'PASS_WITH_LIMITATIONS'].includes(prior.verdict)) failures.push('Auditor rejection or uncertainty blocks verified completion.');
  if (output.report !== reportFor(output)) failures.push('Report contains prose outside the structured claim and uncertainty record.');
  if (LIMITATIONS.some(item => !output.uncertainty.includes(item))) failures.push('Required uncertainty disappeared: static checks cannot establish runtime, production, or commercial priority.');
  for (const c of output.claims) {
    if (!c.evidence_ids.length) failures.push(`Claim has no source evidence: ${c.claim_id}.`);
    for (const id of c.evidence_ids) {
      const evidence = ctx.run.evidence.find(e => e.evidence_id === id);
      const artifact = evidence && ctx.run.artifacts.find(a => a.artifact_id === evidence.artifact_id);
      if (!evidence || !artifact || artifact.sha256 !== hash(artifact.content)) { failures.push(`Evidence artifact is missing or corrupted: ${c.claim_id}.`); continue; }
      if (evidence.source !== 'git:tree' && !PERMITTED_FILES.includes(evidence.source)) { failures.push(`Evidence source is outside the permitted scope: ${c.claim_id}.`); continue; }
      let fresh = freshSources.get(evidence.source);
      if (!fresh) { fresh = evidence.source === 'git:tree' ? await ctx.inventory() : await ctx.read(evidence.source); freshSources.set(evidence.source, fresh); independentEvidence.push(fresh.evidence.evidence_id); }
      if (fresh.content !== artifact.content) failures.push(`Evidence differs from Red Sink's independent observation: ${c.claim_id}.`);
    }
    if (c.classification === 'KNOWN' && !prior.checked_claim_ids.includes(c.claim_id)) failures.push(`Claim escaped auditor review: ${c.claim_id}.`);
    if (c.classification === 'INFERRED' && c.statement !== RECOMMENDATION) failures.push(`Unsupported recommendation prose: ${c.claim_id}.`);
    if (c.evidence_ids.some(id => !ctx.run.evidence.some(e => e.evidence_id === id && e.commit_sha === ctx.run.commit_sha && e.agent_id === c.agent_id))) failures.push(`Evidence identity or commit mismatch: ${c.claim_id}.`);
  }
  const tree = freshSources.get('git:tree');
  if (tree) {
    const paths = inventoryPaths(tree);
    const recommendations = output.claims.filter(c => c.classification === 'INFERRED');
    if (recommendations.length !== 1 || recommendations[0]?.statement !== RECOMMENDATION) failures.push('The bounded inventory limitation is missing or changed.');
  } else failures.push('No repository inventory establishes the scope of the recommendation.');
  const findings = [...failures, 'Scope limit: independent deterministic checks share the Git reader and host trust boundary. No model reasoning, runtime health, deployed state, customer demand, or globally optimal recommendation was established.'];
  return {verification: verification(ctx, failures.length ? 'FAIL' : 'PASS_WITH_LIMITATIONS', findings, output.claims.map(c => c.claim_id), independentEvidence), findings};
}
