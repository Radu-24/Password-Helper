'use strict';

/**
 * Encrypted vault file (main process only — pages never see the key).
 *
 *  Key derivation  PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt
 *                  (OWASP Password Storage Cheat Sheet). The master password is
 *                  Unicode-normalised (NFKC) first, so "ă" typed on any keyboard
 *                  layout gives the same key.
 *  Encryption      AES-256-GCM, fresh 12-byte IV on every save. The file header
 *                  (format, version, KDF parameters) is authenticated as AAD, so
 *                  tampering with it makes decryption fail.
 *  Storage         One JSON file, written atomically (temp file + rename) with
 *                  mode 0600. The previous version is kept as <file>.bak.
 *
 * PBKDF2 (not Argon2id) because Electron's BoringSSL has no Argon2, and PBKDF2 is
 * available everywhere (WebCrypto, Android, iOS) for future clients. The KDF
 * parameters live in the file header, so they can be raised later.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const FORMAT = 'password-helper-vault';
const VERSION = 1;
const KDF_NAME = 'PBKDF2-HMAC-SHA256';
const CIPHER_NAME = 'AES-256-GCM';
const DEFAULT_ITERATIONS = 600_000;
const MAX_ITERATIONS = 10_000_000; // refuse absurd values from a damaged file
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

const TYPES = Object.freeze(['Website', 'App', 'Email', 'Other']);
const LIMITS = Object.freeze({ label: 200, username: 320, password: 1024, notes: 10000, master: 1024 });

/** Unlock attempts allowed before a growing delay kicks in. */
const FREE_ATTEMPTS = 3;
const MAX_DELAY_MS = 30_000;

class VaultError extends Error {
  /**
   * @param {'NO_VAULT'|'VAULT_EXISTS'|'LOCKED'|'WRONG_PASSWORD'|'THROTTLED'|'CORRUPT'|'INVALID'|'NOT_FOUND'} code
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function deriveKey(masterPassword, salt, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(Buffer.from(masterPassword.normalize('NFKC'), 'utf8'), salt, iterations, KEY_BYTES, 'sha256', (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** The authenticated part of the header — fixed key order so it's byte-identical every time. */
function headerAad(header) {
  return Buffer.from(
    JSON.stringify({
      format: header.format,
      version: header.version,
      kdf: { name: header.kdf.name, iterations: header.kdf.iterations, salt: header.kdf.salt },
      cipher: header.cipher.name,
    }),
    'utf8',
  );
}

function encryptPayload(key, header, payload) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(headerAad(header));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    ...header,
    cipher: { name: CIPHER_NAME, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    data: data.toString('base64'),
  };
}

/** @throws {VaultError} WRONG_PASSWORD when the key (or the file) doesn't authenticate */
function decryptPayload(key, file) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.cipher.iv, 'base64'));
    decipher.setAAD(headerAad(file));
    decipher.setAuthTag(Buffer.from(file.cipher.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new VaultError('WRONG_PASSWORD', 'Wrong master password.');
  }
}

function validateFile(file) {
  const ok =
    file &&
    file.format === FORMAT &&
    file.version === VERSION &&
    file.kdf &&
    file.kdf.name === KDF_NAME &&
    Number.isInteger(file.kdf.iterations) &&
    file.kdf.iterations > 0 &&
    file.kdf.iterations <= MAX_ITERATIONS &&
    typeof file.kdf.salt === 'string' &&
    file.cipher &&
    file.cipher.name === CIPHER_NAME &&
    typeof file.cipher.iv === 'string' &&
    typeof file.cipher.tag === 'string' &&
    typeof file.data === 'string';
  if (!ok) throw new VaultError('CORRUPT', 'The vault file is damaged or from an unsupported version.');
  return file;
}

// ---------------------------------------------------------------------------
// Entry validation
// ---------------------------------------------------------------------------

const FIELD_NAMES = { label: 'label', username: 'username', password: 'password', notes: 'notes', master: 'master password' };

function cleanText(value, field, { required = false, trim = true } = {}) {
  const name = FIELD_NAMES[field];
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new VaultError('INVALID', `The ${name} must be text.`);
  const text = trim ? value.trim() : value;
  if (required && text === '') {
    throw new VaultError('INVALID', field === 'password' ? 'Password cannot be empty.' : `Please enter a ${name}.`);
  }
  if (text.length > LIMITS[field]) throw new VaultError('INVALID', `The ${name} is too long (max ${LIMITS[field]} characters).`);
  return text;
}

/** Validates user-supplied fields; returns only the known ones. */
function cleanFields(fields) {
  if (!fields || typeof fields !== 'object') throw new VaultError('INVALID', 'Missing entry fields.');
  return {
    label: cleanText(fields.label, 'label', { required: true }),
    type: TYPES.includes(fields.type) ? fields.type : 'Other',
    username: cleanText(fields.username, 'username'),
    password: cleanText(fields.password, 'password', { required: true, trim: false }),
    notes: cleanText(fields.notes, 'notes'),
  };
}

/** Accepts entries from the old localStorage format ({ user, pass }) too. */
function normalizeImported(raw, now) {
  const fields = cleanFields({
    label: raw.label,
    type: raw.type,
    username: raw.username ?? raw.user,
    password: raw.password ?? raw.pass,
    notes: raw.notes,
  });
  const isoOr = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : now);
  return {
    id: typeof raw.id === 'string' && /^[\w-]{8,64}$/.test(raw.id) ? raw.id : crypto.randomUUID(),
    ...fields,
    createdAt: isoOr(raw.createdAt),
    updatedAt: isoOr(raw.updatedAt),
  };
}

/** What pages get from list(): everything except the password. */
function publicEntry(entry) {
  const { password: _password, ...rest } = entry;
  return rest;
}

// ---------------------------------------------------------------------------
// VaultStore
// ---------------------------------------------------------------------------

class VaultStore {
  /**
   * @param {object} options
   * @param {string} options.filePath  where the encrypted vault lives
   * @param {number} [options.iterations]  PBKDF2 iterations for new vaults (tests use fewer)
   * @param {() => number} [options.now]  clock, for tests
   */
  constructor({ filePath, iterations = DEFAULT_ITERATIONS, now = Date.now }) {
    this.filePath = filePath;
    this.iterations = iterations;
    this.now = now;
    this.key = null;
    this.header = null;
    this.entries = null;
    this.failedAttempts = 0;
    this.blockedUntil = 0;
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  get unlocked() {
    return this.key !== null;
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Creates a new vault. `initialEntries` may be in the old localStorage shape;
   * entries that fail validation are skipped (counted), never fatal.
   * @returns {Promise<{imported:number, skipped:number}>}
   */
  async create(masterPassword, initialEntries = []) {
    if (this.exists()) throw new VaultError('VAULT_EXISTS', 'A vault already exists.');
    cleanText(masterPassword, 'master', { required: true, trim: false });
    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await deriveKey(masterPassword, salt, this.iterations);
    const nowIso = new Date(this.now()).toISOString();
    const entries = [];
    let skipped = 0;
    for (const raw of Array.isArray(initialEntries) ? initialEntries : []) {
      try {
        entries.push(normalizeImported(raw || {}, nowIso));
      } catch {
        skipped += 1;
      }
    }

    this.key = key;
    this.header = {
      format: FORMAT,
      version: VERSION,
      kdf: { name: KDF_NAME, iterations: this.iterations, salt: salt.toString('base64') },
      cipher: { name: CIPHER_NAME },
    };
    this.entries = dedupeById(entries);
    skipped += entries.length - this.entries.length;
    await this.save();
    return { imported: this.entries.length, skipped };
  }

  /** @throws {VaultError} NO_VAULT | THROTTLED | WRONG_PASSWORD | CORRUPT */
  async unlock(masterPassword) {
    if (!this.exists()) throw new VaultError('NO_VAULT', 'No vault has been created yet.');
    const now = this.now();
    if (now < this.blockedUntil) {
      const retryAfterMs = this.blockedUntil - now;
      throw new VaultError('THROTTLED', `Too many attempts — try again in ${Math.ceil(retryAfterMs / 1000)} s.`, { retryAfterMs });
    }
    // One guess at a time, so parallel attempts can't slip past the throttle.
    if (this.unlockInFlight) throw new VaultError('THROTTLED', 'Already checking a password — one moment.', { retryAfterMs: 500 });
    if (typeof masterPassword !== 'string' || masterPassword === '') {
      throw new VaultError('WRONG_PASSWORD', 'Wrong master password.');
    }

    this.unlockInFlight = true;
    try {
      await this.unlockWith(masterPassword);
    } finally {
      this.unlockInFlight = false;
    }
  }

  async unlockWith(masterPassword) {
    const file = validateFile(await this.readFile());
    const key = await deriveKey(masterPassword, Buffer.from(file.kdf.salt, 'base64'), file.kdf.iterations);
    let payload;
    try {
      payload = decryptPayload(key, file);
    } catch (error) {
      key.fill(0);
      this.registerFailure();
      throw error;
    }
    if (!payload || !Array.isArray(payload.entries)) {
      key.fill(0);
      throw new VaultError('CORRUPT', 'The vault contents are damaged.');
    }

    this.failedAttempts = 0;
    this.blockedUntil = 0;
    if (this.key) this.key.fill(0);
    this.key = key;
    this.header = { format: file.format, version: file.version, kdf: { ...file.kdf }, cipher: { name: CIPHER_NAME } };
    this.entries = payload.entries;
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.header = null;
    this.entries = null;
  }

  registerFailure() {
    this.failedAttempts += 1;
    if (this.failedAttempts >= FREE_ATTEMPTS) {
      const delay = Math.min(1000 * 2 ** (this.failedAttempts - FREE_ATTEMPTS), MAX_DELAY_MS);
      this.blockedUntil = this.now() + delay;
    }
  }

  async changePassword(currentPassword, newPassword) {
    this.assertUnlocked();
    cleanText(newPassword, 'master', { required: true, trim: false });
    const file = validateFile(await this.readFile());
    const check = await deriveKey(currentPassword || '', Buffer.from(file.kdf.salt, 'base64'), file.kdf.iterations);
    const matches = crypto.timingSafeEqual(check, this.key);
    check.fill(0);
    if (!matches) throw new VaultError('WRONG_PASSWORD', 'The current master password is wrong.');

    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await deriveKey(newPassword, salt, this.iterations);
    this.key.fill(0);
    this.key = key;
    this.header = { ...this.header, kdf: { name: KDF_NAME, iterations: this.iterations, salt: salt.toString('base64') } };
    await this.save();
  }

  // ---- entries --------------------------------------------------------------

  list() {
    this.assertUnlocked();
    return this.entries.map(publicEntry);
  }

  /** Full entry including the password — main process only (copy / reveal / edit). */
  getEntry(id) {
    this.assertUnlocked();
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) throw new VaultError('NOT_FOUND', 'That entry no longer exists.');
    return { ...entry };
  }

  /** @returns {object} the new entry without its password */
  async add(fields) {
    this.assertUnlocked();
    const nowIso = new Date(this.now()).toISOString();
    const entry = { id: crypto.randomUUID(), ...cleanFields(fields), createdAt: nowIso, updatedAt: nowIso };
    this.entries.push(entry);
    await this.save();
    return publicEntry(entry);
  }

  async update(id, fields) {
    this.assertUnlocked();
    const index = this.entries.findIndex((item) => item.id === id);
    if (index === -1) throw new VaultError('NOT_FOUND', 'That entry no longer exists.');
    const updated = { ...this.entries[index], ...cleanFields(fields), updatedAt: new Date(this.now()).toISOString() };
    this.entries[index] = updated;
    await this.save();
    return publicEntry(updated);
  }

  async remove(id) {
    this.assertUnlocked();
    const index = this.entries.findIndex((item) => item.id === id);
    if (index === -1) throw new VaultError('NOT_FOUND', 'That entry no longer exists.');
    this.entries.splice(index, 1);
    await this.save();
  }

  /**
   * Adds entries that aren't in the vault yet (matched by id, or by label +
   * username + password for entries without an id).
   * @returns {Promise<{added:number, skipped:number}>}
   */
  async importEntries(rawEntries) {
    this.assertUnlocked();
    if (!Array.isArray(rawEntries)) throw new VaultError('INVALID', 'Nothing to import.');
    const nowIso = new Date(this.now()).toISOString();
    const ids = new Set(this.entries.map((entry) => entry.id));
    const fingerprints = new Set(this.entries.map(fingerprint));
    let added = 0;
    let skipped = 0;
    for (const raw of rawEntries) {
      let entry;
      try {
        entry = normalizeImported(raw || {}, nowIso);
      } catch {
        skipped += 1;
        continue;
      }
      if (ids.has(entry.id) || fingerprints.has(fingerprint(entry))) {
        skipped += 1;
        continue;
      }
      ids.add(entry.id);
      fingerprints.add(fingerprint(entry));
      this.entries.push(entry);
      added += 1;
    }
    if (added > 0) await this.save();
    return { added, skipped };
  }

  // ---- backups --------------------------------------------------------------

  /** Copies the encrypted vault file (it stays encrypted with the master password). */
  async exportTo(destinationPath) {
    this.assertUnlocked();
    await fsp.copyFile(this.filePath, destinationPath);
  }

  /**
   * Reads another vault file (e.g. a backup) with its own master password.
   * @returns {Promise<object[]>} its entries
   */
  static async readBackup(filePath, masterPassword) {
    let file;
    try {
      file = validateFile(JSON.parse(await fsp.readFile(filePath, 'utf8')));
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError('CORRUPT', 'That file is not a Password Helper vault backup.');
    }
    const key = await deriveKey(masterPassword || '', Buffer.from(file.kdf.salt, 'base64'), file.kdf.iterations);
    try {
      const payload = decryptPayload(key, file);
      if (!payload || !Array.isArray(payload.entries)) throw new VaultError('CORRUPT', 'The backup contents are damaged.');
      return payload.entries;
    } catch (error) {
      if (error.code === 'WRONG_PASSWORD') throw new VaultError('WRONG_PASSWORD', 'Wrong master password for that backup.');
      throw error;
    } finally {
      key.fill(0);
    }
  }

  // ---- internals --------------------------------------------------------------

  assertUnlocked() {
    if (!this.key) throw new VaultError('LOCKED', 'The vault is locked.');
  }

  async readFile() {
    let text;
    try {
      text = await fsp.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new VaultError('NO_VAULT', 'No vault has been created yet.');
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new VaultError('CORRUPT', 'The vault file is damaged.');
    }
  }

  /**
   * Saves are queued, so two quick changes can't race each other on disk:
   * each save encrypts the state as it is when its turn comes.
   */
  save() {
    const run = async () => {
      this.assertUnlocked();
      const payload = { entries: this.entries, savedAt: new Date(this.now()).toISOString() };
      const file = encryptPayload(this.key, this.header, payload);
      await writeFileAtomic(this.filePath, `${JSON.stringify(file, null, 2)}\n`);
    };
    this.saveQueue = (this.saveQueue || Promise.resolve()).catch(() => {}).then(run);
    return this.saveQueue;
  }
}

function fingerprint(entry) {
  return JSON.stringify([entry.label.toLowerCase(), entry.username.toLowerCase(), entry.password]);
}

function dedupeById(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Write to a temp file, flush, keep a .bak of the old file (optional), then rename over it. */
async function writeFileAtomic(filePath, contents, { backup = true } = {}) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const handle = await fsp.open(tempPath, 'w', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (backup && fs.existsSync(filePath)) await fsp.copyFile(filePath, `${filePath}.bak`);
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

module.exports = { VaultStore, VaultError, TYPES, LIMITS, DEFAULT_ITERATIONS, writeFileAtomic };
