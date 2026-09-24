import { runPersistedAcademyCycle, type AcademyCycleReceipt } from './academy-runner.js';
import { loadAcademyState } from './academy-store.js';
import { bootstrapLakeYange } from './lake-yange-bootstrap.js';
import { loadGraduationState } from './academy-graduation-store.js';
import { type AcademyGraduationState } from './academy-graduation-types.js';

export type PrimeAgentCommand =
  | { kind: 'ACADEMY_CYCLE'; dryRun: boolean }
  | { kind: 'ACADEMY_START'; agentId?: string }
  | { kind: 'ACADEMY_PROGRESS'; agentId?: string }
  | { kind: 'ACADEMY_NEXT_LESSON'; agentId?: string }
  | { kind: 'ACADEMY_GRADUATION'; agentId?: string }
  | { kind: 'REPORT_WORK'; }
  | { kind: 'UNSUPPORTED'; reason: string };

export type PrimeAgentCommandResult = {
  status: 'COMPLETED' | 'UNSUPPORTED' | 'REQUIRES_APPROVAL' | 'FAILED';
  reply: string;
  command: PrimeAgentCommand;
  academy?: AcademyCycleReceipt | Record<string, unknown>;
  progress?: Record<string, unknown>;
};

export function interpretPrimeAgentCommand(input: string): PrimeAgentCommand {
  const normalized = input.trim().toLowerCase();
  
  // Academy progress and status queries
  if (/\b(show|display|what is|tell me)\b.*\b(academy.*progress|progress.*academy|agent.*academy|academy.*status)\b/i.test(normalized)) {
    const match = normalized.match(/\b(agent|citizen|student)\s+(\S+)/i);
    return { kind: 'ACADEMY_PROGRESS', ...(match ? { agentId: match[2] } : {}) };
  }
  
  // Graduation status
  if (/\b(show|display|check|report)\b.*\b(graduation|graduate|academy.*graduation)\b/i.test(normalized)) {
    const match = normalized.match(/\b(agent|citizen|student)\s+(\S+)/i);
    return { kind: 'ACADEMY_GRADUATION', ...(match ? { agentId: match[2] } : {}) };
  }
  
  // Next lesson/assignment
  if (/\b(give|start|run|continue|advance|next|assign)\b.*\b(lesson|assignment|course|class)\b.*\b(academy|learning)/i.test(normalized)) {
    const match = normalized.match(/\b(agent|citizen|student|for)\s+(\S+)/i);
    return { kind: 'ACADEMY_NEXT_LESSON', ...(match ? { agentId: match[2] } : {}) };
  }
  
  // Start Academy for agent
  if (/\b(start|begin|initiate|enroll)\b.*\b(academy|learning|education)\b/i.test(normalized)) {
    const match = normalized.match(/\b(agent|citizen|student|for)\s+(\S+)/i);
    return { kind: 'ACADEMY_START', ...(match ? { agentId: match[2] } : {}) };
  }
  
  // Run Academy cycle
  if (/\b(run|continue|advance|start|cycle)\b.*\b(academy|learning|class|course)/i.test(normalized)) {
    return { kind: 'ACADEMY_CYCLE', dryRun: false };
  }
  
  // Report work
  if (/\b(what are|report|show|tell me)\b.*\b(agent|mission|work|doing|result)/i.test(normalized)) {
    return { kind: 'REPORT_WORK' };
  }
  
  // Research requests
  if (/\b(research|investigate|study|analyse|analyze)\b/i.test(normalized)) {
    return { kind: 'UNSUPPORTED', reason: 'Arbitrary topic research is not currently exposed as an executable Prime mission. The Academy runtime supports its persisted curriculum only. Use Academy commands to manage learning progress.' };
  }
  
  return { kind: 'UNSUPPORTED', reason: 'Prime could not map that request to a supported bounded agent operation.' };
}

export async function executePrimeAgentCommand(repositoryRoot: string, input: string): Promise<PrimeAgentCommandResult> {
  const command = interpretPrimeAgentCommand(input);
  
  if (command.kind === 'UNSUPPORTED') {
    return { status: 'UNSUPPORTED', reply: command.reason, command };
  }
  
  if (command.kind === 'REPORT_WORK') {
    return { 
      status: 'COMPLETED', 
      reply: 'I can report persisted work from the Operations and Mission views. No new execution was requested.', 
      command 
    };
  }
  
  if (command.kind === 'ACADEMY_START') {
    try {
      const academy = await runPersistedAcademyCycle({ repositoryRoot });
      return { 
        status: 'COMPLETED', 
        reply: `Academy enrollment started. ${academy.assignments_created} assignment(s) created for students. Receipt: ${academy.receipt_id}.`,
        command,
        academy 
      };
    } catch (error) {
      return { 
        status: 'FAILED', 
        reply: error instanceof Error ? error.message : String(error), 
        command 
      };
    }
  }
  
  if (command.kind === 'ACADEMY_PROGRESS') {
    try {
      const lake = await bootstrapLakeYange({ repositoryRoot });
      const academyState = await loadAcademyState(repositoryRoot);
      const graduationState: AcademyGraduationState = await loadGraduationState(repositoryRoot);
      
      const agents = command.agentId 
        ? [command.agentId]
        : lake.state.citizens.map(c => c.system_id);
      
      const progress = agents.map(agentId => {
        const student = academyState.students.find(s => s.citizen_id === agentId);
        const enrollment = graduationState.enrollments.find(e => e.agent_id === agentId);
        
        return {
          citizen_id: agentId,
          enrolled: student?.enrolled ?? false,
          completed_courses: student?.completed_courses ?? [],
          assignments_completed: student?.assignments_completed ?? 0,
          assignments_failed: student?.assignments_failed ?? 0,
          capability_score: student?.capability_score ?? 0,
          graduation_status: enrollment?.status ?? 'NOT_ENROLLED',
          current_lesson: enrollment?.current_lesson_id ?? null,
          overall_score: enrollment?.total_score ?? 0
        };
      });
      
      return { 
        status: 'COMPLETED', 
        reply: `Academy progress retrieved for ${agents.length} agent(s).`,
        command,
        progress: { agents: progress, total_students: academyState.students.length }
      };
    } catch (error) {
      return { 
        status: 'FAILED', 
        reply: error instanceof Error ? error.message : String(error), 
        command 
      };
    }
  }
  
  if (command.kind === 'ACADEMY_NEXT_LESSON') {
    try {
      const academy = await runPersistedAcademyCycle({ repositoryRoot });
      return { 
        status: 'COMPLETED', 
        reply: `Next Academy lesson assigned. ${academy.assignments_created} new assignment(s) created. Receipt: ${academy.receipt_id}.`,
        command,
        academy 
      };
    } catch (error) {
      return { 
        status: 'FAILED', 
        reply: error instanceof Error ? error.message : String(error), 
        command 
      };
    }
  }
  
  if (command.kind === 'ACADEMY_GRADUATION') {
    try {
      const graduationState = await loadGraduationState(repositoryRoot);
      const lake = await bootstrapLakeYange({ repositoryRoot });
      
      const agents = command.agentId 
        ? [command.agentId]
        : lake.state.citizens.map(c => c.system_id);
      
      const graduationInfo = agents.map(agentId => {
        const enrollment = graduationState.enrollments.find(e => e.agent_id === agentId);
        const graduationRecord = graduationState.graduation_records.find(
          r => r.agent_id === agentId
        );
        
        const allLessons = graduationState.curriculum.lessons || [];
        
        return {
          agent_id: agentId,
          graduation_status: enrollment?.status ?? 'NOT_ENROLLED',
          society_eligible: enrollment?.final_score ? enrollment.final_score >= 70 : false,
          overall_score: enrollment?.total_score ?? 0,
          completed_lessons: enrollment?.completed_lessons?.length ?? 0,
          total_lessons: allLessons.length,
          has_graduate: !!graduationRecord,
          certificate_id: graduationRecord?.record_id ?? null
        };
      });
      
      return { 
        status: 'COMPLETED', 
        reply: `Graduation status retrieved for ${agents.length} agent(s).`,
        command,
        progress: { agents: graduationInfo }
      };
    } catch (error) {
      return { 
        status: 'FAILED', 
        reply: error instanceof Error ? error.message : String(error), 
        command 
      };
    }
  }
  
  if (command.kind === 'ACADEMY_CYCLE') {
    try {
      const academy = await runPersistedAcademyCycle({ repositoryRoot });
      return { 
        status: 'COMPLETED', 
        reply: `Academy cycle completed. ${academy.assignments_created} assignment(s) created; ${academy.students_enrolled} student(s) enrolled. Receipt: ${academy.receipt_id}.`,
        command,
        academy 
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'ACADEMY_LOCAL_MODEL_OFFLINE') {
        return { 
          status: 'UNSUPPORTED', 
          reply: 'The local Academy model is offline. No agent work was executed.', 
          command 
        };
      }
      return { 
        status: 'FAILED', 
        reply: error instanceof Error ? error.message : String(error), 
        command 
      };
    }
  }
  
  return { 
    status: 'UNSUPPORTED', 
    reply: 'Unknown Academy command.', 
    command 
  };
}

export async function executePrimePersistedAcademyCommand(repositoryRoot: string): Promise<PrimeAgentCommandResult> {
  const command: PrimeAgentCommand = { kind: 'ACADEMY_CYCLE', dryRun: false };
  const academy = await runPersistedAcademyCycle({ repositoryRoot });
  return { status: 'COMPLETED', reply: `Academy curriculum cycle persisted. Receipt ${academy.receipt_id}.`, command, academy };
}
