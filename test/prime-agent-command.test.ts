import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executePrimePersistedAcademyCommand, interpretPrimeAgentCommand, executePrimeAgentCommand } from '../runtime/prime-agent-command.js';

test('Prime recognizes a supported Academy cycle command', () => {
  assert.deepEqual(interpretPrimeAgentCommand('Prime, run the next Academy cycle'), { kind: 'ACADEMY_CYCLE', dryRun: false });
});

test('Prime recognizes natural phrasings for the next Academy lesson', () => {
  assert.deepEqual(interpretPrimeAgentCommand('Prime, give the agent its next Academy lesson.'), { kind: 'ACADEMY_NEXT_LESSON' });
  assert.deepEqual(interpretPrimeAgentCommand('Please assign the next lesson in the Academy for Atlas'), { kind: 'ACADEMY_NEXT_LESSON', agentId: 'Atlas' });
});

test('Prime recognizes Academy progress and graduation questions', () => {
  assert.deepEqual(interpretPrimeAgentCommand("How is Atlas doing in the Academy?"), { kind: 'ACADEMY_PROGRESS', agentId: 'Atlas' });
  assert.deepEqual(interpretPrimeAgentCommand('Is agent SINK-03 eligible to graduate?'), { kind: 'ACADEMY_GRADUATION', agentId: 'SINK-03' });
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

test('Prime parses topic training requests', () => {
  assert.deepEqual(
    interpretPrimeAgentCommand("train the academy for 'future government ambitions' 'ai infastructure' 'agent work'"),
    { kind: 'ACADEMY_TRAIN', topics: ['future government ambitions', 'ai infastructure', 'agent work'] }
  );
  assert.deepEqual(
    interpretPrimeAgentCommand('Train the Academy on AI infrastructure, agent work and future government ambitions.'),
    { kind: 'ACADEMY_TRAIN', topics: ['AI infrastructure', 'agent work', 'future government ambitions'] }
  );
});

test('Prime topic training creates educational-only assignments with a receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prime-train-'));
  try {
    const result = await executePrimeAgentCommand(root, "train the academy for 'AI infrastructure' and 'agent work'");
    assert.equal(result.status, 'COMPLETED');
    assert.match(result.reply, /AI infrastructure/);
    const receipt = result.academy as { assignments_created: number; authority: string; external_actions: number };
    assert.ok(receipt.assignments_created > 0);
    assert.equal(receipt.authority, 'EDUCATIONAL_ONLY');
    assert.equal(receipt.external_actions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
