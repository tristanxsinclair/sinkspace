import type { Status } from './contracts.js';
import { ControlError } from './security.js';
export const TERMINAL: readonly Status[] = ['COMPLETED','FAILED','BLOCKED','CANCELLED'];
const transitions: Record<Status, readonly Status[]> = {
  QUEUED: ['PLANNING','RUNNING','CANCELLED','FAILED','BLOCKED'], PLANNING: ['RUNNING','BLOCKED','FAILED','CANCELLED'],
  RUNNING: ['VERIFYING','WAITING_FOR_APPROVAL','WAITING_ON_DEPENDENCY','FAILED','BLOCKED','CANCELLED'],
  WAITING_FOR_APPROVAL: ['RUNNING','BLOCKED','CANCELLED'], WAITING_ON_DEPENDENCY: ['RUNNING','BLOCKED','CANCELLED'],
  VERIFYING: ['COMPLETED','FAILED','BLOCKED','CANCELLED'], COMPLETED: [], FAILED: [], BLOCKED: [], CANCELLED: [],
};
export function transition(from: Status, to: Status, completionSatisfied = false): Status {
  if (!transitions[from].includes(to) || (to === 'COMPLETED' && !completionSatisfied)) throw new ControlError('INVALID_STATE_TRANSITION', `${from} -> ${to}`);
  return to;
}
