'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SettingsStore, DEFAULTS } = require('../../src/settings-store');

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'settings.json');
}

test('missing or damaged file falls back to defaults', (t) => {
  const filePath = tempFile(t);
  assert.equal(new SettingsStore({ filePath }).get('autoLockMinutes'), DEFAULTS.autoLockMinutes);
  fs.writeFileSync(filePath, '{ broken');
  const store = new SettingsStore({ filePath });
  assert.equal(store.get('clearAnalyzerOnBack'), true);
  assert.equal(store.get('generator').length, 20);
});

test('set() validates values, ignores unknown keys and persists', async (t) => {
  const filePath = tempFile(t);
  const store = new SettingsStore({ filePath });
  const result = await store.set({
    autoLockMinutes: 15,
    clipboardClearSeconds: 7, // not an allowed choice → ignored
    matrixBackground: 'yes', // wrong type → ignored
    somethingElse: true, // unknown → ignored
    generator: { length: 32, symbols: false, length2: 1 },
  });
  assert.equal(result.autoLockMinutes, 15);
  assert.equal(result.clipboardClearSeconds, DEFAULTS.clipboardClearSeconds);
  assert.equal(result.matrixBackground, true);
  assert.equal('somethingElse' in result, false);
  assert.equal(result.generator.length, 32);
  assert.equal(result.generator.symbols, false);
  assert.equal('length2' in result.generator, false);

  const reloaded = new SettingsStore({ filePath });
  assert.equal(reloaded.get('autoLockMinutes'), 15);
  assert.equal(reloaded.get('generator').length, 32);
});

test('pages cannot change main-only keys', async (t) => {
  const store = new SettingsStore({ filePath: tempFile(t) });
  const bounds = { x: 1, y: 2, width: 900, height: 700 };
  const visible = await store.set({ windowBounds: bounds });
  assert.equal('windowBounds' in visible, false);
  assert.equal(store.get('windowBounds'), null);
  await store.set({ windowBounds: bounds }, { internal: true });
  assert.deepEqual(store.get('windowBounds'), bounds);
});

test('the generator always keeps one character set enabled', async (t) => {
  const store = new SettingsStore({ filePath: tempFile(t) });
  const { generator } = await store.set({ generator: { lowercase: false, uppercase: false, digits: false, symbols: false } });
  assert.equal(generator.lowercase, true);
});

test('setSync writes atomically and onChange fires on set', async (t) => {
  const filePath = tempFile(t);
  const store = new SettingsStore({ filePath });
  let seen = null;
  store.onChange((next, previous) => {
    seen = [previous.autoLockMinutes, next.autoLockMinutes];
  });
  await store.set({ autoLockMinutes: 30 });
  assert.deepEqual(seen, [5, 30]);
  store.setSync({ windowBounds: { x: 0, y: 0, width: 1000, height: 800, maximized: true } });
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['settings.json']);
  assert.equal(new SettingsStore({ filePath }).get('windowBounds').maximized, true);
});

test('appearance settings are validated', async (t) => {
  const store = new SettingsStore({ filePath: tempFile(t) });
  assert.equal(store.get('accent'), 'blue');
  let result = await store.set({ accent: 'purple', backgroundIntensity: 35, reduceMotion: true, vaultSort: 'recent', onboarded: true });
  assert.deepEqual(
    [result.accent, result.backgroundIntensity, result.reduceMotion, result.vaultSort, result.onboarded],
    ['purple', 35, true, 'recent', true],
  );
  result = await store.set({ accent: 'hotdog', backgroundIntensity: 101, vaultSort: 'size' });
  assert.deepEqual([result.accent, result.backgroundIntensity, result.vaultSort], ['purple', 35, 'recent'], 'invalid values are ignored');
  result = await store.set({ backgroundIntensity: 12.5 });
  assert.equal(result.backgroundIntensity, 35, 'whole numbers only');
});
