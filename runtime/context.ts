import type { PublicResearchRequest } from './public-research.js';
import type { Evidence, Run, Task, Artifact, Event } from './contracts.js';
import type { RepositoryReader } from './repository.js';
import type { CapabilityDescriptor } from './capabilities.js';
import type { MemoryAccess } from './memory.js';
export interface Observation { content: string; evidence: Evidence; artifact: Artifact }
export type EventMetadata = Pick<Event, 'capability_id' | 'memory_id' | 'evidence_ids'>;
export interface ExecutionContext {
  readonly run: Run;
  readonly task: Task;
  now(): string;
  id(): string;
  read(path: string): Promise<Observation>;
  inventory(): Promise<Observation>;
  systemProbe?(): Promise<Observation>;
  publicResearch?(request: PublicResearchRequest): Promise<Observation>;
  discoverCapabilities?(): CapabilityDescriptor[];
  invokeCapability?(id: string, input: unknown): Promise<unknown>;
  memory?: MemoryAccess;
  artifact(content: string, mediaType?: string): Artifact;
  emit(type: Event['type'], summary: string, metadata?: EventMetadata): void;
}
export interface RuntimeServices { repository: RepositoryReader; now: () => Date; id: () => string }
