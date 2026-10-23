'use strict';

/**
 * Password strength analysis (main process).
 *
 * Wraps zxcvbn-ts with the common + English + Romanian dictionaries. It runs in
 * the main process so the ~8 MB of dictionaries are loaded once per app run
 * instead of on every page, and so the vault can reuse it later.
 */

const { ZxcvbnFactory } = require('@zxcvbn-ts/core');
const common = require('@zxcvbn-ts/language-common');
const en = require('@zxcvbn-ts/language-en');
const ro = require('@zxcvbn-ts/language-ro');

/** Longer input is truncated before analysis (zxcvbn's cost grows with length). */
const MAX_LENGTH = 256;
const MAX_USER_INPUTS = 10;

let factory = null;

function getFactory() {
  if (!factory) {
    factory = new ZxcvbnFactory({
      translations: en.translations,
      graphs: common.adjacencyGraphs,
      dictionary: { ...common.dictionary, ...en.dictionary, ...ro.dictionary },
      // The default (100) is ~5x slower; 10 produced identical scores on our test set.
      l33tMaxSubstitutions: 10,
      maxLength: MAX_LENGTH,
    });
  }
  return factory;
}

/**
 * Extra words that should count as "easy to guess" for this password,
 * e.g. the e-mail address on the register form or the site name in the vault.
 */
function sanitizeUserInputs(userInputs) {
  if (!Array.isArray(userInputs)) return [];
  return userInputs
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .slice(0, MAX_USER_INPUTS)
    .map((value) => value.trim().slice(0, MAX_LENGTH));
}

/**
 * @param {string} password
 * @param {string[]} [userInputs]
 * @returns {{score:number, guessesLog10:number, crackTime:object, feedback:object, matches:object[], truncated:boolean}}
 */
function analyze(password, userInputs = []) {
  if (typeof password !== 'string') throw new TypeError('password must be a string');

  // Truncate by code points so we never split a surrogate pair. (A code point is
  // at most 2 UTF-16 units, so pre-slicing to 2 × MAX_LENGTH loses nothing and
  // keeps a huge pasted string from being expanded in full.)
  const codePoints = Array.from(password.slice(0, MAX_LENGTH * 2));
  const input = codePoints.slice(0, MAX_LENGTH).join('');
  const result = getFactory().check(input, sanitizeUserInputs(userInputs));
  const times = result.crackTimes;

  return {
    score: result.score,
    guessesLog10: result.guessesLog10,
    crackTime: {
      offlineSlowHashing: times.offlineSlowHashingXPerSecond.display,
      offlineFastHashing: times.offlineFastHashingXPerSecond.display,
      onlineThrottled: times.onlineThrottlingXPerHour.display,
      onlineUnthrottled: times.onlineNoThrottlingXPerSecond.display,
    },
    feedback: {
      warning: result.feedback.warning || null,
      suggestions: [...result.feedback.suggestions],
    },
    matches: result.sequence.map((match) => ({
      pattern: match.pattern,
      token: match.token,
      dictionaryName: match.dictionaryName || null,
      l33t: Boolean(match.l33t),
      reversed: Boolean(match.reversed),
    })),
    truncated: codePoints.length > MAX_LENGTH || password.length > MAX_LENGTH * 2,
  };
}

/** Builds the dictionaries ahead of time so the first keystroke is fast. */
function warmUp() {
  getFactory();
}

module.exports = { analyze, warmUp, MAX_LENGTH };
