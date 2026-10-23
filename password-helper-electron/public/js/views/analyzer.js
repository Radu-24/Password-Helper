/**
 * Analyzer view: strength, time to crack, breach check, pattern insights,
 * SHA-256. Async results only apply if the field still holds the password
 * they were started for, so a slow, older answer never overwrites a newer one.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $, el, icon } = PH;
  const Policy = window.PHPolicy;

  const view = $('#view-analyzer');
  const hero = $('.an-hero', view);
  const input = $('#an-input');
  const clearButton = $('#an-clear');
  const meter = $('#an-meter');
  const verdictTitle = $('#an-verdict-title');
  const verdictDetail = $('#an-verdict-detail');
  const count = $('#an-count');
  const checkLength = $('#an-check-length');
  const checkGuess = $('#an-check-guess');
  const checkBreach = $('#an-check-breach');
  const times = $('#an-times');
  const insights = $('#an-insights');
  const insightsBody = $('#an-insights-body');
  const hashPlatter = $('#an-hash');
  const hashValue = $('#an-hash-value');
  const optBreach = $('#an-opt-breach');
  const optInsights = $('#an-opt-insights');
  const optHash = $('#an-opt-hash');

  const reveal = PH.bindReveal($('[data-reveal="an-input"]', view), input);
  const analyzer = PH.Strength.createAnalyzer({ delay: 60 });
  const breachChecker = PH.Strength.createBreachChecker({ delay: 400 });

  const state = { password: '', analysis: null, analysisError: false, breach: { status: 'off' }, hash: '' };

  // ------------------------------------------------------------------
  // Input → async work
  // ------------------------------------------------------------------
  function update() {
    const password = input.value;
    state.password = password;
    clearButton.hidden = !password;

    if (!password) {
      analyzer.cancel();
      breachChecker.cancel();
      Object.assign(state, { analysis: null, analysisError: false, hash: '', breach: { status: optBreach.checked ? 'idle' : 'off' } });
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
    item.dataset.status = status;
    const holder = $('.status-icon', item);
    const wanted = status === 'done' ? 'check' : status === 'failed' ? 'x' : null;
    if (wanted && (!holder.firstChild || holder.firstChild.dataset.icon !== wanted)) holder.replaceChildren(icon(wanted));
    $('.status-text', item).textContent = text;
  }

  /** "3 hours" → "About 3 hours to crack offline." */
  function crackSentence(display) {
    const text = PH.Strength.crackPhrase(display);
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} to crack offline.`;
  }

  function renderChecks() {
    const { password, analysis, breach } = state;
    const length = Policy.charCount(password);
    const min = Policy.MIN_LENGTH;
    setCheck(checkLength, length >= min ? 'done' : password ? 'failed' : 'todo', password && length < min ? `At least ${min} characters — ${min - length} to go` : `At least ${min} characters`);
    setCheck(
      checkGuess,
      analysis ? (analysis.score >= Policy.MIN_SCORE ? 'done' : 'failed') : 'todo',
      'Hard to guess — no common words, names or patterns',
    );
    const base = 'Not found in known data breaches';
    if (breach.status === 'off') setCheck(checkBreach, 'off', `${base} — check is off`);
    else if (breach.status === 'checking') setCheck(checkBreach, 'pending', `${base} — checking…`);
    else if (breach.status === 'clean') setCheck(checkBreach, 'done', base);
    else if (breach.status === 'breached') setCheck(checkBreach, 'failed', `Found in data breaches ${breach.count.toLocaleString()} times`);
    else if (breach.status === 'error') setCheck(checkBreach, 'muted', `${base} — couldn’t check (offline?)`);
    else setCheck(checkBreach, 'todo', base);
  }

  function renderInsights() {
    const show = optInsights.checked && state.password && state.analysis;
    insights.hidden = !show;
    if (!show) return;
    const { feedback, matches, truncated } = state.analysis;
    const nodes = [];
    if (feedback.warning) nodes.push(el('p', { className: 'insight-warning' }, icon('triangle-alert'), el('span', { text: feedback.warning })));
    const patterns = matches
      .map((match) => ({ match, text: Policy.describeMatch(match) }))
      .filter((item) => item.text);
    if (patterns.length) {
      nodes.push(
        el(
          'div',
          { className: 'pattern-list' },
          patterns.map(({ match, text }) =>
            el('div', { className: 'pattern' }, el('span', { className: 'pattern-token', text: match.token }), el('span', { className: 'pattern-what', text: text.replace(/^".*?" — /, '') })),
          ),
        ),
      );
    }
    if (feedback.suggestions.length) nodes.push(el('p', { className: 'insight-suggestions', text: feedback.suggestions.join(' ') }));
    if (truncated) nodes.push(el('p', { className: 'insight-suggestions', text: 'Only the first 256 characters were analysed.' }));
    if (!nodes.length) nodes.push(el('p', { className: 'insight-suggestions', text: 'No common words or patterns found.' }));
    insightsBody.replaceChildren(...nodes);
  }

  function renderHash() {
    hashPlatter.hidden = !(optHash.checked && state.password);
    hashValue.textContent = state.hash;
  }

  function render() {
    const { password, analysis, breach } = state;
    renderChecks();
    renderInsights();
    renderHash();

    const length = Policy.charCount(password);
    count.textContent = password ? PH.plural(length, 'character', 'characters') : '';

    if (!password) {
      hero.dataset.level = '';
      PH.setMeter(meter, null);
      verdictTitle.textContent = 'Nothing to check yet';
      verdictDetail.textContent = 'Everything is analysed on this computer — nothing you type here is saved.';
      times.hidden = true;
      return;
    }
    if (!analysis) {
      verdictTitle.textContent = state.analysisError ? 'Couldn’t check the strength' : 'Checking…';
      verdictDetail.textContent = state.analysisError ? 'Try typing again.' : '';
      return;
    }

    const breached = breach.status === 'breached';
    const level = breached ? 'breached' : analysis.score;
    hero.dataset.level = String(level);
    PH.setMeter(meter, level);
    meter.setAttribute('aria-valuetext', breached ? 'Breached' : Policy.scoreLabel(analysis.score));

    if (breached) {
      verdictTitle.textContent = 'Found in data breaches';
      verdictDetail.textContent = `Seen ${breach.count.toLocaleString()} times. Attackers try these first — don’t use this password.`;
    } else {
      verdictTitle.textContent = Policy.scoreLabel(analysis.score);
      verdictDetail.textContent = analysis.feedback.warning || crackSentence(analysis.crackTime.offlineSlowHashing);
    }

    times.hidden = false;
    $('#an-time-slow').textContent = analysis.crackTime.offlineSlowHashing;
    $('#an-time-fast').textContent = analysis.crackTime.offlineFastHashing;
    $('#an-time-online').textContent = analysis.crackTime.onlineUnthrottled;
    $('#an-time-throttled').textContent = analysis.crackTime.onlineThrottled;
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  input.addEventListener('input', update);
  clearButton.addEventListener('click', () => {
    input.value = '';
    update();
    input.focus();
  });

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
  $('#an-breach-on').addEventListener('click', () => {
    optBreach.checked = true;
    optBreach.dispatchEvent(new Event('change'));
  });
  $('#an-hash-copy').addEventListener('click', async () => {
    if (!state.hash) return;
    try {
      PH.copied('Hash', await window.api.clipboard.copy(state.hash));
    } catch (error) {
      PH.showError(error);
    }
  });

  PH.views = PH.views || {};
  PH.views.analyzer = {
    element: view,
    title: 'Analyzer',
    onShow() {
      input.focus({ preventScroll: true });
    },
    onHide() {
      reveal.hide();
      if (PH.settings.clearAnalyzerOnBack !== false) {
        input.value = '';
        update();
      }
    },
    /** Used by the generator's "Analyze" button. */
    setPassword(value) {
      reveal.hide();
      input.value = value;
      update();
    },
  };

  PH.ready.then(() => {
    optBreach.checked = PH.settings.analyzerBreachCheck === true;
    optInsights.checked = PH.settings.analyzerInsights === true;
    optHash.checked = PH.settings.analyzerHash === true;
    update();
  });
})();
