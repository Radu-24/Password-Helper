/**
 * Generator view. The algorithms live in generator.js (CSPRNG, rejection
 * sampling); options are remembered in Settings (settings.generator).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $ } = PH;
  const api = window.api;
  const Gen = window.PHGenerator;
  const wordlist = window.PHWordlist;

  const view = $('#view-generator');
  const output = $('#gen-output');
  // One inner line box, so the output can be centred without turning every character into a grid item.
  const outputText = PH.el('span');
  output.append(outputText);
  const meter = $('#gen-meter');
  const strengthText = $('#gen-strength-text');
  const passwordOptions = $('#gen-password-options');
  const passphraseOptions = $('#gen-passphrase-options');
  const lengthInput = $('#gen-length');
  const lengthValue = $('#gen-length-value');
  const wordsInput = $('#gen-words');
  const wordsValue = $('#gen-words-value');
  const separatorInput = PH.popupButton($('#gen-separator'));
  const refreshButton = $('#gen-refresh');
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
  const LEVELS = { 'Very Weak': 0, Weak: 1, Fair: 2, Strong: 3, 'Very Strong': 4 };

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
  let current = '';

  const mode = PH.segmented($('#gen-mode'), {
    onChange(value) {
      options.mode = value;
      writeControls();
      generate();
      persist();
    },
  });

  function writeControls() {
    mode.set(options.mode);
    passwordOptions.hidden = options.mode !== 'password';
    passphraseOptions.hidden = options.mode !== 'passphrase';
    lengthInput.value = String(Math.min(options.length, Number(lengthInput.max)));
    wordsInput.value = String(options.words);
    separatorInput.value = options.separator;
    separatorInput.refreshPopup();
    PH.syncSlider(lengthInput, lengthValue);
    PH.syncSlider(wordsInput, wordsValue);
    for (const [key, input] of Object.entries(toggles)) input.checked = Boolean(options[key]);
  }

  function readControls() {
    options = { ...options, length: Number(lengthInput.value), words: Number(wordsInput.value), separator: separatorInput.value };
    for (const [key, input] of Object.entries(toggles)) options[key] = input.checked;
  }

  /** Makes a new password with the current options and shows it with the decode effect. */
  function generate({ decode = true } = {}) {
    try {
      const passphrase = options.mode === 'passphrase';
      current = passphrase ? Gen.generatePassphrase(options, wordlist) : Gen.generatePassword(options);
      const bits = passphrase ? Gen.passphraseEntropy(options, wordlist.length) : Gen.passwordEntropy(options);
      const label = Gen.entropyLabel(bits);
      output.classList.toggle('is-passphrase', passphrase);
      output.classList.toggle('is-long', current.length > 44);
      PH.showSecret(outputText, current, { decode, separator: passphrase ? options.separator : null });
      PH.setMeter(meter, LEVELS[label]);
      strengthText.textContent = `${label.charAt(0)}${label.slice(1).toLowerCase()}, about ${Math.round(bits)} bits of entropy`;
    } catch (error) {
      current = '';
      outputText.textContent = '';
      PH.setMeter(meter, null);
      strengthText.textContent = error.message;
    }
    return current;
  }

  const persist = PH.debounce(() => PH.updateSettings({ generator: options }).catch(() => {}), 400);

  function onOptionsChanged(changedToggle) {
    readControls();
    if (CHARACTER_SETS.every((key) => !options[key])) {
      changedToggle.checked = true;
      readControls();
      PH.hud('Keep at least one kind of character.', { tone: 'warning' });
    }
    PH.syncSlider(lengthInput, lengthValue);
    PH.syncSlider(wordsInput, wordsValue);
    generate({ decode: false });
    persist();
  }

  for (const input of [lengthInput, wordsInput]) input.addEventListener('input', () => onOptionsChanged(input));
  // Sliders re-decode once released, so dragging stays calm.
  for (const input of [lengthInput, wordsInput]) input.addEventListener('change', () => generate());
  for (const input of [separatorInput, ...Object.values(toggles)]) input.addEventListener('change', () => onOptionsChanged(input));

  let turns = 0;
  function regenerate() {
    turns += 1;
    refreshButton.querySelector('i[data-icon]').style.transform = `rotate(${turns * 180}deg)`;
    generate();
  }
  refreshButton.addEventListener('click', regenerate);

  $('#gen-copy').addEventListener('click', async () => {
    if (!current) return;
    try {
      PH.copied(options.mode === 'passphrase' ? 'Passphrase' : 'Password', await api.clipboard.copy(current));
    } catch (error) {
      PH.showError(error);
    }
  });
  $('#gen-analyze').addEventListener('click', () => {
    if (!current) return;
    const value = current;
    PH.navigate('analyzer');
    PH.views.analyzer.setPassword(value);
  });
  $('#gen-save').addEventListener('click', () => {
    if (current) PH.navigate('items', { newItem: { password: current } });
  });

  PH.views = PH.views || {};
  PH.views.generator = {
    element: view,
    title: 'Generator',
    onShow() {
      writeControls();
      generate();
    },
    onHide() {
      current = '';
      outputText.replaceChildren(); // don't leave a secret on a hidden view
    },
    /** Same options as the Generator view — used by the item editor. */
    generateForField() {
      const value = options.mode === 'passphrase' ? Gen.generatePassphrase(options, wordlist) : Gen.generatePassword(options);
      return { value, separator: options.mode === 'passphrase' ? options.separator : null };
    },
  };

  PH.shortcut('mod+g', regenerate, { when: () => !view.hidden });

  PH.ready.then(() => {
    options = { ...options, ...(PH.settings.generator || {}) };
    writeControls();
  });
})();
