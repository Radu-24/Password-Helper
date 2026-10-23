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
  /** 'darwin' | 'win32' | 'linux' — macOS draws its own window buttons. */
  platform: process.platform,

  window: {
    /** @param {'minimize'|'toggle-maximize'|'close'} action */
    control: (action) => ipcRenderer.send('window:control', action),
    onFocusChange: (callback) => subscribe('window:focus', callback),
    onMaximizedChange: (callback) => subscribe('window:maximized', callback),
  },

  /** zxcvbn-ts analysis (runs in the main process). */
  analyze: (password, userInputs = []) => invoke('analysis:analyze', password, userInputs),

  /** Pwned Passwords range lookup: send a 5-char SHA-1 prefix, get "SUFFIX:COUNT" lines back. */
  hibpRange: (prefix) => invoke('hibp:range', prefix),

  app: {
    info: () => invoke('app:info'),
    openDataFolder: () => invoke('app:open-data-folder'),
    /** Opens an http(s) address in the default browser. */
    openUrl: (url) => invoke('app:open-url', url),
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
    /** One entry for the editor: password included, 2FA described but not its secret. */
    get: (id) => invoke('vault:get', id),
    reveal: (id) => invoke('vault:reveal', id),
    /** @param {'password'|'username'|'url'|'totp'} field */
    copy: (id, field) => invoke('vault:copy', id, field),
    setFavorite: (id, favorite) => invoke('vault:set-favorite', id, favorite),
    /** Current 2FA codes: [{ id, code, period, remaining }] (all entries with 2FA when `ids` is omitted). */
    totpCodes: (ids) => invoke('vault:totp', ids),
    /** Text of a QR code found in the image on the clipboard. */
    readQrFromClipboard: () => invoke('vault:read-qr'),
    /** Checks a 2FA setup key / otpauth:// link and returns its current code (nothing is saved). */
    previewTotp: (input) => invoke('vault:preview-totp', input),
    add: (fields) => invoke('vault:add', fields),
    update: (id, fields) => invoke('vault:update', id, fields),
    /** Moves an item to Recently Deleted. */
    remove: (id) => invoke('vault:remove', id),
    restore: (id) => invoke('vault:restore', id),
    /** Deletes an item permanently. */
    purge: (id) => invoke('vault:purge', id),
    emptyTrash: () => invoke('vault:empty-trash'),
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

  /** Import from a browser / password-manager CSV export (parsed in the main process). */
  csvImport: {
    /** Opens a file picker; resolves to a preview ({ fileName, format, count, … }) or null if cancelled. */
    choose: () => invoke('import:choose-csv'),
    commit: () => invoke('import:commit-csv'),
    /** Moves the (plain-text) export file to the trash. */
    trashFile: () => invoke('import:trash-csv'),
    cancel: () => invoke('import:cancel'),
  },
});
