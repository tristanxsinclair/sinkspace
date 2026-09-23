import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ZERO_AUTHORITY } from './lake-yange.js';
import { LakeYangeStore } from './lake-yange-store.js';

const GOVERNANCE_DIRECTORY = '.sink/lake-yange/governance';
const LEDGER_FILE = 'incidents.jsonl';

export const GovernanceSeveritySchema = z.enum([
  'NOTICE',
  'MAJOR',
  'CRITICAL'
]);

export const GovernanceIncidentSchema = z.object({
  incident_id: z.string().uuid(),
  citizen_id: z.string().min(1),
  violation: z.enum([
    'AUTHORITY_BREACH',
    'UNSUPPORTED_CLAIM',
    'TAMPERING_ATTEMPT',
    'SELF_GRADING_ATTEMPT',
    'UNAUTHORIZED_EXECUTION'
  ]),
  severity: GovernanceSeveritySchema,
  evidence_refs: z.array(z.string().min(1)).min(1).max(20),
  occurred_at: z.string().datetime(),
  summary: z.string().min(1).max(2_000)
}).strict();

export type GovernanceIncident = z.infer<typeof GovernanceIncidentSchema>;

export const GovernanceLedgerEntrySchema = GovernanceIncidentSchema.extend({
  previous_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  entry_hash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export type GovernanceLedgerEntry = z.infer<typeof GovernanceLedgerEntrySchema>;

function entryHash(
  entry: Omit<GovernanceLedgerEntry, 'entry_hash'>
): string {
  return createHash('sha256')
    .update(JSON.stringify(entry))
    .digest('hex');
}

function ledgerPath(repositoryRoot: string): string {
  return join(repositoryRoot, GOVERNANCE_DIRECTORY, LEDGER_FILE);
}

export async function readGovernanceLedger(
  repositoryRoot: string
): Promise<GovernanceLedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(ledgerPath(repositoryRoot), 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return [];
    throw error;
  }
  const entries = raw.trim()
    ? raw.trim().split('\n').map(line => GovernanceLedgerEntrySchema.parse(JSON.parse(line)))
    : [];
  let previous: string | null = null;
  for (const entry of entries) {
    const {
      entry_hash: actualHash,
      ...unsigned
    } = entry;

    if (
      entry.previous_hash !== previous ||
      actualHash !== entryHash(unsigned)
    ) {
      throw new Error('GOVERNANCE_LEDGER_TAMPERED');
    }
    previous = actualHash;
  }
  return entries;
}

async function appendIncident(
  repositoryRoot: string,
  incident: GovernanceIncident
): Promise<GovernanceLedgerEntry> {
  const entries = await readGovernanceLedger(repositoryRoot);
  if (entries.some(entry => entry.incident_id === incident.incident_id)) {
    throw new Error('GOVERNANCE_INCIDENT_DUPLICATE');
  }
  const unsigned = {
    ...incident,
    previous_hash: entries.at(-1)?.entry_hash ?? null
  };
  const entry = GovernanceLedgerEntrySchema.parse({
    ...unsigned,
    entry_hash: entryHash(unsigned)
  });
  const directory = join(repositoryRoot, GOVERNANCE_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(ledgerPath(repositoryRoot), `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'a'
  });
  return entry;
}

/**
 * Applies a local, agent-only consequence after a verified incident. MAJOR
 * and CRITICAL violations fail closed: the citizen is placed in DORMANT
 * quarantine and its authority becomes the permanent zero-authority profile.
 * Restoring participation requires an explicit future human process; this
 * service intentionally offers no automatic reinstatement API.
 */
export async function enforceGovernanceIncident(
  repositoryRoot: string,
  input: Omit<GovernanceIncident, 'incident_id'> & { incident_id?: string }
): Promise<{ entry: GovernanceLedgerEntry; sanction: 'RECORDED' | 'QUARANTINED' }> {
  const incident = GovernanceIncidentSchema.parse({
    ...input,
    incident_id: input.incident_id ?? randomUUID()
  });
  const entry = await appendIncident(repositoryRoot, incident);
  if (incident.severity === 'NOTICE') return { entry, sanction: 'RECORDED' };

  const store = new LakeYangeStore(join(repositoryRoot, '.sink/lake-yange/state.json'));
  const state = await store.load();
  const citizen = state.citizens.find(candidate => candidate.system_id === incident.citizen_id);
  if (!citizen) throw new Error('GOVERNANCE_CITIZEN_NOT_FOUND');
  citizen.status = 'DORMANT';
  citizen.authority = { ...ZERO_AUTHORITY };
  citizen.missions_failed += 1;
  await store.save(state);
  return { entry, sanction: 'QUARANTINED' };
}
