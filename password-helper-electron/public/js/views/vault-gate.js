/**
 * Vault gate: shown in place of a vault view while the vault is locked
 * (unlock form) or doesn't exist yet (create form).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $ } = PH;
  const api = window.api;
  const Gen = window.PHGenerator;

  const view = $('#view-gate');
  const titleEl = $('#gate-title');
  const unlockForm = $('#unlock-form');
  const createForm = $('#create-form');
  const loading = $('#gate-loading');

  // ------------------------------------------------------------------
  // Unlock
  // ------------------------------------------------------------------
  const lockBadge = $('#lock-badge');
  const unlockField = $('#unlock-field');
  const unlockInput = $('#unlock-password');
  const unlockSubmit = $('#unlock-submit');
  const unlockMessage = $('#unlock-message');
  let throttleTimer = null;
  let capsLock = false;
  let busy = false;

  function setMessage(text, { error = false } = {}) {
    unlockMessage.textContent = text;
    unlockMessage.classList.toggle('is-error', error);
  }

  function showCapsLock() {
    if (!throttleTimer && !unlockMessage.classList.contains('is-error')) setMessage(capsLock ? 'Caps Lock is on' : '');
  }

  for (const type of ['keydown', 'keyup']) {
    unlockInput.addEventListener(type, (event) => {
      if (typeof event.getModifierState !== 'function') return;
      capsLock = event.getModifierState('CapsLock');
      showCapsLock();
    });
  }
  unlockInput.addEventListener('input', () => {
    unlockField.classList.toggle('has-value', unlockInput.value.length > 0);
    if (unlockMessage.classList.contains('is-error') && !throttleTimer) setMessage(capsLock ? 'Caps Lock is on' : '');
  });

  function startThrottle(ms) {
    clearInterval(throttleTimer);
    const until = Date.now() + ms;
    unlockSubmit.disabled = true;
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(throttleTimer);
        throttleTimer = null;
        unlockSubmit.disabled = false;
        setMessage(capsLock ? 'Caps Lock is on' : '');
        return;
      }
      setMessage(`Too many attempts — try again in ${left} s`, { error: true });
    };
    tick();
    throttleTimer = setInterval(tick, 250);
  }

  unlockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || throttleTimer) return;
    if (!unlockInput.value) {
      unlockInput.focus();
      return;
    }
    busy = true;
    unlockSubmit.classList.add('is-busy');
    setMessage('');
    try {
      await api.vault.unlock(unlockInput.value);
      unlockInput.value = '';
      unlockField.classList.remove('has-value');
      try {
        const migrated = await PH.VaultData.migrateLegacyIfAny();
        if (migrated && migrated.added) {
          PH.hud(`Moved ${PH.plural(migrated.added, 'old item', 'old items')} into the encrypted vault.`, { tone: 'success' });
        }
      } catch (error) {
        PH.showError(error, 'Could not move the old items.');
      }
    } catch (error) {
      if (error.code === 'THROTTLED') startThrottle(error.retryAfterMs || 1000);
      else setMessage(error.message || 'Could not unlock the vault.', { error: true });
      if (error.code === 'WRONG_PASSWORD' || error.code === 'THROTTLED') {
        PH.replayClass(unlockField, 'shake');
        PH.replayClass(lockBadge, 'shake');
        unlockInput.select();
      }
    } finally {
      busy = false;
      unlockSubmit.classList.remove('is-busy');
    }
  });

  // ------------------------------------------------------------------
  // Create (first run)
  // ------------------------------------------------------------------
  const createPassword = $('#create-password');
  const createConfirm = $('#create-confirm');
  const createSubmit = $('#create-submit');
  const legacyNote = $('#legacy-note');
  const createReveals = PH.bindRevealButtons(createForm);
  const createChecks = PH.Strength.createChecklist({
    passwordInput: createPassword,
    confirmInput: createConfirm,
    listEl: $('#create-checks'),
    meterEl: $('#create-meter'),
  });

  function clearCreate() {
    createPassword.value = '';
    createConfirm.value = '';
    for (const reveal of Object.values(createReveals)) reveal.hide();
    createChecks.reset();
  }

  $('#create-suggest').addEventListener('click', () => {
    const phrase = Gen.generatePassphrase({ words: 6, separator: '-', capitalize: true, addNumber: true }, window.PHWordlist);
    createPassword.value = phrase;
    createReveals['create-password'].show();
    createPassword.dispatchEvent(new Event('input'));
    createConfirm.value = '';
    createConfirm.dispatchEvent(new Event('input'));
    createConfirm.focus();
    PH.hud('Write it down or memorise it, then type it again to confirm.', { tone: 'info', icon: 'sparkles', duration: 5000 });
  });

  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    PH.withBusy(createSubmit, async () => {
      const check = await createChecks.validateNow();
      if (check.stale) return;
      if (!check.ok) throw new Error(check.failure);
      if (check.breachUnavailable) PH.hud('Breach check unavailable — continuing without it.', { tone: 'warning' });
      const legacy = PH.VaultData.readLegacy();
      const { imported, skipped } = await api.vault.create(createPassword.value, legacy);
      if (legacy.length) await PH.VaultData.clearLegacy();
      clearCreate();
      PH.hud(imported ? `Vault created — ${PH.plural(imported, 'old item', 'old items')} moved in and encrypted.` : 'Vault created.', { tone: 'success' });
      if (skipped) PH.hud(`${PH.plural(skipped, 'old item', 'old items')} couldn’t be moved (no title or password).`, { tone: 'warning' });
    });
  });

  // ------------------------------------------------------------------
  // View
  // ------------------------------------------------------------------
  function showForm(which) {
    unlockForm.hidden = which !== 'unlock';
    createForm.hidden = which !== 'create';
    loading.hidden = which !== 'loading';
    const card = which === 'unlock' ? unlockForm : which === 'create' ? createForm : null;
    if (card) PH.enter([card]);
    if (which === 'unlock') {
      lockBadge.classList.remove('is-open');
      unlockInput.focus({ preventScroll: true });
    }
    if (which === 'create') {
      const legacy = PH.VaultData.readLegacy();
      legacyNote.hidden = legacy.length === 0;
      legacyNote.textContent = legacy.length
        ? `${PH.plural(legacy.length, 'item', 'items')} saved by an earlier version (unencrypted) will be moved into the new vault and encrypted.`
        : '';
      createPassword.focus({ preventScroll: true });
    }
  }

  PH.views = PH.views || {};
  PH.views.gate = {
    element: view,
    title: 'Vault',
    async onShow({ title = 'Vault' } = {}) {
      titleEl.textContent = title;
      let status = PH.Vault.status;
      if (!status.known) {
        showForm('loading');
        try {
          status = await PH.Vault.refreshStatus();
        } catch (error) {
          PH.showError(error, 'Could not open the vault.');
          return;
        }
      }
      if (view.hidden) return;
      showForm(status.exists ? 'unlock' : 'create');
    },
    onHide() {
      unlockInput.value = '';
      unlockField.classList.remove('has-value');
      setMessage('');
      clearCreate();
    },
    /** Opens the padlock before the vault appears. */
    async celebrate() {
      if (unlockForm.hidden || PH.reducedMotion()) return;
      lockBadge.classList.add('is-open');
      await new Promise((resolve) => setTimeout(resolve, 380));
    },
  };
})();
