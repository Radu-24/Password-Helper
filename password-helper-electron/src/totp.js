'use strict';

/**
 * Time-based one-time passwords (RFC 6238 / RFC 4226), main process only.
 * Secrets never leave this process — pages receive just the current code.
 */

const crypto = require('node:crypto');
const { base32Decode } = require('../public/js/otp.js');

/** HOTP value for one counter step. */
function hotp(key, counter, { algorithm = 'SHA1', digits = 6 } = {}) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(algorithm.toLowerCase(), Buffer.from(key)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Current code for a stored TOTP config.
 * @param {{secret:string, algorithm?:string, digits?:number, period?:number}} config
 * @param {number} [nowMs]
 * @returns {{code:string, period:number, remaining:number}}
 */
function generate(config, nowMs = Date.now()) {
  const period = config.period || 30;
  const seconds = Math.floor(nowMs / 1000);
  return {
    code: hotp(base32Decode(config.secret), Math.floor(seconds / period), config),
    period,
    remaining: period - (seconds % period),
  };
}

module.exports = { hotp, generate };
