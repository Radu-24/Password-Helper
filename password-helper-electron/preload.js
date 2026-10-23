'use strict';

/**
 * The only bridge between the pages and the main process.
 * Runs sandboxed: only `electron` (contextBridge, ipcRenderer) is available here.
 * Pages see `window.api` — never ipcRenderer itself.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Calls a main-process handler. Failures ({ ok:false, error }) become a
 * rejection with { code, message } — a plain object on purpose: Error objects
 * lose custom fields like `code` when they cross the contextBridge.
 */
async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result && result.ok === false) {
    return Promise.reject({
      name: 'ApiError',
      code: result.error.code,
      message: result.error.message,
      retryAfterMs: result.error.retryAfterMs || 0,
    });
  }
  return result ? result.value : undefined;
}

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  window: {
    /** @param {'minimize'|'toggle-maximize'|'close'} action */
    control: (action) => ipcRenderer.send('window:control', action),
  },

  /** zxcvbn-ts analysis (runs in the main process). */
  analyze: (password, userInputs = []) => invoke('analysis:analyze', password, userInputs),

  /** Pwned Passwords range lookup: send a 5-char SHA-1 prefix, get "SUFFIX:COUNT" lines back. */
  hibpRange: (prefix) => invoke('hibp:range', prefix),

  app: {
    info: () => invoke('app:info'),
    openDataFolder: () => invoke('app:open-data-folder'),
    purgeLegacyStorage: () => invoke('app:purge-legacy-storage'),
  },

  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },

  clipboard: {
    /** Copies text; it is wiped again after the "clear clipboard" delay from Settings. */
    copy: (text) => invoke('clipboard:copy', text),
  },

  vault: {
    status: () => invoke('vault:status'),
    create: (masterPassword, legacyEntries = []) => invoke('vault:create', masterPassword, legacyEntries),
    unlock: (masterPassword) => invoke('vault:unlock', masterPassword),
    lock: () => invoke('vault:lock'),
    touch: () => invoke('vault:touch'),
    list: () => invoke('vault:list'),
    get: (id) => invoke('vault:get', id),
    reveal: (id) => invoke('vault:reveal', id),
    copy: (id, field) => invoke('vault:copy', id, field),
    add: (fields) => invoke('vault:add', fields),
    update: (id, fields) => invoke('vault:update', id, fields),
    remove: (id) => invoke('vault:remove', id),
    importLegacy: (entries) => invoke('vault:import-legacy', entries),
    changePassword: (current, next) => invoke('vault:change-password', current, next),
    checkBreaches: () => invoke('vault:check-breaches'),
    exportBackup: () => invoke('vault:export-backup'),
    chooseBackup: () => invoke('vault:choose-backup'),
    importBackup: (backupPassword) => invoke('vault:import-backup', backupPassword),
    /** @returns {() => void} unsubscribe */
    onLocked: (callback) => subscribe('vault:locked', callback),
    onUnlocked: (callback) => subscribe('vault:unlocked', callback),
  },
});
