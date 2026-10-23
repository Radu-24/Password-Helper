/**
 * Verification Codes view: every item with two-factor authentication and its
 * current code. Click a tile to copy the code. The secrets stay in the main
 * process; this view only ever receives the codes themselves.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, el, icon } = PH;
  const api = window.api;
  const Vault = PH.Vault;

  const view = $('#view-codes');
  const grid = $('#codes-grid');
  const subtitle = $('#codes-subtitle');
  const search = $('#codes-search');

  let tiles = new Map(); // id → { digits, ring, remaining, period, code }
  let ticker = null;
  let refreshing = false;
  let query = '';

  function visibleEntries() {
    const q = query.trim().toLowerCase();
    return Vault.withCodes()
      .filter((entry) => !q || [entry.label, entry.username, PH.hostOf(entry.url)].some((text) => String(text || '').toLowerCase().includes(q)))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  }

  async function copyCode(entry) {
    try {
      PH.copied('Code', await api.vault.copy(entry.id, 'totp'));
    } catch (error) {
      PH.showError(error);
    }
  }

  function render({ animate = false } = {}) {
    const entries = visibleEntries();
    const total = Vault.withCodes().length;
    subtitle.textContent = PH.plural(total, 'code', 'codes');
    tiles = new Map();
    if (!entries.length) {
      const [iconName, heading, text] = query
        ? ['search', 'No results', `Nothing matches “${query.trim()}”.`]
        : ['timer', 'No verification codes yet', 'Open an item, choose Edit, then Set Up… next to “Verification code”.'];
      grid.replaceChildren(el('div', { className: 'glass platter list-empty codes-empty' }, icon(iconName), el('strong', { text: heading }), el('span', { text })));
      return;
    }
    const nodes = entries.map((entry) => {
      const digits = el('span', { className: 'code-digits', text: '••• •••' });
      const ring = PH.ring({ showSeconds: true });
      const tile = el(
        'button',
        { type: 'button', className: 'glass code-tile', title: 'Copy code', 'aria-label': `Copy the code for ${entry.label}` },
        PH.avatar(entry.label),
        el('span', { className: 'list-text' }, el('span', { className: 'list-title', text: entry.label }), el('span', { className: 'list-subtitle', text: entry.username || PH.hostOf(entry.url) || entry.type })),
        ring,
        digits,
        el('span', { className: 'copy-hint', text: 'Click to copy' }),
      );
      tile.addEventListener('click', () => copyCode(entry));
      tile.addEventListener('contextmenu', async (event) => {
        const choice = await PH.contextMenu(event, [
          { id: 'copy', label: 'Copy Code', icon: 'copy' },
          { id: 'show', label: 'Show Item', icon: 'key-round' },
        ]);
        if (choice === 'copy') copyCode(entry);
        if (choice === 'show') PH.navigate('items', { select: entry.id });
      });
      tiles.set(entry.id, { digits, ring, remaining: 0, period: 30, code: '' });
      return tile;
    });
    grid.replaceChildren(...nodes);
    if (animate) PH.enter(nodes, { stagger: 22 });
    refreshCodes();
  }

  async function refreshCodes() {
    if (refreshing || !tiles.size) return;
    refreshing = true;
    try {
      const codes = await api.vault.totpCodes([...tiles.keys()]);
      for (const code of codes) {
        const tile = tiles.get(code.id);
        if (!tile) continue;
        const formatted = window.PHOtp.formatCode(code.code);
        if (formatted !== tile.code) {
          tile.digits.textContent = formatted;
          if (tile.code) PH.replayClass(tile.digits, 'flip');
          tile.code = formatted;
        }
        tile.remaining = code.remaining;
        tile.period = code.period;
        tile.ring.update(code.remaining, code.period);
      }
    } catch (error) {
      if (error.code !== 'LOCKED') PH.showError(error);
    } finally {
      refreshing = false;
    }
  }

  function tick() {
    let expired = false;
    for (const tile of tiles.values()) {
      tile.remaining -= 1;
      if (tile.remaining <= 0) expired = true;
      else tile.ring.update(tile.remaining, tile.period);
    }
    if (expired) refreshCodes();
  }

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  Vault.subscribe((_vault, reason) => {
    if (reason === 'locked') {
      tiles = new Map();
      grid.replaceChildren();
    } else if (reason === 'list' && !view.hidden) {
      render();
    }
  });

  PH.shortcut('mod+f', () => {
    search.focus();
    search.select();
  }, { when: () => !view.hidden });

  PH.views = PH.views || {};
  PH.views.codes = {
    element: view,
    title: 'Verification Codes',
    needsVault: true,
    async onShow() {
      if (!Vault.loaded) await Vault.refresh();
      render({ animate: true });
      clearInterval(ticker);
      ticker = setInterval(tick, 1000);
    },
    onHide() {
      clearInterval(ticker);
      ticker = null;
      tiles = new Map();
      grid.replaceChildren(); // codes don't linger on a hidden view
    },
  };
})();
