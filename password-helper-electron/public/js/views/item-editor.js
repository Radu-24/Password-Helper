/**
 * Item editor (new item / edit item), shown in the vault's detail pane,
 * and the "Set Up Verification Code" sheet.
 *
 * The 2FA secret never comes back to the page: the editor only knows
 * whether one is set (and its issuer/account). Saving without touching it
 * keeps it; "Remove" sends null; a new setup sends the pasted key/link.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { el, icon } = PH;
  const api = window.api;
  const Policy = window.PHPolicy;
  const TYPES = ['Website', 'App', 'Email', 'Other'];

  let active = null; // the open editor

  function describeTotp(info) {
    if (!info) return 'Set up';
    const who = [info.issuer, info.account].filter(Boolean).join(' — ');
    return who || `${info.digits}-digit code every ${info.period} s`;
  }

  // ------------------------------------------------------------------
  // "Set Up Verification Code" sheet
  // ------------------------------------------------------------------
  /** Resolves with the setup text (otpauth:// link or key), or null if cancelled. */
  function openTotpSheet({ label = '' } = {}) {
    return new Promise((resolve) => {
      let result = null;
      let previewTimer = null;
      let checkSeq = 0;
      let valid = false;

      const input = el('textarea', {
        className: 'input otp-input',
        rows: 2,
        placeholder: 'JBSW Y3DP EHPK 3PXP  or  otpauth://totp/…',
        spellcheck: false,
        autocomplete: 'off',
        'aria-label': 'Setup key or otpauth link',
      });
      const error = el('p', { className: 'otp-hint', role: 'status' });
      const digits = el('span', { className: 'code-digits' });
      const ring = PH.ring({ showSeconds: true });
      const previewText = el('div', { className: 'otp-preview-text' });
      const preview = el('div', { className: 'otp-preview', hidden: true }, digits, previewText, ring);
      const pasteQr = el('button', { type: 'button', className: 'btn btn-secondary btn-small' }, icon('scan-qr-code'), el('span', { text: 'Paste QR Code' }));

      const content = el(
        'div',
        { className: 'form-grid' },
        el('div', {}, el('label', { className: 'form-label', text: 'Setup key or link' }), input, error),
        el(
          'p',
          { className: 'otp-hint' },
          'Got a QR code instead? Take a screenshot of it (it goes to the clipboard), then choose ',
          el('strong', { text: 'Paste QR Code' }),
          '.',
        ),
        preview,
      );
      input.id = `otp-input-${Date.now()}`;
      content.querySelector('.form-label').htmlFor = input.id;

      function stopPreview() {
        clearInterval(previewTimer);
        previewTimer = null;
      }

      async function check() {
        const text = input.value.trim();
        const seq = ++checkSeq;
        stopPreview();
        if (!text) {
          valid = false;
          preview.hidden = true;
          error.textContent = '';
          sheet.setPrimaryEnabled(false);
          return;
        }
        try {
          const info = await api.vault.previewTotp(text);
          if (seq !== checkSeq) return;
          valid = true;
          error.textContent = '';
          preview.hidden = false;
          previewText.replaceChildren(
            el('strong', { text: 'Current code' }),
            [info.issuer, info.account].filter(Boolean).join(' — ') || `${info.digits} digits, new code every ${info.period} s`,
          );
          digits.textContent = window.PHOtp.formatCode(info.code);
          let remaining = info.remaining;
          ring.update(remaining, info.period);
          previewTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) check();
            else ring.update(remaining, info.period);
          }, 1000);
        } catch (failure) {
          if (seq !== checkSeq) return;
          valid = false;
          preview.hidden = true;
          error.textContent = failure.message || 'That isn’t a valid setup key.';
        }
        sheet.setPrimaryEnabled(valid);
      }

      const debouncedCheck = PH.debounce(check, 250);
      input.addEventListener('input', debouncedCheck);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sheet.element.requestSubmit();
        }
      });
      pasteQr.addEventListener('click', async () => {
        try {
          input.value = await api.vault.readQrFromClipboard();
          check();
        } catch (failure) {
          PH.showError(failure);
        }
      });

      const sheet = PH.openSheet({
        title: 'Set Up Verification Code',
        subtitle: label
          ? `Paste the key or link that ${label} shows when you turn on two-factor authentication.`
          : 'Paste the key or link the website shows when you turn on two-factor authentication.',
        symbol: { icon: 'timer', tint: 'orange' },
        width: 480,
        content,
        leftButton: pasteQr,
        buttons: [
          { label: 'Cancel', role: 'cancel' },
          { label: 'Add Code', role: 'primary' },
        ],
        initialFocus: input,
        onSubmit: () => {
          if (!valid) return false;
          result = input.value.trim();
          return true;
        },
        onClose: () => {
          stopPreview();
          input.value = '';
          resolve(result);
        },
      });
      sheet.setPrimaryEnabled(false);
    });
  }

  // ------------------------------------------------------------------
  // Editor
  // ------------------------------------------------------------------
  /**
   * PH.ItemEditor.open(container, {
   *   entry,        // from api.vault.get() when editing; null for a new item
   *   prefill,      // { password, label, … } for a new item
   *   onSaved(saved), onCancel()
   * })
   */
  function open(container, { entry = null, prefill = {}, onSaved, onCancel }) {
    close();
    const isNew = !entry;
    const initial = {
      label: entry ? entry.label : prefill.label || '',
      username: entry ? entry.username : prefill.username || '',
      password: entry ? entry.password : prefill.password || '',
      // Stored addresses are normalised ("https://github.com/"); show them without the bare trailing slash.
      url: (entry ? entry.url : prefill.url || '').replace(/^(https?:\/\/[^/?#]+)\/$/, '$1'),
      type: entry ? entry.type : prefill.type || 'Website',
      notes: entry ? entry.notes : prefill.notes || '',
    };
    let type = initial.type;
    const totpInfo = entry ? entry.totpInfo : null;
    let totpChange; // undefined = unchanged, null = remove, string = new setup

    // ---- fields ----
    const avatarSlot = el('span', {});
    const titleInput = el('input', {
      className: 'editor-title-input',
      type: 'text',
      placeholder: 'Title',
      value: initial.label,
      maxLength: 200,
      autocomplete: 'off',
      spellcheck: false,
      'aria-label': 'Title',
    });
    const usernameInput = el('input', { className: 'input', type: 'text', value: initial.username, maxLength: 320, placeholder: 'Email or username', autocomplete: 'off', spellcheck: false, 'aria-label': 'Username' });
    const passwordInput = el('input', { className: 'input', type: 'password', value: initial.password, maxLength: 1024, placeholder: 'Required', autocomplete: 'new-password', spellcheck: false, 'aria-label': 'Password' });
    const generateButton = el('button', { type: 'button', className: 'field-btn', title: `Generate a strong password (${PH.keyLabel('mod+g')})`, 'aria-label': 'Generate a strong password' }, icon('wand-sparkles'));
    const revealButton = el('button', { type: 'button', className: 'field-btn', 'aria-label': 'Show password' }, icon('eye'));
    const passwordField = el('div', { className: 'secure-field input-field has-2-btns' }, passwordInput, generateButton, revealButton);
    const strengthMeter = el('div', { className: 'meter meter-thin', 'aria-hidden': 'true' }, el('span'), el('span'), el('span'), el('span'), el('span'));
    const strengthText = el('p', { 'aria-live': 'polite' });
    const strength = el('div', { className: 'edit-strength' }, strengthMeter, strengthText);
    const urlInput = el('input', { className: 'input', type: 'text', value: initial.url, maxLength: 2048, placeholder: 'example.com', autocomplete: 'off', spellcheck: false, 'aria-label': 'Website' });
    const typeChips = TYPES.map((name) =>
      el('button', { type: 'button', className: 'type-chip', role: 'radio', 'aria-checked': String(name === type), dataset: { type: name }, text: name }),
    );
    const typePicker = el('div', { className: 'type-picker', role: 'radiogroup', 'aria-label': 'Type' }, typeChips);
    const totpText = el('span');
    const totpActions = el('div', { className: 'field-actions' });
    const totpSummary = el('div', { className: 'totp-summary' }, totpText, totpActions);
    const notesInput = el('textarea', { className: 'input', rows: 2, maxLength: 10000, placeholder: 'Recovery codes, security questions…', 'aria-label': 'Notes' });
    notesInput.value = initial.notes;

    const row = (label, control, extra = '') => el('div', { className: `edit-row ${extra}` }, el('span', { className: 'field-label', text: label }), control);

    const saveButton = el('button', { type: 'submit', className: 'btn btn-primary btn-small', text: isNew ? 'Save' : 'Save' });
    const cancelButton = el('button', { type: 'button', className: 'btn btn-secondary btn-small', text: 'Cancel' });
    const form = el(
      'form',
      { className: 'editor', novalidate: true, style: { display: 'contents' } },
      el('div', { className: 'detail-bar' }, el('span', { className: 'spacer' }), cancelButton, saveButton),
      el(
        'div',
        { className: 'detail-scroll detail-swap' },
        el('div', { className: 'editor-head' }, avatarSlot, titleInput),
        el(
          'div',
          { className: 'detail-group' },
          row('Username', usernameInput),
          row('Password', el('div', {}, passwordField, strength)),
          row('Website', urlInput),
          row('Type', typePicker),
        ),
        el('div', { className: 'detail-group' }, row('Verification code', totpSummary)),
        el('div', { className: 'detail-group' }, row('Notes', notesInput, 'align-top')),
      ),
    );
    container.replaceChildren(form);
    const fitNotes = PH.autoGrow(notesInput);
    const reveal = PH.bindReveal(revealButton, passwordInput);

    // ---- behaviour ----
    function refreshAvatar() {
      avatarSlot.replaceChildren(PH.avatar(titleInput.value || PH.hostOf(urlInput.value) || '?', 'xl'));
    }

    const analyzer = PH.Strength.createAnalyzer({ delay: 120 });
    function refreshStrength() {
      const value = passwordInput.value;
      if (!value) {
        analyzer.cancel();
        PH.setMeter(strengthMeter, null);
        strengthText.textContent = '';
        return;
      }
      analyzer.run(value, [titleInput.value, usernameInput.value]).then(({ stale, analysis }) => {
        if (stale || passwordInput.value !== value || !analysis) return;
        PH.setMeter(strengthMeter, analysis.score);
        strengthText.textContent = `${Policy.scoreLabel(analysis.score)} — ${PH.Strength.crackPhrase(analysis.crackTime.offlineSlowHashing)} to crack`;
      });
    }

    function renderTotp() {
      totpActions.replaceChildren();
      const hasSetup = totpChange === undefined ? Boolean(totpInfo) : totpChange !== null;
      if (!hasSetup) {
        totpText.textContent = 'Not set up';
        totpActions.append(el('button', { type: 'button', className: 'btn btn-tinted btn-small', text: 'Set Up…', onClick: setUpTotp }));
        return;
      }
      totpText.textContent = typeof totpChange === 'string' ? 'New code — saved with the item' : describeTotp(totpInfo);
      totpActions.append(
        el('button', { type: 'button', className: 'btn btn-secondary btn-small', text: 'Change…', onClick: setUpTotp }),
        el('button', {
          type: 'button',
          className: 'btn btn-destructive btn-small',
          text: 'Remove',
          onClick: () => {
            totpChange = totpInfo ? null : undefined;
            renderTotp();
          },
        }),
      );
    }

    async function setUpTotp() {
      const text = await openTotpSheet({ label: titleInput.value.trim() });
      if (text) {
        totpChange = text;
        renderTotp();
      }
    }

    function generate() {
      try {
        const { value } = PH.views.generator.generateForField();
        passwordInput.value = value;
        reveal.show();
        refreshStrength();
        passwordInput.focus();
        PH.replayClass(passwordField, 'pulse');
      } catch (error) {
        PH.showError(error);
      }
    }

    for (const chip of typeChips) {
      chip.addEventListener('click', () => {
        type = chip.dataset.type;
        for (const other of typeChips) other.setAttribute('aria-checked', String(other === chip));
      });
    }
    titleInput.addEventListener('input', refreshAvatar);
    urlInput.addEventListener('input', refreshAvatar);
    passwordInput.addEventListener('input', refreshStrength);
    generateButton.addEventListener('click', generate);
    cancelButton.addEventListener('click', () => cancel());

    function values() {
      return {
        label: titleInput.value,
        username: usernameInput.value,
        password: passwordInput.value,
        url: urlInput.value,
        type,
        notes: notesInput.value,
      };
    }
    function isDirty() {
      const now = values();
      return totpChange !== undefined || Object.keys(initial).some((key) => now[key] !== initial[key]);
    }

    /** Same title + username already saved? Ask before making a second copy. */
    async function confirmIfDuplicate(fields) {
      const norm = (text) => String(text || '').trim().toLowerCase();
      const twin = PH.Vault.active().find(
        (item) => (!entry || item.id !== entry.id) && norm(item.label) === norm(fields.label) && norm(item.username) === norm(fields.username),
      );
      if (!twin) return true;
      return PH.alert({
        title: 'Possible duplicate',
        message: `“${twin.label}”${twin.username ? ` with the username “${twin.username}”` : ''} is already in the vault. Save anyway?`,
        symbol: { icon: 'copy', tint: 'orange' },
        buttons: [
          { label: 'Cancel', value: false, cancel: true },
          { label: 'Save Anyway', value: true, style: 'primary' },
        ],
      });
    }

    async function save() {
      const fields = values();
      if (!fields.label.trim()) {
        PH.replayClass(titleInput, 'shake');
        titleInput.focus();
        throw new Error('Give the item a title.');
      }
      if (!fields.password) {
        PH.replayClass(passwordField, 'shake');
        passwordInput.focus();
        throw new Error('Enter or generate a password.');
      }
      if (totpChange !== undefined) fields.totp = totpChange;
      if (!(await confirmIfDuplicate(fields))) return;
      const saved = isNew ? await PH.Vault.add(fields) : await PH.Vault.update(entry.id, fields);
      PH.hud(isNew ? 'Item saved' : 'Changes saved', { tone: 'success' });
      if (saved.reusedCount > 0) {
        PH.hud(`This password is also used by ${PH.plural(saved.reusedCount, 'other item', 'other items')} — a unique one is safer.`, {
          tone: 'warning',
          duration: 5500,
        });
      }
      finish();
      if (onSaved) onSaved(saved);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      PH.withBusy(saveButton, save);
    });
    // Return in single-line fields saves; Escape cancels.
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT' && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    function finish() {
      analyzer.cancel();
      reveal.hide();
      passwordInput.value = '';
      if (active === controller) active = null;
      removeEscape();
    }

    async function cancel({ force = false } = {}) {
      if (!force && isDirty()) {
        const discard = await PH.confirm({
          title: isNew ? 'Discard this new item?' : 'Discard your changes?',
          message: 'What you typed will be lost.',
          confirmLabel: 'Discard',
          destructive: true,
          symbol: { icon: 'pencil-off', tint: 'orange' },
        });
        if (!discard) return false;
      }
      finish();
      if (onCancel) onCancel();
      return true;
    }

    const removeEscape = PH.onEscape(() => cancel());
    const controller = {
      isDirty,
      /** Asks before throwing away edits; resolves true if the editor may close. */
      requestClose: () => cancel(),
      /** Closes without asking (e.g. the vault locked). */
      dispose: () => finish(),
      generate,
    };
    active = controller;

    refreshAvatar();
    renderTotp();
    refreshStrength();
    requestAnimationFrame(fitNotes);
    if (prefill.password) reveal.show();
    (isNew && !initial.label ? titleInput : isNew ? usernameInput : titleInput).focus({ preventScroll: true });
    if (!isNew) titleInput.select();
    return controller;
  }

  function close() {
    if (active) active.dispose();
    active = null;
  }

  PH.ItemEditor = {
    open,
    close,
    openTotpSheet,
    isOpen: () => active !== null,
    isDirty: () => Boolean(active && active.isDirty()),
    /** Resolves true when it's fine to leave (nothing to lose, or the user discarded). */
    requestClose: () => (active ? active.requestClose() : Promise.resolve(true)),
    generate: () => active && active.generate(),
  };

  PH.shortcut('mod+g', () => PH.ItemEditor.generate(), { when: () => PH.ItemEditor.isOpen() });
})();
