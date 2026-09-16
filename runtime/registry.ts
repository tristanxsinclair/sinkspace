import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { AgentDefinitionSchema, type AgentDefinition } from './contracts.js';
import { ControlError } from './security.js';
export const RegistrySchema = z.strictObject({version: z.literal('0.2.0'), doctrine: z.string(), agents: z.array(AgentDefinitionSchema).min(1)});
export function loadRegistry(): AgentDefinition[] {
  const registry = RegistrySchema.parse(JSON.parse(readFileSync(new URL('../agents/registry.json', import.meta.url), 'utf8')));
  if (new Set(registry.agents.map(a => a.id)).size !== registry.agents.length) throw new ControlError('DUPLICATE_AGENT');
  return registry.agents;
}
export function specialist(registry: AgentDefinition[], capability: string): AgentDefinition {
  const candidates = registry.filter(a => a.enabled && a.capabilities.includes(capability));
  if (candidates.length !== 1) throw new ControlError('AMBIGUOUS_AGENT', `Expected one enabled agent for ${capability}`);
  return structuredClone(candidates[0]!);
}
