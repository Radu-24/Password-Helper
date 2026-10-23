/**
 * App shell: startup (welcome → sign-in → main window), sidebar navigation,
 * the vault gate, sidebar resizing / collapsing and global shortcuts.
 *
 * Destinations are what the sidebar shows; several share one view
 * (All Items, Favourites and Recently Deleted are all the vault view).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, $$ } = PH;
  const Vault = PH.Vault;

  const appScreen = $('#screen-app');
  const sidebar = $('#sidebar');
  const sidebarScroll = $('#sidebar-scroll');
  const indicator = $('#sidebar-indicator');
  const resizer = $('#sidebar-resizer');
  const navItems = $$('.sidebar-item[data-nav]');

  const DESTINATIONS = {
    analyzer: { view: 'analyzer', title: 'Analyzer' },
    generator: { view: 'generator', title: 'Generator' },
    items: { view: 'vault', params: { mode: 'items' }, vault: true, title: 'All Items' },
    favorites: { view: 'vault', params: { mode: 'favorites' }, vault: true, title: 'Favourites' },
    codes: { view: 'codes', vault: true, title: 'Verification Codes' },
    security: { view: 'security', vault: true, title: 'Security' },
    deleted: { view: 'vault', params: { mode: 'deleted' }, vault: true, title: 'Recently Deleted' },
    settings: { view: 'settings', title: 'Settings' },
  };
  const NUMBERED = ['analyzer', 'generator', 'items', 'favorites', 'codes', 'security'];

  const current = { name: null, view: null };
  let pending = null; // destination waiting for the vault to unlock
  let navigating = Promise.resolve();
  const rememberView = (name) => {
    if (PH.settings.lastView !== name) PH.updateSettings({ lastView: name }).catch(() => {});
  };

  // ------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------
  PH.showScreen = function showScreen(id) {
    for (const screen of $$('body > .screen')) screen.hidden = screen.id !== id;
  };

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------
  function showView(key, params) {
    const next = PH.views[key];
    if (current.view !== key) {
      const previous = current.view && PH.views[current.view];
      if (previous) {
        if (previous.onHide) previous.onHide();
        previous.element.hidden = true;
      }
      next.element.hidden = false;
      next.element.classList.remove('is-scrolled');
      const body = $('.view-body', next.element);
      if (body) body.scrollTop = 0;
      PH.enter($$('[data-enter]', next.element).filter((node) => !node.hidden));
    }
    current.view = key;
    if (next.onShow) next.onShow(params);
  }

  /**
   * Opens a sidebar destination. Vault destinations show the unlock (or
   * create) form first when the vault is locked, then continue.
   */
  PH.navigate = function navigate(name, params = {}) {
    navigating = navigating.then(() => go(name, params)).catch((error) => console.error(error));
    return navigating;
  };

  async function go(name, params) {
    const destination = DESTINATIONS[name];
    if (!destination) return;
    const leaving = current.view && PH.views[current.view];
    if (leaving && leaving.canLeave && !(await leaving.canLeave())) return;

    if (destination.vault && !Vault.status.unlocked) {
      pending = { name, params };
      showView('gate', { title: destination.title });
    } else {
      pending = null;
      showView(destination.view, { ...(destination.params || {}), ...params });
    }
    current.name = name;
    select(name);
    rememberView(name);
  }

  // ------------------------------------------------------------------
  // Sidebar: selection pill, counts, vault status
  // ------------------------------------------------------------------
  function placeIndicator({ animate = true } = {}) {
    const active = navItems.find((item) => item.getAttribute('aria-current') === 'page');
    if (!active || !active.offsetParent) {
      indicator.classList.remove('visible');
      return;
    }
    const top = active.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    indicator.classList.toggle('instant', !animate);
    indicator.style.transform = `translateY(${top}px)`;
    indicator.classList.add('visible');
    if (!animate) {
      void indicator.offsetWidth;
      indicator.classList.remove('instant');
    }
  }

  function select(name) {
    const wasVisible = indicator.classList.contains('visible');
    for (const item of navItems) {
      if (item.dataset.nav === name) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    if (name === 'deleted') $('#nav-deleted-row').hidden = false;
    placeIndicator({ animate: wasVisible });
  }

  for (const item of navItems) item.addEventListener('click', () => PH.navigate(item.dataset.nav));
  sidebarScroll.addEventListener('scroll', () => placeIndicator({ animate: false }), { passive: true });
  window.addEventListener('resize', () => placeIndicator({ animate: false }));

  function updateCounts() {
    const unlocked = Vault.status.unlocked && Vault.loaded;
    const counts = unlocked ? Vault.counts() : null;
    for (const node of $$('[data-count]', sidebar)) {
      const key = node.dataset.count;
      const value = counts ? counts[key] : null;
      node.textContent = value ? value.toLocaleString() : '';
      node.classList.toggle('is-alert', key === 'security' && Boolean(counts && counts.breached));
    }
    const deletedRow = $('#nav-deleted-row');
    const showDeleted = Boolean(counts && counts.deleted) || current.name === 'deleted';
    if (deletedRow.hidden === showDeleted) {
      deletedRow.hidden = !showDeleted;
      placeIndicator({ animate: false });
    }

    const status = $('#vault-status');
    status.hidden = !Vault.status.exists;
    status.classList.toggle('is-locked', !Vault.status.unlocked);
    $('#vault-status-text').textContent = Vault.status.unlocked ? 'Vault unlocked' : 'Vault locked';
    PH.setIcon($('.vault-status-icon', status), Vault.status.unlocked ? 'lock-open' : 'lock');
    $('#vault-lock-btn').hidden = !Vault.status.unlocked;
  }

  $('#vault-lock-btn').addEventListener('click', () => Vault.lock());

  Vault.subscribe(async (_vault, reason, detail) => {
    updateCounts();
    if (reason === 'locked') {
      PH.closeOverlays();
      const destination = DESTINATIONS[current.name];
      if (destination && destination.vault) {
        pending = { name: current.name, params: {} };
        showView('gate', { title: destination.title });
      }
      if (detail && detail !== 'manual' && detail !== 'quit') PH.hud(PH.lockMessage(detail), { tone: 'info', icon: 'lock', duration: 4000 });
    }
    if (reason === 'unlocked' && current.view === 'gate' && pending) {
      const target = pending;
      await PH.views.gate.celebrate();
      if (current.view === 'gate') PH.navigate(target.name, target.params);
    }
  });

  // ------------------------------------------------------------------
  // Sidebar collapse + resize
  // ------------------------------------------------------------------
  const NARROW = 860;
  let expandedWhileNarrow = false;

  function applySidebar() {
    const narrow = window.innerWidth < NARROW;
    appScreen.classList.toggle('is-narrow', narrow);
    const collapsed = narrow ? !expandedWhileNarrow : PH.settings.sidebarCollapsed === true;
    appScreen.classList.toggle('sidebar-collapsed', collapsed);
    appScreen.style.setProperty('--sidebar-w', `${PH.settings.sidebarWidth || 224}px`);
    setTimeout(() => placeIndicator({ animate: false }), 0);
  }

  function toggleSidebar() {
    if (window.innerWidth < NARROW) {
      expandedWhileNarrow = !expandedWhileNarrow;
      applySidebar();
    } else {
      PH.updateSettings({ sidebarCollapsed: !PH.settings.sidebarCollapsed }).then(applySidebar, (error) => PH.showError(error));
    }
  }

  for (const button of $$('[data-action="toggle-sidebar"]')) button.addEventListener('click', toggleSidebar);
  window.addEventListener('resize', PH.debounce(applySidebar, 80));

  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    appScreen.classList.add('is-resizing');
    const startX = event.clientX;
    const startWidth = PH.settings.sidebarWidth || 224;
    let width = startWidth;
    const onMove = (moveEvent) => {
      width = Math.round(Math.max(180, Math.min(320, startWidth + moveEvent.clientX - startX)));
      appScreen.style.setProperty('--sidebar-w', `${width}px`);
      placeIndicator({ animate: false });
    };
    const onUp = () => {
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onUp);
      appScreen.classList.remove('is-resizing');
      if (width !== startWidth) PH.updateSettings({ sidebarWidth: width }).catch(() => {});
    };
    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onUp);
  });
  resizer.addEventListener('dblclick', () => PH.updateSettings({ sidebarWidth: 224 }).then(applySidebar));

  // Scroll edge under each toolbar
  for (const body of $$('.view-body')) {
    const viewElement = body.closest('.view');
    body.addEventListener('scroll', () => viewElement.classList.toggle('is-scrolled', body.scrollTop > 2), { passive: true });
  }

  // ------------------------------------------------------------------
  // Global shortcuts
  // ------------------------------------------------------------------
  const inApp = () => !appScreen.hidden;
  NUMBERED.forEach((name, index) => PH.shortcut(`mod+${index + 1}`, () => PH.navigate(name), { when: inApp }));
  PH.shortcut('mod+,', () => PH.navigate('settings'), { when: inApp });
  PH.shortcut('mod+shift+s', toggleSidebar, { when: inApp });
  PH.shortcut('mod+l', () => Vault.lock(), { when: () => Vault.status.unlocked, allowInModal: true });
  // Fallbacks when the current view doesn't handle these itself.
  PH.shortcut('mod+g', () => PH.navigate('generator'), { when: inApp, fallback: true });
  PH.shortcut('mod+n', () => PH.navigate('items', { newItem: {} }), { when: inApp, fallback: true });
  PH.shortcut('mod+f', () => PH.navigate('items').then(() => $('#vault-search').focus()), { when: inApp, fallback: true });

  // ------------------------------------------------------------------
  // Startup
  // ------------------------------------------------------------------
  function enterApp() {
    PH.showScreen('screen-app');
    applySidebar();
    if (!PH.reducedMotion()) {
      sidebar.animate(
        [
          { opacity: 0, transform: 'translateX(-14px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: PH.spring('smooth').duration, easing: PH.spring('smooth').easing },
      );
    }
    const last = DESTINATIONS[PH.settings.lastView] ? PH.settings.lastView : 'items';
    return PH.navigate(last === 'deleted' ? 'items' : last);
  }

  /**
   * Glass over a moving background needs a GPU. If the window draws slowly
   * (e.g. no graphics acceleration), suggest "Reduce transparency" — once.
   */
  function checkPerformance() {
    const HINT_KEY = 'ph.performanceHintShown';
    setTimeout(() => {
      const s = PH.settings;
      if (PH.store.get(HINT_KEY, false) || document.hidden || s.reduceTransparency || s.matrixBackground === false || PH.reducedMotion()) return;
      let frames = 0;
      const start = performance.now();
      const count = (now) => {
        frames += 1;
        if (now - start < 2000) {
          requestAnimationFrame(count);
          return;
        }
        const fps = (frames * 1000) / (now - start);
        if (fps >= 30 || document.hidden) return;
        PH.store.set(HINT_KEY, true);
        PH.hud('The glass effect is slow on this computer. Reduce transparency for a smoother window?', {
          tone: 'info',
          icon: 'gauge',
          duration: 12000,
          action: { label: 'Reduce', onClick: () => PH.updateSettings({ reduceTransparency: true }).catch(() => {}) },
        });
      };
      requestAnimationFrame(count);
    }, 5000);
  }

  /** Settings → Sign In… */
  PH.openSignIn = async function openSignIn() {
    await PH.Onboarding.showSignIn();
    PH.showScreen('screen-app');
    placeIndicator({ animate: false });
  };

  PH.ready.then(async () => {
    try {
      await Vault.refreshStatus();
    } catch (error) {
      PH.showError(error, 'Could not open the vault.');
    }
    if (!PH.settings.onboarded) await PH.Onboarding.showWelcome();
    if (PH.settings.showLoginOnStart) await PH.Onboarding.showSignIn();
    await enterApp();
    checkPerformance();
  });
})();
