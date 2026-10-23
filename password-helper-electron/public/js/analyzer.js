/**
 * Password Analyzer screen (index.html).
 *
 * All results go through one `state` object and one render() function.
 * Async work (zxcvbn analysis, breach check, hashing) only updates `state`
 * if the input still holds the password it was started for — so a slow,
 * older response can never overwrite a newer one.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $ } = PH;
  const Policy = window.PHPolicy;

  const screen = $('#analyzer-screen');
  const advPanel = $('#advanced-panel');
  const masterToggle = $('#masterToggle');
  const input = $('#password');
  const charCount = $('#char-count');
  const meter = $('#strength-bar');
  const barMask = $('#bar-mask');
  const result = $('#result');
  const resultDetail = $('#result-detail');
  const reqLength = $('#req-length');
  const reqGuess = $('#req-guess');
  const reqBreach = $('#req-breach');
  const optBreach = $('#opt-breach');
  const optInsights = $('#opt-insights');
  const optHash = $('#opt-hash');
  const insightsBox = $('#insights');
  const hashOutput = $('#hash-output');
  const hashNote = $('#hash-note');

  const reveal = PH.bindReveal($('#togglePwd'), input);
  const analyzer = PH.Strength.createAnalyzer({ delay: 60 });
  const breachChecker = PH.Strength.createBreachChecker({ delay: 400 });

  const state = {
    password: '',
    analysis: null,
    analysisError: false,
    breach: { status: 'off' },
    hash: '',
  };

  // ------------------------------------------------------------------
  // Input → async work
  // ------------------------------------------------------------------
  function update() {
    const password = input.value;
    state.password = password;

    if (!password) {
      analyzer.cancel();
      breachChecker.cancel();
      state.analysis = null;
      state.analysisError = false;
      state.breach = { status: optBreach.checked ? 'idle' : 'off' };
      state.hash = '';
      render();
      return;
    }

    analyzer.run(password).then(({ stale, analysis, error }) => {
      if (stale || input.value !== password) return;
      state.analysis = analysis || null;
      state.analysisError = Boolean(error);
      render();
    });

    if (optBreach.checked) {
      state.breach = { status: 'checking' };
      breachChecker.check(password).then((outcome) => {
        if (outcome.stale || input.value !== password) return;
        state.breach = outcome;
        render();
      });
    } else {
      breachChecker.cancel();
      state.breach = { status: 'off' };
    }

    if (optHash.checked) {
      PH.Strength.sha256Hex(password).then((hex) => {
        if (input.value !== password) return;
        state.hash = hex;
        render();
      });
    } else {
      state.hash = '';
    }

    render();
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function setCheck(item, status, text) {
    item.classList.toggle('fulfilled', status === 'done');
    item.classList.toggle('failed', status === 'failed');
    item.classList.toggle('muted', status === 'muted');
    item.classList.toggle('pending', status === 'pending');
    item.textContent = text;
  }

  function renderChecks() {
    const { password, analysis, breach } = state;
    const count = Policy.charCount(password);
    const min = Policy.MIN_LENGTH;

    let lengthText = `At least ${min} characters`;
    if (password && count < min) lengthText += ` — ${min - count} to go`;
    setCheck(reqLength, count >= min ? 'done' : 'todo', lengthText);

    setCheck(
      reqGuess,
      analysis && analysis.score >= Policy.MIN_SCORE ? 'done' : 'todo',
      'Hard to guess — no common words, names or patterns',
    );

    const base = 'Not found in known data breaches';
    switch (breach.status) {
      case 'off':
        setCheck(reqBreach, 'muted', `${base} — turn on the breach check in Advanced Options`);
        break;
      case 'checking':
        setCheck(reqBreach, 'pending', `${base} — checking…`);
        break;
      case 'clean':
        setCheck(reqBreach, 'done', base);
        break;
      case 'breached':
        setCheck(reqBreach, 'failed', `Found in data breaches ${breach.count.toLocaleString()} times`);
        break;
      case 'error':
        setCheck(reqBreach, 'muted', `${base} — check unavailable (offline?)`);
        break;
      default:
        setCheck(reqBreach, 'todo', base);
    }
  }

  function renderInsights() {
    const show = optInsights.checked && state.password && state.analysis;
    insightsBox.classList.toggle('visible', Boolean(show));
    if (!show) {
      insightsBox.value = '';
      return;
    }
    const { feedback, matches } = state.analysis;
    const lines = [];
    if (feedback.warning) lines.push(`⚠ ${feedback.warning}`);
    if (feedback.suggestions.length) lines.push(`Suggestions: ${feedback.suggestions.join(' ')}`);
    const patterns = matches.map(Policy.describeMatch).filter(Boolean);
    if (patterns.length) lines.push('Patterns found:', ...patterns.map((p) => `  • ${p}`));
    if (state.analysis.truncated) lines.push('(Only the first 256 characters were analysed.)');
    insightsBox.value = lines.join('\n') || 'No common words or patterns detected.';
  }

  function renderHash() {
    const show = optHash.checked && Boolean(state.hash);
    hashOutput.classList.toggle('visible', show);
    hashNote.classList.toggle('hidden', !optHash.checked);
    hashOutput.value = show ? state.hash : '';
  }

  function render() {
    const { password, analysis, breach } = state;
    const count = Policy.charCount(password);

    charCount.textContent = password ? `${count} character${count === 1 ? '' : 's'}` : '';
    renderChecks();
    renderInsights();
    renderHash();

    if (!password) {
      barMask.style.width = '100%';
      meter.setAttribute('aria-valuenow', '0');
      result.textContent = '';
      result.classList.remove('danger');
      resultDetail.textContent = '';
      return;
    }

    if (!analysis) {
      result.textContent = state.analysisError ? 'Strength check failed — try again.' : 'Analysing…';
      return;
    }

    const breached = breach.status === 'breached';
    // A breached password is effectively zero-strength: attackers try those lists first.
    const score = breached ? 0 : analysis.score;
    barMask.style.width = `${100 - (score + 1) * 20}%`;
    meter.setAttribute('aria-valuenow', String(score));
    meter.setAttribute('aria-valuetext', breached ? 'Breached' : Policy.scoreLabel(score));

    const label = Policy.scoreLabel(analysis.score);
    const crackTime = analysis.crackTime.offlineSlowHashing;
    result.classList.toggle('danger', breached);
    if (breached) {
      result.textContent = `⚠️ Seen in data breaches ${breach.count.toLocaleString()} times — never use this password.`;
      resultDetail.textContent = `Pattern strength alone: ${label} (≈ ${crackTime} to crack offline).`;
    } else {
      result.textContent = `Strength: ${label} — ≈ ${crackTime} to crack offline`;
      resultDetail.textContent = analysis.feedback.warning || '';
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  input.addEventListener('input', update);

  masterToggle.addEventListener('change', () => {
    screen.classList.toggle('adv-open', masterToggle.checked);
    advPanel.classList.toggle('open', masterToggle.checked);
  });

  // Advanced toggles are remembered in Settings.
  const savePref = (key, value) => PH.updateSettings({ [key]: value }).catch(() => {});
  optBreach.addEventListener('change', () => {
    savePref('analyzerBreachCheck', optBreach.checked);
    update();
  });
  optInsights.addEventListener('change', () => {
    savePref('analyzerInsights', optInsights.checked);
    render();
  });
  optHash.addEventListener('change', () => {
    savePref('analyzerHash', optHash.checked);
    update();
  });

  /** Called by index.js when leaving the analyzer. */
  function leave({ clear }) {
    masterToggle.checked = false;
    screen.classList.remove('adv-open');
    advPanel.classList.remove('open');
    reveal.hide();
    if (clear) {
      input.value = '';
      update();
    }
  }

  /** Used by the generator's "Check it in the Analyzer" button. */
  function setPassword(value) {
    reveal.hide();
    input.value = value;
    update();
  }

  PH.Analyzer = { leave, setPassword, refresh: update };
  PH.ready.then(() => {
    optBreach.checked = PH.settings.analyzerBreachCheck === true;
    optInsights.checked = PH.settings.analyzerInsights === true;
    optHash.checked = PH.settings.analyzerHash === true;
    update();
  });
})();
