import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerEntertainment,
  looksLikeEntertainmentRequest
} from '../runtime/prime-entertainment.js';

test('Prime recognises a cultural discovery request', () => {
  assert.equal(looksLikeEntertainmentRequest('Find dark electronic music for a late-night drive.'), true);
  assert.equal(looksLikeEntertainmentRequest('Run a revenue validation mission.'), false);
});

test('Prime Entertainment returns explainable music discovery without provider claims', () => {
  const answer = answerEntertainment('Find me dark electronic music for a late-night drive.');
  assert.equal(answer.status, 'ENTERTAINMENT_ANSWER');
  assert.ok(answer.recommendations.length > 0);
  assert.equal(answer.recommendations[0]?.item.kind, 'MUSIC');
  assert.match(answer.reply, /editorial discovery suggestions/i);
  assert.match(answer.facts[0] ?? '', /EDITORIAL_BOOTSTRAP/);
  assert.ok(answer.recommendations.every(result => result.why.length > 10));
});

test('less dystopian cinema request avoids dystopian result when alternatives exist', () => {
  const answer = answerEntertainment('Give me films like Blade Runner but less dystopian.');
  assert.ok(answer.recommendations.length > 0);
  assert.equal(answer.recommendations[0]?.item.moods.includes('dystopian'), false);
  assert.ok(answer.recommendations.every(result => result.item.kind === 'FILM'));
});
