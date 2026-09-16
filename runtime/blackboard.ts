import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const BlackboardEntrySchema = z.strictObject({
  entry_id: z.string().min(1),
  run_id: z.string().min(1),
  agent_id: z.string().min(1),
  task_id: z.string().nullable(),
  kind: z.enum([
    'FACT',
    'HYPOTHESIS',
    'UNCERTAINTY',
    'DECISION',
    'OBJECTION',
    'NEXT_ACTION'
  ]),
  content: z.string().min(1),
  evidence_ids: z.array(z.string()),
  created_at: z.string()
});

export type BlackboardEntry =
  z.infer<typeof BlackboardEntrySchema>;

export class Blackboard {
  private readonly entries: BlackboardEntry[] = [];

  add(input: {
    run_id: string;
    agent_id: string;
    task_id?: string | null;
    kind: BlackboardEntry['kind'];
    content: string;
    evidence_ids?: string[];
  }): BlackboardEntry {
    const entry = BlackboardEntrySchema.parse({
      entry_id: randomUUID(),
      run_id: input.run_id,
      agent_id: input.agent_id,
      task_id: input.task_id ?? null,
      kind: input.kind,
      content: input.content,
      evidence_ids: input.evidence_ids ?? [],
      created_at: new Date().toISOString()
    });

    this.entries.push(entry);

    return entry;
  }

  all(run_id: string): BlackboardEntry[] {
    return this.entries
      .filter(entry => entry.run_id === run_id)
      .map(entry => ({ ...entry }));
  }

  byKind(
    run_id: string,
    kind: BlackboardEntry['kind']
  ): BlackboardEntry[] {
    return this.all(run_id)
      .filter(entry => entry.kind === kind);
  }

  forAgent(
    run_id: string,
    agent_id: string
  ): BlackboardEntry[] {
    return this.all(run_id)
      .filter(entry => entry.agent_id === agent_id);
  }
}
