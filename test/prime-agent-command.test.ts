import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executePrimePersistedAcademyCommand, interpretPrimeAgentCommand, executePrimeAgentCommand } from '../runtime/prime-agent-command.js';

test('Prime recognizes a supported Academy cycle command', () => {
  assert.deepEqual(interpretPrimeAgentCommand('Prime, run the next Academy cycle'), { kind: 'ACADEMY_CYCLE', dryRun: false });
});

test('Prime refuses arbitrary research when no supported topic executor exists', async () => {
  const result = await executePrimeAgentCommand('/tmp/lake-yange-test', 'Prime, have the Academy agents research TypeScript performance.');
  assert.equal(result.status, 'UNSUPPORTED');
  assert.match(result.reply, /not currently exposed|local Academy runtime/i);
});

test('Prime reports persisted work without executing a new mission', async () => {
  const result = await executePrimeAgentCommand('/tmp/lake-yange-test', 'Prime, what are the agents working on?');
  assert.equal(result.status, 'COMPLETED');
  assert.match(result.reply, /persisted work/i);
  assert.equal(result.command.kind, 'REPORT_WORK');
});

test('Prime persisted Academy command uses the real Academy adapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lake-yange-prime-academy-'));
  try {
    const result = await executePrimePersistedAcademyCommand(root);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.command.kind, 'ACADEMY_CYCLE');
    assert.equal(result.academy?.authority, 'EDUCATIONAL_ONLY');
    assert.match(result.reply, /curriculum cycle persisted/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
