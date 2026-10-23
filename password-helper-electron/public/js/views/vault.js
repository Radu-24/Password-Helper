/**
 * Vault view: list + detail for All Items, Favourites and Recently Deleted.
 *
 * Passwords aren't part of the list. They're fetched one at a time when you
 * reveal one (hidden again after REVEAL_SECONDS), or copied straight to the
 * clipboard by the main process. 2FA secrets never reach the page at all —
 * only the current code.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, el, icon } = PH;
  const api = window.api;
  const Vault = PH.Vault;

  const REVEAL_SECONDS = 30;
  const TRASH_DAYS = 30;
  const MODES = {
    items: { title: 'All Items', empty: ['key-round', 'No passwords yet', 'Add your first one, or import the passwords saved in your browser.'] },
    favorites: { title: 'Favourites', empty: ['star', 'No favourites yet', 'Star the items you use most and they’ll show up here.'] },
    deleted: { title: 'Recently Deleted', empty: ['trash', 'Nothing here', `Deleted items stay here for ${TRASH_DAYS} days, then they’re removed for good.`] },
  };

  const view = $('#view-vault');
  const titleEl = $('#vault-title');
  const subtitleEl = $('#vault-subtitle');
  const search = $('#vault-search');
  const newButton = $('#vault-new');
  const emptyTrashButton = $('#vault-empty-trash');
  const sortSelect = PH.popupButton($('#vault-sort'));
  const list = $('#vault-list');
  const detail = $('#vault-detail');

  const state = {
    mode: 'items',
    query: '',
    selectedId: null,
    editing: false,
  };

  // Detail-pane timers (password auto-hide, 2FA countdown)
  let revealTimer = null;
  let codeTimer = null;

  // ------------------------------------------------------------------
  // Data helpers
  // ------------------------------------------------------------------
  function source() {
    if (state.mode === 'favorites') return Vault.favorites();
    if (state.mode === 'deleted') return Vault.deleted();
    return Vault.active();
  }

  function matches(entry, query) {
    if (!query) return true;
    const host = PH.hostOf(entry.url);
    return [entry.label, entry.username, host, entry.notes, entry.type].some((text) => String(text || '').toLowerCase().includes(query));
  }

  const byName = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });

  /** Visible entries, grouped into sections: [{ title, entries }] */
  function sections() {
    const query = state.query.trim().toLowerCase();
    const entries = source().filter((entry) => matches(entry, query));
    if (state.mode === 'deleted') {
      entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return entries.length ? [{ title: '', entries }] : [];
    }
    const sort = PH.settings.vaultSort || 'name';
    const groups = new Map();
    const add = (title, entry) => {
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(entry);
    };
    if (sort === 'recent') {
      entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (const entry of entries) {
        const days = (today - new Date(entry.updatedAt)) / 86_400_000;
        add(days <= 0 ? 'Today' : days <= 1 ? 'Yesterday' : days <= 7 ? 'Previous 7 days' : days <= 30 ? 'Previous 30 days' : 'Earlier', entry);
      }
    } else if (sort === 'type') {
      entries.sort((a, b) => a.type.localeCompare(b.type) || byName(a, b));
      for (const entry of entries) add(entry.type, entry);
    } else {
      entries.sort(byName);
      // Letter headings only help once the list is long.
      if (entries.length < 12) return entries.length ? [{ title: '', entries }] : [];
      for (const entry of entries) {
        const first = entry.label.trim().charAt(0).toLocaleUpperCase();
        add(/\p{L}/u.test(first) ? first : '#', entry);
      }
    }
    return [...groups].map(([title, groupEntries]) => ({ title, entries: groupEntries }));
  }

  const visibleIds = () => sections().flatMap((section) => section.entries.map((entry) => entry.id));

  function daysLeft(entry) {
    const left = TRASH_DAYS - (Date.now() - new Date(entry.deletedAt).getTime()) / 86_400_000;
    return Math.max(0, Math.ceil(left));
  }

  // ------------------------------------------------------------------
  // List
  // ------------------------------------------------------------------
  function listItem(entry) {
    const flags = el('span', { className: 'list-flags' });
    if (entry.breachCount > 0) flags.append(icon('shield-alert', { className: 'flag-breach' }));
    else if (entry.weak || entry.reusedCount > 0) flags.append(icon('triangle-alert', { className: 'flag-alert' }));
    if (entry.hasTotp) flags.append(icon('timer'));
    if (entry.favorite && state.mode !== 'deleted') flags.append(icon('star', { className: 'flag-star' }));

    const subtitle =
      state.mode === 'deleted'
        ? `Removed for good in ${PH.plural(daysLeft(entry), 'day', 'days')}`
        : entry.username || PH.hostOf(entry.url) || entry.type;
    const node = el(
      'div',
      {
        className: 'list-item',
        role: 'option',
        id: `item-${entry.id}`,
        'aria-selected': String(entry.id === state.selectedId),
        dataset: { id: entry.id },
      },
      PH.avatar(entry.label),
      el('span', { className: 'list-text' }, el('span', { className: 'list-title', text: entry.label }), el('span', { className: 'list-subtitle', text: subtitle })),
      flags,
    );
    node.addEventListener('click', () => select(entry.id));
    node.addEventListener('dblclick', () => {
      if (state.mode !== 'deleted' && !state.editing && PH.modalDepth === 0) startEdit(entry.id);
    });
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      // While editing, a right-click only asks to leave the editor (no menu on top of that question).
      if (state.editing) {
        select(entry.id);
        return;
      }
      select(entry.id);
      showContextMenu(event, entry);
    });
    return node;
  }

  function renderList() {
    const groups = sections();
    const scroll = list.scrollTop;
    if (!groups.length) {
      // The detail pane explains an empty vault; the list just says it's empty.
      const empty = state.query
        ? el('div', { className: 'list-empty' }, icon('search'), el('strong', { text: 'No results' }), el('span', { text: `Nothing matches “${state.query.trim()}”.` }))
        : el('div', { className: 'list-empty' }, el('span', { text: state.mode === 'favorites' ? 'No favourites' : 'No items' }));
      list.replaceChildren(empty);
      list.removeAttribute('aria-activedescendant');
    } else {
      const nodes = [];
      for (const group of groups) {
        if (group.title) nodes.push(el('div', { className: 'list-section-title', role: 'presentation', text: group.title }));
        for (const entry of group.entries) nodes.push(listItem(entry));
      }
      list.replaceChildren(...nodes);
      list.scrollTop = scroll;
      if (state.selectedId) list.setAttribute('aria-activedescendant', `item-${state.selectedId}`);
    }

    const total = source().length;
    const shown = groups.reduce((sum, group) => sum + group.entries.length, 0);
    subtitleEl.textContent = state.query ? `${shown} of ${PH.plural(total, 'item', 'items')}` : PH.plural(total, 'item', 'items');
    emptyTrashButton.hidden = state.mode !== 'deleted' || total === 0;
  }

  function scrollSelectedIntoView() {
    const node = state.selectedId && document.getElementById(`item-${state.selectedId}`);
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------------
  // Selection
  // ------------------------------------------------------------------
  async function select(id, { force = false } = {}) {
    if (id === state.selectedId && !state.editing && !force) return;
    if (state.editing && !(await PH.ItemEditor.requestClose())) return;
    state.editing = false;
    state.selectedId = id;
    for (const node of list.querySelectorAll('.list-item')) node.setAttribute('aria-selected', String(node.dataset.id === id));
    if (id) list.setAttribute('aria-activedescendant', `item-${id}`);
    scrollSelectedIntoView();
    renderDetail();
  }

  function moveSelection(step) {
    const ids = visibleIds();
    if (!ids.length) return;
    const index = ids.indexOf(state.selectedId);
    const next = index === -1 ? (step > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, index + step));
    select(ids[next]);
  }

  function selectEdge(last) {
    const ids = visibleIds();
    if (ids.length) select(last ? ids[ids.length - 1] : ids[0]);
  }

  // ------------------------------------------------------------------
  // Detail
  // ------------------------------------------------------------------
  function clearTimers() {
    clearTimeout(revealTimer);
    clearInterval(codeTimer);
    revealTimer = null;
    codeTimer = null;
  }

  function emptyDetail() {
    const total = source().length;
    const [iconName, heading, text] =
      total === 0 ? MODES[state.mode].empty : ['mouse-pointer-click', 'Select an item', 'Choose an item on the left to see its details.'];
    const node = el('div', { className: 'detail-empty' }, icon(iconName), el('h2', { text: heading }), el('p', { text }));
    if (total === 0 && state.mode === 'items') {
      node.append(
        el(
          'div',
          { className: 'detail-footer' },
          el('button', { type: 'button', className: 'btn btn-primary', onClick: () => startNew() }, icon('plus'), el('span', { text: 'New Item' })),
          el('button', { type: 'button', className: 'btn btn-secondary', onClick: () => PH.importCsv() }, icon('file-up'), el('span', { text: 'Import Passwords…' })),
        ),
      );
    }
    return node;
  }

  async function copyField(entry, field, label) {
    try {
      PH.copied(label, await api.vault.copy(entry.id, field));
    } catch (error) {
      PH.showError(error);
    }
  }

  function fieldRow(label, value, actions, { onClick = null, valueClass = '' } = {}) {
    const row = el(
      'div',
      { className: `field-row${onClick ? ' copyable' : ''}` },
      el('span', { className: 'field-label', text: label }),
      el('div', { className: `field-value ${valueClass}` }, value),
      el('div', { className: 'field-actions' }, onClick ? el('span', { className: 'copy-hint', text: 'Copy' }) : null, actions),
    );
    if (onClick) {
      row.addEventListener('click', (event) => {
        // Selecting text or pressing a button inside the row shouldn't copy.
        if (event.target.closest('button, a') || String(window.getSelection())) return;
        onClick();
      });
    }
    return row;
  }

  function iconButton(name, label, onClick) {
    return el('button', { type: 'button', className: 'icon-btn', title: label, 'aria-label': label, onClick }, icon(name));
  }

  function passwordRow(entry) {
    const value = el('span', { className: 'dots', text: '••••••••••••' });
    const holder = el('span', {}, value);
    const eye = iconButton('eye', 'Show password', toggle);
    let shown = false;

    function hide() {
      clearTimeout(revealTimer);
      shown = false;
      holder.phDecode = null;
      holder.replaceChildren(value);
      holder.className = '';
      PH.setIcon(eye.querySelector('i'), 'eye');
      eye.setAttribute('aria-label', 'Show password');
      eye.title = 'Show password';
    }
    async function toggle() {
      if (shown) return hide();
      let password;
      try {
        password = await api.vault.reveal(entry.id);
      } catch (error) {
        PH.showError(error);
        return undefined;
      }
      shown = true;
      holder.className = 'secret';
      PH.showSecret(holder, password, { decode: true });
      PH.setIcon(eye.querySelector('i'), 'eye-off');
      eye.setAttribute('aria-label', 'Hide password');
      eye.title = `Hide password (hides itself after ${REVEAL_SECONDS} s)`;
      clearTimeout(revealTimer);
      revealTimer = setTimeout(hide, REVEAL_SECONDS * 1000);
      return undefined;
    }
    return fieldRow('Password', holder, [eye, iconButton('copy', 'Copy password', () => copyField(entry, 'password', 'Password'))], {
      onClick: () => copyField(entry, 'password', 'Password'),
    });
  }

  function codeRow(entry) {
    const digits = el('span', { className: 'code-digits', text: '••• •••' });
    const ring = PH.ring({ showSeconds: true });
    let remaining = 0;
    let period = 30;
    let lastCode = '';

    async function refresh() {
      try {
        const [code] = await api.vault.totpCodes([entry.id]);
        if (!code) return;
        remaining = code.remaining;
        period = code.period;
        const formatted = window.PHOtp.formatCode(code.code);
        if (formatted !== lastCode) {
          digits.textContent = formatted;
          if (lastCode) PH.replayClass(digits, 'flip');
          lastCode = formatted;
        }
        ring.update(remaining, period);
      } catch (error) {
        if (error.code !== 'LOCKED') PH.showError(error);
      }
    }
    refresh();
    codeTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) refresh();
      else ring.update(remaining, period);
    }, 1000);

    return fieldRow(
      'Verification code',
      el('span', { className: 'code-value' }, digits, ring),
      [iconButton('copy', 'Copy code', () => copyField(entry, 'totp', 'Code'))],
      { onClick: () => copyField(entry, 'totp', 'Code') },
    );
  }

  function callouts(entry) {
    const nodes = [];
    const callout = (tint, iconName, heading, text, button) =>
      el(
        'div',
        { className: 'callout', dataset: { tint } },
        icon(iconName),
        el('div', { className: 'callout-text' }, el('strong', { text: heading }), el('span', { text })),
        button,
      );
    const changeButton = () =>
      entry.url
        ? el('button', { type: 'button', className: 'btn btn-secondary btn-small', text: 'Change on Website', onClick: () => openWebsite(entry) })
        : el('button', { type: 'button', className: 'btn btn-secondary btn-small', text: 'Edit', onClick: () => startEdit(entry.id) });
    if (entry.breachCount > 0) {
      nodes.push(callout('red', 'shield-alert', 'Found in data breaches', `This password has shown up ${entry.breachCount.toLocaleString()} times in known breaches. Change it.`, changeButton()));
    }
    if (entry.reusedCount > 0) {
      nodes.push(callout('yellow', 'repeat', 'Reused password', `Also used for ${PH.plural(entry.reusedCount, 'other item', 'other items')}. If one site leaks it, all of them are at risk.`, null));
    }
    if (entry.weak) nodes.push(callout('orange', 'triangle-alert', 'Weak password', 'It’s easy to guess. Generate a strong one in the editor.', changeButton()));
    return nodes;
  }

  async function openWebsite(entry) {
    try {
      await api.app.openUrl(entry.url);
    } catch (error) {
      PH.showError(error);
    }
  }

  function detailView(entry) {
    const deleted = Boolean(entry.deletedAt);
    const bar = el('div', { className: 'detail-bar' });
    if (deleted) {
      bar.append(
        el('span', { className: 'spacer' }),
        el('button', { type: 'button', className: 'btn btn-destructive btn-small', text: 'Delete Now', onClick: () => purgeItem(entry) }),
        el('button', { type: 'button', className: 'btn btn-primary btn-small', text: 'Recover', onClick: () => restoreItem(entry) }),
      );
    } else {
      const star = iconButton('star', entry.favorite ? 'Remove from Favourites' : 'Add to Favourites', () => toggleFavorite(entry));
      star.classList.add('star-btn');
      star.setAttribute('aria-pressed', String(entry.favorite));
      bar.append(
        el('span', { className: 'spacer' }),
        star,
        iconButton('ellipsis', 'More', (event) => showMoreMenu(event.currentTarget, entry)),
        el('button', { type: 'button', className: 'btn btn-secondary btn-small', text: 'Edit', title: `Edit (${PH.keyLabel('mod+e')})`, onClick: () => startEdit(entry.id) }),
      );
    }

    const host = PH.hostOf(entry.url);
    const subtitle = el('p', { className: 'detail-subtitle' });
    if (host) subtitle.append(el('a', { href: '#', text: host, onClick: (event) => (event.preventDefault(), openWebsite(entry)) }));
    else subtitle.textContent = entry.type;

    const fields = el('div', { className: 'detail-group' });
    if (entry.username) {
      fields.append(
        fieldRow('Username', el('span', { text: entry.username }), [iconButton('copy', 'Copy username', () => copyField(entry, 'username', 'Username'))], {
          onClick: () => copyField(entry, 'username', 'Username'),
        }),
      );
    }
    fields.append(passwordRow(entry));
    if (entry.hasTotp && !deleted) fields.append(codeRow(entry));
    if (entry.url) {
      fields.append(
        fieldRow('Website', el('span', { text: host || entry.url }), [
          iconButton('copy', 'Copy address', () => copyField(entry, 'url', 'Address')),
          iconButton('external-link', 'Open in browser', () => openWebsite(entry)),
        ]),
      );
    }

    const scroll = el(
      'div',
      { className: 'detail-scroll detail-swap' },
      el('div', { className: 'detail-head' }, PH.avatar(entry.label, 'xl'), el('div', { className: 'detail-head-text' }, el('h2', { className: 'detail-title', text: entry.label }), subtitle)),
      fields,
    );
    if (entry.notes) {
      scroll.append(
        el(
          'div',
          { className: 'detail-group' },
          fieldRow('Notes', el('div', { className: 'notes-value', text: entry.notes }), [
            iconButton('copy', 'Copy notes', async () => {
              try {
                PH.copied('Notes', await api.clipboard.copy(entry.notes));
              } catch (error) {
                PH.showError(error);
              }
            }),
          ]),
        ),
      );
    }
    if (!deleted) for (const node of callouts(entry)) scroll.append(node);

    const meta = el('div', { className: 'detail-meta' });
    if (deleted) {
      const until = new Date(new Date(entry.deletedAt).getTime() + TRASH_DAYS * 86_400_000);
      meta.append(el('span', { text: `Deleted ${PH.formatDateTime(entry.deletedAt)}.` }), el('span', { text: `Removed for good on ${PH.formatDateTime(until.toISOString())}.` }));
    } else {
      meta.append(el('span', { text: `Created ${PH.formatDateTime(entry.createdAt)}` }), el('span', { text: `Modified ${PH.formatDateTime(entry.updatedAt)}` }));
    }
    scroll.append(meta);
    if (!deleted) {
      scroll.append(el('div', { className: 'detail-footer' }, el('button', { type: 'button', className: 'btn btn-destructive btn-small', text: 'Delete Item…', onClick: () => deleteItem(entry) })));
    }
    return [bar, scroll];
  }

  function renderDetail() {
    clearTimers();
    if (state.editing) return; // the editor owns the pane
    const entry = state.selectedId ? Vault.find(state.selectedId) : null;
    const visible = entry && source().some((item) => item.id === entry.id);
    detail.replaceChildren(...(visible ? detailView(entry) : [emptyDetail()]));
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  async function toggleFavorite(entry) {
    try {
      await Vault.setFavorite(entry.id, !entry.favorite);
      const star = detail.querySelector('.star-btn i');
      if (star) PH.replayClass(star.parentElement, 'pop');
    } catch (error) {
      PH.showError(error);
    }
  }

  async function deleteItem(entry) {
    const ok = await PH.confirm({
      title: `Delete “${entry.label}”?`,
      message: `It moves to Recently Deleted and is removed for good after ${TRASH_DAYS} days.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const ids = visibleIds();
      const next = ids[ids.indexOf(entry.id) + 1] || ids[ids.indexOf(entry.id) - 1] || null;
      await Vault.remove(entry.id);
      state.selectedId = next;
      render();
      list.focus({ preventScroll: true });
      PH.hud('Moved to Recently Deleted', {
        tone: 'success',
        icon: 'trash',
        duration: 6000,
        action: { label: 'Undo', onClick: () => restoreItem(entry, { quiet: true }) },
      });
    } catch (error) {
      PH.showError(error);
    }
  }

  async function restoreItem(entry, { quiet = false } = {}) {
    try {
      await Vault.restore(entry.id);
      if (!quiet) PH.hud(`“${entry.label}” recovered`, { tone: 'success', icon: 'rotate-ccw' });
      if (state.mode === 'deleted') state.selectedId = null;
      render();
    } catch (error) {
      PH.showError(error);
    }
  }

  async function purgeItem(entry) {
    const ok = await PH.confirm({
      title: `Delete “${entry.label}” now?`,
      message: 'It will be deleted permanently. This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await Vault.purge(entry.id);
      state.selectedId = null;
      render();
      PH.hud('Deleted permanently', { tone: 'success', icon: 'trash' });
    } catch (error) {
      PH.showError(error);
    }
  }

  async function emptyTrash() {
    const count = Vault.deleted().length;
    if (!count) return;
    const ok = await PH.confirm({
      title: `Delete ${PH.plural(count, 'item', 'items')} permanently?`,
      message: 'Everything in Recently Deleted will be gone for good. This can’t be undone.',
      confirmLabel: 'Delete All',
      destructive: true,
    });
    if (!ok) return;
    try {
      const removed = await Vault.emptyTrash();
      state.selectedId = null;
      render();
      PH.hud(`${PH.plural(removed, 'item', 'items')} deleted permanently`, { tone: 'success', icon: 'trash' });
    } catch (error) {
      PH.showError(error);
    }
  }

  async function startEdit(id) {
    if (state.mode === 'deleted') return;
    let entry;
    try {
      entry = await api.vault.get(id);
    } catch (error) {
      PH.showError(error);
      return;
    }
    clearTimers();
    state.selectedId = id;
    state.editing = true;
    PH.ItemEditor.open(detail, {
      entry,
      onSaved: (saved) => {
        state.editing = false;
        state.selectedId = saved.id;
        render();
      },
      onCancel: () => {
        state.editing = false;
        renderDetail();
      },
    });
    entry.password = '';
  }

  async function startNew(prefill = {}) {
    if (state.editing && !(await PH.ItemEditor.requestClose())) return;
    if (state.mode === 'deleted') {
      PH.navigate('items', { newItem: prefill });
      return;
    }
    const previous = state.selectedId;
    clearTimers();
    state.editing = true;
    state.selectedId = null;
    for (const node of list.querySelectorAll('.list-item')) node.setAttribute('aria-selected', 'false');
    PH.ItemEditor.open(detail, {
      prefill,
      onSaved: (saved) => {
        state.editing = false;
        state.selectedId = saved.id;
        if (state.mode === 'favorites' && !saved.favorite) state.mode = 'items';
        PH.navigate(state.mode, { select: saved.id });
      },
      onCancel: () => {
        state.editing = false;
        select(previous, { force: true });
      },
    });
  }

  function itemMenuItems(entry) {
    if (entry.deletedAt) {
      return [
        { id: 'restore', label: 'Recover', icon: 'rotate-ccw' },
        { separator: true },
        { id: 'purge', label: 'Delete Now…', icon: 'trash', destructive: true },
      ];
    }
    return [
      { id: 'copy-username', label: 'Copy Username', icon: 'user-round', shortcut: 'mod+shift+c', disabled: !entry.username },
      { id: 'copy-password', label: 'Copy Password', icon: 'key-round', shortcut: 'mod+c' },
      { id: 'copy-code', label: 'Copy Verification Code', icon: 'timer', disabled: !entry.hasTotp },
      { separator: true },
      { id: 'open', label: 'Open Website', icon: 'external-link', disabled: !entry.url },
      { id: 'favorite', label: entry.favorite ? 'Remove from Favourites' : 'Add to Favourites', icon: 'star' },
      { id: 'edit', label: 'Edit', icon: 'pencil', shortcut: 'mod+e' },
      { separator: true },
      { id: 'delete', label: 'Delete…', icon: 'trash', destructive: true },
    ];
  }

  function runItemAction(id, entry) {
    switch (id) {
      case 'copy-username': return copyField(entry, 'username', 'Username');
      case 'copy-password': return copyField(entry, 'password', 'Password');
      case 'copy-code': return copyField(entry, 'totp', 'Code');
      case 'open': return openWebsite(entry);
      case 'favorite': return toggleFavorite(entry);
      case 'edit': return startEdit(entry.id);
      case 'delete': return deleteItem(entry);
      case 'restore': return restoreItem(entry);
      case 'purge': return purgeItem(entry);
      default: return undefined;
    }
  }

  async function showContextMenu(event, entry) {
    const choice = await PH.contextMenu(event, itemMenuItems(entry));
    if (choice) runItemAction(choice, Vault.find(entry.id) || entry);
  }

  async function showMoreMenu(anchor, entry) {
    const items = itemMenuItems(entry).filter((item) => !['edit', 'favorite'].includes(item.id));
    const choice = await PH.menu({ items, anchor, align: 'end' });
    if (choice) runItemAction(choice, Vault.find(entry.id) || entry);
  }

  // ------------------------------------------------------------------
  // Render + wiring
  // ------------------------------------------------------------------
  function render() {
    titleEl.textContent = MODES[state.mode].title;
    search.placeholder = state.mode === 'deleted' ? 'Search deleted items' : 'Search';
    newButton.hidden = state.mode === 'deleted';
    // Recently Deleted is always newest first, so it has no sort menu.
    sortSelect.closest('.list-header').hidden = state.mode === 'deleted';
    // Keep the selection valid; pick the first item when nothing is selected.
    const ids = visibleIds();
    if (!state.editing && (!state.selectedId || !ids.includes(state.selectedId))) state.selectedId = ids[0] || null;
    renderList();
    if (!state.editing) renderDetail();
  }

  search.addEventListener('input', () => {
    state.query = search.value;
    render();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list.focus();
      moveSelection(state.selectedId ? 0 : 1);
    }
  });
  sortSelect.addEventListener('change', () => {
    PH.updateSettings({ vaultSort: sortSelect.value }).catch((error) => PH.showError(error));
  });
  newButton.addEventListener('click', () => startNew());
  emptyTrashButton.addEventListener('click', emptyTrash);

  list.addEventListener('keydown', (event) => {
    const entry = state.selectedId && Vault.find(state.selectedId);
    switch (event.key) {
      case 'ArrowDown': moveSelection(1); break;
      case 'ArrowUp': moveSelection(-1); break;
      case 'Home': selectEdge(false); break;
      case 'End': selectEdge(true); break;
      case 'Enter':
        if (entry && !entry.deletedAt) startEdit(entry.id);
        break;
      case 'Delete':
      case 'Backspace':
        if (entry) (entry.deletedAt ? purgeItem : deleteItem)(entry);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  const vaultVisible = () => !view.hidden && Vault.status.unlocked;
  const listHasFocus = () => vaultVisible() && !state.editing && !document.activeElement.closest('input, textarea') && !String(window.getSelection());
  PH.shortcut('mod+f', () => {
    search.focus();
    search.select();
  }, { when: vaultVisible });
  PH.shortcut('mod+n', () => startNew(), { when: vaultVisible });
  PH.shortcut('mod+e', () => state.selectedId && startEdit(state.selectedId), { when: () => vaultVisible() && !state.editing });
  PH.shortcut('mod+c', () => {
    const entry = Vault.find(state.selectedId);
    if (entry) copyField(entry, 'password', 'Password');
  }, { when: () => listHasFocus() && Boolean(state.selectedId) });
  PH.shortcut('mod+shift+c', () => {
    const entry = Vault.find(state.selectedId);
    if (entry && entry.username) copyField(entry, 'username', 'Username');
  }, { when: () => listHasFocus() && Boolean(state.selectedId) });

  Vault.subscribe((_vault, reason) => {
    if (reason === 'locked') {
      clearTimers();
      if (state.editing) PH.ItemEditor.close();
      state.editing = false;
      state.selectedId = null;
      list.replaceChildren();
      detail.replaceChildren();
      return;
    }
    if (reason === 'list' && !view.hidden) render();
  });
  PH.onSettings((settings, previous) => {
    if (settings.vaultSort !== previous.vaultSort) {
      sortSelect.value = settings.vaultSort;
      sortSelect.refreshPopup();
      if (!view.hidden) render();
    }
  });

  // ------------------------------------------------------------------
  // View interface (used by app.js for items / favorites / deleted)
  // ------------------------------------------------------------------
  PH.views = PH.views || {};
  PH.views.vault = {
    element: view,
    needsVault: true,
    titleFor: (mode) => MODES[mode].title,
    async onShow(params = {}) {
      const modeChanged = params.mode && params.mode !== state.mode;
      state.mode = params.mode || state.mode;
      if (modeChanged) {
        state.query = '';
        search.value = '';
        state.selectedId = null;
      }
      sortSelect.value = PH.settings.vaultSort || 'name';
      sortSelect.refreshPopup();
      if (!Vault.loaded) await Vault.refresh();
      if (params.select) state.selectedId = params.select;
      render();
      scrollSelectedIntoView();
      if (params.newItem) startNew(params.newItem);
      else if (params.edit) startEdit(params.edit);
      else if (!state.editing) list.focus({ preventScroll: true });
    },
    onHide() {
      clearTimers();
      if (state.editing) PH.ItemEditor.close();
      state.editing = false;
    },
    /** Asked before switching views: unsaved edits need a decision. */
    canLeave: () => (state.editing ? PH.ItemEditor.requestClose() : Promise.resolve(true)),
    startNew,
  };
})();
