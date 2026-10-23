/**
 * Shared page code: titlebar, matrix background, toasts, confirm dialogs,
 * screen switching, page transitions and small DOM helpers.
 *
 * Every page loads this first (with `defer`), so the DOM is already parsed
 * when it runs. Everything is exposed on `window.PH`.
 */
(function () {
  'use strict';

  const api = window.api;
  const PH = (window.PH = window.PH || {});

  // ------------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------------
  PH.$ = (selector, root = document) => root.querySelector(selector);
  PH.$$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /**
   * Tiny element builder — text only goes through textContent, never innerHTML.
   * PH.el('button', { className: 'btn', type: 'button', onClick: fn }, 'Label')
   */
  PH.el = function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key in node && !key.startsWith('aria')) node[key] = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  /** "12 characters" — counted in Unicode code points. */
  PH.charLabel = function charLabel(text) {
    const count = Array.from(text || '').length;
    return `${count} character${count === 1 ? '' : 's'}`;
  };

  PH.debounce = function debounce(fn, wait) {
    let timer = null;
    const debounced = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
  };

  /** localStorage that never throws (private mode, quota, corrupted data). */
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
        // storage unavailable — preference just won't persist
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

  // ------------------------------------------------------------------
  // Titlebar (frameless window controls)
  // ------------------------------------------------------------------
  function mountTitlebar() {
    const control = (action) => () => api.window.control(action);
    const button = (cls, label, symbol, action) =>
      PH.el('button', {
        type: 'button',
        className: `tb-btn ${cls}`,
        title: label,
        'aria-label': label,
        dataset: { symbol },
        onClick: control(action),
      });

    // "Vault unlocked" pill on the left — one click (or Ctrl+L) locks it from any page.
    const lockPill = PH.el('button', {
      type: 'button',
      className: 'tb-lock hidden',
      title: 'Lock the vault now (Ctrl+L)',
      'aria-label': 'Vault is unlocked — lock it now',
      text: '🔓 Vault unlocked',
      onClick: () => api.vault.lock().catch((error) => PH.showError(error)),
    });
    const setUnlocked = (unlocked) => lockPill.classList.toggle('hidden', !unlocked);
    api.vault.onLocked(() => setUnlocked(false));
    api.vault.onUnlocked(() => setUnlocked(true));
    api.vault
      .status()
      .then((status) => setUnlocked(status.unlocked))
      .catch(() => {});

    const bar = PH.el(
      'header',
      { className: 'titlebar' },
      lockPill,
      button('min', 'Minimize', '–', 'minimize'),
      button('max', 'Maximize', '▢', 'toggle-maximize'),
      button('close', 'Close', '✕', 'close'),
    );
    bar.addEventListener('dblclick', (event) => {
      if (event.target === bar) api.window.control('toggle-maximize');
    });
    document.body.prepend(bar);
  }

  // ------------------------------------------------------------------
  // Keyboard shortcuts: Ctrl+L locks the vault everywhere; pages add their own.
  // ------------------------------------------------------------------
  const shortcuts = {};
  /** PH.onShortcut('f', handler) → runs on Ctrl+F (Cmd+F on macOS). */
  PH.onShortcut = function onShortcut(key, handler) {
    shortcuts[key.toLowerCase()] = handler;
  };
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 'l') {
      event.preventDefault();
      api.vault.lock().catch(() => {});
    } else if (shortcuts[key]) {
      event.preventDefault();
      shortcuts[key](event);
    }
  });

  // ------------------------------------------------------------------
  // Matrix background
  // ------------------------------------------------------------------
  const MATRIX_CHARS = 'アァイィウエェカキクケコサシスセソタチツテトナニヌネノ0123456789'.split('');
  const MATRIX_FONT_SIZE = 14;
  const MATRIX_FRAME_MS = 33; // ~30 fps, same speed as the original setInterval(…, 33)

  function startMatrix() {
    const canvas = PH.el('canvas', { id: 'matrixCanvas', 'aria-hidden': 'true' });
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let drops = [];
    let last = 0;
    let rafId = 0;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drops = Array(Math.floor(canvas.width / MATRIX_FONT_SIZE)).fill(1);
    }

    function draw() {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f0';
      ctx.font = `${MATRIX_FONT_SIZE}px monospace`;
      for (let i = 0; i < drops.length; i++) {
        const char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        ctx.fillText(char, i * MATRIX_FONT_SIZE, drops[i] * MATRIX_FONT_SIZE);
        drops[i] = drops[i] * MATRIX_FONT_SIZE > canvas.height && Math.random() > 0.975 ? 0 : drops[i] + 1;
      }
    }

    function frame(time) {
      rafId = requestAnimationFrame(frame);
      if (time - last < MATRIX_FRAME_MS) return;
      last = time;
      draw();
    }

    function sync() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      // Paused while the window is hidden/minimised or if the OS asks for less motion.
      if (!document.hidden && !reduceMotion.matches && !document.body.classList.contains('no-matrix')) {
        rafId = requestAnimationFrame(frame);
      }
    }

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', sync);
    reduceMotion.addEventListener('change', sync);
    PH.setMatrixEnabled = (enabled) => {
      document.body.classList.toggle('no-matrix', !enabled);
      canvas.classList.toggle('hidden', !enabled);
      sync();
    };
    sync();
  }

  // ------------------------------------------------------------------
  // Toasts
  // ------------------------------------------------------------------
  const MAX_TOASTS = 3;
  let toastContainer = null;

  /**
   * PH.toast('Saved', { type: 'success' })
   * PH.toast('Deleted', { action: { label: 'Undo', onClick: fn } })
   */
  PH.toast = function toast(message, { type = 'info', duration = 3000, action = null } = {}) {
    if (!toastContainer) {
      toastContainer = PH.el('div', { id: 'toast-container', role: 'status', 'aria-live': 'polite' });
      document.body.append(toastContainer);
    }
    const live = PH.$$('.toast:not(.leaving)', toastContainer);
    if (live.some((t) => t.dataset.message === message)) {
      // Same message again (e.g. button mashing): shake instead of stacking.
      toastContainer.classList.remove('shake');
      void toastContainer.offsetWidth; // restart the animation
      toastContainer.classList.add('shake');
      return;
    }
    // Too many on screen: drop the oldest so the newest message is never lost.
    if (live.length >= MAX_TOASTS) live[0].dismiss();

    const node = PH.el('div', { className: `toast ${type}`, dataset: { message } }, PH.el('span', { text: message }));
    if (action) {
      node.append(
        PH.el('button', {
          type: 'button',
          className: 'toast-action',
          text: action.label,
          onClick: () => {
            action.onClick();
            dismiss();
          },
        }),
      );
    }
    toastContainer.append(node);
    requestAnimationFrame(() => node.classList.add('show'));

    let removed = false;
    function dismiss() {
      if (removed) return;
      removed = true;
      node.classList.add('leaving');
      node.classList.remove('show');
      setTimeout(() => node.remove(), 400);
    }
    node.dismiss = dismiss;
    setTimeout(dismiss, duration);
  };

  // ------------------------------------------------------------------
  // Escape-key stack (modals first, then the current screen's "back")
  // ------------------------------------------------------------------
  const escapeHandlers = [];
  PH.onEscape = function onEscape(handler) {
    escapeHandlers.push(handler);
    return () => {
      const index = escapeHandlers.lastIndexOf(handler);
      if (index !== -1) escapeHandlers.splice(index, 1);
    };
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || escapeHandlers.length === 0) return;
    event.preventDefault();
    escapeHandlers[escapeHandlers.length - 1](event);
  });

  // ------------------------------------------------------------------
  // Dialogs (confirm / prompt)
  // ------------------------------------------------------------------
  let dialogCounter = 0;

  /** @returns {Promise<{confirmed:boolean, value:string}>} */
  function openDialog({ title, message = '', input = null, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const cancelBtn = PH.el('button', { type: 'button', className: 'btn secondary', text: cancelLabel });
      const confirmBtn = PH.el('button', { type: 'button', className: `btn ${danger ? 'danger' : ''}`, text: confirmLabel });
      const titleId = `modal-title-${++dialogCounter}`;
      const field = input
        ? PH.el('input', {
            className: 'field modal-input',
            type: input.type || 'text',
            placeholder: input.placeholder || '',
            autocomplete: 'off',
            spellcheck: false,
            'aria-labelledby': titleId,
          })
        : null;
      const dialog = PH.el(
        'div',
        { className: 'modal', role: input ? 'dialog' : 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        PH.el('h2', { id: titleId, text: title }),
        message ? PH.el('p', { text: message }) : null,
        field,
        PH.el('div', { className: 'modal-actions' }, cancelBtn, confirmBtn),
      );
      const backdrop = PH.el('div', { className: 'modal-backdrop' }, dialog);

      let removeEscape = () => {};
      function close(confirmed) {
        removeEscape();
        backdrop.removeEventListener('keydown', onKeydown);
        backdrop.inert = true; // fading out: no more clicks or typing
        backdrop.classList.remove('show');
        setTimeout(() => backdrop.remove(), 200);
        const value = field ? field.value : '';
        if (field) field.value = '';
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        resolve({ confirmed, value });
      }
      function onKeydown(event) {
        if (event.key === 'Enter' && field && document.activeElement === field) {
          event.preventDefault();
          close(true);
          return;
        }
        if (event.key !== 'Tab') return;
        const focusables = [field, cancelBtn, confirmBtn].filter(Boolean);
        const index = focusables.indexOf(document.activeElement);
        event.preventDefault();
        focusables[(index + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length].focus();
      }

      cancelBtn.addEventListener('click', () => close(false));
      confirmBtn.addEventListener('click', () => close(true));
      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) close(false);
      });
      backdrop.addEventListener('keydown', onKeydown);
      removeEscape = PH.onEscape(() => close(false));

      document.body.append(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('show'));
      (field || (danger ? cancelBtn : confirmBtn)).focus();
    });
  }

  /** const ok = await PH.confirm({ title: 'Delete entry?', message: '…', confirmLabel: 'Delete', danger: true }); */
  PH.confirm = (options) => openDialog(options).then((result) => result.confirmed);

  /** const secret = await PH.prompt({ title, message, type: 'password' });  // null if cancelled */
  PH.prompt = ({ type = 'text', placeholder = '', ...options }) =>
    openDialog({ confirmLabel: 'OK', ...options, input: { type, placeholder } }).then((result) => (result.confirmed ? result.value : null));

  /** Toast for a clipboard copy made through window.api (shows when it will be wiped). */
  PH.copiedToast = function copiedToast(what, result) {
    const seconds = result && result.clearsInSeconds;
    PH.toast(seconds ? `${what} copied — clipboard clears in ${seconds} s.` : `${what} copied.`, { type: 'success' });
  };

  // ------------------------------------------------------------------
  // Screens (several "pages" inside one HTML file) and page transitions
  // ------------------------------------------------------------------
  PH.showScreen = function showScreen(id) {
    for (const screen of PH.$$('.screen')) screen.classList.toggle('active', screen.id === id);
    const target = document.getElementById(id);
    const focusTarget = target && (target.querySelector('[autofocus]') || target.querySelector('h1, h2'));
    if (focusTarget && !target.contains(document.activeElement)) {
      if (!focusTarget.hasAttribute('tabindex') && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(focusTarget.tagName)) {
        focusTarget.setAttribute('tabindex', '-1');
      }
      // Synchronous on purpose: focus() recalculates styles, so the newly
      // visible screen is already focusable — and a delayed focus could steal
      // the caret from a field the user has started typing in.
      focusTarget.focus({ preventScroll: true });
    }
  };

  /** Fade out, then load another page of the app. */
  PH.go = function go(url) {
    document.body.classList.remove('loaded');
    setTimeout(() => {
      window.location.href = url;
    }, 400);
  };

  // ------------------------------------------------------------------
  // Show / hide password buttons
  // ------------------------------------------------------------------
  /**
   * Wires a .reveal-btn to a password input. Returns { hide() } so pages can
   * force the field back to hidden (e.g. when leaving a screen).
   */
  PH.bindReveal = function bindReveal(button, input) {
    const icon = button.querySelector('img');
    function set(visible) {
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      button.title = visible ? 'Hide password' : 'Show password';
      if (icon) icon.src = visible ? 'icons/eye-slash.png' : 'icons/eye.png';
    }
    button.addEventListener('click', () => {
      const end = input.value.length;
      set(input.type === 'password');
      input.focus();
      input.setSelectionRange(end, end);
    });
    set(false);
    return { hide: () => set(false), show: () => set(true) };
  };

  /** Grows a textarea with its content. */
  PH.autoGrow = function autoGrow(textarea) {
    const fit = () => {
      textarea.style.height = 'auto';
      // scrollHeight excludes borders; add them back so no scrollbar appears.
      const borders = textarea.offsetHeight - textarea.clientHeight;
      textarea.style.height = `${textarea.scrollHeight + borders}px`;
    };
    textarea.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return fit;
  };

  /**
   * Animates an element's height across a DOM change:
   * PH.animateHeight(card, () => { …show/hide things… });
   */
  PH.animateHeight = function animateHeight(element, mutate) {
    const token = {};
    element.phHeightAnimation = token;
    const from = element.getBoundingClientRect().height;
    element.style.height = 'auto';
    mutate();
    const to = element.getBoundingClientRect().height;
    element.style.height = `${from}px`;
    void element.offsetHeight; // apply the start height before animating
    element.style.height = `${to}px`;
    const done = (event) => {
      if (event && (event.target !== element || event.propertyName !== 'height')) return;
      element.removeEventListener('transitionend', done);
      if (element.phHeightAnimation !== token) return; // a newer animation took over
      element.style.height = '';
    };
    element.addEventListener('transitionend', done);
    setTimeout(done, 700); // in case transitionend never fires (reduced motion, no change)
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
    showLoginOnStart: true,
  };

  function applySettings() {
    PH.setMatrixEnabled(PH.settings.matrixBackground !== false);
  }

  /** Saves a settings change; resolves with the validated settings. */
  PH.updateSettings = async function updateSettings(patch) {
    PH.settings = await api.settings.set(patch);
    applySettings();
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
    await PH.updateSettings(patch);
    for (const oldKey of Object.keys(legacyKeys)) PH.store.remove(oldKey);
  }

  /** Resolves once settings are loaded — pages start from PH.ready.then(…). */
  PH.ready = (async () => {
    try {
      PH.settings = await api.settings.get();
      await migrateLegacyPrefs();
    } catch (error) {
      console.error('Could not load settings:', error);
    }
    applySettings();
  })();

  // ------------------------------------------------------------------
  // Vault session helpers
  // ------------------------------------------------------------------
  /** Any keyboard/mouse activity postpones the vault's auto-lock (at most one ping per 15 s). */
  let lastActivityPing = 0;
  function activityPing() {
    const now = Date.now();
    if (now - lastActivityPing < 15000) return;
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

  /** Runs `handler(message, reason)` whenever the vault locks (auto-lock, sleep, other page…). */
  PH.onVaultLocked = function onVaultLocked(handler) {
    return api.vault.onLocked((reason) => handler(PH.lockMessage(reason), reason));
  };

  /** Turns a failed window.api call into a toast. */
  PH.showError = function showError(error, fallback = 'Something went wrong.') {
    PH.toast(`❗ ${(error && error.message) || fallback}`, { type: 'error', duration: 4000 });
  };

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  startMatrix();
  mountTitlebar();
  PH.ready.finally(() => requestAnimationFrame(() => document.body.classList.add('loaded')));
})();
