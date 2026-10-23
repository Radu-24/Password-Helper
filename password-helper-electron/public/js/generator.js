/**
 * Password / passphrase generator.
 *
 * Uses the platform CSPRNG (crypto.getRandomValues) with rejection sampling,
 * so every character / word is picked uniformly — no modulo bias.
 *
 * Loads as a classic <script> (window.PHGenerator) or via require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PHGenerator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SETS = Object.freeze({
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    // No quotes, backslash, backtick, spaces or <> — those break some sites and shells.
    symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
  });
  /** Characters that are easy to confuse when read or typed by hand. */
  const AMBIGUOUS = 'Il1O0o';
  const SET_NAMES = Object.freeze(['lowercase', 'uppercase', 'digits', 'symbols']);
  const LIMITS = Object.freeze({ minLength: 8, maxLength: 128, minWords: 3, maxWords: 12 });

  const defaultRandomValues = (array) => globalThis.crypto.getRandomValues(array);

  /**
   * Uniform integer in [0, max) using rejection sampling.
   * @param {number} max  1 … 2^32
   * @param {(array: Uint32Array) => Uint32Array} [getRandomValues]
   */
  function randomInt(max, getRandomValues = defaultRandomValues) {
    if (!Number.isInteger(max) || max < 1 || max > 2 ** 32) throw new RangeError('max must be an integer between 1 and 2^32');
    const limit = Math.floor(2 ** 32 / max) * max; // largest multiple of max that fits
    const buffer = new Uint32Array(1);
    for (;;) {
      getRandomValues(buffer);
      if (buffer[0] < limit) return buffer[0] % max;
    }
  }

  function enabledSets(options) {
    const strip = (chars) => (options.avoidAmbiguous ? [...chars].filter((c) => !AMBIGUOUS.includes(c)).join('') : chars);
    return SET_NAMES.filter((name) => options[name]).map((name) => strip(SETS[name]));
  }

  /**
   * Random password containing at least one character from every enabled set.
   * Whole candidates are re-drawn until they qualify, which keeps the result
   * uniform over all valid passwords.
   */
  function generatePassword(options = {}, getRandomValues = defaultRandomValues) {
    const opts = { length: 20, lowercase: true, uppercase: true, digits: true, symbols: true, avoidAmbiguous: false, ...options };
    const length = Math.trunc(opts.length);
    if (!(length >= LIMITS.minLength && length <= LIMITS.maxLength)) {
      throw new RangeError(`Length must be ${LIMITS.minLength}–${LIMITS.maxLength}.`);
    }
    const sets = enabledSets(opts);
    if (sets.length === 0) throw new Error('Choose at least one character type.');
    const pool = sets.join('');
    for (let attempt = 0; attempt < 10_000; attempt++) {
      let password = '';
      for (let i = 0; i < length; i++) password += pool[randomInt(pool.length, getRandomValues)];
      if (sets.every((set) => [...password].some((char) => set.includes(char)))) return password;
    }
    throw new Error('Could not generate a password with these settings.');
  }

  /** Diceware-style passphrase, e.g. "Orbit-Lantern-Velvet-Cactus7-Jumbo-Mango". */
  function generatePassphrase(options = {}, wordlist, getRandomValues = defaultRandomValues) {
    const opts = { words: 6, separator: '-', capitalize: true, addNumber: false, ...options };
    const count = Math.trunc(opts.words);
    if (!(count >= LIMITS.minWords && count <= LIMITS.maxWords)) {
      throw new RangeError(`Use ${LIMITS.minWords}–${LIMITS.maxWords} words.`);
    }
    if (!Array.isArray(wordlist) || wordlist.length < 2) throw new Error('A wordlist is required.');
    const parts = [];
    for (let i = 0; i < count; i++) {
      const word = wordlist[randomInt(wordlist.length, getRandomValues)];
      parts.push(opts.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word);
    }
    if (opts.addNumber) {
      const index = randomInt(parts.length, getRandomValues);
      parts[index] += String(randomInt(10, getRandomValues));
    }
    return parts.join(opts.separator);
  }

  /** Entropy in bits of a password made with these options (upper bound). */
  function passwordEntropy(options) {
    const pool = enabledSets({ lowercase: true, uppercase: true, digits: true, symbols: true, ...options }).join('').length;
    return pool > 1 ? options.length * Math.log2(pool) : 0;
  }

  function passphraseEntropy(options, wordlistSize) {
    let bits = options.words * Math.log2(wordlistSize);
    if (options.addNumber) bits += Math.log2(10) + Math.log2(options.words);
    return bits;
  }

  /** Rough label for an entropy value (bits). */
  function entropyLabel(bits) {
    if (bits >= 80) return 'Very Strong';
    if (bits >= 64) return 'Strong';
    if (bits >= 50) return 'Fair';
    if (bits >= 36) return 'Weak';
    return 'Very Weak';
  }

  return Object.freeze({
    SETS,
    AMBIGUOUS,
    LIMITS,
    randomInt,
    generatePassword,
    generatePassphrase,
    passwordEntropy,
    passphraseEntropy,
    entropyLabel,
  });
});
