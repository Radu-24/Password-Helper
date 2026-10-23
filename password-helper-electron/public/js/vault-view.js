/**
 * vault_view.html — saved entries: search, sort, health filters, copy, edit, delete.
 *
 * Passwords are not sent to this page with the list: they're fetched one at a
 * time when you press 👁 (hidden again after REVEAL_SECONDS) or copied straight
 * to the clipboard by the main process.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, $$, el } = PH;
  const api = window.api;

  const REVEAL_SECONDS = 30;
  const list = $('#vault-list');
  const search = $('#search');
  const sortSelect = $('#sort');
  const healthCount = $('#health-count');
  const scanButton = $('#btn-breach-scan');
  const filterChips = $$('[data-filter]');

  const state = {
    entries: [],
    breachCheckedAt: null,
    query: '',
    sort: 'name',
    filter: null, // 'weak' | 'reused' | 'breached' | null
    expanded: new Set(),
  };

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  async function load() {
    try {
      const { entries, breachCheckedAt } = await api.vault.list();
      state.entries = entries;
      state.breachCheckedAt = breachCheckedAt;
    } catch (error) {
      if (error.code === 'LOCKED') PH.go('vault.html');
      else PH.showError(error);
      return;
    }
    render();
  }

  const FILTERS = {
    weak: (entry) => entry.weak,
    reused: (entry) => entry.reusedCount > 0,
    breached: (entry) => entry.breachCount > 0,
  };

  const SORTS = {
    name: (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    type: (a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  };

  function visibleEntries() {
    const query = state.query.trim().toLowerCase();
    return state.entries
      .filter((entry) => !state.filter || FILTERS[state.filter](entry))
      .filter((entry) => !query || [entry.label, entry.username, entry.type, entry.notes].some((text) => text.toLowerCase().includes(query)))
      .sort(SORTS[state.sort]);
  }

  // ------------------------------------------------------------------
  // Health bar
  // ------------------------------------------------------------------
  function renderHealth(shown) {
    const total = state.entries.length;
    healthCount.textContent = shown === total ? plural(total, 'entry', 'entries') : `${shown} of ${total} shown`;
    const counts = {
      weak: state.entries.filter(FILTERS.weak).length,
      reused: state.entries.filter(FILTERS.reused).length,
      breached: state.entries.filter(FILTERS.breached).length,
    };
    const labels = {
      weak: `⚠ ${counts.weak} weak`,
      reused: `♻ ${counts.reused} reused`,
      breached: `✖ ${counts.breached} breached`,
    };
    for (const chip of filterChips) {
      const name = chip.dataset.filter;
      chip.textContent = labels[name];
      chip.classList.toggle('hidden', counts[name] === 0 && state.filter !== name);
      chip.setAttribute('aria-pressed', String(state.filter === name));
      chip.title = state.filter === name ? 'Show all entries' : `Show only ${name} passwords`;
    }
    scanButton.classList.toggle('hidden', total === 0);
    scanButton.textContent = state.breachCheckedAt ? '🛡️ Re-check breaches' : '🛡️ Check breaches';
  }

  // ------------------------------------------------------------------
  // Entries
  // ------------------------------------------------------------------
  function fieldBlock(labelText, control) {
    return [el('p', { className: 'field-label', text: labelText }), control];
  }

  /** Eye button that asks the main process for the password only when needed. */
  function bindVaultReveal(button, input, entryId) {
    const icon = button.querySelector('img');
    let hideTimer = null;

    function hide() {
      clearTimeout(hideTimer);
      input.value = '';
      input.type = 'password';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Show password');
      button.title = 'Show password';
      icon.src = 'icons/eye.png';
    }

    async function showPassword() {
      try {
        input.value = await api.vault.reveal(entryId);
      } catch (error) {
        PH.showError(error);
        return;
      }
      input.type = 'text';
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('aria-label', 'Hide password');
      button.title = `Hide password (hides itself after ${REVEAL_SECONDS} s)`;
      icon.src = 'icons/eye-slash.png';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, REVEAL_SECONDS * 1000);
    }

    button.addEventListener('click', () => (input.type === 'password' ? showPassword() : hide()));
    hide();
    return { hide };
  }

  function badges(entry) {
    const result = [];
    if (entry.breachCount > 0) {
      result.push(el('span', { className: 'badge breached', title: `Seen in data breaches ${entry.breachCount.toLocaleString()} times`, text: 'Breached' }));
    }
    if (entry.weak) result.push(el('span', { className: 'badge weak', title: 'Easy to guess', text: 'Weak' }));
    if (entry.reusedCount > 0) {
      result.push(el('span', { className: 'badge reused', title: `Same password as ${plural(entry.reusedCount, 'other entry', 'other entries')}`, text: `Reused ×${entry.reusedCount + 1}` }));
    }
    return result;
  }

  async function copy(entry, field) {
    try {
      PH.copiedToast(field === 'password' ? 'Password' : 'Username', await api.vault.copy(entry.id, field));
    } catch (error) {
      PH.showError(error);
    }
  }

  function renderEntry(entry) {
    const bodyId = `entry-body-${entry.id}`;
    const item = el('article', { className: 'entry', dataset: { id: entry.id } });

    const header = el(
      'button',
      { type: 'button', className: 'entry-header', 'aria-expanded': 'false', 'aria-controls': bodyId },
      el('span', { className: 'entry-title', text: entry.label }),
      ...badges(entry),
      el('span', { className: 'entry-type', text: entry.type }),
      el('span', { className: 'chevron', 'aria-hidden': 'true', text: '▾' }),
    );

    const inner = el('div', { className: 'entry-body-inner' });

    if (entry.username) {
      inner.append(
        ...fieldBlock('Username', el('input', { className: 'frosted-input', type: 'text', readOnly: true, value: entry.username, 'aria-label': 'Username' })),
      );
    }

    const passwordInput = el('input', {
      className: 'frosted-input',
      type: 'password',
      readOnly: true,
      placeholder: '••••••••••••',
      'aria-label': 'Password',
    });
    const revealBtn = el('button', { type: 'button', className: 'reveal-btn' }, el('img', { src: 'icons/eye.png', alt: '' }));
    const reveal = bindVaultReveal(revealBtn, passwordInput, entry.id);
    inner.append(...fieldBlock('Password', el('div', { className: 'password-field' }, passwordInput, revealBtn)));

    if (entry.notes) {
      const notes = el('textarea', { className: 'frosted-input', readOnly: true, rows: 1, 'aria-label': 'Notes' });
      notes.value = entry.notes;
      inner.append(...fieldBlock('Notes', notes));
      PH.autoGrow(notes);
    }

    const changed = new Date(entry.updatedAt);
    inner.append(el('p', { className: 'entry-meta', text: `Last changed ${changed.toLocaleString()}` }));

    const actions = el('div', { className: 'entry-actions' });
    if (entry.username) actions.append(el('button', { type: 'button', className: 'entry-btn', onClick: () => copy(entry, 'username') }, '📋 Username'));
    actions.append(
      el('button', { type: 'button', className: 'entry-btn', onClick: () => copy(entry, 'password') }, '📋 Password'),
      el('button', { type: 'button', className: 'entry-btn', onClick: () => PH.go(`vault.html?screen=edit&id=${encodeURIComponent(entry.id)}`) }, '✏️ Edit'),
      el('button', { type: 'button', className: 'entry-btn delete', onClick: () => confirmDelete(entry) }, '🗑️ Delete'),
    );
    inner.append(actions);

    const body = el('div', { className: 'entry-body', id: bodyId, role: 'region', 'aria-label': entry.label }, inner);

    function setExpanded(expanded) {
      item.classList.toggle('expanded', expanded);
      header.setAttribute('aria-expanded', String(expanded));
      body.inert = !expanded; // collapsed: keep its fields out of the Tab order
      if (expanded) state.expanded.add(entry.id);
      else {
        state.expanded.delete(entry.id);
        reveal.hide();
      }
    }
    header.addEventListener('click', () => setExpanded(!item.classList.contains('expanded')));
    setExpanded(state.expanded.has(entry.id));

    item.append(header, body);
    return item;
  }

  function render() {
    const shown = visibleEntries();
    renderHealth(shown.length);
    list.replaceChildren();
    if (!state.entries.length) {
      list.append(el('p', { className: 'empty-state', text: 'No entries saved yet — press ➕ New (Ctrl+N).' }));
      return;
    }
    if (!shown.length) {
      list.append(el('p', { className: 'empty-state', text: state.query ? `No entries match “${state.query}”.` : 'Nothing to show.' }));
      return;
    }
    for (const entry of shown) list.append(renderEntry(entry));
  }

  async function confirmDelete(entry) {
    const ok = await PH.confirm({
      title: 'Delete entry?',
      message: `“${entry.label}” will be removed from the vault. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.vault.remove(entry.id);
      state.expanded.delete(entry.id);
      PH.toast('Entry deleted.', { type: 'success' });
      await load();
    } catch (error) {
      PH.showError(error);
    }
  }

  async function scanBreaches() {
    scanButton.disabled = true;
    scanButton.textContent = '🛡️ Checking…';
    try {
      const { checked, breached, failed } = await api.vault.checkBreaches();
      if (failed === checked) PH.toast('Could not reach Have I Been Pwned (offline?).', { type: 'error' });
      else if (breached) {
        PH.toast(`⚠️ ${plural(breached, 'password was', 'passwords were')} found in data breaches — change them.`, { type: 'warning', duration: 5000 });
      } else PH.toast(`No breached passwords among ${plural(checked - failed, 'entry', 'entries')}.`, { type: 'success' });
      if (failed && failed < checked) PH.toast(`${plural(failed, 'check', 'checks')} failed — try again later.`, { type: 'warning' });
      if (breached) state.filter = 'breached';
      await load();
    } catch (error) {
      PH.showError(error);
    } finally {
      scanButton.disabled = false;
      renderHealth(visibleEntries().length);
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  search.addEventListener('input', () => {
    state.query = search.value;
    render();
  });
  // Esc in a non-empty search box clears it instead of leaving the page.
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      event.stopPropagation();
      search.value = '';
      state.query = '';
      render();
    }
  });
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    render();
  });
  for (const chip of filterChips) {
    chip.addEventListener('click', () => {
      state.filter = state.filter === chip.dataset.filter ? null : chip.dataset.filter;
      render();
    });
  }
  scanButton.addEventListener('click', scanBreaches);
  $('#btn-new').addEventListener('click', () => PH.go('vault.html?screen=add'));
  $('#btn-back').addEventListener('click', () => PH.go('vault.html'));

  PH.onShortcut('f', () => {
    search.focus();
    search.select();
  });
  PH.onShortcut('n', () => PH.go('vault.html?screen=add'));
  PH.onEscape(() => PH.go('vault.html'));
  PH.onVaultLocked((_message, reason) => {
    state.entries = [];
    list.replaceChildren(); // drop everything that was on screen
    PH.go(`vault.html?locked=${encodeURIComponent(reason || 'manual')}`);
  });

  PH.ready.then(load);
})();
