/**
 * Vault helpers for the vault pages.
 *
 * The vault itself lives in the main process (encrypted with the master
 * password; see src/vault-store.js) and is reached through window.api.vault.
 * This file only deals with the *old* storage: earlier versions kept entries
 * unencrypted in localStorage under "vaultEntries". They are moved into the
 * encrypted vault once, then wiped.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const api = window.api;
  const LEGACY_KEY = 'vaultEntries';
  const TYPES = Object.freeze(['Website', 'App', 'Email', 'Other']);

  function readLegacy() {
    const data = PH.store.get(LEGACY_KEY, []);
    return Array.isArray(data) ? data.filter((item) => item && typeof item === 'object') : [];
  }

  /** Deletes the old unencrypted copy (including Chromium's on-disk localStorage files). */
  async function clearLegacy() {
    PH.store.remove(LEGACY_KEY);
    try {
      await api.app.purgeLegacyStorage();
    } catch {
      // the key is already removed; the purge is a best-effort extra
    }
  }

  /**
   * Imports leftover legacy entries into the (unlocked) vault.
   * @returns {Promise<{added:number, skipped:number}|null>} null if there was nothing to move
   */
  async function migrateLegacyIfAny() {
    const legacy = readLegacy();
    if (!legacy.length) return null;
    const result = await api.vault.importLegacy(legacy);
    await clearLegacy();
    return result;
  }

  PH.VaultData = { TYPES, readLegacy, clearLegacy, migrateLegacyIfAny };
})();
