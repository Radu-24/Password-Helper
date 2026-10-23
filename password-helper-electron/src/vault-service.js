'use strict';

/**
 * Vault session (main process): wraps VaultStore with auto-lock, a "locked"
 * event for the UI, and vault-health checks (weak / reused / breached).
 */

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const Policy = require('../public/js/policy.js');
const { VaultError } = require('./vault-store');

const BREACH_CONCURRENCY = 3;

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

class VaultService extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./vault-store').VaultStore} deps.store
   * @param {{analyze:Function}} deps.analysis
   * @param {{fetchRange:Function, parseRangeCount:Function}} deps.hibp
   * @param {Function} deps.fetch  fetch implementation for HIBP
   * @param {() => number} deps.getAutoLockMinutes
   */
  constructor({ store, analysis, hibp, fetch, getAutoLockMinutes, schedule = setTimeout, cancel = clearTimeout }) {
    super();
    this.store = store;
    this.analysis = analysis;
    this.hibp = hibp;
    this.fetch = fetch;
    this.getAutoLockMinutes = getAutoLockMinutes;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timer = null;
    this.strengthCache = new Map(); // id → { updatedAt, weak, score }
    this.breachCache = new Map(); // id → { updatedAt, count }
    this.breachCheckedAt = null;
  }

  // ---- lifecycle -------------------------------------------------------------

  status() {
    return { exists: this.store.exists(), unlocked: this.store.unlocked };
  }

  /**
   * Same rules the pages show (policy.js), enforced again here so a page can't
   * skip them. The breach check needs the network, so only the page does it.
   */
  assertMasterPolicy(masterPassword) {
    if (typeof masterPassword !== 'string') throw new VaultError('INVALID', 'Please enter a master password.');
    const length = Policy.charCount(masterPassword);
    if (length < Policy.MIN_LENGTH || length > Policy.MAX_LENGTH) {
      throw new VaultError('INVALID', `The master password must be ${Policy.MIN_LENGTH}–${Policy.MAX_LENGTH} characters.`);
    }
    if (this.analysis.analyze(masterPassword).score < Policy.MIN_SCORE) {
      throw new VaultError('INVALID', 'That master password is too easy to guess.');
    }
  }

  async create(masterPassword, legacyEntries) {
    this.assertMasterPolicy(masterPassword);
    const result = await this.store.create(masterPassword, legacyEntries);
    this.afterUnlock();
    return result;
  }

  async unlock(masterPassword) {
    await this.store.unlock(masterPassword);
    this.afterUnlock();
  }

  afterUnlock() {
    this.clearCaches();
    this.touch();
    this.emit('unlocked');
  }

  /** @param {'manual'|'timeout'|'minimize'|'suspend'|'logout'|'quit'} reason */
  lock(reason = 'manual') {
    const wasUnlocked = this.store.unlocked;
    this.cancelTimer();
    this.store.lock();
    this.clearCaches();
    if (wasUnlocked) this.emit('locked', reason);
  }

  /** Restarts the auto-lock countdown (called on every vault action and on user activity). */
  touch() {
    this.cancelTimer();
    if (!this.store.unlocked) return;
    const minutes = this.getAutoLockMinutes();
    if (minutes > 0) this.timer = this.schedule(() => this.lock('timeout'), minutes * 60_000);
  }

  cancelTimer() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }

  clearCaches() {
    this.strengthCache.clear();
    this.breachCache.clear();
    this.breachCheckedAt = null;
  }

  // ---- entries ---------------------------------------------------------------

  /**
   * Entries without passwords, plus health flags:
   *   weak (zxcvbn score below the policy), reusedCount (other entries with the
   *   same password), breachCount (null until checkBreaches() ran).
   */
  async list() {
    this.touch();
    const full = this.store.list().map((entry) => this.store.getEntry(entry.id));
    const passwordCounts = new Map();
    for (const entry of full) passwordCounts.set(entry.password, (passwordCounts.get(entry.password) || 0) + 1);

    const result = [];
    let computed = 0;
    for (const entry of full) {
      let strength = this.strengthCache.get(entry.id);
      if (!strength || strength.updatedAt !== entry.updatedAt) {
        const { score } = this.analysis.analyze(entry.password, [entry.label, entry.username]);
        strength = { updatedAt: entry.updatedAt, score, weak: score < Policy.MIN_SCORE };
        this.strengthCache.set(entry.id, strength);
        computed += 1;
        if (computed % 10 === 0) {
          await yieldToEventLoop(); // keep the window responsive on big vaults
          if (!this.store.unlocked) throw Object.assign(new Error('The vault is locked.'), { code: 'LOCKED' });
        }
      }
      const breach = this.breachCache.get(entry.id);
      const { password: _password, ...rest } = entry;
      result.push({
        ...rest,
        score: strength.score,
        weak: strength.weak,
        reusedCount: passwordCounts.get(entry.password) - 1,
        breachCount: breach && breach.updatedAt === entry.updatedAt ? breach.count : null,
      });
    }
    return { entries: result, breachCheckedAt: this.breachCheckedAt };
  }

  getEntry(id) {
    this.touch();
    return this.store.getEntry(id);
  }

  /** @returns {Promise<object>} the entry (no password) + reusedCount: other entries with the same password */
  async add(fields) {
    this.touch();
    const entry = await this.store.add(fields);
    return { ...entry, reusedCount: this.countReuse(entry.id) };
  }

  async update(id, fields) {
    this.touch();
    const entry = await this.store.update(id, fields);
    return { ...entry, reusedCount: this.countReuse(entry.id) };
  }

  countReuse(id) {
    const { password } = this.store.getEntry(id);
    return this.store.list().filter((entry) => entry.id !== id && this.store.getEntry(entry.id).password === password).length;
  }

  async remove(id) {
    this.touch();
    await this.store.remove(id);
    this.strengthCache.delete(id);
    this.breachCache.delete(id);
  }

  async importEntries(entries) {
    this.touch();
    return this.store.importEntries(entries);
  }

  async changePassword(current, next) {
    this.touch();
    this.assertMasterPolicy(next);
    await this.store.changePassword(current, next);
  }

  /** Copies the encrypted vault file to `filePath`. */
  async exportTo(filePath) {
    this.touch();
    await this.store.exportTo(filePath);
  }

  /**
   * Checks every saved password against Pwned Passwords (k-anonymity: only
   * 5-character hash prefixes leave the computer).
   * @returns {Promise<{checked:number, breached:number, failed:number}>}
   */
  async checkBreaches() {
    this.touch();
    const entries = this.store.list().map((entry) => this.store.getEntry(entry.id));
    const byHash = new Map(); // sha1 → entries
    for (const entry of entries) {
      const hash = crypto.createHash('sha1').update(entry.password, 'utf8').digest('hex').toUpperCase();
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(entry);
    }

    const hashes = [...byHash.keys()];
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < hashes.length) {
        const hash = hashes[next++];
        let count;
        try {
          const body = await this.hibp.fetchRange(hash.slice(0, 5), { fetch: this.fetch });
          count = this.hibp.parseRangeCount(body, hash.slice(5));
        } catch {
          failed += 1;
          continue;
        }
        if (!this.store.unlocked) return; // locked while we were waiting
        for (const entry of byHash.get(hash)) this.breachCache.set(entry.id, { updatedAt: entry.updatedAt, count });
      }
    };
    await Promise.all(Array.from({ length: Math.min(BREACH_CONCURRENCY, hashes.length) }, worker));
    if (!this.store.unlocked) throw Object.assign(new Error('The vault was locked during the check.'), { code: 'LOCKED' });

    this.breachCheckedAt = new Date().toISOString();
    this.touch();
    const breached = entries.filter((entry) => (this.breachCache.get(entry.id) || {}).count > 0).length;
    return { checked: entries.length, breached, failed };
  }
}

module.exports = { VaultService };
