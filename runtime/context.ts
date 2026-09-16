import type { Evidence, Run, Task, Artifact, Event } from './contracts.js';
import type { RepositoryReader } from './repository.js';
export interface Observation { content: string; evidence: Evidence; artifact: Artifact }
export interface ExecutionContext {
  readonly run: Run;
  readonly task: Task;
  now(): string;
  id(): string;
  read(path: string): Promise<Observation>;
  inventory(): Promise<Observation>;
  artifact(content: string, mediaType?: string): Artifact;
  emit(type: Event['type'], summary: string): void;
}
export interface RuntimeServices { repository: RepositoryReader; now: () => Date; id: () => string }
