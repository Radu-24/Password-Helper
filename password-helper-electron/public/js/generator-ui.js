/**
 * Password Generator screen (index.html). The algorithms live in generator.js.
 * Options are remembered in Settings (settings.generator).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, $$ } = PH;
  const api = window.api;
  const Gen = window.PHGenerator;
  const wordlist = window.PHWordlist;

  const output = $('#gen-output');
  const strength = $('#gen-strength');
  const segments = $$('.segment');
  const passwordOptions = $('#gen-password-options');
  const passphraseOptions = $('#gen-passphrase-options');
  const lengthInput = $('#gen-length');
  const lengthValue = $('#gen-length-value');
  const wordsInput = $('#gen-words');
  const wordsValue = $('#gen-words-value');
  const separatorInput = $('#gen-separator');
  const toggles = {
    lowercase: $('#gen-lowercase'),
    uppercase: $('#gen-uppercase'),
    digits: $('#gen-digits'),
    symbols: $('#gen-symbols'),
    avoidAmbiguous: $('#gen-ambiguous'),
    capitalize: $('#gen-capitalize'),
    addNumber: $('#gen-number'),
  };
  const CHARACTER_SETS = ['lowercase', 'uppercase', 'digits', 'symbols'];

  let options = {
    mode: 'password',
    length: 20,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    avoidAmbiguous: false,
    words: 6,
    separator: '-',
    capitalize: true,
    addNumber: false,
  };

  function writeControls() {
    for (const segment of segments) segment.setAttribute('aria-checked', String(segment.dataset.mode === options.mode));
    passwordOptions.classList.toggle('hidden', options.mode !== 'password');
    passphraseOptions.classList.toggle('hidden', options.mode !== 'passphrase');
    lengthInput.value = String(Math.min(options.length, Number(lengthInput.max)));
    lengthValue.textContent = lengthInput.value;
    wordsInput.value = String(options.words);
    wordsValue.textContent = wordsInput.value;
    separatorInput.value = options.separator;
    for (const [key, input] of Object.entries(toggles)) input.checked = Boolean(options[key]);
  }

  function readControls() {
    options = {
      ...options,
      length: Number(lengthInput.value),
      words: Number(wordsInput.value),
      separator: separatorInput.value,
    };
    for (const [key, input] of Object.entries(toggles)) options[key] = input.checked;
  }

  /** Builds a password with the current options; returns it (or '' on error). */
  function generate() {
    try {
      const value =
        options.mode === 'passphrase' ? Gen.generatePassphrase(options, wordlist) : Gen.generatePassword(options);
      const bits =
        options.mode === 'passphrase' ? Gen.passphraseEntropy(options, wordlist.length) : Gen.passwordEntropy(options);
      output.textContent = value;
      strength.textContent = `≈ ${Math.round(bits)} bits of entropy — ${Gen.entropyLabel(bits)} · ${PH.charLabel(value)}`;
      return value;
    } catch (error) {
      output.textContent = '';
      strength.textContent = error.message;
      return '';
    }
  }

  const persist = PH.debounce(() => {
    PH.updateSettings({ generator: options }).catch(() => {});
  }, 400);

  function onOptionsChanged(changedToggle) {
    readControls();
    // Keep at least one character type switched on.
    if (CHARACTER_SETS.every((key) => !options[key])) {
      changedToggle.checked = true;
      readControls();
      PH.toast('Keep at least one character type.', { type: 'warning' });
    }
    lengthValue.textContent = lengthInput.value;
    wordsValue.textContent = wordsInput.value;
    generate();
    persist();
  }

  for (const input of [lengthInput, wordsInput]) input.addEventListener('input', () => onOptionsChanged(input));
  for (const input of [separatorInput, ...Object.values(toggles)]) input.addEventListener('change', () => onOptionsChanged(input));
  for (const segment of segments) {
    segment.addEventListener('click', () => {
      options.mode = segment.dataset.mode;
      writeControls();
      generate();
      persist();
    });
  }

  $('#gen-refresh').addEventListener('click', generate);
  $('#gen-copy').addEventListener('click', async () => {
    const value = output.textContent;
    if (!value) return;
    try {
      PH.copiedToast(options.mode === 'passphrase' ? 'Passphrase' : 'Password', await api.clipboard.copy(value));
    } catch (error) {
      PH.showError(error);
    }
  });
  $('#gen-analyze').addEventListener('click', () => {
    const value = output.textContent;
    if (!value) return;
    PH.navigate('analyzer-screen');
    PH.Analyzer.setPassword(value);
  });

  PH.GeneratorUI = {
    /** Called by index.js when the screen opens / closes. */
    onShow: generate,
    onHide: () => {
      output.textContent = ''; // don't leave a secret on a hidden screen
    },
    isActive: () => $('#generator-screen').classList.contains('active'),
  };

  PH.ready.then(() => {
    options = { ...options, ...(PH.settings.generator || {}) };
    writeControls();
  });
})();
