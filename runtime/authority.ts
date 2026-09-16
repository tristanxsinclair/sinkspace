import type { AgentDefinition, Approval, Run, Task } from './contracts.js';
import { transition } from './state.js';
import { authorize, ControlError, decideApproval, hash } from './security.js';
// Trusted controller API. This module is not exposed as an agent tool or unauthenticated HTTP endpoint.
export function requestAction(run:Run, task:Task, agent:AgentDefinition, tool:string, args:unknown, id:string, now:Date):Approval|null {
  if (run.status!=='RUNNING' || task.status!=='RUNNING' || task.run_id!==run.run_id || !run.tasks.some(t=>t.task_id===task.task_id && hash(t)===hash(task)) || !run.agent_configs.some(a=>a.id===agent.id && hash(a)===hash(agent))) throw new ControlError('AUTHORITY_CONTEXT_MISMATCH');
  try {authorize(agent,task,tool);return null;}
  catch(error) {
    if (!(error instanceof ControlError) || error.code!=='APPROVAL_REQUIRED') throw error;
    const approval:Approval={approval_id:id,run_id:run.run_id,task_id:task.task_id,agent_id:agent.id,tool,arguments_hash:hash(args),status:'PENDING',requested_at:now.toISOString(),expires_at:new Date(now.getTime()+300000).toISOString(),decided_by:null,decided_at:null,consumed:false};
    run.approvals.push(approval);run.status=transition(run.status,'WAITING_FOR_APPROVAL');
    run.events.push({event_id:`${id}-requested`,type:'APPROVAL_REQUESTED',timestamp:now.toISOString(),agent_id:agent.id,task_id:task.task_id,summary:`Operator decision required for ${tool}; no action executed.`});
    return structuredClone(approval);
  }
}
export function resolveAction(run:Run, id:string, actor:{kind:'agent'|'operator';id:string}, granted:boolean, now:Date):Approval {
  if(run.status!=='WAITING_FOR_APPROVAL')throw new ControlError('INVALID_STATE_TRANSITION');
  const index=run.approvals.findIndex(a=>a.approval_id===id);if(index<0) throw new ControlError('APPROVAL_NOT_FOUND');
  const updated=decideApproval(run.approvals[index]!,actor,granted,now.toISOString());run.approvals[index]=updated;
  run.events.push({event_id:`${id}-decided`,type:granted?'APPROVAL_GRANTED':'APPROVAL_DENIED',timestamp:now.toISOString(),agent_id:'SINK-PRIME',task_id:updated.task_id,summary:`Operator ${granted?'granted':'denied'} ${updated.tool}.`});
  // A grant alone never dispatches an action. Disabled external tools stay disabled.
  if(!granted) {run.status=transition(run.status,'BLOCKED');run.errors.push('HUMAN_REJECTED');}
  return structuredClone(updated);
}
