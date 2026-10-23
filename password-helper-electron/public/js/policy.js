/**
 * Password policy — one source of truth for every page (analyzer, register
 * form, vault) and for the main process.
 *
 * Loads as a classic <script> (exposes window.PHPolicy) or via require().
 *
 * Based on NIST SP 800-63B-4, §3.1.1 (Passwords):
 *  - length is what matters: at least 15 characters for a password used on its own
 *  - no composition rules ("must contain a symbol" is explicitly discouraged)
 *  - compare against known common / breached passwords
 *  - accept spaces and Unicode, counting each Unicode code point as one character
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PHPolicy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_LENGTH = 15;
  const MAX_LENGTH = 128;
  /** zxcvbn score (0–4) a new password must reach. 3 = "Strong". */
  const MIN_SCORE = 3;
  const SCORE_LABELS = Object.freeze(['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong']);

  /** Length in Unicode code points ("ă" and "🔐" both count as 1). */
  function charCount(text) {
    return typeof text === 'string' ? Array.from(text).length : 0;
  }

  function scoreLabel(score) {
    const index = Math.max(0, Math.min(4, Math.trunc(Number(score) || 0)));
    return SCORE_LABELS[index];
  }

  /**
   * Finds `suffix` in a Pwned Passwords range response ("SUFFIX:COUNT" per line).
   * Padding rows (count 0) and malformed lines are ignored.
   * @returns {number} times seen in breaches (0 = not found)
   */
  function parseRangeCount(body, suffix) {
    if (typeof body !== 'string' || typeof suffix !== 'string' || !suffix) return 0;
    const target = suffix.trim().toUpperCase();
    for (const line of body.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      if (line.slice(0, separator).trim().toUpperCase() !== target) continue;
      const count = Number.parseInt(line.slice(separator + 1), 10);
      return Number.isFinite(count) && count > 0 ? count : 0;
    }
    return 0;
  }

  /**
   * Checks a NEW password (account or master password) against the policy.
   * A breach check that couldn't run ("error"/"off") does not block — the UI warns instead.
   *
   * @param {object} input
   * @param {string} input.password
   * @param {{score:number}|null} [input.analysis]  result of window.api.analyze()
   * @param {{status:string, count?:number}} [input.breach]
   * @param {string} [input.confirm]  pass to also require a matching confirmation
   */
  function evaluateNewPassword({ password, analysis = null, breach = { status: 'off' }, confirm }) {
    const count = charCount(password);
    const checks = {
      length: { ok: count >= MIN_LENGTH && count <= MAX_LENGTH, count, min: MIN_LENGTH, max: MAX_LENGTH },
      guess: { ok: Boolean(analysis) && analysis.score >= MIN_SCORE, pending: !analysis },
      breach: {
        ok: breach.status !== 'breached' && breach.status !== 'checking',
        status: breach.status,
        count: breach.count || 0,
      },
    };
    if (confirm !== undefined) checks.match = { ok: password.length > 0 && password === confirm };
    const ok = Object.values(checks).every((check) => check.ok);
    return { ok, checks };
  }

  const LANGUAGES = { en: 'English', ro: 'Romanian' };
  const DICTIONARY_KINDS = {
    commonWords: 'common words',
    firstnames: 'first names',
    lastnames: 'last names',
    wikipedia: 'Wikipedia words',
    months: 'month names',
    daysOfWeek: 'day names',
    seasons: 'season names',
    timePeriods: 'time words',
    cardinalNumbers: 'number words',
    ordinalNumbers: 'ordinal numbers',
    rainbowColors: 'colour names',
    directions: 'direction words',
    intermediateDirections: 'direction words',
    sizeProgression: 'size words',
    militaryAlphabet: 'NATO alphabet words',
    planets: 'planet names',
    zodiacSigns: 'zodiac signs',
    chineseZodiac: 'zodiac signs',
  };

  function describeDictionary(name) {
    if (!name) return 'a dictionary';
    if (name === 'passwords-common') return 'the common-passwords list';
    if (name === 'diceware-common') return 'common Diceware words';
    if (name === 'userInputs') return 'details you entered on this form';
    const [kind, language] = name.split('-');
    const kindLabel = DICTIONARY_KINDS[kind] || kind;
    return LANGUAGES[language] ? `${LANGUAGES[language]} ${kindLabel}` : kindLabel;
  }

  /** Human-readable explanation of one zxcvbn match, or null if not worth showing. */
  function describeMatch(match) {
    if (!match || typeof match.token !== 'string') return null;
    const token = `"${match.token}"`;
    switch (match.pattern) {
      case 'dictionary': {
        let text = `${token} — ${describeDictionary(match.dictionaryName)}`;
        if (match.l33t) text += ' (with l33t swaps)';
        if (match.reversed) text += ' (reversed)';
        return text;
      }
      case 'spatial': return `${token} — keyboard pattern`;
      case 'repeat': return `${token} — repeated characters`;
      case 'sequence': return `${token} — sequence like abc or 123`;
      case 'regex': return `${token} — looks like a recent year`;
      case 'date': return `${token} — looks like a date`;
      default: return null;
    }
  }

  return Object.freeze({
    MIN_LENGTH,
    MAX_LENGTH,
    MIN_SCORE,
    SCORE_LABELS,
    charCount,
    scoreLabel,
    parseRangeCount,
    evaluateNewPassword,
    describeDictionary,
    describeMatch,
  });
});
