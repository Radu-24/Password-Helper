/**
 * Two-factor (TOTP) setup parsing — shared by the pages (live validation in
 * the edit form) and the main process (which re-validates and generates codes).
 *
 * Accepts either an otpauth:// link (what QR codes contain) or a plain Base32
 * "setup key" such as "JBSW Y3DP EHPK 3PXP".
 *
 * Loads as a classic <script> (window.PHOtp) or via require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PHOtp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const ALGORITHMS = Object.freeze(['SHA1', 'SHA256', 'SHA512']);
  const MIN_SECRET_BYTES = 10; // 80 bits — the shortest key real services use
  const MAX_SECRET_BYTES = 128;

  class OtpError extends Error {
    constructor(message) {
      super(message);
      this.name = 'OtpError';
      this.code = 'INVALID';
    }
  }

  /** "jbsw y3dp-ehpk" → "JBSWY3DPEHPK" (spaces, dashes and '=' padding removed). */
  function normalizeSecret(text) {
    return String(text || '').toUpperCase().replace(/[\s\-=]/g, '');
  }

  /** RFC 4648 Base32 → bytes. */
  function base32Decode(text) {
    const clean = normalizeSecret(text);
    let bits = 0;
    let value = 0;
    const out = [];
    for (const char of clean) {
      const index = ALPHABET.indexOf(char);
      if (index === -1) throw new OtpError('The setup key can only contain the letters A–Z and the digits 2–7.');
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        out += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  function checkSecret(secret) {
    if (!secret) throw new OtpError('Enter the setup key or paste the otpauth:// link.');
    const bytes = base32Decode(secret);
    if (bytes.length < MIN_SECRET_BYTES) throw new OtpError('That setup key is too short — check that you copied all of it.');
    if (bytes.length > MAX_SECRET_BYTES) throw new OtpError('That setup key is too long.');
    return secret;
  }

  function decode(component) {
    try {
      return decodeURIComponent(component);
    } catch {
      return component;
    }
  }

  /**
   * @param {string} input  otpauth:// link or Base32 setup key
   * @returns {{secret:string, algorithm:string, digits:number, period:number, issuer:string, account:string}}
   * @throws {OtpError} with a message that can be shown to the user
   */
  function parseOtpInput(input) {
    const text = String(input || '').trim();
    if (!text) throw new OtpError('Enter the setup key or paste the otpauth:// link.');

    if (!/^otpauth:/i.test(text)) {
      return { secret: checkSecret(normalizeSecret(text)), algorithm: 'SHA1', digits: 6, period: 30, issuer: '', account: '' };
    }

    const match = /^otpauth:\/\/([a-z]+)\/([^?]*)(?:\?(.*))?$/i.exec(text);
    if (!match) throw new OtpError('That otpauth:// link is not valid.');
    const kind = match[1].toLowerCase();
    if (kind === 'hotp') throw new OtpError('Counter-based (HOTP) codes are not supported — only time-based ones.');
    if (kind !== 'totp') throw new OtpError('That otpauth:// link is not a time-based (TOTP) code.');

    const label = decode(match[2] || '');
    const params = {};
    for (const pair of (match[3] || '').split('&')) {
      if (!pair) continue;
      const [key, ...rest] = pair.split('=');
      params[key.toLowerCase()] = decode(rest.join('=').replace(/\+/g, ' '));
    }

    const [labelIssuer, labelAccount] = label.includes(':') ? label.split(/:(.*)/s) : ['', label];
    const algorithm = (params.algorithm || 'SHA1').toUpperCase();
    if (!ALGORITHMS.includes(algorithm)) throw new OtpError(`Unsupported algorithm "${params.algorithm}".`);
    const digits = params.digits ? Number(params.digits) : 6;
    if (![6, 7, 8].includes(digits)) throw new OtpError('Codes must be 6, 7 or 8 digits long.');
    const period = params.period ? Number(params.period) : 30;
    if (!Number.isInteger(period) || period < 10 || period > 300) throw new OtpError('Unsupported code period.');

    return {
      secret: checkSecret(normalizeSecret(params.secret)),
      algorithm,
      digits,
      period,
      issuer: String(params.issuer || labelIssuer || '').trim().slice(0, 100),
      account: String(labelAccount || '').trim().slice(0, 200),
    };
  }

  /** Re-checks a stored config (e.g. from a backup or an import). Returns a clean copy or null. */
  function sanitizeConfig(config) {
    if (!config || typeof config !== 'object') return null;
    try {
      const secret = checkSecret(normalizeSecret(config.secret));
      const algorithm = ALGORITHMS.includes(config.algorithm) ? config.algorithm : 'SHA1';
      const digits = [6, 7, 8].includes(config.digits) ? config.digits : 6;
      const period = Number.isInteger(config.period) && config.period >= 10 && config.period <= 300 ? config.period : 30;
      return {
        secret,
        algorithm,
        digits,
        period,
        issuer: typeof config.issuer === 'string' ? config.issuer.slice(0, 100) : '',
        account: typeof config.account === 'string' ? config.account.slice(0, 200) : '',
      };
    } catch {
      return null;
    }
  }

  /** "123456" → "123 456", "12345678" → "1234 5678" (easier to read and type). */
  function formatCode(code) {
    const text = String(code || '');
    if (text.length === 6) return `${text.slice(0, 3)} ${text.slice(3)}`;
    if (text.length === 8) return `${text.slice(0, 4)} ${text.slice(4)}`;
    return text;
  }

  return Object.freeze({
    ALGORITHMS,
    OtpError,
    normalizeSecret,
    base32Decode,
    base32Encode,
    parseOtpInput,
    sanitizeConfig,
    formatCode,
  });
});
