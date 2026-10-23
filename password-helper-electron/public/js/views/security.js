/**
 * Security view: breached, reused and weak passwords, with what to do about
 * each one. The breach check sends only 5-character hash prefixes
 * (k-anonymity) — never a password or a full hash.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, el, icon } = PH;
  const api = window.api;
  const Vault = PH.Vault;

  const view = $('#view-security');
  const body = $('#security-body');
  const scanButton = $('#security-scan');
  let filter = null;

  const KINDS = {
    breached: {
      tint: 'red',
      title: 'Found in data breaches',
      label: 'Breached',
      describe: (entry) => `Seen ${entry.breachCount.toLocaleString()} times in known breaches`,
      advice: 'Change these first: attackers try leaked passwords before anything else.',
    },
    reused: {
      tint: 'yellow',
      title: 'Reused passwords',
      label: 'Reused',
      describe: (entry) => `Same password as ${PH.plural(entry.reusedCount, 'other item', 'other items')}`,
      advice: 'If one site leaks a reused password, every account that shares it is exposed.',
    },
    weak: {
      tint: 'orange',
      title: 'Weak passwords',
      label: 'Weak',
      describe: () => 'Easy to guess',
      advice: 'Replace them with generated passwords or passphrases.',
    },
  };

  async function openWebsite(entry) {
    try {
      await api.app.openUrl(entry.url);
    } catch (error) {
      PH.showError(error);
    }
  }

  function issueRow(entry, kind) {
    const actions = el('div', { className: 'issue-actions' });
    if (entry.url) actions.append(el('button', { type: 'button', className: 'btn btn-secondary btn-small', text: 'Change on Website', onClick: () => openWebsite(entry) }));
    actions.append(el('button', { type: 'button', className: 'btn btn-tinted btn-small', text: 'Show', onClick: () => PH.navigate('items', { select: entry.id }) }));
    return el(
      'div',
      { className: 'issue-row' },
      PH.avatar(entry.label),
      el('div', { className: 'issue-text' }, el('strong', { text: entry.label }), el('span', { text: KINDS[kind].describe(entry) })),
      actions,
    );
  }

  function summary(issues, flaggedCount) {
    const breached = issues.breached.length;
    const tint = breached ? 'red' : flaggedCount ? 'orange' : 'green';
    const checked = Vault.breachCheckedAt
      ? `Last checked for breaches ${PH.formatAgo(Vault.breachCheckedAt)}.`
      : 'Not checked for breaches yet. Check for Breaches compares hash prefixes with Have I Been Pwned — your passwords never leave this computer.';
    const total = Vault.active().length;
    const heading = !total ? 'No passwords to check' : flaggedCount ? PH.plural(flaggedCount, 'item needs attention', 'items need attention') : 'Your passwords look good';
    const node = el(
      'div',
      { className: 'glass platter' },
      el(
        'div',
        { className: 'security-summary' },
        el('span', { className: 'security-shield', dataset: { tint } }, icon(flaggedCount ? 'shield-alert' : 'shield-check')),
        el('div', {}, el('h2', { text: heading }), el('p', { text: checked })),
      ),
    );
    if (total) {
      const counts = el('div', { className: 'security-counts' });
      for (const [kind, info] of Object.entries(KINDS)) {
        const button = el(
          'button',
          {
            type: 'button',
            className: 'security-count',
            dataset: { tint: info.tint },
            'aria-pressed': String(filter === kind),
            title: filter === kind ? 'Show every recommendation' : `Show only ${info.label.toLowerCase()} passwords`,
          },
          el('strong', { text: String(issues[kind].length) }),
          el('span', { text: info.label }),
        );
        button.addEventListener('click', () => {
          filter = filter === kind ? null : kind;
          render();
        });
        counts.append(button);
      }
      node.append(counts);
    }
    return node;
  }

  function render({ animate = false } = {}) {
    const issues = Vault.issues();
    const flagged = new Set([...issues.breached, ...issues.reused, ...issues.weak].map((entry) => entry.id)).size;
    const nodes = [summary(issues, flagged)];
    for (const [kind, info] of Object.entries(KINDS)) {
      if (filter && filter !== kind) continue;
      const entries = [...issues[kind]].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      if (!entries.length) continue;
      nodes.push(
        el(
          'div',
          { className: 'glass platter' },
          el('div', { className: 'platter-header' }, el('h2', { text: `${info.title} (${entries.length})` })),
          el('p', { className: 'platter-note', text: info.advice }),
          ...entries.map((entry) => issueRow(entry, kind)),
        ),
      );
    }
    if (flagged === 0 && Vault.active().length) {
      nodes.push(
        el(
          'div',
          { className: 'glass platter security-ok' },
          el('span', { className: 'security-shield', dataset: { tint: 'green' } }, icon('shield-check')),
          el('h2', { text: 'No recommendations' }),
          el('p', { text: Vault.breachCheckedAt ? 'None of your passwords are weak, reused or in known breaches.' : 'None of your passwords are weak or reused. Run Check for Breaches to compare them with known data breaches too.' }),
        ),
      );
    }
    body.replaceChildren(...nodes);
    if (animate) PH.enter(nodes);
    scanButton.disabled = Vault.active().length === 0;
    scanButton.querySelector('span').textContent = Vault.breachCheckedAt ? 'Check Again' : 'Check for Breaches';
  }

  async function scan() {
    await PH.withBusy(scanButton, async () => {
      const { checked, breached, failed } = await Vault.checkBreaches();
      if (failed === checked && checked > 0) PH.hud('Couldn’t reach Have I Been Pwned — are you offline?', { tone: 'error' });
      else if (breached) {
        filter = 'breached';
        PH.hud(`${PH.plural(breached, 'password was', 'passwords were')} found in data breaches.`, { tone: 'warning', duration: 5000 });
      } else PH.hud(`No breached passwords among ${PH.plural(checked - failed, 'item', 'items')}.`, { tone: 'success' });
      if (failed && failed < checked) PH.hud(`${PH.plural(failed, 'check', 'checks')} failed — try again later.`, { tone: 'warning' });
      render();
    });
  }
  scanButton.addEventListener('click', scan);

  Vault.subscribe((_vault, reason) => {
    if (reason === 'locked') body.replaceChildren();
    else if (reason === 'list' && !view.hidden) render();
  });

  PH.views = PH.views || {};
  PH.views.security = {
    element: view,
    title: 'Security',
    needsVault: true,
    async onShow() {
      if (!Vault.loaded) await Vault.refresh();
      render({ animate: true });
    },
    onHide() {
      filter = null;
    },
  };
})();
