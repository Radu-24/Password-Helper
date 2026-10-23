'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const analysis = require('../../src/analysis');

test('returns a plain, serialisable result', () => {
  const result = analysis.analyze('Password1!');
  assert.deepEqual(Object.keys(result).sort(), ['crackTime', 'feedback', 'guessesLog10', 'matches', 'score', 'truncated']);
  assert.equal(result.score <= 1, true, 'a famous password scores low');
  assert.equal(typeof result.crackTime.offlineSlowHashing, 'string');
  assert.equal(JSON.parse(JSON.stringify(result)).score, result.score);
  assert.equal('password' in result, false, 'the password itself is not echoed back');
});

test('knows Romanian words and the user\'s own details', () => {
  const ro = analysis.analyze('dragoste');
  assert.ok(ro.matches.some((match) => /-ro$/.test(match.dictionaryName || '')));
  const withEmail = analysis.analyze('radu.matei.2026', ['radu.matei.2026@example.com', 'radu.matei.2026']);
  assert.ok(withEmail.matches.some((match) => match.dictionaryName === 'userInputs'));
});

test('long input is truncated by code point, not rejected', () => {
  const result = analysis.analyze('🔐'.repeat(400));
  assert.equal(result.truncated, true);
  assert.throws(() => analysis.analyze(42), TypeError);
});

test('strong passphrases score high', () => {
  assert.equal(analysis.analyze('correct horse battery staple').score, 4);
});
