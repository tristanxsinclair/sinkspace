import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { 
  interpretPrimeAgentCommand, 
  executePrimeAgentCommand 
} from '../runtime/prime-agent-command.js';

test('Prime recognizes Academy start command', () => {
  const result = interpretPrimeAgentCommand('Prime, start the Academy for this agent.');
  assert.equal(result.kind, 'ACADEMY_START');
});

test('Prime recognizes Academy progress command', () => {
  const result = interpretPrimeAgentCommand('Prime, show me the agent Academy progress.');
  assert.equal(result.kind, 'ACADEMY_PROGRESS');
});

test('Prime recognizes Academy next lesson command', () => {
  const result = interpretPrimeAgentCommand('Prime, give the agent its next Academy lesson.');
  assert.equal(result.kind, 'ACADEMY_NEXT_LESSON');
});

test('Prime recognizes Academy graduation command', () => {
  const result = interpretPrimeAgentCommand('Prime, report the agent graduation status.');
  assert.equal(result.kind, 'ACADEMY_GRADUATION');
});

test('Prime recognizes Academy cycle command', () => {
  const result = interpretPrimeAgentCommand('Prime, run the next Academy cycle.');
  assert.equal(result.kind, 'ACADEMY_CYCLE');
});

test('Prime executes persisted Academy cycle without local model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lake-yange-prime-academy-persisted-'));
  try {
    const result = await executePrimeAgentCommand(root, 'Prime, run the next Academy cycle.');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.command.kind, 'ACADEMY_CYCLE');
    assert(result.academy !== undefined);
    assert.match(result.reply, /Academy cycle completed/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Prime executes Academy start without local model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lake-yange-prime-academy-start-'));
  try {
    const result = await executePrimeAgentCommand(root, 'Prime, start the Academy.');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.command.kind, 'ACADEMY_START');
    assert(result.academy !== undefined);
    assert.match(result.reply, /Academy enrollment started/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Prime reports Academy progress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lake-yange-prime-academy-progress-'));
  try {
    const result = await executePrimeAgentCommand(root, 'Prime, show me Academy progress.');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.command.kind, 'ACADEMY_PROGRESS');
    assert(result.progress !== undefined);
    assert.match(result.reply, /Academy progress retrieved/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Prime reports graduation status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lake-yange-prime-graduation-'));
  try {
    const result = await executePrimeAgentCommand(root, 'Prime, report graduation status.');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.command.kind, 'ACADEMY_GRADUATION');
    assert(result.progress !== undefined);
    assert.match(result.reply, /Graduation status retrieved/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
