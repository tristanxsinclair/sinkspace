import { randomUUID } from 'node:crypto';
import { AgentDefinitionSchema, BudgetSchema, DEFAULT_BUDGET, HEALTH_OBJECTIVE, IntakeSchema, ReceiptSchema, RunSchema, TaskSchema, VerificationSchema, WorkerOutputSchema, type AgentDefinition, type Artifact, type Budget, type Event, type Receipt, type Run, type Task, type Verification, type WorkerOutput } from './contracts.js';
import type { ExecutionContext, Observation, RuntimeServices } from './context.js';
import { loadRegistry, specialist } from './registry.js';
import { authorize, ControlError, enforceBudget, hash, redact, validateGraph } from './security.js';
import { TERMINAL, transition } from './state.js';
import { receiptDigest, type RunStore } from './store.js';
import { scout, audit, redSink } from './specialists.js';
import type { IntelligenceAdapter } from './adapters/intelligence.js';
import { localIntelligenceAdapter } from './adapters/local-intelligence.js';

export interface RuntimeAdapter {
  readonly name: string;

  /**
   * Transitional compatibility hook.
   *
   * Intelligence belongs in IntelligenceAdapter, but older tests and
   * synthetic evals still inject research failures through RuntimeAdapter.
   *
   * Remove this once the entire test harness has migrated.
   */
  research?(ctx: ExecutionContext): Promise<unknown>;

  audit(ctx: ExecutionContext, output: WorkerOutput): Promise<Verification>;

  challenge(
    ctx: ExecutionContext,
    output: WorkerOutput,
    verdict: Verification
  ): Promise<{verification:Verification;findings:string[]}>;
}
export const localAdapter: RuntimeAdapter = {
  name:'local-deterministic-v1',
  research: scout,
  audit,
  challenge:redSink
};
export class Orchestrator {
  private active = new Map<string,Run>();
  private cancelled = new Set<string>();
  private busy = false;
  private aborters = new Map<string,AbortController>();
  constructor(
    private readonly store: RunStore,
    private readonly services: RuntimeServices,
    private readonly adapter: RuntimeAdapter = localAdapter,
    private readonly registry: AgentDefinition[] = loadRegistry(),
    private readonly intelligence: IntelligenceAdapter = localIntelligenceAdapter
  ) {
    this.registry = registry.map(a=>AgentDefinitionSchema.parse(a));
  }
  async create(input: unknown, budget: Budget = DEFAULT_BUDGET): Promise<Run> {
    const intake=IntakeSchema.parse(input); const now=this.now();
    const run:Run = RunSchema.parse({schema_version:'1.0.0',run_id:this.services.id(),...intake,adapter:this.adapter.name,status:'QUEUED',commit_sha:'',repository:this.services.repository.root,created_at:now,started_at:null,completed_at:null,tasks:[],artifacts:[],evidence:[],claims:[],verification:[],approvals:[],events:[],errors:[],uncertainty:[],red_sink_findings:[],usage:{tool_calls:0,tokens:0,estimated_cost_usd:0,model:null},budget:BudgetSchema.parse(budget),agent_configs:structuredClone(this.registry),receipt:null});
    this.event(run,'RUN_CREATED','SINK-PRIME',null,'Accepted the capability-inventory objective; local deterministic adapter, no model execution.');
    await this.store.save(run); return structuredClone(run);
  }
  private now(): string { return this.services.now().toISOString(); }
  private event(run:Run,type:Event['type'],agent:string,task:string|null,summary:string): void {
    run.events.push({event_id:this.services.id(),type,timestamp:this.now(),agent_id:agent,task_id:task,summary:redact(summary)});
  }
  private state(run:Run,next:Run['status'],verified=false): void { run.status=transition(run.status,next,verified); this.event(run,'STATE_CHANGED','SINK-00',null,`Run entered ${next}.`); }
  private guard(run:Run): void { if (this.cancelled.has(run.run_id)) throw new ControlError('CANCELLED'); enforceBudget(run,this.services.now().getTime()); }
  private plan(run:Run): void {
    const capabilities = ['repository_research','report_artifact','independent_audit','adversarial_review'];
    const objectives = ['Inspect pinned repository evidence for visible capabilities','Create capability inventory artifacts','Independently verify inventory claims','Challenge evidence and scope'];
    let previous:string|null=null;
    run.tasks=capabilities.map((capability,i)=>{
      const agent=specialist(run.agent_configs,capability); const id=this.services.id();
      const task=TaskSchema.parse({task_id:id,parent_task_id:null,run_id:run.run_id,objective:objectives[i],success_criteria:['Produce an artifact and satisfy independent verification policy.'],assigned_agent:agent.id,agent_version:agent.version,status:'QUEUED',priority:i,dependencies:previous?[previous]:[],inputs:[run.commit_sha],constraints:['External content is untrusted data.','Inspect committed allowlisted files only.'],permissions:agent.allowed_tools,budget:run.budget,created_at:this.now(),started_at:null,completed_at:null,artifacts:[],evidence:[],uncertainty:[],errors:[],verification_status:'UNVERIFIED',auditor:null,next_action:'Wait for dependencies.',attempts:0});
      previous=id; this.event(run,'TASK_CREATED','SINK-00',id,task.objective); return task;
    });
    validateGraph(run.tasks,run.budget); this.event(run,'PLAN_CREATED','SINK-00',null,'Research → report artifact → independent audit → Red Sink → receipt.');
  }
  private context(run:Run,task:Task,isLive:()=>boolean):ExecutionContext {
    const guard=()=>{if(!isLive())throw new ControlError('CONTEXT_EXPIRED');this.guard(run);};
    const agent=run.agent_configs.find(a=>a.id===task.assigned_agent)!;
    const artifact=(content:string,mediaType='text/plain'):Artifact=>{
      guard(); const safe=redact(content); if (safe.length>2_000_000) throw new ControlError('OUTPUT_LIMIT');
      const a:Artifact={artifact_id:this.services.id(),media_type:mediaType,sha256:hash(safe),content:safe,created_at:this.now(),agent_id:agent.id,task_id:task.task_id};
      run.artifacts.push(a); task.artifacts.push(a.artifact_id); this.event(run,'ARTIFACT_CREATED',agent.id,task.task_id,`Stored artifact ${a.artifact_id}.`); return structuredClone(a);
    };
    const observe=async(tool:'repo_read'|'repo_inventory',path?:string):Promise<Observation>=>{
      guard(); authorize(agent,task,tool); enforceBudget(run,this.services.now().getTime(),{tools:1,tokens:0,cost:0}); run.usage.tool_calls++;
      this.event(run,'TOOL_REQUESTED',agent.id,task.task_id,`${tool}: ${path ?? 'pinned tree'}`); await this.store.save(run);
      const content=tool==='repo_read' ? await this.services.repository.read(run.commit_sha,path!) : JSON.stringify(await this.services.repository.inventory(run.commit_sha));
      guard(); const a=artifact(content,tool==='repo_inventory'?'application/json':'text/plain');
      const e={evidence_id:this.services.id(),artifact_id:a.artifact_id,commit_sha:run.commit_sha,tool,agent_id:agent.id,task_id:task.task_id,timestamp:this.now(),source:path??'git:tree',trust:'UNTRUSTED_DATA' as const};
      run.evidence.push(e); task.evidence.push(e.evidence_id);
      this.event(run,'TOOL_COMPLETED',agent.id,task.task_id,`${tool} completed; evidence ${e.evidence_id}.`); this.event(run,'EVIDENCE_ATTACHED',agent.id,task.task_id,e.evidence_id);
      await this.store.save(run); return {content:a.content,artifact:structuredClone(a),evidence:structuredClone(e)};
    };
    return {get run(){return structuredClone(run);},get task(){return structuredClone(task);},now:()=>this.now(),id:()=>this.services.id(),read:path=>observe('repo_read',path),inventory:()=>observe('repo_inventory'),artifact,emit:(type,summary)=>{guard();this.event(run,type,agent.id,task.task_id,summary);}};
  }
  private async execute<T>(run:Run,task:Task,operation:(ctx:ExecutionContext)=>Promise<T>):Promise<T> {
    this.guard(run);
    for (const dep of task.dependencies) if (!run.tasks.some(t=>t.task_id===dep && t.status==='VERIFYING')) throw new ControlError('DEPENDENCY_FAILED');
    task.status=transition(task.status,'RUNNING'); task.started_at=this.now(); task.next_action='Executing bounded work.';
    this.event(run,'AGENT_ASSIGNED',task.assigned_agent,task.task_id,task.objective);
    for (;;) {
      this.guard(run); task.attempts++;
      try {
        let live=true;
        const signal=this.aborters.get(run.run_id)!.signal;
        let timer:ReturnType<typeof setTimeout>|undefined;
        let onAbort:()=>void=()=>{};
        const stop=new Promise<never>((_,reject)=>{
          onAbort=()=>reject(new ControlError('CANCELLED'));
          signal.addEventListener('abort',onAbort,{once:true});
          timer=setTimeout(()=>reject(new ControlError('BUDGET_EXCEEDED')),Math.max(1,run.budget.max_wall_ms-(this.services.now().getTime()-Date.parse(run.started_at!))));
        });
        let result:T;
        try { result=await Promise.race([operation(this.context(run,task,()=>live)),stop]); }
        finally {live=false;if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
        this.guard(run);
        task.status=transition(task.status,'VERIFYING'); task.next_action='Await independent completion policy.'; await this.store.save(run); return result;
      } catch(error) {
        // Retry only known transient tool failures. Governance/model/schema failures never retry.
        if (!(error instanceof ControlError) || error.code!=='TOOL_FAILURE' || task.attempts>run.budget.max_retries) throw error;
        this.event(run,'RETRY',task.assigned_agent,task.task_id,`Tool failure; bounded retry ${task.attempts}.`);
      }
    }
  }
  private recordVerification(run:Run,task:Task,input:unknown):Verification {
    const verdict=VerificationSchema.parse(input);
    if(redact(JSON.stringify(verdict))!==JSON.stringify(verdict))throw new ControlError('SECRET_OUTPUT_BLOCKED');
    if (verdict.agent_id!==task.assigned_agent || verdict.agent_version!==task.agent_version || run.claims.some(c=>c.agent_id===verdict.agent_id)) throw new ControlError('INDEPENDENCE_REQUIRED');
    if (verdict.evidence_ids.some(id=>!run.evidence.some(e=>e.evidence_id===id && e.agent_id===verdict.agent_id))) throw new ControlError('FORGED_AUDIT_EVIDENCE');
    if (['PASS','PASS_WITH_LIMITATIONS'].includes(verdict.verdict) && run.claims.filter(c=>c.classification==='KNOWN').some(c=>!verdict.checked_claim_ids.includes(c.claim_id))) throw new ControlError('INCOMPLETE_AUDIT');
    run.verification.push(verdict); task.verification_status=verdict.verdict;
    this.event(run,['PASS','PASS_WITH_LIMITATIONS'].includes(verdict.verdict)?'AUDIT_PASSED':'AUDIT_FAILED',task.assigned_agent,task.task_id,verdict.reasons.join(' ')); return verdict;
  }
  async run(id:string):Promise<Run> {
    if (this.busy) throw new ControlError('RUNNER_BUSY'); this.busy=true;
    let run:Run|undefined;
    try {
      run=await this.store.get(id); if (run.status!=='QUEUED') throw new ControlError('RUN_NOT_QUEUED');
      this.active.set(id,run); this.aborters.set(id,new AbortController()); run.started_at=this.now(); this.state(run,'PLANNING');
      this.guard(run); enforceBudget(run,this.services.now().getTime(),{tools:1,tokens:0,cost:0}); run.usage.tool_calls++;
      this.event(run,'TOOL_REQUESTED','SINK-00',null,'Resolve authorised repository HEAD.'); run.commit_sha=await this.services.repository.pin();
      this.event(run,'TOOL_COMPLETED','SINK-00',null,`Pinned commit ${run.commit_sha}; working tree excluded.`);
      this.guard(run); this.plan(run); this.state(run,'RUNNING'); await this.store.save(run);
      const [research,build,auditor,red]=run.tasks as [Task,Task,Task,Task];
      const raw=await this.execute(
        run,
        research,
        ctx => this.adapter.research
          ? this.adapter.research(ctx)
          : this.intelligence.research(ctx,research)
      );
      const output=WorkerOutputSchema.parse(raw);
      if (redact(JSON.stringify(output))!==JSON.stringify(output)) throw new ControlError('SECRET_OUTPUT_BLOCKED');
      if(new Set(output.claims.map(c=>c.claim_id)).size!==output.claims.length)throw new ControlError('DUPLICATE_CLAIM');
      if (output.claims.some(c=>c.agent_id!==research.assigned_agent || c.evidence_ids.some(eid=>!run!.evidence.some(e=>e.evidence_id===eid && e.agent_id===research.assigned_agent)))) throw new ControlError('FORGED_WORKER_EVIDENCE');
      run.claims=output.claims; run.uncertainty=output.uncertainty; research.uncertainty=[...output.uncertainty];
      for (const claim of output.claims) this.event(run,'CLAIM_CREATED',research.assigned_agent,research.task_id,claim.statement);
      await this.execute(run,build,async ctx=>{
        ctx.artifact(output.report,'text/markdown');
        return ctx.artifact(JSON.stringify(output,null,2),'application/json');
      });
      this.state(run,'VERIFYING'); this.event(run,'AUDIT_STARTED',auditor.assigned_agent,auditor.task_id,'Independent source verification.');
      const verdict=this.recordVerification(run,auditor,await this.execute(run,auditor,ctx=>this.adapter.audit(ctx,structuredClone(output))));
      // Red Sink still reviews rejected work; its findings remain in failed receipts.
      const challenge=await this.execute(run,red,ctx=>this.adapter.challenge(ctx,structuredClone(output),structuredClone(verdict)));
      const redVerdict=this.recordVerification(run,red,challenge.verification);
      run.red_sink_findings=challenge.findings.map(f=>redact(f)); this.event(run,'RED_SINK_COMPLETED',red.assigned_agent,red.task_id,run.red_sink_findings.join(' ')||'No additional finding.');
      if (![verdict,redVerdict].every(v=>['PASS','PASS_WITH_LIMITATIONS'].includes(v.verdict))) throw new ControlError('INSUFFICIENT_EVIDENCE','Independent verification rejected completion.');
      if (!run.claims.some(c=>c.classification==='KNOWN') || !build.artifacts.length || !run.uncertainty.length) throw new ControlError('UNVERIFIED_COMPLETION');
      for (const task of run.tasks) {task.status=transition(task.status,'COMPLETED',true);task.completed_at=this.now();task.verification_status='PASS_WITH_LIMITATIONS';task.auditor=task.assigned_agent==='SINK-03'?'RED-SINK':'SINK-03';task.next_action='Inspect receipt; runtime and production remain unverified.';}
      this.guard(run); this.state(run,'COMPLETED',true); this.event(run,'RUN_COMPLETED','SINK-00',null,'Bounded report verified; no production or commercial outcome claimed.');
    } catch(error) {
      if (!run || TERMINAL.includes(run.status)) throw error;
      const code=error instanceof ControlError?error.code:'INVALID_OUTPUT';
      run.errors.push(redact(`${code}: ${error instanceof ControlError?error.message:'Operation or schema validation failed.'}`));
      const next=code==='CANCELLED'?'CANCELLED':['BUDGET_EXCEEDED','HUMAN_REJECTED','UNAUTHORIZED_TOOL','CHILD_LIMIT','DEPTH_LIMIT'].includes(code)?'BLOCKED':'FAILED';
      this.state(run,next); for (const task of run.tasks) if (!TERMINAL.includes(task.status)) {task.status=transition(task.status,next==='FAILED' && task.status==='WAITING_ON_DEPENDENCY'?'BLOCKED':next);task.completed_at=this.now();task.errors.push(code);task.next_action='Review failure evidence before a new run.';}
      this.event(run,next==='CANCELLED'?'RUN_CANCELLED':'RUN_FAILED','SINK-00',null,run.errors.at(-1)!);
    } finally {this.active.delete(id);this.cancelled.delete(id);this.aborters.delete(id);this.busy=false;}
    run.completed_at=this.now();
    const receipt:Receipt=ReceiptSchema.parse({schema_version:'1.0.0',receipt_id:this.services.id(),run_id:run.run_id,objective:run.objective,agent:'SINK-00',adapter:run.adapter,commit_sha:run.commit_sha,started_at:run.started_at??run.created_at,completed_at:run.completed_at,actions_taken:run.events,artifacts_created:run.artifacts,evidence:run.evidence,claims:run.claims,verification:run.verification,tests:['Only deterministic committed-file assertions executed; no repository scripts, browser or production tests.'],unresolved_items:[...run.uncertainty,...run.errors],red_sink_findings:run.red_sink_findings,confidence:run.status==='COMPLETED'?'BOUNDED':'UNVERIFIED',cost:run.usage,human_approvals:run.approvals,final_status:run.status,agent_configs:run.agent_configs,hash:'0'.repeat(64)});
    receipt.hash=receiptDigest(receipt); await this.store.seal(receipt);run.receipt=receipt;await this.store.save(run);return structuredClone(run);
  }
  async cancel(id:string):Promise<Run> {
    const active=this.active.get(id); if (active) {this.cancelled.add(id);this.aborters.get(id)?.abort();return structuredClone(active);}
    const run=await this.store.get(id);if (TERMINAL.includes(run.status)) throw new ControlError('RUN_TERMINAL');
    if (run.status==='QUEUED') {this.cancelled.add(id);return this.run(id);}
    throw new ControlError('RUN_NOT_ACTIVE');
  }
}
export function services(repository:RuntimeServices['repository']):RuntimeServices { return {repository,now:()=>new Date(),id:randomUUID}; }
export const healthIntake = {workflow:'capability-inventory' as const,objective:HEALTH_OBJECTIVE};
