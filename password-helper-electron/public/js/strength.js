/**
 * Strength + breach helpers shared by the analyzer, the register form and the vault.
 *
 *  - PH.Strength.createAnalyzer()       latest-only wrapper around window.api.analyze
 *  - PH.Strength.createBreachChecker()  debounced, latest-only HIBP check
 *  - PH.Strength.sha1Hex / sha256Hex    Web Crypto helpers
 *
 * "Latest-only" means a slow, older result can never overwrite a newer one:
 * each call gets a sequence number and stale results resolve as { stale: true }.
 */
(function () {
  'use strict';

  const PH = window.PH;
  const Policy = window.PHPolicy;

  async function digestHex(algorithm, text) {
    const buffer = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const sha1Hex = async (text) => (await digestHex('SHA-1', text)).toUpperCase();
  const sha256Hex = (text) => digestHex('SHA-256', text);

  /**
   * const analyzer = PH.Strength.createAnalyzer({ delay: 60 });
   * const { stale, analysis, error } = await analyzer.run(password, [email]);
   */
  function createAnalyzer({ delay = 60 } = {}) {
    let seq = 0;
    let timer = null;
    let pending = null;

    function cancel() {
      seq++;
      clearTimeout(timer);
      if (pending) pending({ stale: true });
      pending = null;
    }

    function run(password, userInputs = []) {
      cancel();
      const mine = seq;
      return new Promise((resolve) => {
        pending = resolve;
        timer = setTimeout(async () => {
          pending = null;
          try {
            const analysis = await window.api.analyze(password, userInputs);
            resolve(mine === seq ? { analysis } : { stale: true });
          } catch (error) {
            resolve(mine === seq ? { error } : { stale: true });
          }
        }, delay);
      });
    }

    return { run, cancel };
  }

  /**
   * Debounced Pwned Passwords check. Resolves with one of:
   *   { status: 'clean' } | { status: 'breached', count } | { status: 'error', message } | { stale: true }
   */
  function createBreachChecker({ delay = 400 } = {}) {
    let seq = 0;
    let timer = null;
    let pending = null;

    function cancel() {
      seq++;
      clearTimeout(timer);
      if (pending) pending({ stale: true });
      pending = null;
    }

    function check(password) {
      cancel();
      const mine = seq;
      return new Promise((resolve) => {
        pending = resolve;
        timer = setTimeout(async () => {
          pending = null;
          try {
            const hash = await sha1Hex(password);
            const body = await window.api.hibpRange(hash.slice(0, 5));
            if (mine !== seq) return resolve({ stale: true });
            const count = Policy.parseRangeCount(body, hash.slice(5));
            resolve(count > 0 ? { status: 'breached', count } : { status: 'clean', count: 0 });
          } catch (error) {
            if (mine !== seq) return resolve({ stale: true });
            resolve({ status: 'error', message: String((error && error.message) || error) });
          }
        }, delay);
      });
    }

    return { check, cancel };
  }

  /**
   * Immediate (not debounced) analysis + breach check, e.g. right before a form
   * is submitted. Never rejects: failures come back as analysis=null / status 'error'.
   */
  async function checkNow(password, userInputs = []) {
    const analysisPromise = window.api.analyze(password, userInputs).catch(() => null);
    let breach;
    try {
      const hash = await sha1Hex(password);
      const body = await window.api.hibpRange(hash.slice(0, 5));
      const count = Policy.parseRangeCount(body, hash.slice(5));
      breach = count > 0 ? { status: 'breached', count } : { status: 'clean', count: 0 };
    } catch (error) {
      breach = { status: 'error', message: String((error && error.message) || error) };
    }
    return { analysis: await analysisPromise, breach };
  }

  /** First failing check of Policy.evaluateNewPassword(), as a sentence for a toast. */
  function describeFailure(evaluation, analysis) {
    const { checks } = evaluation;
    if (!checks.length.ok) {
      return checks.length.count > checks.length.max
        ? `Password must be at most ${checks.length.max} characters.`
        : `Password must be at least ${checks.length.min} characters (currently ${checks.length.count}).`;
    }
    if (!checks.guess.ok) {
      const why = analysis && analysis.feedback.warning ? ` ${analysis.feedback.warning}` : '';
      return `Password is too easy to guess.${why}`;
    }
    if (!checks.breach.ok) {
      return checks.breach.status === 'checking'
        ? 'Still checking known data breaches — try again in a moment.'
        : `This password appeared in data breaches ${checks.breach.count.toLocaleString()} times — choose another.`;
    }
    if (checks.match && !checks.match.ok) return 'Passwords do not match.';
    return null;
  }

  /**
   * Live checklist for a NEW password (register form, master password, …).
   *
   * Markup: an element with <li data-check="length|guess|breach|match">Base text</li>
   * items, and optionally a meter: <div class="mini-meter"><div class="mini-meter-mask"></div></div>.
   *
   * const checks = PH.Strength.createChecklist({ passwordInput, confirmInput, listEl, meterEl, userInputs: () => [email.value] });
   * const { ok, failure } = await checks.validateNow();   // before submitting
   */
  function createChecklist({ passwordInput, confirmInput = null, listEl, meterEl = null, userInputs = () => [], isActive = () => true }) {
    const analyzer = createAnalyzer({ delay: 80 });
    const breachChecker = createBreachChecker({ delay: 500 });
    const state = { analysis: null, breach: { status: 'idle' } };
    const items = {};
    for (const li of listEl.querySelectorAll('[data-check]')) {
      li.dataset.label = li.dataset.label || li.textContent.trim();
      items[li.dataset.check] = li;
    }
    const mask = meterEl && meterEl.querySelector('.mini-meter-mask');

    function setItem(name, status, text) {
      const li = items[name];
      if (!li) return;
      li.classList.toggle('ok', status === 'ok');
      li.classList.toggle('failed', status === 'failed');
      li.classList.toggle('muted', status === 'muted');
      li.textContent = text || li.dataset.label;
    }

    function render() {
      const value = passwordInput.value;
      const evaluation = Policy.evaluateNewPassword({
        password: value,
        analysis: state.analysis,
        breach: state.breach,
        confirm: confirmInput ? confirmInput.value : undefined,
      });
      const { length, guess, breach, match } = evaluation.checks;

      let lengthText = items.length && items.length.dataset.label;
      if (length.count > length.max) lengthText = `At most ${length.max} characters`;
      else if (value && !length.ok) lengthText += ` — ${length.min - length.count} to go`;
      setItem('length', length.ok ? 'ok' : '', lengthText);
      setItem('guess', guess.ok ? 'ok' : '');

      const base = items.breach && items.breach.dataset.label;
      if (!value || breach.status === 'idle') setItem('breach', '', base);
      else if (breach.status === 'checking') setItem('breach', 'muted', `${base} — checking…`);
      else if (breach.status === 'clean') setItem('breach', 'ok', base);
      else if (breach.status === 'breached') setItem('breach', 'failed', `Found in data breaches ${breach.count.toLocaleString()} times`);
      else setItem('breach', 'muted', `${base} — check unavailable (offline?)`);

      if (match) setItem('match', match.ok ? 'ok' : '');

      if (mask) {
        const breached = breach.status === 'breached';
        const score = !value || !state.analysis ? -1 : breached ? 0 : state.analysis.score;
        mask.style.width = `${100 - (score + 1) * 20}%`;
      }
      return evaluation;
    }

    function runAnalysis() {
      const value = passwordInput.value;
      if (!value) return;
      analyzer.run(value, userInputs()).then(({ stale, analysis }) => {
        if (stale || passwordInput.value !== value) return;
        state.analysis = analysis || null;
        render();
      });
    }

    function run() {
      const value = passwordInput.value;
      if (!value) {
        reset();
        return;
      }
      runAnalysis();
      state.breach = { status: 'checking' };
      breachChecker.check(value).then((outcome) => {
        if (outcome.stale || passwordInput.value !== value) return;
        state.breach = outcome;
        render();
      });
      render();
    }

    function reset() {
      analyzer.cancel();
      breachChecker.cancel();
      state.analysis = null;
      state.breach = { status: 'idle' };
      render();
    }

    /** Fresh, non-debounced checks — call right before submitting. */
    async function validateNow() {
      const value = passwordInput.value;
      analyzer.cancel();
      breachChecker.cancel();
      const { analysis, breach } = await checkNow(value, userInputs());
      if (passwordInput.value !== value) return { ok: false, stale: true };
      state.analysis = analysis;
      state.breach = breach;
      const evaluation = render();
      if (!analysis) return { ok: false, failure: 'Could not check password strength — try again.' };
      const failure = describeFailure(evaluation, analysis);
      return { ok: !failure, failure, breachUnavailable: breach.status === 'error' };
    }

    passwordInput.addEventListener('input', () => {
      if (!isActive()) return;
      state.analysis = null;
      run();
    });
    if (confirmInput) {
      confirmInput.addEventListener('input', () => {
        if (isActive()) render();
      });
    }
    render();

    return { render, run, reset, validateNow, refreshAnalysis: runAnalysis };
  }

  PH.Strength = { createAnalyzer, createBreachChecker, createChecklist, checkNow, describeFailure, sha1Hex, sha256Hex };
})();
