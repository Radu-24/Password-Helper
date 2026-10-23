'use strict';

/**
 * Have I Been Pwned — Pwned Passwords range API (main process).
 *
 * k-anonymity: only the first 5 hex characters of the password's SHA-1 hash
 * are sent. The renderer hashes the password and matches the returned
 * suffixes locally, so neither the password nor its full hash leaves the app.
 *
 * "Add-Padding: true" makes every response 800–1,000 lines long so the
 * response size doesn't reveal which prefix was queried. Padding rows have a
 * count of 0 and are ignored by parseRangeCount().
 */

const { parseRangeCount } = require('../public/js/policy.js');

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const PREFIX_PATTERN = /^[0-9A-F]{5}$/;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 8000;

const cache = new Map();

/**
 * @param {string} prefix  5 uppercase hex characters
 * @param {{fetch: Function, timeoutMs?: number, now?: () => number}} options
 * @returns {Promise<string>} raw "SUFFIX:COUNT" lines
 */
async function fetchRange(prefix, { fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = {}) {
  if (typeof prefix !== 'string' || !PREFIX_PATTERN.test(prefix)) {
    throw new TypeError('Expected a 5-character uppercase SHA-1 prefix');
  }
  if (typeof fetch !== 'function') throw new TypeError('A fetch implementation is required');

  const hit = cache.get(prefix);
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.body;

  const response = await fetch(RANGE_URL + prefix, {
    headers: { 'Add-Padding': 'true' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Pwned Passwords API returned HTTP ${response.status}`);
  const body = await response.text();

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(prefix, { body, at: now() });
  return body;
}

function clearCache() {
  cache.clear();
}

module.exports = { fetchRange, parseRangeCount, clearCache, RANGE_URL };
