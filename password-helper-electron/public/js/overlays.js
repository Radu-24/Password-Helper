/**
 * Overlays: HUD notifications, alerts, sheets and menus.
 *
 *   PH.hud('Password copied', { tone: 'success' })
 *   await PH.confirm({ title: 'Delete “GitHub”?', message: '…', confirmLabel: 'Delete', destructive: true })
 *   PH.openSheet({ title, content, buttons, onSubmit })
 *   const choice = await PH.menu({ items, x, y })   // or { items, anchor }
 *
 * The scrim and the panel are siblings — fading a parent would cut the
 * panel's glass off from the window behind it.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { el, icon } = PH;

  const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

  function afterTransition(element, fallbackMs, callback) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      callback();
    };
    element.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, fallbackMs);
  }

  function trapFocus(container, event) {
    if (event.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!container.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  // ------------------------------------------------------------------
  // HUD notifications
  // ------------------------------------------------------------------
  const MAX_HUDS = 3;
  const TONE_ICONS = { success: 'circle-check', warning: 'triangle-alert', error: 'circle-alert', info: 'info' };
  let hudStack = null;

  /**
   * @param {string} message
   * @param {{tone?:'success'|'warning'|'error'|'info', icon?:string, duration?:number, action?:{label:string, onClick:Function}}} [options]
   */
  PH.hud = function hud(message, { tone = 'info', icon: iconName = null, duration = 2800, action = null } = {}) {
    if (!hudStack) {
      hudStack = el('div', { className: 'hud-stack', role: 'status', 'aria-live': 'polite' });
      document.body.append(hudStack);
    }
    const live = [...hudStack.querySelectorAll('.hud:not(.leaving)')];
    const twin = live.find((node) => node.dataset.message === message);
    if (twin) {
      // Same message again (button mashing): nudge it and keep it up longer.
      PH.replayClass(twin, 'nudge');
      twin.restartTimer();
      return twin;
    }
    if (live.length >= MAX_HUDS) live[0].dismiss();

    const node = el(
      'div',
      { className: `hud glass hud-${tone}${action ? ' has-action' : ''}`, dataset: { message } },
      icon(iconName || TONE_ICONS[tone] || 'info', { className: 'hud-icon' }),
      el('span', { className: 'hud-text', text: message }),
    );
    if (action) {
      node.append(
        el('button', {
          type: 'button',
          className: 'btn btn-small btn-tinted',
          text: action.label,
          onClick: () => {
            dismiss();
            action.onClick();
          },
        }),
      );
    }
    hudStack.append(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('show')));

    let timer = null;
    let removed = false;
    function dismiss() {
      if (removed) return;
      removed = true;
      clearTimeout(timer);
      node.classList.add('leaving');
      node.classList.remove('show');
      afterTransition(node, 400, () => node.remove());
    }
    node.restartTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(dismiss, duration);
    };
    node.dismiss = dismiss;
    node.addEventListener('mouseenter', () => clearTimeout(timer));
    node.addEventListener('mouseleave', () => node.restartTimer());
    node.restartTimer();
    return node;
  };

  // ------------------------------------------------------------------
  // Scrim + panel plumbing shared by alerts and sheets
  // ------------------------------------------------------------------
  /** Cancel functions of every open alert / sheet / menu (newest last). */
  const openLayers = new Set();

  /** Closes every alert, sheet and menu, and notifications with an action (e.g. when the vault locks). */
  PH.closeOverlays = function closeOverlays() {
    for (const cancel of [...openLayers].reverse()) cancel();
    if (hudStack) for (const node of hudStack.querySelectorAll('.hud.has-action')) node.dismiss();
  };

  function openLayer(panel, { onEscape, initialFocus }) {
    const previousFocus = document.activeElement;
    const scrim = el('div', { className: 'scrim' });
    document.body.append(scrim, panel);
    PH.modalDepth += 1;
    // Everything behind the panel stops reacting to keyboard and mouse.
    const app = document.getElementById('screen-app');
    const inertTargets = [...document.querySelectorAll('body > .screen')].filter((node) => !node.inert);
    for (const node of inertTargets) node.inert = true;

    const removeEscape = PH.onEscape(() => onEscape());
    const onKeydown = (event) => trapFocus(panel, event);
    panel.addEventListener('keydown', onKeydown);

    requestAnimationFrame(() => {
      scrim.classList.add('show');
      panel.classList.add('show');
    });
    if (initialFocus) initialFocus.focus();

    return function close() {
      removeEscape();
      panel.removeEventListener('keydown', onKeydown);
      panel.inert = true;
      scrim.classList.remove('show');
      panel.classList.add('leaving');
      panel.classList.remove('show');
      for (const node of inertTargets) node.inert = false;
      PH.modalDepth = Math.max(0, PH.modalDepth - 1);
      afterTransition(panel, 320, () => {
        scrim.remove();
        panel.remove();
      });
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      } else if (app) {
        app.focus?.();
      }
    };
  }

  // ------------------------------------------------------------------
  // Alerts
  // ------------------------------------------------------------------
  let alertCounter = 0;

  /**
   * const choice = await PH.alert({
   *   title, message, symbol: { icon: 'trash', tint: 'red' },     // or appIcon: true
   *   buttons: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Delete', value: true, style: 'destructive' }],
   * });
   */
  PH.alert = function alert({ title, message = '', symbol = null, appIcon = false, buttons }) {
    return new Promise((resolve) => {
      const id = ++alertCounter;
      const list = buttons && buttons.length ? buttons : [{ label: 'OK', value: true, style: 'primary' }];
      const cancel = list.find((button) => button.cancel) || list[0];
      let close = null;
      const finish = (value) => {
        if (!close) return;
        const doClose = close;
        close = null;
        doClose();
        resolve(value);
      };

      const buttonNodes = list.map((button) =>
        el('button', {
          type: 'button',
          className: `btn ${button.style === 'primary' ? 'btn-primary' : button.style === 'destructive' ? 'btn-destructive-solid' : 'btn-secondary'}`,
          text: button.label,
          onClick: () => finish(button.value),
        }),
      );
      const visual = appIcon
        ? el('img', { className: 'alert-icon', src: 'img/app-icon.svg', alt: '' })
        : symbol
          ? el('div', { className: 'alert-symbol', dataset: { tint: symbol.tint || 'blue' } }, icon(symbol.icon))
          : null;
      const panel = el(
        'div',
        {
          className: 'alert glass',
          role: 'alertdialog',
          'aria-modal': 'true',
          'aria-labelledby': `alert-title-${id}`,
          'aria-describedby': message ? `alert-text-${id}` : undefined,
        },
        visual,
        el('h2', { id: `alert-title-${id}`, text: title }),
        message ? el('p', { id: `alert-text-${id}`, text: message }) : null,
        el('div', { className: `alert-buttons${list.length > 2 ? ' stacked' : ''}` }, buttonNodes),
      );
      // Destructive questions start on Cancel, so Return can't delete by accident.
      const destructive = list.some((button) => button.style === 'destructive');
      const defaultIndex = destructive ? list.indexOf(cancel) : list.findIndex((button) => button.style === 'primary');
      const cancelLayer = () => finish(cancel.value);
      const doClose = openLayer(panel, {
        onEscape: cancelLayer,
        initialFocus: buttonNodes[defaultIndex >= 0 ? defaultIndex : buttonNodes.length - 1],
      });
      openLayers.add(cancelLayer);
      close = () => {
        openLayers.delete(cancelLayer);
        doClose();
      };
    });
  };

  /** Yes/no question. Resolves true when confirmed. */
  PH.confirm = function confirm({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false, symbol = null }) {
    return PH.alert({
      title,
      message,
      symbol: symbol || (destructive ? { icon: 'trash', tint: 'red' } : null),
      appIcon: !symbol && !destructive,
      buttons: [
        { label: cancelLabel, value: false, cancel: true },
        { label: confirmLabel, value: true, style: destructive ? 'destructive' : 'primary' },
      ],
    });
  };

  // ------------------------------------------------------------------
  // Sheets
  // ------------------------------------------------------------------
  /**
   * PH.openSheet({
   *   title, subtitle, symbol: { icon, tint }, width,
   *   content: Node,                       // goes inside a <form>, so Return submits
   *   buttons: [{ label: 'Cancel', role: 'cancel' }, { label: 'Save', role: 'primary' }],
   *   onSubmit: async (sheet) => true,     // return false (or throw) to keep it open
   *   onClose: () => {},
   *   initialFocus: Node,
   * }) → { close(), element, primary, setPrimaryEnabled(bool) }
   */
  PH.openSheet = function openSheet({ title, subtitle = '', symbol = null, width = 460, content, buttons, onSubmit, onClose, initialFocus, leftButton = null }) {
    const id = ++alertCounter;
    const list = buttons || [{ label: 'Cancel', role: 'cancel' }, { label: 'Done', role: 'primary' }];
    let busy = false;
    let closed = false;

    const form = el('form', { className: 'sheet glass', novalidate: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `sheet-title-${id}` });
    form.style.setProperty('--sheet-w', `${width}px`);
    const header = el(
      'header',
      { className: 'sheet-header' },
      symbol ? el('span', { className: 'sheet-symbol', dataset: { tint: symbol.tint || 'blue' } }, icon(symbol.icon)) : null,
      el('div', {}, el('h2', { id: `sheet-title-${id}`, text: title }), subtitle ? el('p', { text: subtitle }) : null),
    );
    const body = el('div', { className: 'sheet-body' }, content);
    const footer = el('footer', { className: 'sheet-footer' });
    if (leftButton) footer.append(leftButton, el('span', { className: 'spacer' }));
    let primary = null;
    for (const button of list) {
      const node = el('button', {
        type: button.role === 'primary' ? 'submit' : 'button',
        className: `btn ${button.role === 'primary' ? 'btn-primary' : button.role === 'destructive' ? 'btn-destructive-solid' : 'btn-secondary'}`,
        text: button.label,
      });
      if (button.role === 'primary' || button.role === 'destructive') primary = node;
      if (button.role === 'cancel') node.addEventListener('click', () => controller.close());
      else if (button.onClick) node.addEventListener('click', () => button.onClick(controller));
      footer.append(node);
    }
    form.append(header, body, footer);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !primary || primary.disabled) return;
      if (!onSubmit) {
        controller.close();
        return;
      }
      busy = true;
      primary.classList.add('is-busy');
      let shouldClose = false;
      try {
        shouldClose = (await onSubmit(controller)) !== false;
      } catch (error) {
        PH.showError(error);
      } finally {
        busy = false;
        primary.classList.remove('is-busy');
      }
      if (shouldClose) controller.close();
    });

    const closeLayer = openLayer(form, {
      onEscape: () => {
        if (!busy) controller.close();
      },
      initialFocus: initialFocus || form.querySelector('input, textarea, select') || primary,
    });

    const controller = {
      element: form,
      body,
      primary,
      setPrimaryEnabled(enabled) {
        if (primary) primary.disabled = !enabled;
      },
      close() {
        if (closed) return;
        closed = true;
        openLayers.delete(controller.close);
        closeLayer();
        if (onClose) onClose();
      },
    };
    openLayers.add(controller.close);
    return controller;
  };

  // ------------------------------------------------------------------
  // Menus
  // ------------------------------------------------------------------
  let openMenu = null;

  /**
   * const id = await PH.menu({ items, x, y })            // context menu at a point
   * const id = await PH.menu({ items, anchor: button })  // below a button
   * Items: { id, label, icon, shortcut, checked, destructive, disabled } | { separator: true } | { heading }
   * Resolves with the chosen item's id, or null.
   */
  PH.menu = function menu({ items, x = 0, y = 0, anchor = null, minWidth = 0, align = 'start' }) {
    if (openMenu) openMenu(null);
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const hasChecks = items.some((item) => item.checked !== undefined);
      const panel = el('div', { className: 'menu glass', role: 'menu', tabindex: '-1' });
      if (minWidth) panel.style.minWidth = `${minWidth}px`;
      const buttons = [];
      for (const item of items) {
        if (item.separator) {
          panel.append(el('div', { className: 'menu-separator', role: 'separator' }));
          continue;
        }
        if (item.heading) {
          panel.append(el('div', { className: 'menu-heading', text: item.heading }));
          continue;
        }
        const node = el(
          'button',
          {
            type: 'button',
            className: `menu-item${item.destructive ? ' destructive' : ''}`,
            role: hasChecks ? 'menuitemradio' : 'menuitem',
            'aria-checked': hasChecks ? String(Boolean(item.checked)) : undefined,
            tabindex: '-1',
            disabled: item.disabled,
          },
          hasChecks ? el('span', { className: 'menu-check' }, item.checked ? icon('check') : null) : null,
          item.icon ? icon(item.icon) : null,
          el('span', { className: 'menu-label', text: item.label }),
          item.shortcut ? el('span', { className: 'menu-shortcut', text: PH.keyLabel(item.shortcut) }) : null,
        );
        node.addEventListener('click', () => close(item.id));
        node.addEventListener('mousemove', () => {
          if (document.activeElement !== node && !node.disabled) node.focus({ preventScroll: true });
        });
        node.addEventListener('mouseleave', () => {
          if (document.activeElement === node) panel.focus({ preventScroll: true });
        });
        buttons.push(node);
        panel.append(node);
      }
      document.body.append(panel);
      PH.modalDepth += 1;

      // Position: at the point, or under the anchor; flipped to stay on screen.
      const rect = panel.getBoundingClientRect();
      let left = x;
      let top = y;
      if (anchor) {
        const a = anchor.getBoundingClientRect();
        left = align === 'end' ? a.right - rect.width : a.left;
        top = a.bottom + 5;
        if (top + rect.height > window.innerHeight - 8) top = a.top - rect.height - 5;
        panel.style.setProperty('--origin', `${align === 'end' ? 'top right' : 'top left'}`);
      } else {
        if (left + rect.width > window.innerWidth - 8) left = Math.max(8, x - rect.width);
        if (top + rect.height > window.innerHeight - 8) top = Math.max(8, y - rect.height);
      }
      panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
      panel.style.top = `${Math.max(8, top)}px`;
      requestAnimationFrame(() => panel.classList.add('show'));
      panel.focus({ preventScroll: true });

      const enabled = () => buttons.filter((node) => !node.disabled);
      function move(step) {
        const list = enabled();
        if (!list.length) return;
        const index = list.indexOf(document.activeElement);
        const next = index === -1 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length;
        list[next].focus({ preventScroll: false });
      }
      function onKeydown(event) {
        if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Home') enabled()[0]?.focus();
        else if (event.key === 'End') enabled().at(-1)?.focus();
        else if (event.key === 'Tab') close(null);
        else return;
        event.preventDefault();
      }
      function onPointerDown(event) {
        if (!panel.contains(event.target)) close(null, { keepFocus: anchor && anchor.contains(event.target) });
      }
      const onBlur = () => close(null);
      const removeEscape = PH.onEscape(() => close(null));

      panel.addEventListener('keydown', onKeydown);
      setTimeout(() => {
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('blur', onBlur);
        window.addEventListener('resize', onBlur);
      });

      let closed = false;
      const cancelMenu = () => close(null);
      openLayers.add(cancelMenu);
      function close(value, { keepFocus = false } = {}) {
        if (closed) return;
        closed = true;
        openLayers.delete(cancelMenu);
        openMenu = null;
        removeEscape();
        document.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('resize', onBlur);
        PH.modalDepth = Math.max(0, PH.modalDepth - 1);
        panel.inert = true;
        panel.classList.add('leaving');
        panel.classList.remove('show');
        afterTransition(panel, 220, () => panel.remove());
        if (!keepFocus && previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
        resolve(value);
      }
      openMenu = close;
    });
  };

  /** Right-click menu helper: PH.contextMenu(event, items).then(id => …) */
  PH.contextMenu = function contextMenu(event, items) {
    event.preventDefault();
    return PH.menu({ items, x: event.clientX, y: event.clientY });
  };
})();
