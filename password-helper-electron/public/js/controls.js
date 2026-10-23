/**
 * Controls: segmented controls, pop-up buttons, reveal buttons, sliders,
 * strength meters, countdown rings, and the "decode" effect for secrets.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { el, icon } = PH;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------------
  // Segmented control with a sliding thumb
  // ------------------------------------------------------------------
  /**
   * PH.segmented(container, { onChange(value) }) → { set(value), get() }
   * Markup: .segmented > button.segment[role=radio][data-value]
   */
  PH.segmented = function segmented(container, { onChange = () => {} } = {}) {
    const segments = [...container.querySelectorAll('.segment')];
    const thumb = el('span', { className: 'segmented-thumb', 'aria-hidden': 'true' });
    container.prepend(thumb);
    let value = (segments.find((s) => s.getAttribute('aria-checked') === 'true') || segments[0]).dataset.value;

    function place(animate) {
      const active = segments.find((s) => s.dataset.value === value);
      if (!active || !active.offsetWidth) return;
      if (!animate) thumb.style.transition = 'none';
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.transform = `translateX(${active.offsetLeft}px)`;
      if (!animate) {
        void thumb.offsetWidth;
        thumb.style.transition = '';
      }
    }
    function set(next, { emit = false, animate = true } = {}) {
      if (!segments.some((s) => s.dataset.value === next)) return;
      const changed = next !== value;
      value = next;
      for (const segment of segments) {
        const on = segment.dataset.value === value;
        segment.setAttribute('aria-checked', String(on));
        segment.tabIndex = on ? 0 : -1;
      }
      place(animate);
      if (emit && changed) onChange(value);
    }
    for (const segment of segments) {
      segment.addEventListener('click', () => set(segment.dataset.value, { emit: true }));
    }
    container.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const index = segments.findIndex((s) => s.dataset.value === value);
      const next = segments[(index + (event.key === 'ArrowRight' ? 1 : -1) + segments.length) % segments.length];
      set(next.dataset.value, { emit: true });
      next.focus();
    });
    // Size depends on fonts and on the view being visible.
    new ResizeObserver(() => place(false)).observe(container);
    set(value, { animate: false });
    return { set: (next) => set(next, { animate: true }), get: () => value };
  };

  // ------------------------------------------------------------------
  // Pop-up button (macOS NSPopUpButton) on top of a hidden <select>
  // ------------------------------------------------------------------
  /**
   * Replaces a <select class="popup"> with a button that opens a menu.
   * The select stays the source of truth: listen to its 'change' event,
   * and call select.refreshPopup() after setting .value from code.
   */
  PH.popupButton = function popupButton(select) {
    if (select.refreshPopup) return select;
    const label = el('span', { className: 'popup-label' });
    const button = el(
      'button',
      {
        type: 'button',
        className: `popup-button${select.classList.contains('popup-plain') ? ' plain' : ''}`,
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
      },
      label,
      icon('chevrons-up-down'),
    );
    if (select.id) {
      const labelFor = document.querySelector(`label[for="${select.id}"]`);
      if (labelFor) {
        if (!labelFor.id) labelFor.id = `${select.id}-label`;
        button.setAttribute('aria-labelledby', `${labelFor.id} ${select.id}-button`);
        label.id = `${select.id}-button`;
        labelFor.addEventListener('click', (event) => {
          event.preventDefault();
          button.focus();
        });
      }
    }
    select.after(button);

    function refresh() {
      const option = select.options[select.selectedIndex];
      label.textContent = option ? option.textContent : '';
      button.disabled = select.disabled;
    }
    async function open() {
      button.setAttribute('aria-expanded', 'true');
      const items = [...select.options].map((option) => ({ id: option.value, label: option.textContent, checked: option.selected }));
      const choice = await PH.menu({ items, anchor: button, minWidth: button.offsetWidth });
      button.setAttribute('aria-expanded', 'false');
      if (choice === null || choice === select.value) return;
      select.value = choice;
      refresh();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    button.addEventListener('click', open);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open();
      }
    });
    select.refreshPopup = refresh;
    select.popupButton = button;
    refresh();
    return select;
  };

  // ------------------------------------------------------------------
  // Show / hide password buttons
  // ------------------------------------------------------------------
  /**
   * Wires a reveal button to an input. Returns { hide(), show(), visible() }.
   * Hidden again automatically after `autoHideSeconds` (if set).
   */
  PH.bindReveal = function bindReveal(button, input, { autoHideSeconds = 0 } = {}) {
    let timer = null;
    const holder = button.querySelector('i[data-icon]');
    function set(visible) {
      clearTimeout(timer);
      input.type = visible ? 'text' : 'password';
      input.classList.toggle('is-secret', visible);
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      button.title = visible ? 'Hide password' : 'Show password';
      if (holder) PH.setIcon(holder, visible ? 'eye-off' : 'eye');
      if (visible && autoHideSeconds) timer = setTimeout(() => set(false), autoHideSeconds * 1000);
    }
    button.addEventListener('click', () => {
      const end = input.value.length;
      set(input.type === 'password');
      input.focus();
      try {
        input.setSelectionRange(end, end);
      } catch {
        // some input types don't support selection
      }
    });
    set(false);
    return { hide: () => set(false), show: () => set(true), visible: () => input.type === 'text' };
  };

  /** Wires every [data-reveal="<input id>"] button under `scope`; returns { id: controller }. */
  PH.bindRevealButtons = function bindRevealButtons(scope = document) {
    const controllers = {};
    for (const button of scope.querySelectorAll('[data-reveal]')) {
      const input = document.getElementById(button.dataset.reveal);
      if (input) controllers[input.id] = PH.bindReveal(button, input);
    }
    return controllers;
  };

  // ------------------------------------------------------------------
  // Sliders: accent-coloured fill up to the thumb
  // ------------------------------------------------------------------
  PH.syncSlider = function syncSlider(input, output = null) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const percent = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${percent}%`);
    if (output) output.textContent = input.value;
  };

  // ------------------------------------------------------------------
  // Strength meter: level 0–4, 'breached', or null (empty)
  // ------------------------------------------------------------------
  PH.setMeter = function setMeter(meter, level) {
    if (!meter) return;
    const segments = [...meter.children];
    const lit = level === null || level === undefined ? 0 : level === 'breached' ? 1 : Number(level) + 1;
    meter.dataset.level = level === null || level === undefined ? '' : String(level);
    segments.forEach((segment, index) => segment.classList.toggle('on', index < lit));
    if (meter.hasAttribute('aria-valuenow')) meter.setAttribute('aria-valuenow', String(level === 'breached' ? 0 : Math.max(0, lit - 1)));
  };

  // ------------------------------------------------------------------
  // Countdown ring for verification codes
  // ------------------------------------------------------------------
  /** PH.ring() → element with .update(remainingSeconds, periodSeconds) */
  PH.ring = function ring({ showSeconds = false } = {}) {
    const node = el('span', { className: 'ring', 'aria-hidden': 'true' });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    for (const cls of ['ring-track', 'ring-bar']) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '9.5');
      circle.setAttribute('pathLength', '100');
      circle.setAttribute('class', cls);
      svg.append(circle);
    }
    node.append(svg);
    const seconds = showSeconds ? el('span', { className: 'ring-seconds' }) : null;
    if (seconds) node.append(seconds);
    node.update = (remaining, period) => {
      node.style.setProperty('--progress', String(Math.max(0, Math.min(1, remaining / period))));
      node.classList.toggle('is-ending', remaining <= 5);
      if (seconds) seconds.textContent = String(Math.ceil(remaining));
    };
    return node;
  };

  // ------------------------------------------------------------------
  // Secrets: coloured digits / symbols, and the matrix "decode" effect
  // ------------------------------------------------------------------
  const SCRAMBLE = 'アイウエオカキクケコサシスセソ0123456789ABCDEFGHJKLMNPQRSTUVWXYZ#$%&*+=?@';
  const classFor = (char) => (/\p{Nd}/u.test(char) ? 'd' : /[\p{L}\p{M}\s]/u.test(char) ? '' : 's');

  function charSpan(char, extra = '') {
    const span = document.createElement('span');
    const cls = [classFor(char), extra].filter(Boolean).join(' ');
    if (cls) span.className = cls;
    span.textContent = char;
    return span;
  }

  /**
   * Shows `text` in `target` with coloured digits and symbols.
   * Options: decode (play the scramble effect), separator (dims passphrase separators).
   */
  PH.showSecret = function showSecret(target, text, { decode = false, separator = null } = {}) {
    const token = {};
    target.phDecode = token;
    const chars = Array.from(text || '');
    const isSep = (char) => separator !== null && separator !== '' && char === separator;
    const finalSpan = (char) => (isSep(char) ? charSpan(char, 'w-sep') : charSpan(char));
    const draw = () => target.replaceChildren(...chars.map(finalSpan));

    if (!decode || PH.reducedMotion() || chars.length === 0) {
      draw();
      return Promise.resolve();
    }

    const duration = Math.min(560, 260 + chars.length * 9);
    const settleAt = chars.map((_, i) => (i / chars.length) * duration * 0.75 + Math.random() * duration * 0.25);
    const randomGlyph = () => SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
    // Start scrambled, so the real value never flashes before the effect begins.
    const scrambled = () => {
      const span = document.createElement('span');
      span.className = 'scramble';
      span.textContent = randomGlyph();
      return span;
    };
    const spans = chars.map((char) => (/\s/.test(char) ? charSpan(char) : scrambled()));
    target.replaceChildren(...spans);
    const start = performance.now();
    let lastSwap = 0;

    return new Promise((resolve) => {
      function frame(now) {
        if (target.phDecode !== token) return resolve();
        const elapsed = now - start;
        const swap = now - lastSwap > 45; // new random glyphs ~22×/s
        if (swap) lastSwap = now;
        let pending = 0;
        spans.forEach((span, i) => {
          if (elapsed >= settleAt[i]) {
            if (!span.dataset.done) {
              span.dataset.done = '1';
              const done = finalSpan(chars[i]);
              span.className = done.className;
              span.textContent = chars[i];
            }
          } else {
            pending += 1;
            if (swap && !/\s/.test(chars[i])) {
              span.className = 'scramble';
              span.textContent = randomGlyph();
            }
          }
        });
        if (pending > 0) requestAnimationFrame(frame);
        else {
          draw(); // clean final DOM
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  };

  // ------------------------------------------------------------------
  // Text areas that grow with their content
  // ------------------------------------------------------------------
  PH.autoGrow = function autoGrow(textarea) {
    const fit = () => {
      textarea.style.height = 'auto';
      const borders = textarea.offsetHeight - textarea.clientHeight;
      textarea.style.height = `${textarea.scrollHeight + borders}px`;
    };
    textarea.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return fit;
  };

  // ------------------------------------------------------------------
  // Busy state for buttons
  // ------------------------------------------------------------------
  /** Runs `task` with the button showing a spinner; errors become notifications. */
  PH.withBusy = async function withBusy(button, task) {
    if (!button || button.classList.contains('is-busy')) return undefined;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    try {
      return await task();
    } catch (error) {
      PH.showError(error);
      return undefined;
    } finally {
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
    }
  };
})();
