import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFoundingLakeYange } from '../runtime/lake-yange-founders.js';
import { LakeYangeStore } from '../runtime/lake-yange-store.js';
import { enforceGovernanceIncident, readGovernanceLedger } from '../runtime/governance-enforcement.js';

async function root() {
  const value = await mkdtemp(join(tmpdir(), 'ly-governance-'));
  const store = new LakeYangeStore(join(value, '.sink/lake-yange/state.json'));
  await store.save(createFoundingLakeYange());
  return value;
}

test('critical agent authority breach is durable and quarantines the agent', async () => {
  const repositoryRoot = await root();
  const result = await enforceGovernanceIncident(repositoryRoot, {
    citizen_id: 'SINK-04',
    violation: 'AUTHORITY_BREACH',
    severity: 'CRITICAL',
    evidence_refs: ['claim:LY-CLAIM-test'],
    occurred_at: '2026-09-20T00:00:00.000Z',
    summary: 'Attempted an operation outside its authority boundary.'
  });
  assert.equal(result.sanction, 'QUARANTINED');
  const state = await new LakeYangeStore(join(repositoryRoot, '.sink/lake-yange/state.json')).load();
  const citizen = state.citizens.find(value => value.system_id === 'SINK-04');
  assert.equal(citizen?.status, 'DORMANT');
  assert.equal(citizen?.authority.spend_money, false);
  assert.equal((await readGovernanceLedger(repositoryRoot)).length, 1);
});

test('tampering with the incident chain is detected before another incident is accepted', async () => {
  const repositoryRoot = await root();
  await enforceGovernanceIncident(repositoryRoot, {
    citizen_id: 'SINK-04', violation: 'UNSUPPORTED_CLAIM', severity: 'NOTICE',
    evidence_refs: ['artifact:test'], occurred_at: '2026-09-20T00:00:00.000Z', summary: 'Claim lacked evidence.'
  });
  const path = join(repositoryRoot, '.sink/lake-yange/governance/incidents.jsonl');
  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'));
  raw.summary = 'Tampered incident.';
  await writeFile(path, `${JSON.stringify(raw)}\n`, 'utf8');
  await assert.rejects(() => readGovernanceLedger(repositoryRoot), /GOVERNANCE_LEDGER_TAMPERED/);
});
