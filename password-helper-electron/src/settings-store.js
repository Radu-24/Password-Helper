'use strict';

/**
 * App settings (main process), stored as settings.json in the data folder.
 * Every value is validated, so a hand-edited or damaged file can't break the app.
 */

const fs = require('node:fs');
const { writeFileAtomic } = require('./vault-store');

const AUTO_LOCK_CHOICES = Object.freeze([0, 1, 5, 15, 30, 60]); // minutes, 0 = never
const CLIPBOARD_CHOICES = Object.freeze([0, 15, 30, 60, 120]); // seconds, 0 = never
const ACCENTS = Object.freeze(['blue', 'cyan', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite']);
/** Sidebar destinations the app may reopen at startup. */
const VIEWS = Object.freeze(['analyzer', 'generator', 'items', 'favorites', 'codes', 'security', 'deleted', 'settings']);

const DEFAULTS = Object.freeze({
  clearAnalyzerOnBack: true,
  analyzerBreachCheck: false,
  analyzerInsights: false,
  analyzerHash: false,
  autoLockMinutes: 5,
  lockOnMinimize: false,
  clipboardClearSeconds: 30,
  matrixBackground: true,
  backgroundIntensity: 70,
  accent: 'blue',
  reduceMotion: false,
  reduceTransparency: false,
  showLoginOnStart: true,
  onboarded: false,
  vaultSort: 'name',
  lastView: 'items',
  sidebarWidth: 224,
  sidebarCollapsed: false,
  generator: Object.freeze({
    mode: 'password',
    length: 20,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    avoidAmbiguous: false,
    words: 6,
    separator: '-',
    capitalize: true,
    addNumber: false,
  }),
  windowBounds: null,
});

const isBool = (value) => typeof value === 'boolean';
const oneOf = (choices) => (value) => choices.includes(value);
const intBetween = (min, max) => (value) => Number.isInteger(value) && value >= min && value <= max;

const GENERATOR_SCHEMA = {
  mode: oneOf(['password', 'passphrase']),
  length: intBetween(8, 128),
  lowercase: isBool,
  uppercase: isBool,
  digits: isBool,
  symbols: isBool,
  avoidAmbiguous: isBool,
  words: intBetween(3, 12),
  separator: oneOf(['-', ' ', '.', '_', ',']),
  capitalize: isBool,
  addNumber: isBool,
};

const SCHEMA = {
  clearAnalyzerOnBack: isBool,
  analyzerBreachCheck: isBool,
  analyzerInsights: isBool,
  analyzerHash: isBool,
  autoLockMinutes: oneOf(AUTO_LOCK_CHOICES),
  lockOnMinimize: isBool,
  clipboardClearSeconds: oneOf(CLIPBOARD_CHOICES),
  matrixBackground: isBool,
  backgroundIntensity: intBetween(0, 100),
  accent: oneOf(ACCENTS),
  reduceMotion: isBool,
  reduceTransparency: isBool,
  showLoginOnStart: isBool,
  onboarded: isBool,
  vaultSort: oneOf(['name', 'recent', 'type']),
  lastView: oneOf(VIEWS),
  sidebarWidth: intBetween(180, 320),
  sidebarCollapsed: isBool,
  generator: (value) => value && typeof value === 'object',
  windowBounds: (value) =>
    value === null ||
    (value &&
      typeof value === 'object' &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key])) &&
      value.width >= 200 &&
      value.height >= 200),
};

/** Keys pages may read and change (windowBounds is managed by the main process). */
const PUBLIC_KEYS = Object.freeze(Object.keys(SCHEMA).filter((key) => key !== 'windowBounds'));

function cleanGenerator(value, base) {
  const result = { ...base };
  if (!value || typeof value !== 'object') return result;
  for (const [key, valid] of Object.entries(GENERATOR_SCHEMA)) {
    if (key in value && valid(value[key])) result[key] = value[key];
  }
  // At least one character set must stay on.
  if (!['lowercase', 'uppercase', 'digits', 'symbols'].some((key) => result[key])) result.lowercase = true;
  return result;
}

/** Keeps only known, valid keys from `patch`, applied on top of `base`. */
function applyPatch(base, patch, allowedKeys) {
  const next = { ...base };
  if (!patch || typeof patch !== 'object') return next;
  for (const key of allowedKeys) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === 'generator') next.generator = cleanGenerator(value, base.generator);
    else if (SCHEMA[key](value)) next[key] = value === null ? null : typeof value === 'object' ? { ...value } : value;
  }
  return next;
}

class SettingsStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.values = applyPatch({ ...DEFAULTS, generator: { ...DEFAULTS.generator } }, this.readFile(), Object.keys(SCHEMA));
    this.listeners = new Set();
  }

  readFile() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return {}; // missing or damaged → defaults
    }
  }

  /** Everything, including main-only keys. */
  all() {
    return { ...this.values, generator: { ...this.values.generator } };
  }

  get(key) {
    const value = this.values[key];
    return value && typeof value === 'object' ? { ...value } : value;
  }

  /** The subset pages are allowed to see. */
  publicValues() {
    const result = {};
    for (const key of PUBLIC_KEYS) result[key] = this.get(key);
    return result;
  }

  /**
   * @param {object} patch
   * @param {{internal?: boolean}} [options]  internal=true also allows main-only keys
   */
  async set(patch, { internal = false } = {}) {
    const allowed = internal ? Object.keys(SCHEMA) : PUBLIC_KEYS;
    const previous = this.values;
    this.values = applyPatch(previous, patch, allowed);
    await this.save();
    for (const listener of this.listeners) listener(this.all(), previous);
    return internal ? this.all() : this.publicValues();
  }

  /** Synchronous (still atomic) write, for app shutdown (window bounds). */
  setSync(patch) {
    this.values = applyPatch(this.values, patch, Object.keys(SCHEMA));
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(this.values, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } catch {
      fs.rmSync(tempPath, { force: true }); // best effort — keep the old file
    }
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  save() {
    this.saveQueue = (this.saveQueue || Promise.resolve())
      .catch(() => {})
      .then(() => writeFileAtomic(this.filePath, `${JSON.stringify(this.values, null, 2)}\n`, { backup: false }));
    return this.saveQueue;
  }
}

module.exports = { SettingsStore, DEFAULTS, AUTO_LOCK_CHOICES, CLIPBOARD_CHOICES, ACCENTS, VIEWS, PUBLIC_KEYS };
