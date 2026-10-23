/**
 * Core: DOM helpers, icons, settings, appearance, keyboard shortcuts,
 * the Escape stack and small formatting helpers. Exposed on window.PH.
 *
 * Every script after this one runs with `defer`, so the DOM is parsed.
 */
(function () {
  'use strict';

  const api = window.api;
  const PH = (window.PH = window.PH || {});
  const root = document.documentElement;

  // ------------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------------
  PH.$ = (selector, scope = document) => scope.querySelector(selector);
  PH.$$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  /**
   * Element builder — text always goes through textContent, never innerHTML.
   *   PH.el('button', { className: 'btn', type: 'button', onClick: fn }, 'Label', PH.icon('plus'))
   */
  PH.el = function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key in node && !key.startsWith('aria') && key !== 'role') node[key] = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  // ------------------------------------------------------------------
  // Icons (Lucide data from icons.js, drawn with createElementNS)
  // ------------------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function drawIcon(name) {
    const nodes = (window.PHIcons || {})[name];
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (!nodes) {
      console.warn(`Unknown icon "${name}"`);
      return svg;
    }
    for (const [tag, attrs] of nodes) {
      const child = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, value);
      svg.append(child);
    }
    return svg;
  }

  /** An <i data-icon> holding the named icon. Options: { className, size } */
  PH.icon = function icon(name, { className = '', size = null } = {}) {
    const holder = document.createElement('i');
    holder.dataset.icon = name;
    if (className) holder.className = className;
    if (size) holder.style.setProperty('--icon-size', `${size}px`);
    holder.append(drawIcon(name));
    return holder;
  };

  /** Fills every empty <i data-icon> under `scope` (static markup in index.html). */
  PH.hydrateIcons = function hydrateIcons(scope = document) {
    for (const holder of scope.querySelectorAll('i[data-icon]')) {
      if (!holder.firstChild) holder.append(drawIcon(holder.dataset.icon));
    }
  };

  /** Swaps the icon inside an <i data-icon>. */
  PH.setIcon = function setIcon(holder, name) {
    if (!holder || holder.dataset.icon === name) return;
    holder.dataset.icon = name;
    holder.replaceChildren(drawIcon(name));
  };

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  PH.plural = (count, one, many) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  PH.charCount = (text) => Array.from(text || '').length;

  PH.debounce = function debounce(fn, wait) {
    let timer = null;
    const debounced = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
  };

  /** localStorage that never throws (private mode, quota, damaged data). */
  PH.store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage unavailable — the preference just won't persist
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  /** "Today, 14:32" · "Yesterday" · "3 Oct 2026" */
  PH.formatDay = function formatDay(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
    if (days === 0) return `Today, ${timeFormat.format(date)}`;
    if (days === 1) return `Yesterday, ${timeFormat.format(date)}`;
    return dateFormat.format(date);
  };
  PH.formatDateTime = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
  };
  /** "just now" · "5 minutes ago" · "2 days ago" */
  PH.formatAgo = function formatAgo(iso) {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(seconds)) return '';
    if (seconds < 45) return 'just now';
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
    if (seconds < 86_400) return rtf.format(-Math.round(seconds / 3600), 'hour');
    return rtf.format(-Math.round(seconds / 86_400), 'day');
  };

  /** Host name of a URL without "www." ("" if it isn't one). */
  PH.hostOf = function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  /** Monogram tile coloured by a hash of the name. */
  PH.avatar = function avatar(label, size = '') {
    const text = String(label || '?').trim();
    let hash = 0;
    for (const char of text.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    const letter = Array.from(text.replace(/^(https?:\/\/)?(www\.)?/i, ''))[0] || '?';
    return PH.el('span', {
      className: `avatar${size ? ` avatar-${size}` : ''}`,
      dataset: { color: String(hash % 12) },
      'aria-hidden': 'true',
      text: letter,
    });
  };

  // ------------------------------------------------------------------
  // Motion
  // ------------------------------------------------------------------
  const osReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  PH.reducedMotion = () => osReducedMotion.matches || PH.settings.reduceMotion === true;

  /** { easing, duration } of a spring from tokens.css ('smooth' | 'snappy' | 'bouncy'), for element.animate(). */
  PH.spring = function spring(name) {
    const style = getComputedStyle(root);
    return {
      easing: style.getPropertyValue(`--spring-${name}`).trim() || 'ease-out',
      duration: parseFloat(style.getPropertyValue(`--spring-${name}-d`)) || 400,
    };
  };

  /** Plays the entrance animation on elements (each one is a glass surface or plain content). */
  PH.enter = function enter(elements, { stagger = 28, delay = 0 } = {}) {
    if (PH.reducedMotion()) return;
    [...elements].forEach((element, index) => {
      element.classList.remove('enter');
      void element.offsetWidth; // restart
      element.style.animationDelay = `${delay + index * stagger}ms`;
      element.classList.add('enter');
      element.addEventListener(
        'animationend',
        () => {
          element.classList.remove('enter');
          element.style.animationDelay = '';
        },
        { once: true },
      );
    });
  };

  /** Restarts a one-shot CSS animation class (e.g. 'shake'). */
  PH.replayClass = function replayClass(element, className) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    element.addEventListener('animationend', () => element.classList.remove(className), { once: true });
  };

  // ------------------------------------------------------------------
  // Settings (kept by the main process in settings.json)
  // ------------------------------------------------------------------
  PH.settings = {
    clearAnalyzerOnBack: true,
    analyzerBreachCheck: false,
    analyzerInsights: false,
    analyzerHash: false,
    autoLockMinutes: 5,
    lockOnMinimize: false,
    clipboardClearSeconds: 30,
    matrixBackground: true,
    backgroundIntensity: 70,
    accent: 'blue',
    reduceMotion: false,
    reduceTransparency: false,
    showLoginOnStart: true,
    onboarded: false,
    vaultSort: 'name',
    lastView: 'items',
    sidebarWidth: 224,
    sidebarCollapsed: false,
    generator: {},
  };

  const settingsListeners = new Set();
  /** Runs `listener(settings, previous)` after every change (and once at startup). */
  PH.onSettings = (listener) => {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
  };

  function applyAppearance() {
    const s = PH.settings;
    root.dataset.accent = s.accent || 'blue';
    root.toggleAttribute('data-reduce-motion', s.reduceMotion === true);
    root.toggleAttribute('data-reduce-transparency', s.reduceTransparency === true);
  }

  function emitSettings(previous) {
    applyAppearance();
    for (const listener of settingsListeners) {
      try {
        listener(PH.settings, previous);
      } catch (error) {
        console.error(error);
      }
    }
  }

  /** Saves a change; resolves with the validated settings. */
  PH.updateSettings = async function updateSettings(patch) {
    const previous = PH.settings;
    PH.settings = { ...PH.settings, ...(await api.settings.set(patch)) };
    emitSettings(previous);
    return PH.settings;
  };

  /** Earlier versions kept a few preferences in localStorage — move them over once. */
  async function migrateLegacyPrefs() {
    const legacyKeys = {
      clearOnBack: 'clearAnalyzerOnBack',
      'ph.analyzer.breach': 'analyzerBreachCheck',
      'ph.analyzer.insights': 'analyzerInsights',
      'ph.analyzer.hash': 'analyzerHash',
    };
    const patch = {};
    for (const [oldKey, newKey] of Object.entries(legacyKeys)) {
      const value = PH.store.get(oldKey, null);
      if (typeof value === 'boolean') patch[newKey] = value;
    }
    if (Object.keys(patch).length === 0) return;
    PH.settings = { ...PH.settings, ...(await api.settings.set(patch)) };
    for (const oldKey of Object.keys(legacyKeys)) PH.store.remove(oldKey);
  }

  /** Resolves once settings are loaded — modules start from PH.ready.then(…). */
  PH.ready = (async () => {
    try {
      PH.settings = { ...PH.settings, ...(await api.settings.get()) };
      await migrateLegacyPrefs();
    } catch (error) {
      console.error('Could not load settings:', error);
    }
    emitSettings(PH.settings);
  })();

  // ------------------------------------------------------------------
  // Keyboard: shortcuts and the Escape stack
  // ------------------------------------------------------------------
  const isMac = api.platform === 'darwin';
  PH.isMac = isMac;
  /** Shortcut label for menus and tooltips: "Ctrl+F" / "⌘F". */
  PH.keyLabel = (combo) =>
    combo
      .split('+')
      .map((part) => {
        if (part === 'mod') return isMac ? '⌘' : 'Ctrl';
        if (part === 'shift') return isMac ? '⇧' : 'Shift';
        if (part === 'alt') return isMac ? '⌥' : 'Alt';
        return part.length === 1 ? part.toUpperCase() : part;
      })
      .join(isMac ? '' : '+');

  const shortcuts = new Map(); // combo → [{ handler, when, allowInModal }]
  /**
   * PH.shortcut('mod+f', handler, { when: () => boolean })
   * Several handlers may share a combo; the most recently registered one whose
   * `when` is true runs (`fallback: true` registers below all others). Shortcuts
   * don't fire while a sheet, alert or menu is open (PH.modalDepth > 0) unless
   * allowInModal is set.
   */
  PH.shortcut = function shortcut(combo, handler, { when = () => true, allowInModal = false, fallback = false } = {}) {
    const key = combo.toLowerCase();
    if (!shortcuts.has(key)) shortcuts.set(key, []);
    shortcuts.get(key)[fallback ? 'unshift' : 'push']({ handler, when, allowInModal });
  };
  PH.modalDepth = 0;

  function comboOf(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('mod');
    if (event.shiftKey) parts.push('shift');
    if (event.altKey) parts.push('alt');
    let key = event.key.toLowerCase();
    if (/^digit\d$/i.test(event.code)) key = event.code.slice(5);
    parts.push(key);
    return parts.join('+');
  }

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const entries = shortcuts.get(comboOf(event)) || [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if ((PH.modalDepth > 0 && !entry.allowInModal) || !entry.when(event)) continue;
      event.preventDefault();
      entry.handler(event);
      return;
    }
  });

  const escapeHandlers = [];
  /** Pushes an Escape handler; the newest runs first. Returns a remover. */
  PH.onEscape = function onEscape(handler) {
    escapeHandlers.push(handler);
    return () => {
      const index = escapeHandlers.lastIndexOf(handler);
      if (index !== -1) escapeHandlers.splice(index, 1);
    };
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || escapeHandlers.length === 0) return;
    // Let a focused search field clear itself first.
    const target = event.target;
    if (target && target.type === 'search' && target.value) return;
    event.preventDefault();
    escapeHandlers[escapeHandlers.length - 1](event);
  });

  // ------------------------------------------------------------------
  // Vault session helpers
  // ------------------------------------------------------------------
  /** Keyboard / mouse activity postpones the auto-lock (at most one ping per 15 s). */
  let lastActivityPing = 0;
  function activityPing() {
    const now = Date.now();
    if (now - lastActivityPing < 15_000) return;
    lastActivityPing = now;
    api.vault.touch().catch(() => {});
  }
  for (const type of ['keydown', 'pointerdown', 'wheel']) {
    document.addEventListener(type, activityPing, { passive: true, capture: true });
  }

  const LOCK_REASONS = {
    timeout: 'Vault locked after inactivity.',
    minimize: 'Vault locked because the window was minimised.',
    suspend: 'Vault locked because the computer went to sleep.',
  };
  PH.lockMessage = (reason) => LOCK_REASONS[reason] || 'Vault locked.';

  /** Turns a failed window.api call into a notification. */
  PH.showError = function showError(error, fallback = 'Something went wrong.') {
    if (error && error.code === 'LOCKED') return; // the lock screen says it already
    PH.hud((error && error.message) || fallback, { tone: 'error', duration: 4500 });
  };

  /** Notification for a clipboard copy (says when it will be wiped). */
  PH.copied = function copied(what, result) {
    const seconds = result && result.clearsInSeconds;
    PH.hud(seconds ? `${what} copied — clears in ${seconds} s` : `${what} copied`, { tone: 'success', icon: 'clipboard-check' });
  };

  // ------------------------------------------------------------------
  // Window chrome
  // ------------------------------------------------------------------
  root.classList.add(`platform-${api.platform}`);
  for (const button of PH.$$('[data-window]')) {
    button.addEventListener('click', () => api.window.control(button.dataset.window));
  }
  api.window.onFocusChange((focused) => root.classList.toggle('window-inactive', !focused));

  // Tooltips are written with "Ctrl+"; macOS shows ⌘ instead.
  if (isMac) {
    for (const node of PH.$$('[title*="Ctrl+"]')) node.title = node.title.replace(/Ctrl\+/g, '⌘');
  }

  PH.hydrateIcons();
})();
