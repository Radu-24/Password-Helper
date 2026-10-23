/**
 * The page's view of the vault: status, the item list (no passwords or 2FA
 * secrets — those stay in the main process) and derived counts. Views
 * subscribe to it instead of each calling window.api on their own.
 *
 *   PH.Vault.subscribe((vault, reason) => …)   reason: 'status' | 'list' | 'locked' | 'unlocked'
 */
(function () {
  'use strict';

  const PH = window.PH;
  const api = window.api;

  const listeners = new Set();
  let refreshing = null;

  const Vault = {
    status: { exists: false, unlocked: false, known: false },
    entries: [],
    breachCheckedAt: null,
    loaded: false,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    emit(reason, detail) {
      for (const listener of listeners) {
        try {
          listener(Vault, reason, detail);
        } catch (error) {
          console.error(error);
        }
      }
    },

    async refreshStatus() {
      const status = await api.vault.status();
      Vault.status = { ...status, known: true };
      Vault.emit('status');
      return Vault.status;
    },

    /** Reloads the item list (coalesces overlapping calls). */
    refresh() {
      if (!Vault.status.unlocked) return Promise.resolve(Vault);
      if (refreshing) return refreshing;
      refreshing = (async () => {
        try {
          const { entries, breachCheckedAt } = await api.vault.list();
          Vault.entries = entries;
          Vault.breachCheckedAt = breachCheckedAt;
          Vault.loaded = true;
          Vault.emit('list');
        } catch (error) {
          if (error.code !== 'LOCKED') PH.showError(error);
        } finally {
          refreshing = null;
        }
        return Vault;
      })();
      return refreshing;
    },

    // ---- queries ----
    find: (id) => Vault.entries.find((entry) => entry.id === id) || null,
    active: () => Vault.entries.filter((entry) => !entry.deletedAt),
    favorites: () => Vault.active().filter((entry) => entry.favorite),
    withCodes: () => Vault.active().filter((entry) => entry.hasTotp),
    deleted: () => Vault.entries.filter((entry) => entry.deletedAt),

    /** Security recommendations for active items. */
    issues() {
      const active = Vault.active();
      return {
        breached: active.filter((entry) => entry.breachCount > 0),
        reused: active.filter((entry) => entry.reusedCount > 0),
        weak: active.filter((entry) => entry.weak),
      };
    },

    counts() {
      const issues = Vault.issues();
      const flagged = new Set([...issues.breached, ...issues.reused, ...issues.weak].map((entry) => entry.id));
      return {
        items: Vault.active().length,
        favorites: Vault.favorites().length,
        codes: Vault.withCodes().length,
        security: flagged.size,
        breached: issues.breached.length,
        deleted: Vault.deleted().length,
      };
    },

    // ---- actions (each refreshes the list afterwards) ----
    async add(fields) {
      const saved = await api.vault.add(fields);
      await Vault.refresh();
      return saved;
    },
    async update(id, fields) {
      const saved = await api.vault.update(id, fields);
      await Vault.refresh();
      return saved;
    },
    async setFavorite(id, favorite) {
      const entry = Vault.find(id);
      if (entry) {
        entry.favorite = favorite; // instant feedback; the refresh confirms it
        Vault.emit('list');
      }
      try {
        await api.vault.setFavorite(id, favorite);
      } finally {
        await Vault.refresh();
      }
    },
    async remove(id) {
      await api.vault.remove(id);
      await Vault.refresh();
    },
    async restore(id) {
      await api.vault.restore(id);
      await Vault.refresh();
    },
    async purge(id) {
      await api.vault.purge(id);
      await Vault.refresh();
    },
    async emptyTrash() {
      const count = await api.vault.emptyTrash();
      await Vault.refresh();
      return count;
    },
    async checkBreaches() {
      const result = await api.vault.checkBreaches();
      await Vault.refresh();
      return result;
    },
    lock() {
      return api.vault.lock().catch((error) => PH.showError(error));
    },
  };

  api.vault.onLocked((reason) => {
    Vault.status = { ...Vault.status, unlocked: false };
    Vault.entries = [];
    Vault.breachCheckedAt = null;
    Vault.loaded = false;
    Vault.emit('locked', reason);
  });
  api.vault.onUnlocked(() => {
    Vault.status = { exists: true, unlocked: true, known: true };
    Vault.emit('unlocked');
    Vault.refresh();
  });

  PH.Vault = Vault;
})();
