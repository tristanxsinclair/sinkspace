import { z } from 'zod';
import { MemorySchema, type Memory } from './contracts.js';
import type { Run, Task } from './contracts.js';
import { ControlError } from './security.js';

export const RememberInputSchema = z.strictObject({
  kind: z.enum(['RUN', 'WORKING']),
  content: z.string().min(1).max(20000),
  confidence: z.number().min(0).max(1),
  provenance: z.array(z.string().min(1)).min(1),
  expires_at: z.iso.datetime().nullable().default(null),
  supersedes: z.string().min(1).nullable().default(null)
});

export type RememberInput = z.input<typeof RememberInputSchema>;

export interface MemoryAccess {
  list(): Array<{item: Memory; freshness: 'FRESH' | 'STALE' | 'UNKNOWN'}>;
  remember(input: RememberInput): Promise<Memory>;
}

export function runMemory(
  run: Run,
  task: Task,
  agentId: string,
  now: () => string,
  id: () => string,
  guard: () => void,
  updated: (memory: Memory) => Promise<void>
): MemoryAccess {
  const missionScope = `run:${run.run_id}`;
  const workingScope = `agent:${agentId}:run:${run.run_id}`;

  return {
    list() {
      guard();
      const currentTime = new Date(now());
      return (run.memories ?? [])
        .filter(item =>
          item.scope === missionScope ||
          item.scope === workingScope
        )
        .map(item => ({
          item: structuredClone(item),
          freshness: item.expires_at === null
            ? 'UNKNOWN' as const
            : Date.parse(item.expires_at) <= currentTime.getTime()
              ? 'STALE' as const
              : 'FRESH' as const
        }));
    },
    async remember(rawInput) {
      guard();
      if (
        !run.agent_configs.find(agent => agent.id === agentId)?.capabilities.includes('mission_memory_write') ||
        task.capability_requirements && !task.capability_requirements.includes('mission_memory_write')
      ) {
        throw new ControlError('UNAUTHORIZED_CAPABILITY', 'mission_memory_write');
      }
      const input = RememberInputSchema.parse(rawInput);
      if (task.run_id !== run.run_id || task.assigned_agent !== agentId) {
        throw new ControlError('MEMORY_CONTEXT_MISMATCH');
      }
      const evidenceIds = new Set(run.evidence.map(item => item.evidence_id));
      if (input.provenance.some(evidenceId => !evidenceIds.has(evidenceId))) {
        throw new ControlError('MEMORY_PROVENANCE_MISMATCH');
      }
      const scope = input.kind === 'RUN' ? missionScope : workingScope;
      if (
        input.supersedes !== null &&
        !(run.memories ?? []).some(item => item.id === input.supersedes && item.scope === scope)
      ) {
        throw new ControlError('MEMORY_SUPERSESSION_MISMATCH');
      }
      const item = MemorySchema.parse({
        id: id(),
        kind: input.kind,
        scope,
        content: input.content,
        source: `agent:${agentId}`,
        timestamp: now(),
        confidence: input.confidence,
        provenance: input.provenance,
        expires_at: input.expires_at,
        supersedes: input.supersedes
      });
      run.memories ??= [];
      run.memories.push(item);
      await updated(item);
      return structuredClone(item);
    }
  };
}
