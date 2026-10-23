/**
 * Settings view, plus the flows it starts: change master password, import
 * from a browser / password-manager CSV, export and restore encrypted backups.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, $$, el, icon } = PH;
  const api = window.api;
  const Vault = PH.Vault;

  const view = $('#view-settings');
  const ACCENTS = [
    ['blue', '#0a84ff', 'Blue'],
    ['cyan', '#4fd0ff', 'Cyan'],
    ['purple', '#bf5af2', 'Purple'],
    ['pink', '#ff4f87', 'Pink'],
    ['red', '#ff453a', 'Red'],
    ['orange', '#ff9f0a', 'Orange'],
    ['yellow', '#ffd60a', 'Yellow'],
    ['green', '#30d158', 'Green'],
    ['graphite', '#9a9aa1', 'Graphite'],
  ];
  const SHORTCUTS = [
    ['Analyzer, Generator, All Items …', 'mod+1', '…6'],
    ['Search the vault', 'mod+f'],
    ['New item', 'mod+n'],
    ['Edit the selected item', 'mod+e'],
    ['Copy the password / username', 'mod+c', 'mod+shift+c'],
    ['Generate a password', 'mod+g'],
    ['Lock the vault', 'mod+l'],
    ['Settings', 'mod+,'],
    ['Show or hide the sidebar', 'mod+shift+s'],
  ];

  // ------------------------------------------------------------------
  // Settings controls: every [data-setting] element is bound automatically
  // ------------------------------------------------------------------
  const controls = $$('[data-setting]', view);
  const intensity = $('#set-intensity');
  const intensityValue = $('#set-intensity-value');
  for (const select of $$('select.popup', view)) PH.popupButton(select);

  function fillControls() {
    for (const control of controls) {
      const value = PH.settings[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = value === true;
      else {
        control.value = String(value);
        if (control.refreshPopup) control.refreshPopup();
      }
    }
    PH.syncSlider(intensity);
    intensityValue.textContent = `${intensity.value}%`;
    $('#intensity-row').classList.toggle('is-disabled', PH.settings.matrixBackground === false);
    intensity.disabled = PH.settings.matrixBackground === false;
    for (const swatch of $$('.accent-swatch', view)) swatch.setAttribute('aria-checked', String(swatch.dataset.accent === PH.settings.accent));
  }

  const saveIntensity = PH.debounce((value) => PH.updateSettings({ backgroundIntensity: value }).catch((error) => PH.showError(error)), 150);
  for (const control of controls) {
    if (control === intensity) {
      control.addEventListener('input', () => {
        PH.syncSlider(intensity);
        intensityValue.textContent = `${intensity.value}%`;
        // Live preview while dragging; saved shortly after.
        document.getElementById('matrix').style.setProperty('--rain-opacity', String(0.15 + 0.85 * (Number(intensity.value) / 100)));
        saveIntensity(Number(intensity.value));
      });
      continue;
    }
    control.addEventListener('change', async () => {
      const key = control.dataset.setting;
      let value = control.type === 'checkbox' ? control.checked : control.value;
      if (control.dataset.type === 'number') value = Number(value);
      try {
        await PH.updateSettings({ [key]: value });
      } catch (error) {
        PH.showError(error, 'Couldn’t save the setting.');
      }
      fillControls(); // show what was actually stored
    });
  }

  // Accent swatches
  const picker = $('#accent-picker');
  for (const [name, colour, label] of ACCENTS) {
    const swatch = el('button', {
      type: 'button',
      className: 'accent-swatch',
      role: 'radio',
      title: label,
      'aria-label': label,
      dataset: { accent: name },
    });
    swatch.style.setProperty('--swatch', colour);
    swatch.addEventListener('click', () => {
      PH.updateSettings({ accent: name }).then(fillControls, (error) => PH.showError(error));
    });
    picker.append(swatch);
  }
  picker.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = ACCENTS.findIndex(([name]) => name === PH.settings.accent);
    const next = ACCENTS[(index + (event.key === 'ArrowRight' ? 1 : -1) + ACCENTS.length) % ACCENTS.length][0];
    PH.updateSettings({ accent: next }).then(() => {
      fillControls();
      $(`.accent-swatch[data-accent="${next}"]`, picker).focus();
    });
  });

  // Shortcut list
  const shortcutList = $('#shortcut-list');
  for (const [label, ...combos] of SHORTCUTS) {
    const keys = el('dd');
    combos.forEach((combo, index) => {
      if (index) keys.append(el('span', { className: 'row-hint', text: combo.startsWith('…') ? '' : '/' }));
      keys.append(el('kbd', { text: combo.startsWith('…') ? combo : PH.keyLabel(combo) }));
    });
    shortcutList.append(el('dt', { text: label }), keys);
  }

  // ------------------------------------------------------------------
  // Vault-dependent rows
  // ------------------------------------------------------------------
  const changeMasterButton = $('#set-change-master');
  function syncVaultRows() {
    const unlocked = Vault.status.unlocked;
    changeMasterButton.disabled = !unlocked;
    $('#set-master-note').textContent = unlocked
      ? 'Re-encrypts the vault with a new master password.'
      : Vault.status.exists
        ? 'Unlock the vault to change it.'
        : 'Create the vault first.';
    for (const button of $$('[data-needs-vault]', view)) button.disabled = !unlocked;
    $('#set-vault-note').hidden = unlocked;
  }
  Vault.subscribe(syncVaultRows);

  // ------------------------------------------------------------------
  // Change master password (sheet)
  // ------------------------------------------------------------------
  function secureInput(id, placeholder, autocomplete) {
    const input = el('input', { type: 'password', id, placeholder, autocomplete, maxLength: 1024, spellcheck: false });
    const button = el('button', { type: 'button', className: 'field-btn', 'aria-label': 'Show password' }, icon('eye'));
    const wrap = el('div', { className: 'secure-field input-field' }, el('label', { className: 'sr-only', htmlFor: id, text: placeholder }), input, button);
    return { input, wrap, reveal: PH.bindReveal(button, input) };
  }

  function openChangeMaster() {
    const current = secureInput('cm-current', 'Current master password', 'current-password');
    const next = secureInput('cm-new', 'New master password', 'new-password');
    const confirm = secureInput('cm-confirm', 'Confirm new master password', 'new-password');
    const meter = el('div', { className: 'meter meter-thin', 'aria-hidden': 'true' }, el('span'), el('span'), el('span'), el('span'), el('span'));
    const checklist = el(
      'ul',
      { className: 'checklist', 'aria-label': 'New master password requirements' },
      el('li', { dataset: { check: 'length' }, text: 'At least 15 characters' }),
      el('li', { dataset: { check: 'guess' }, text: 'Hard to guess — no common words, names or patterns' }),
      el('li', { dataset: { check: 'breach' }, text: 'Not found in known data breaches' }),
      el('li', { dataset: { check: 'match' }, text: 'Both passwords match' }),
    );
    const checks = PH.Strength.createChecklist({ passwordInput: next.input, confirmInput: confirm.input, listEl: checklist, meterEl: meter });
    const content = el(
      'div',
      { className: 'form-grid' },
      current.wrap,
      el('div', { className: 'form-grid', style: { gap: '8px' } }, next.wrap, meter, confirm.wrap),
      checklist,
      el('p', { className: 'otp-hint', text: 'Backups you exported earlier keep the master password they were made with.' }),
    );
    PH.openSheet({
      title: 'Change Master Password',
      subtitle: 'The vault is re-encrypted with the new password.',
      symbol: { icon: 'key-round', tint: 'graphite' },
      content,
      buttons: [
        { label: 'Cancel', role: 'cancel' },
        { label: 'Change Password', role: 'primary' },
      ],
      initialFocus: current.input,
      async onSubmit() {
        if (!current.input.value) {
          current.input.focus();
          throw new Error('Enter your current master password.');
        }
        if (current.input.value === next.input.value) throw new Error('The new master password must be different.');
        const check = await checks.validateNow();
        if (check.stale) return false;
        if (!check.ok) throw new Error(check.failure);
        if (check.breachUnavailable) PH.hud('Breach check unavailable — continuing without it.', { tone: 'warning' });
        try {
          await api.vault.changePassword(current.input.value, next.input.value);
        } catch (error) {
          if (error.code === 'WRONG_PASSWORD') {
            PH.replayClass(current.wrap, 'shake');
            current.input.select();
          }
          throw error;
        }
        PH.hud('Master password changed', { tone: 'success', icon: 'key-round' });
        return true;
      },
      onClose() {
        for (const field of [current, next, confirm]) {
          field.input.value = '';
          field.reveal.hide();
        }
        checks.reset();
      },
    });
  }
  changeMasterButton.addEventListener('click', openChangeMaster);

  // ------------------------------------------------------------------
  // Import from a CSV export
  // ------------------------------------------------------------------
  function summaryRow(label, value) {
    return el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
  }

  /** Whole flow: pick a file → preview → import → offer to trash the plain-text file. */
  PH.importCsv = async function importCsv() {
    if (!Vault.status.unlocked) {
      PH.hud('Unlock the vault first.', { tone: 'info', icon: 'lock' });
      PH.navigate('items');
      return;
    }
    let preview;
    try {
      preview = await api.csvImport.choose();
    } catch (error) {
      PH.showError(error);
      return;
    }
    if (!preview) return;

    if (!preview.count) {
      api.csvImport.cancel().catch(() => {});
      await PH.alert({
        title: 'Nothing to import',
        message: `“${preview.fileName}” has no rows with a password${preview.skipped ? ` (${PH.plural(preview.skipped, 'row was', 'rows were')} skipped)` : ''}.`,
        symbol: { icon: 'file-x', tint: 'orange' },
      });
      return;
    }

    let imported = null;
    const details = el(
      'dl',
      { className: 'kv-list', style: { padding: '0' } },
      summaryRow('File', preview.fileName),
      summaryRow('Exported from', preview.format === 'CSV' ? 'A CSV file' : preview.format),
      summaryRow('Passwords', preview.count.toLocaleString()),
      preview.withTotp ? summaryRow('With verification codes', preview.withTotp.toLocaleString()) : null,
      preview.skipped ? summaryRow('Skipped rows (no password, notes, cards)', preview.skipped.toLocaleString()) : null,
      preview.likelyDuplicates ? summaryRow('Probably already in your vault', preview.likelyDuplicates.toLocaleString()) : null,
    );
    const sample = el(
      'div',
      { className: 'type-picker', style: { marginTop: '4px' } },
      preview.sample.map((label) => el('span', { className: 'badge', text: label })),
      preview.count > preview.sample.length ? el('span', { className: 'badge', text: `+${(preview.count - preview.sample.length).toLocaleString()} more` }) : null,
    );
    const warning = el(
      'div',
      { className: 'callout', dataset: { tint: 'orange' } },
      icon('triangle-alert'),
      el('div', { className: 'callout-text' }, el('strong', { text: 'This file isn’t encrypted' }), el('span', { text: 'Anyone who opens it can read your passwords. After importing, move it to the Trash.' })),
    );
    PH.openSheet({
      title: 'Import Passwords',
      subtitle: 'Items that are exactly the same as ones in your vault are skipped.',
      symbol: { icon: 'file-up', tint: 'purple' },
      width: 500,
      content: el('div', { className: 'form-grid' }, details, sample, warning),
      buttons: [
        { label: 'Cancel', role: 'cancel' },
        { label: `Import ${PH.plural(preview.count, 'Item', 'Items')}`, role: 'primary' },
      ],
      async onSubmit() {
        imported = await api.csvImport.commit();
        return true;
      },
      async onClose() {
        if (!imported) {
          api.csvImport.cancel().catch(() => {});
          return;
        }
        await Vault.refresh();
        const { added, skipped } = imported;
        const trash = await PH.alert({
          title: added ? `Imported ${PH.plural(added, 'item', 'items')}` : 'Nothing new to import',
          message: `${skipped ? `${PH.plural(skipped, 'item was', 'items were')} already in the vault or not valid. ` : ''}Move “${preview.fileName}” to the Trash? It has your passwords in plain text.`,
          symbol: { icon: 'circle-check', tint: 'green' },
          buttons: [
            { label: 'Keep File', value: false, cancel: true },
            { label: 'Move to Trash', value: true, style: 'primary' },
          ],
        });
        try {
          if (trash && (await api.csvImport.trashFile())) PH.hud('Export file moved to the Trash', { tone: 'success', icon: 'trash' });
          else await api.csvImport.cancel();
        } catch (error) {
          PH.showError(error, 'Couldn’t move the file to the Trash — delete it yourself.');
        }
        if (added) PH.navigate('items');
      },
    });
  };

  // ------------------------------------------------------------------
  // Encrypted backups
  // ------------------------------------------------------------------
  async function exportBackup() {
    try {
      const result = await api.vault.exportBackup();
      if (result.saved) PH.hud(`Backup saved as ${result.fileName}`, { tone: 'success', icon: 'hard-drive', duration: 4500 });
    } catch (error) {
      PH.showError(error);
    }
  }

  async function restoreBackup() {
    let chosen;
    try {
      chosen = await api.vault.chooseBackup();
    } catch (error) {
      PH.showError(error);
      return;
    }
    if (!chosen) return;
    const field = secureInput('backup-password', 'Master password of the backup', 'off');
    const error = el('p', { className: 'gate-message is-error', role: 'status' });
    PH.openSheet({
      title: 'Restore from Backup',
      subtitle: `Enter the master password “${chosen.fileName}” was made with.`,
      symbol: { icon: 'hard-drive', tint: 'blue' },
      content: el('div', { className: 'form-grid' }, field.wrap, error),
      buttons: [
        { label: 'Cancel', role: 'cancel' },
        { label: 'Restore', role: 'primary' },
      ],
      initialFocus: field.input,
      async onSubmit() {
        error.textContent = '';
        try {
          const { added, skipped } = await api.vault.importBackup(field.input.value);
          await Vault.refresh();
          PH.hud(
            added ? `Restored ${PH.plural(added, 'item', 'items')}${skipped ? ` (${skipped} already in the vault)` : ''}` : 'Nothing new — everything in that backup is already in the vault.',
            { tone: 'success', duration: 4500 },
          );
          return true;
        } catch (failure) {
          if (failure.code !== 'WRONG_PASSWORD') throw failure;
          error.textContent = failure.message;
          PH.replayClass(field.wrap, 'shake');
          field.input.select();
          return false;
        }
      },
      onClose() {
        field.input.value = '';
        field.reveal.hide();
      },
    });
  }

  $('#set-import-csv').addEventListener('click', () => PH.importCsv());
  $('#set-export').addEventListener('click', exportBackup);
  $('#set-import-backup').addEventListener('click', restoreBackup);
  $('#set-signin').addEventListener('click', () => PH.openSignIn());
  $('#set-open-data').addEventListener('click', () => api.app.openDataFolder().catch((error) => PH.showError(error)));

  PH.views = PH.views || {};
  PH.views.settings = {
    element: view,
    title: 'Settings',
    onShow() {
      fillControls();
      syncVaultRows();
    },
  };

  PH.onSettings(() => {
    if (!view.hidden) fillControls();
  });

  PH.ready.then(async () => {
    fillControls();
    try {
      const info = await api.app.info();
      $('#about-version').textContent = `Version ${info.version} (Electron ${info.electron})`;
      $('#about-path').textContent = info.dataPath;
      $('#about-path').title = info.dataPath;
    } catch {
      // cosmetic
    }
  });
})();
