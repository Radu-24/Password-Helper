/**
 * vault.html — create / unlock the encrypted vault, vault menu, add / edit
 * entries, change the master password, export / import backups.
 *
 * The vault lives in the main process; this page only talks to window.api.vault.
 * URL parameters: ?screen=add | ?screen=edit&id=<id> (from the list page),
 * ?locked=<reason> (the list page was closed because the vault locked).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, $$ } = PH;
  const api = window.api;
  const Gen = window.PHGenerator;

  const params = new URLSearchParams(window.location.search);
  let current = 'loading-screen';
  function show(id) {
    current = id;
    PH.showScreen(id);
  }

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  /** Disables a submit button while `task` runs and turns errors into toasts. */
  async function withBusy(button, busyLabel, task) {
    if (button.disabled) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await task();
    } catch (error) {
      PH.showError(error);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function shake(element) {
    element.classList.remove('shake');
    void element.offsetWidth;
    element.classList.add('shake');
  }

  // ------------------------------------------------------------------
  // Create (first run)
  // ------------------------------------------------------------------
  const createPassword = $('#create-password');
  const createConfirm = $('#create-confirm');
  const createSubmit = $('#create-submit');
  const legacyNote = $('#legacy-note');
  const createReveal = PH.bindReveal($('#create-reveal'), createPassword);
  const createConfirmReveal = PH.bindReveal($('#create-confirm-reveal'), createConfirm);
  const createChecks = PH.Strength.createChecklist({
    passwordInput: createPassword,
    confirmInput: createConfirm,
    listEl: $('#create-checks'),
    meterEl: $('#create-meter'),
  });

  function openCreate() {
    const legacy = PH.VaultData.readLegacy();
    legacyNote.classList.toggle('hidden', legacy.length === 0);
    legacyNote.textContent = legacy.length
      ? `${plural(legacy.length, 'entry', 'entries')} saved by the previous version (unencrypted) will be moved into the new encrypted vault.`
      : '';
    show('create-screen');
  }

  $('#create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(createSubmit, 'Creating…', async () => {
      const check = await createChecks.validateNow();
      if (check.stale) return;
      if (!check.ok) {
        PH.toast(`❗ ${check.failure}`, { type: 'error' });
        return;
      }
      if (check.breachUnavailable) PH.toast('Breach check unavailable — continuing without it.', { type: 'warning' });

      const legacy = PH.VaultData.readLegacy();
      const { imported, skipped } = await api.vault.create(createPassword.value, legacy);
      if (legacy.length) await PH.VaultData.clearLegacy();
      createPassword.value = '';
      createConfirm.value = '';
      createReveal.hide();
      createConfirmReveal.hide();
      createChecks.reset();

      PH.toast(imported ? `Vault created — ${plural(imported, 'old entry', 'old entries')} moved in and encrypted.` : 'Vault created.', {
        type: 'success',
      });
      if (skipped) PH.toast(`${plural(skipped, 'old entry', 'old entries')} couldn't be imported (no label or password).`, { type: 'warning' });
      afterUnlock();
    });
  });

  // ------------------------------------------------------------------
  // Unlock
  // ------------------------------------------------------------------
  const unlockPassword = $('#unlock-password');
  const unlockSubmit = $('#unlock-submit');
  const capsWarning = $('#caps-warning');
  const unlockReveal = PH.bindReveal($('#unlock-reveal'), unlockPassword);

  for (const type of ['keydown', 'keyup']) {
    unlockPassword.addEventListener(type, (event) => {
      if (typeof event.getModifierState === 'function') {
        capsWarning.classList.toggle('hidden', !event.getModifierState('CapsLock'));
      }
    });
  }

  $('#unlock-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!unlockPassword.value) {
      unlockPassword.focus();
      return;
    }
    withBusy(unlockSubmit, 'Unlocking…', async () => {
      try {
        await api.vault.unlock(unlockPassword.value);
      } catch (error) {
        if (error.code === 'WRONG_PASSWORD' || error.code === 'THROTTLED') {
          shake(unlockPassword);
          unlockPassword.select();
        }
        throw error;
      }
      unlockPassword.value = '';
      unlockReveal.hide();
      capsWarning.classList.add('hidden');

      try {
        const migrated = await PH.VaultData.migrateLegacyIfAny();
        if (migrated && migrated.added) {
          PH.toast(`Moved ${plural(migrated.added, 'old entry', 'old entries')} into the encrypted vault.`, { type: 'success' });
        }
      } catch (error) {
        PH.showError(error, 'Could not move the old entries.');
      }
      afterUnlock();
    });
  });

  // ------------------------------------------------------------------
  // Menu
  // ------------------------------------------------------------------
  /** Where to go once the vault is open: the requested form, or the menu. */
  function afterUnlock() {
    const screen = params.get('screen');
    const id = params.get('id');
    params.delete('screen');
    params.delete('id');
    params.delete('locked');
    history.replaceState(null, '', window.location.pathname); // don't repeat it after a lock/unlock
    if (screen === 'add') openEntryForm({ returnTo: 'vault_view.html' });
    else if (screen === 'edit' && id) openEntryForm({ id, returnTo: 'vault_view.html' });
    else show('vault-menu-screen');
  }

  async function lockNow() {
    try {
      await api.vault.lock();
    } catch (error) {
      PH.showError(error);
    }
  }

  async function exportBackup() {
    try {
      const result = await api.vault.exportBackup();
      if (result.saved) {
        PH.toast(`Backup saved as ${result.fileName} — it stays encrypted with your master password.`, { type: 'success', duration: 5000 });
      }
    } catch (error) {
      PH.showError(error);
    }
  }

  async function importBackup() {
    let chosen;
    try {
      chosen = await api.vault.chooseBackup();
    } catch (error) {
      PH.showError(error);
      return;
    }
    if (!chosen) return;
    for (;;) {
      const password = await PH.prompt({
        title: 'Import backup',
        message: `Enter the master password that “${chosen.fileName}” was created with.`,
        type: 'password',
        confirmLabel: 'Import',
      });
      if (password === null) return;
      try {
        const { added, skipped } = await api.vault.importBackup(password);
        PH.toast(
          added
            ? `Imported ${plural(added, 'entry', 'entries')}${skipped ? ` (${skipped} already in the vault)` : ''}.`
            : 'Nothing new — every entry in that backup is already in the vault.',
          { type: 'success', duration: 4500 },
        );
        return;
      } catch (error) {
        PH.showError(error);
        if (error.code !== 'WRONG_PASSWORD') return; // wrong password → ask again
      }
    }
  }

  $('#btn-add').addEventListener('click', () => openEntryForm());
  $('#btn-view').addEventListener('click', () => PH.go('vault_view.html'));
  $('#btn-change').addEventListener('click', () => openChangeForm());
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', importBackup);
  $('#btn-lock').addEventListener('click', lockNow);
  for (const button of $$('[data-action="home"]')) button.addEventListener('click', () => PH.go('index.html'));

  // ------------------------------------------------------------------
  // Add / edit entry
  // ------------------------------------------------------------------
  const form = $('#entry-form');
  const entryTitle = $('#entry-title');
  const labelInput = $('#label');
  const typeInput = $('#type');
  const userInput = $('#username');
  const passwordInput = $('#vault-password');
  const notesInput = $('#notes');
  const entrySubmit = $('#entry-submit');
  const entryStrength = $('#entry-strength');
  const entryMeterMask = $('#entry-meter .mini-meter-mask');
  const entryReveal = PH.bindReveal($('#vault-reveal'), passwordInput);
  const fitNotes = PH.autoGrow(notesInput);
  const entryAnalyzer = PH.Strength.createAnalyzer({ delay: 120 });
  let editing = null; // { id, returnTo } while editing an existing entry
  let returnTo = null;

  function renderEntryStrength(analysis) {
    if (!passwordInput.value || !analysis) {
      entryMeterMask.style.width = '100%';
      entryStrength.textContent = '';
      return;
    }
    entryMeterMask.style.width = `${100 - (analysis.score + 1) * 20}%`;
    const label = window.PHPolicy.scoreLabel(analysis.score);
    entryStrength.textContent = `${label} · ≈ ${analysis.crackTime.offlineSlowHashing} to crack offline · ${PH.charLabel(passwordInput.value)}`;
  }

  function refreshEntryStrength() {
    const value = passwordInput.value;
    if (!value) {
      entryAnalyzer.cancel();
      renderEntryStrength(null);
      return;
    }
    entryAnalyzer.run(value, [labelInput.value, userInput.value]).then(({ stale, analysis }) => {
      if (!stale && passwordInput.value === value) renderEntryStrength(analysis);
    });
  }
  passwordInput.addEventListener('input', refreshEntryStrength);

  function clearEntryForm() {
    form.reset();
    typeInput.value = 'Website';
    entryReveal.hide();
    entryAnalyzer.cancel();
    renderEntryStrength(null);
    fitNotes();
  }

  async function openEntryForm({ id = null, returnTo: back = null } = {}) {
    clearEntryForm();
    editing = null;
    returnTo = back;
    entryTitle.textContent = id ? '✏️ Edit Entry' : '➕ Add Entry';
    entrySubmit.textContent = id ? '💾 Save changes' : '💾 Save';
    if (id) {
      try {
        const entry = await api.vault.get(id);
        labelInput.value = entry.label;
        typeInput.value = entry.type;
        userInput.value = entry.username;
        passwordInput.value = entry.password;
        notesInput.value = entry.notes;
        editing = { id };
        fitNotes();
        refreshEntryStrength();
      } catch (error) {
        PH.showError(error);
        leaveEntryForm();
        return;
      }
    }
    show('entry-screen');
  }

  function leaveEntryForm() {
    clearEntryForm();
    editing = null;
    if (returnTo) PH.go(returnTo);
    else show('vault-menu-screen');
  }

  function generateIntoForm() {
    const options = (PH.settings && PH.settings.generator) || {};
    try {
      passwordInput.value =
        options.mode === 'passphrase' ? Gen.generatePassphrase(options, window.PHWordlist) : Gen.generatePassword(options);
    } catch (error) {
      PH.showError(error);
      return;
    }
    entryReveal.show();
    refreshEntryStrength();
    passwordInput.focus();
  }
  $('#vault-generate').addEventListener('click', generateIntoForm);

  /** Same label + username already saved? Ask before creating a second copy. */
  async function confirmIfDuplicate(fields) {
    const { entries } = await api.vault.list();
    const norm = (text) => text.trim().toLowerCase();
    const twin = entries.find(
      (entry) =>
        (!editing || entry.id !== editing.id) &&
        norm(entry.label) === norm(fields.label) &&
        norm(entry.username) === norm(fields.username),
    );
    if (!twin) return true;
    return PH.confirm({
      title: 'Possible duplicate',
      message: `There's already an entry for “${twin.label}”${twin.username ? ` with the username “${twin.username}”` : ''}. Save anyway?`,
      confirmLabel: 'Save anyway',
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(entrySubmit, 'Saving…', async () => {
      const fields = {
        label: labelInput.value,
        type: typeInput.value,
        username: userInput.value,
        password: passwordInput.value,
        notes: notesInput.value,
      };
      if (!fields.label.trim()) {
        labelInput.focus();
        throw new Error('Please enter a label.');
      }
      if (!fields.password) {
        passwordInput.focus();
        throw new Error('Password cannot be empty.');
      }
      if (!(await confirmIfDuplicate(fields))) return;

      const saved = editing ? await api.vault.update(editing.id, fields) : await api.vault.add(fields);
      PH.toast(editing ? 'Changes saved.' : 'Entry saved.', { type: 'success' });
      if (saved.reusedCount > 0) {
        PH.toast(`⚠️ This password is also used by ${plural(saved.reusedCount, 'other entry', 'other entries')} — consider a unique one.`, {
          type: 'warning',
          duration: 5000,
        });
      }
      leaveEntryForm();
    });
  });
  $('#btn-cancel').addEventListener('click', leaveEntryForm);

  // ------------------------------------------------------------------
  // Change master password
  // ------------------------------------------------------------------
  const changeCurrent = $('#change-current');
  const changeNew = $('#change-new');
  const changeConfirm = $('#change-confirm');
  const changeSubmit = $('#change-submit');
  const changeReveals = [
    PH.bindReveal($('#change-current-reveal'), changeCurrent),
    PH.bindReveal($('#change-new-reveal'), changeNew),
    PH.bindReveal($('#change-confirm-reveal'), changeConfirm),
  ];
  const changeChecks = PH.Strength.createChecklist({
    passwordInput: changeNew,
    confirmInput: changeConfirm,
    listEl: $('#change-checks'),
    meterEl: $('#change-meter'),
  });

  function clearChangeForm() {
    for (const input of [changeCurrent, changeNew, changeConfirm]) input.value = '';
    for (const reveal of changeReveals) reveal.hide();
    changeChecks.reset();
  }

  function openChangeForm() {
    clearChangeForm();
    show('change-screen');
  }

  function closeChangeForm() {
    clearChangeForm();
    show('vault-menu-screen');
  }

  $('#change-form').addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(changeSubmit, 'Changing…', async () => {
      if (!changeCurrent.value) {
        changeCurrent.focus();
        throw new Error('Enter your current master password.');
      }
      if (changeCurrent.value === changeNew.value) throw new Error('The new master password must be different.');
      const check = await changeChecks.validateNow();
      if (check.stale) return;
      if (!check.ok) throw new Error(check.failure);
      if (check.breachUnavailable) PH.toast('Breach check unavailable — continuing without it.', { type: 'warning' });
      try {
        await api.vault.changePassword(changeCurrent.value, changeNew.value);
      } catch (error) {
        if (error.code === 'WRONG_PASSWORD') {
          shake(changeCurrent);
          changeCurrent.select();
        }
        throw error;
      }
      PH.toast('Master password changed.', { type: 'success' });
      closeChangeForm();
    });
  });
  $('#change-cancel').addEventListener('click', closeChangeForm);

  // ------------------------------------------------------------------
  // Keyboard + lock events
  // ------------------------------------------------------------------
  PH.onEscape(() => {
    if (current === 'entry-screen') leaveEntryForm();
    else if (current === 'change-screen') closeChangeForm();
    else if (current !== 'loading-screen') PH.go('index.html');
  });
  PH.onShortcut('n', () => {
    if (current === 'vault-menu-screen') openEntryForm();
  });
  PH.onShortcut('f', () => {
    if (current === 'vault-menu-screen') PH.go('vault_view.html');
  });
  PH.onShortcut('g', () => {
    if (current === 'entry-screen') generateIntoForm();
  });

  PH.onVaultLocked((message, reason) => {
    clearEntryForm();
    clearChangeForm();
    editing = null;
    if (current === 'create-screen') return;
    // A manual lock needs no explanation; auto-lock / sleep / minimise do.
    if (reason !== 'manual' && current !== 'unlock-screen' && current !== 'loading-screen') PH.toast(message, { type: 'warning' });
    show('unlock-screen');
  });

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  PH.ready.then(async () => {
    const lockedReason = params.get('locked');
    if (lockedReason && lockedReason !== 'manual') PH.toast(PH.lockMessage(lockedReason), { type: 'warning' });
    try {
      const status = await api.vault.status();
      if (!status.exists) openCreate();
      else if (!status.unlocked) show('unlock-screen');
      else afterUnlock();
    } catch (error) {
      PH.showError(error, 'Could not open the vault.');
    }
  });
})();
