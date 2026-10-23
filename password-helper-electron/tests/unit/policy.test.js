'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Policy = require('../../public/js/policy.js');

test('charCount counts Unicode code points, not UTF-16 units', () => {
  assert.equal(Policy.charCount('abc'), 3);
  assert.equal(Policy.charCount('ăîșțâ'), 5);
  assert.equal(Policy.charCount('🔐🔑'), 2); // '🔐🔑'.length === 4
  assert.equal(Policy.charCount(''), 0);
  assert.equal(Policy.charCount(undefined), 0);
});

test('policy constants follow NIST SP 800-63B-4', () => {
  assert.equal(Policy.MIN_LENGTH, 15);
  assert.ok(Policy.MAX_LENGTH >= 64);
  assert.equal(Policy.MIN_SCORE, 3);
});

test('scoreLabel clamps out-of-range scores', () => {
  assert.equal(Policy.scoreLabel(0), 'Very Weak');
  assert.equal(Policy.scoreLabel(4), 'Very Strong');
  assert.equal(Policy.scoreLabel(9), 'Very Strong');
  assert.equal(Policy.scoreLabel(-3), 'Very Weak');
  assert.equal(Policy.scoreLabel('x'), 'Very Weak');
});

test('parseRangeCount handles CRLF/LF, case and padding rows', () => {
  const body = '0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\r\nABCDEF0123456789ABCDEF0123456789ABC:0\nDEADBEEF:not-a-number\n';
  assert.equal(Policy.parseRangeCount(body, '00d4f6e8fa6eecad2a3aa415eec418d38ec'), 2);
  assert.equal(Policy.parseRangeCount(body, '0018A45C4D1DEF81644B54AB7F969B88D65'), 1);
  assert.equal(Policy.parseRangeCount(body, 'ABCDEF0123456789ABCDEF0123456789ABC'), 0, 'padding rows (count 0) are not breaches');
  assert.equal(Policy.parseRangeCount(body, 'DEADBEEF'), 0, 'malformed counts are ignored');
  assert.equal(Policy.parseRangeCount(body, 'FFFF'), 0);
  assert.equal(Policy.parseRangeCount(null, 'FFFF'), 0);
  assert.equal(Policy.parseRangeCount(body, ''), 0);
});

test('evaluateNewPassword combines length, guessability, breaches and confirmation', () => {
  const strong = { score: 4 };
  const ok = Policy.evaluateNewPassword({ password: 'a'.repeat(15), analysis: strong, breach: { status: 'clean' }, confirm: 'a'.repeat(15) });
  assert.equal(ok.ok, true);

  const short = Policy.evaluateNewPassword({ password: 'short', analysis: strong });
  assert.equal(short.ok, false);
  assert.equal(short.checks.length.count, 5);

  const weak = Policy.evaluateNewPassword({ password: 'x'.repeat(20), analysis: { score: 2 } });
  assert.equal(weak.checks.guess.ok, false);

  const pending = Policy.evaluateNewPassword({ password: 'x'.repeat(20), analysis: null });
  assert.equal(pending.checks.guess.pending, true);

  const breached = Policy.evaluateNewPassword({ password: 'x'.repeat(20), analysis: strong, breach: { status: 'breached', count: 3 } });
  assert.equal(breached.ok, false);
  assert.equal(breached.checks.breach.count, 3);

  const offline = Policy.evaluateNewPassword({ password: 'x'.repeat(20), analysis: strong, breach: { status: 'error' } });
  assert.equal(offline.ok, true, 'an unavailable breach check does not block');

  const checking = Policy.evaluateNewPassword({ password: 'x'.repeat(20), analysis: strong, breach: { status: 'checking' } });
  assert.equal(checking.ok, false, 'wait for a running breach check');

  const mismatch = Policy.evaluateNewPassword({ password: 'x'.repeat(20), analysis: strong, confirm: 'y' });
  assert.equal(mismatch.checks.match.ok, false);

  const tooLong = Policy.evaluateNewPassword({ password: 'x'.repeat(Policy.MAX_LENGTH + 1), analysis: strong });
  assert.equal(tooLong.checks.length.ok, false);
});

test('describeMatch explains zxcvbn patterns in plain words', () => {
  assert.equal(
    Policy.describeMatch({ pattern: 'dictionary', token: 'ploiesti', dictionaryName: 'commonWords-ro' }),
    '"ploiesti" — Romanian common words',
  );
  assert.match(Policy.describeMatch({ pattern: 'dictionary', token: 'P@ss', dictionaryName: 'passwords-common', l33t: true }), /common-passwords list \(with l33t swaps\)/);
  assert.match(Policy.describeMatch({ pattern: 'spatial', token: 'qwerty' }), /keyboard pattern/);
  assert.match(Policy.describeMatch({ pattern: 'regex', token: '2024' }), /year/);
  assert.equal(Policy.describeMatch({ pattern: 'bruteforce', token: 'x9' }), null);
  assert.equal(Policy.describeDictionary('userInputs'), 'details you entered on this form');
  assert.equal(Policy.describeDictionary('months-en'), 'English month names');
});
