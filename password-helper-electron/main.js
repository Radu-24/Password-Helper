'use strict';

/**
 * Password Helper — Electron main process.
 *
 * Security model (README → "Security model"):
 *  - Pages run sandboxed, with context isolation and no Node.js access.
 *  - preload.js is the only bridge; it exposes a small, explicit `window.api`.
 *  - Every IPC call must come from one of our own pages (public/*.html).
 *  - Navigation, new windows, <webview> and permission requests are blocked.
 *  - The vault key and decrypted vault live only in this process.
 */

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, powerMonitor, screen, session, shell } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const analysis = require('./src/analysis');
const hibp = require('./src/hibp');
const csvImport = require('./src/csv-import');
const qr = require('./src/qr');
const { VaultStore, VaultError } = require('./src/vault-store');
const { VaultService } = require('./src/vault-service');
const { SettingsStore } = require('./src/settings-store');
const { ClipboardGuard } = require('./src/clipboard-guard');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PUBLIC_URL_PREFIX = `${pathToFileURL(PUBLIC_DIR).href}/`;
const IS_DEV = !app.isPackaged;
const EXTERNAL_HOSTS = new Set(['haveibeenpwned.com', 'www.eff.org', 'pages.nist.gov', 'github.com']);
/** Error codes that are safe (and useful) to show to the user as-is. */
const EXPECTED_ERROR_CODES = new Set([
  'NO_VAULT', 'VAULT_EXISTS', 'LOCKED', 'WRONG_PASSWORD', 'THROTTLED', 'CORRUPT', 'INVALID', 'NOT_FOUND', 'NETWORK',
]);

// Keep the data folder stable (~/.config/password-helper-electron on Linux)
// even if the display name changes, so existing data is never orphaned.
// `--user-data-dir=<path>` still wins (used by the end-to-end tests).
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'password-helper-electron'));
}
// Sandbox every renderer. Skipped only when Chromium's sandbox is switched off
// explicitly (`--no-sandbox`, e.g. CI containers running as root).
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

let mainWindow = null;
let settings = null;
let vault = null;
let clipboardGuard = null;
let pendingImportPath = null;
/** A parsed CSV waiting for the user to confirm the import (plaintext — dropped as soon as possible). */
let pendingCsv = null;

// ---------------------------------------------------------------------------
// IPC plumbing
// ---------------------------------------------------------------------------

function isAppPage(url) {
  return typeof url === 'string' && url.startsWith(PUBLIC_URL_PREFIX);
}

function isTrustedSender(event) {
  const frame = event.senderFrame;
  return Boolean(frame) && frame === event.sender.mainFrame && isAppPage(frame.url);
}

/**
 * ipcMain.handle with sender validation. Results are wrapped as
 * { ok: true, value } / { ok: false, error: { code, message } } so error codes
 * survive the trip to the page (preload.js unwraps them).
 */
function handle(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Blocked request from an untrusted page.' } };
    }
    try {
      return { ok: true, value: await listener(...args) };
    } catch (error) {
      if (error && EXPECTED_ERROR_CODES.has(error.code)) {
        return { ok: false, error: { code: error.code, message: error.message, retryAfterMs: error.retryAfterMs } };
      }
      console.error(`[ipc] ${channel} failed:`, error);
      return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong — please try again.' } };
    }
  });
}

function sendToPages(channel, ...args) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args);
}

function openExternalIfAllowed(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && EXTERNAL_HOSTS.has(parsed.hostname)) shell.openExternal(parsed.href);
  } catch {
    // not a valid URL — ignore
  }
}

const fetchForHibp = (url, init) => net.fetch(url, init);

async function fetchRangeOrNetworkError(prefix) {
  try {
    return await hibp.fetchRange(prefix, { fetch: fetchForHibp });
  } catch (error) {
    if (error instanceof TypeError && /prefix/.test(error.message)) throw error;
    throw Object.assign(new Error('Could not reach Have I Been Pwned (offline?).'), { code: 'NETWORK' });
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/** Restores the last window size/position if it is still on a connected screen. */
function savedBounds() {
  const saved = settings.get('windowBounds');
  if (!saved) return { width: 900, height: 700 };
  const area = screen.getDisplayMatching(saved).workArea;
  const onScreen =
    saved.x < area.x + area.width - 80 &&
    saved.x + saved.width > area.x + 80 &&
    saved.y >= area.y - 20 &&
    saved.y < area.y + area.height - 80;
  const size = { width: Math.max(saved.width, 800), height: Math.max(saved.height, 600) };
  return onScreen ? { ...size, x: saved.x, y: saved.y } : size;
}

function createWindow() {
  const bounds = savedBounds();
  // macOS keeps its own traffic-light buttons; elsewhere the page draws them.
  const chrome =
    process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 20, y: 19 } } : { frame: false };
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 820,
    minHeight: 600,
    ...chrome,
    show: false,
    backgroundColor: '#000000',
    title: 'Password Helper',
    icon: path.join(PUBLIC_DIR, 'img', 'app-icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: IS_DEV,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if ((settings.get('windowBounds') || {}).maximized) mainWindow.maximize();
    mainWindow.show();
    // Build the strength-checker dictionaries while the first page is on screen.
    setTimeout(() => analysis.warmUp(), 300);
  });
  mainWindow.on('minimize', () => {
    if (settings.get('lockOnMinimize')) vault.lock('minimize');
  });
  mainWindow.on('close', () => {
    settings.setSync({ windowBounds: { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() } });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // One page: it decides itself whether to show the welcome, sign-in or main screen.
  mainWindow.loadFile(path.join(PUBLIC_DIR, 'index.html'));
  mainWindow.on('focus', () => mainWindow.webContents.send('window:focus', true));
  mainWindow.on('blur', () => mainWindow.webContents.send('window:focus', false));
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.on('window:control', (event, action) => {
    if (!isTrustedSender(event) || !mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'toggle-maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === 'close') mainWindow.close();
  });

  // ---- analysis / breaches ----
  handle('analysis:analyze', (password, userInputs) => analysis.analyze(password, userInputs));
  handle('hibp:range', (prefix) => fetchRangeOrNetworkError(prefix));

  // ---- app ----
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    dataPath: app.getPath('userData'),
  }));
  handle('app:open-data-folder', () => shell.openPath(app.getPath('userData')).then(() => true));
  // "Open website" on a vault item — only real web addresses, opened in the default browser.
  handle('app:open-url', async (url) => {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      throw new VaultError('INVALID', 'That isn’t a valid web address.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new VaultError('INVALID', 'Only web addresses can be opened.');
    await shell.openExternal(parsed.href);
    return true;
  });
  // Wipes the old (unencrypted) localStorage data once it has been migrated.
  handle('app:purge-legacy-storage', () => session.defaultSession.clearStorageData({ storages: ['localstorage'] }).then(() => true));

  // ---- settings ----
  handle('settings:get', () => settings.publicValues());
  handle('settings:set', (patch) => settings.set(patch));

  // ---- clipboard ----
  handle('clipboard:copy', (text) => clipboardGuard.copy(text, settings.get('clipboardClearSeconds')));

  // ---- vault ----
  handle('vault:status', () => vault.status());
  handle('vault:create', (masterPassword, legacyEntries) => vault.create(masterPassword, legacyEntries));
  handle('vault:unlock', (masterPassword) => vault.unlock(masterPassword));
  handle('vault:lock', () => vault.lock('manual'));
  handle('vault:touch', () => vault.touch());
  handle('vault:list', () => vault.list());
  handle('vault:get', (id) => vault.getEditable(id));
  handle('vault:reveal', (id) => vault.getEntry(id).password);
  handle('vault:copy', (id, field) => {
    const entry = vault.getEntry(id);
    let value;
    if (field === 'password' || field === 'username' || field === 'url') value = entry[field];
    else if (field === 'totp') value = (vault.totpCodes([id])[0] || {}).code; // none for deleted items
    else throw new VaultError('INVALID', 'Unknown field.');
    if (!value) throw new VaultError('INVALID', 'Nothing to copy.');
    // Usernames and addresses aren't secret, so they stay on the clipboard.
    const secret = field === 'password' || field === 'totp';
    return clipboardGuard.copy(value, secret ? settings.get('clipboardClearSeconds') : 0);
  });
  handle('vault:set-favorite', (id, favorite) => vault.setFavorite(id, favorite === true));
  handle('vault:totp', (ids) => vault.totpCodes(Array.isArray(ids) ? ids : undefined));
  // 2FA setup from a QR code: reads a screenshot/image that is on the clipboard.
  handle('vault:read-qr', () => {
    const text = qr.decodeNativeImage(clipboard.readImage());
    if (!text) throw new VaultError('NOT_FOUND', 'No QR code found on the clipboard — copy a screenshot of it first.');
    return text;
  });
  handle('vault:preview-totp', (input) => vault.previewTotp(input));
  handle('vault:add', (fields) => vault.add(fields));
  handle('vault:update', (id, fields) => vault.update(id, fields));
  handle('vault:remove', (id) => vault.remove(id));
  handle('vault:restore', (id) => vault.restore(id));
  handle('vault:purge', (id) => vault.purge(id));
  handle('vault:empty-trash', () => vault.emptyTrash());
  handle('vault:import-legacy', (entries) => vault.importEntries(entries));
  handle('vault:change-password', (current, next) => vault.changePassword(current, next));
  handle('vault:check-breaches', () => vault.checkBreaches());

  handle('vault:export-backup', async () => {
    vault.store.assertUnlocked();
    const date = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export encrypted vault backup',
      defaultPath: path.join(app.getPath('documents'), `password-helper-backup-${date}.phvault`),
      filters: [{ name: 'Password Helper backup', extensions: ['phvault'] }],
    });
    if (canceled || !filePath) return { saved: false };
    await vault.exportTo(filePath);
    return { saved: true, fileName: path.basename(filePath) };
  });

  handle('vault:choose-backup', async () => {
    vault.store.assertUnlocked();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import a vault backup',
      properties: ['openFile'],
      filters: [{ name: 'Password Helper backup', extensions: ['phvault', 'json'] }],
    });
    pendingImportPath = canceled || !filePaths.length ? null : filePaths[0];
    return pendingImportPath ? { fileName: path.basename(pendingImportPath) } : null;
  });

  handle('vault:import-backup', async (backupPassword) => {
    if (!pendingImportPath) throw new VaultError('INVALID', 'Choose a backup file first.');
    const entries = await VaultStore.readBackup(pendingImportPath, backupPassword);
    const result = await vault.importEntries(entries);
    pendingImportPath = null;
    return result;
  });

  // ---- CSV import from browsers / other password managers ----
  handle('import:choose-csv', async () => {
    vault.store.assertUnlocked();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import passwords from a CSV file',
      properties: ['openFile'],
      filters: [{ name: 'CSV export', extensions: ['csv'] }],
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    const { size } = await fsp.stat(filePath);
    if (size > csvImport.MAX_FILE_BYTES) throw new VaultError('INVALID', 'That file is too big to be a password export.');
    const parsed = csvImport.parseImport(await fsp.readFile(filePath, 'utf8'));
    // Same title + username as an existing item → probably already in the vault.
    const fingerprint = (entry) => `${entry.label.toLowerCase()}\u0000${entry.username.toLowerCase()}`;
    const existing = new Set(vault.store.list().map(fingerprint));
    const likelyDuplicates = parsed.entries.filter((entry) => existing.has(fingerprint(entry))).length;
    vault.touch();
    pendingCsv = { filePath, entries: parsed.entries };
    return {
      fileName: path.basename(filePath),
      format: parsed.format,
      count: parsed.entries.length,
      skipped: parsed.skipped,
      withTotp: parsed.entries.filter((entry) => entry.totp).length,
      totpIgnored: parsed.totpIgnored,
      likelyDuplicates,
      sample: parsed.entries.slice(0, 5).map((entry) => entry.label),
    };
  });
  handle('import:commit-csv', async () => {
    if (!pendingCsv || !pendingCsv.entries) throw new VaultError('INVALID', 'Choose a CSV file first.');
    const { entries } = pendingCsv;
    pendingCsv = { filePath: pendingCsv.filePath, entries: null };
    return vault.importEntries(entries);
  });
  // The export file holds every password in plain text — offer to move it to the trash.
  handle('import:trash-csv', async () => {
    if (!pendingCsv || !pendingCsv.filePath) return false;
    const { filePath } = pendingCsv;
    pendingCsv = null;
    await shell.trashItem(filePath);
    return true;
  });
  handle('import:cancel', () => {
    pendingCsv = null;
    return true;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Applies to every webContents the app ever creates.
app.on('web-contents-created', (_event, contents) => {
  const blockForeign = (event, url) => {
    if (!isAppPage(url)) event.preventDefault();
  };
  contents.on('will-navigate', blockForeign);
  contents.on('will-redirect', blockForeign);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url);
    return { action: 'deny' };
  });
});

function init() {
  const dataDir = app.getPath('userData');
  settings = new SettingsStore({ filePath: path.join(dataDir, 'settings.json') });
  clipboardGuard = new ClipboardGuard({ clipboard });
  vault = new VaultService({
    store: new VaultStore({ filePath: path.join(dataDir, 'vault.json') }),
    analysis,
    hibp,
    fetch: fetchForHibp,
    getAutoLockMinutes: () => settings.get('autoLockMinutes'),
  });

  vault.on('locked', (reason) => {
    // Drop any half-finished import: the parsed CSV holds plain-text passwords.
    if (pendingCsv) pendingCsv = { filePath: pendingCsv.filePath, entries: null };
    pendingImportPath = null;
    sendToPages('vault:locked', reason);
  });
  vault.on('unlocked', () => sendToPages('vault:unlocked'));
  settings.onChange((next, previous) => {
    if (next.autoLockMinutes !== previous.autoLockMinutes) vault.touch();
  });
  powerMonitor.on('suspend', () => vault.lock('suspend'));
  powerMonitor.on('lock-screen', () => vault.lock('suspend'));
}

if (!app.requestSingleInstanceLock()) {
  // Another instance is already running — it gets focused (see 'second-instance').
  // Only one process may write vault.json at a time.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // Packaged builds: no default menu, so no reload / DevTools shortcuts.
    if (!IS_DEV) Menu.setApplicationMenu(null);
    hardenSession();
    init();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    if (clipboardGuard) clipboardGuard.clearIfOurs();
    if (vault) vault.lock('quit');
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
