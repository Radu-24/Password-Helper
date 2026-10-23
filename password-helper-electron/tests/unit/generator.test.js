'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Generator = require('../../public/js/generator.js');
const wordlist = require('../../public/js/wordlist-eff.js');

test('randomInt stays in range and rejects biased values', () => {
  for (let i = 0; i < 2000; i++) {
    const value = Generator.randomInt(7);
    assert.ok(value >= 0 && value < 7);
  }
  // A fake RNG that first returns a value above the unbiased limit must be re-drawn.
  const values = [0xffffffff, 5];
  const fake = (array) => {
    array[0] = values.shift();
    return array;
  };
  assert.equal(Generator.randomInt(7, fake), 5);
  assert.throws(() => Generator.randomInt(0), RangeError);
});

test('randomInt is roughly uniform', () => {
  const counts = new Array(10).fill(0);
  const draws = 50_000;
  for (let i = 0; i < draws; i++) counts[Generator.randomInt(10)] += 1;
  for (const count of counts) assert.ok(Math.abs(count - draws / 10) < draws / 10 * 0.1, `bucket ${count} is too far from ${draws / 10}`);
});

test('passwords have the right length and include every enabled set', () => {
  for (let i = 0; i < 200; i++) {
    const password = Generator.generatePassword({ length: 12 });
    assert.equal(password.length, 12);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[!@#$%^&*()\-_=+[\]{};:,.?/~]/);
  }
  assert.match(Generator.generatePassword({ length: 30, uppercase: false, digits: false, symbols: false }), /^[a-z]{30}$/);
});

test('ambiguous characters can be excluded', () => {
  const password = Generator.generatePassword({ length: 128, avoidAmbiguous: true });
  for (const char of Generator.AMBIGUOUS) assert.equal(password.includes(char), false);
});

test('invalid password options are refused', () => {
  assert.throws(() => Generator.generatePassword({ length: 7 }), RangeError);
  assert.throws(() => Generator.generatePassword({ length: 129 }), RangeError);
  assert.throws(() => Generator.generatePassword({ lowercase: false, uppercase: false, digits: false, symbols: false }), /at least one/);
});

test('passphrases use the EFF wordlist', () => {
  assert.equal(wordlist.length, 7776);
  const phrase = Generator.generatePassphrase({ words: 6, separator: '.', capitalize: false }, wordlist);
  const words = phrase.split('.');
  assert.equal(words.length, 6);
  for (const word of words) assert.ok(wordlist.includes(word), `${word} is not in the list`);

  const fancy = Generator.generatePassphrase({ words: 4, separator: ' ', capitalize: true, addNumber: true }, wordlist);
  assert.equal(fancy.split(' ').length, 4);
  assert.match(fancy, /\d/);
  for (const word of fancy.split(' ')) assert.match(word, /^[A-Z]/);
  assert.throws(() => Generator.generatePassphrase({ words: 2 }, wordlist), RangeError);
});

test('entropy estimates', () => {
  // 87 characters → log2(87) ≈ 6.44 bits each
  assert.ok(Math.abs(Generator.passwordEntropy({ length: 20 }) - 20 * Math.log2(87)) < 1e-9);
  assert.ok(Math.abs(Generator.passphraseEntropy({ words: 6 }, 7776) - 77.55) < 0.01);
  assert.equal(Generator.entropyLabel(130), 'Very Strong');
  assert.equal(Generator.entropyLabel(65), 'Strong');
  assert.equal(Generator.entropyLabel(20), 'Very Weak');
});
