/**
 * index.html — main menu, settings and navigation between screens.
 * The analyzer lives in analyzer.js and the generator in generator-ui.js.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, $$ } = PH;
  const api = window.api;

  // ------------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------------
  let current = 'main-menu';

  function show(id) {
    if (current === id) return;
    if (current === 'analyzer-screen') PH.Analyzer.leave({ clear: PH.settings.clearAnalyzerOnBack !== false });
    if (current === 'generator-screen') PH.GeneratorUI.onHide();
    current = id;
    PH.showScreen(id);
    if (id === 'generator-screen') PH.GeneratorUI.onShow();
  }
  PH.navigate = show;

  for (const button of $$('[data-screen]')) {
    button.addEventListener('click', () => show(button.dataset.screen));
  }
  for (const button of $$('[data-page]')) {
    button.addEventListener('click', () => PH.go(button.dataset.page));
  }
  $('#analyzer-back').addEventListener('click', () => show('main-menu'));

  // Esc = back to the menu from any sub-screen.
  PH.onEscape(() => {
    if (current !== 'main-menu') show('main-menu');
  });

  // Ctrl+G = open the generator (or make a new password if it's already open).
  PH.onShortcut('g', () => {
    if (current === 'generator-screen') PH.GeneratorUI.onShow();
    else show('generator-screen');
  });
  // Ctrl+N / Ctrl+F jump into the vault.
  PH.onShortcut('n', () => PH.go('vault.html?screen=add'));
  PH.onShortcut('f', () => PH.go('vault_view.html'));

  // "Log out": lock the vault and return to the login screen.
  $('#logout').addEventListener('click', async () => {
    try {
      await api.vault.lock();
    } catch {
      // nothing to lock
    }
    PH.go('login.html');
  });

  // ------------------------------------------------------------------
  // Settings — every control with data-setting="<key>" is bound automatically
  // ------------------------------------------------------------------
  const controls = $$('[data-setting]');

  function fillControls() {
    for (const control of controls) {
      const value = PH.settings[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = value === true;
      else control.value = String(value);
    }
  }

  for (const control of controls) {
    control.addEventListener('change', async () => {
      const key = control.dataset.setting;
      let value = control.type === 'checkbox' ? control.checked : control.value;
      if (control.dataset.type === 'number') value = Number(value);
      try {
        await PH.updateSettings({ [key]: value });
        PH.toast('Setting saved.', { type: 'success', duration: 1500 });
      } catch (error) {
        PH.showError(error, 'Could not save the setting.');
      }
      fillControls(); // show what was actually stored
    });
  }

  $('#open-data-folder').addEventListener('click', () => api.app.openDataFolder().catch((error) => PH.showError(error)));

  PH.ready.then(async () => {
    fillControls();
    try {
      const info = await api.app.info();
      $('#about-text').textContent = `Password Helper ${info.version} · Electron ${info.electron} · data: ${info.dataPath}`;
    } catch {
      // About line is cosmetic
    }
  });
})();
