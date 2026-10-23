/**
 * Welcome screen (first launch) and the sign-in screen.
 *
 * The account server isn't online yet, so PH.Auth (auth.js) is a stub: the
 * forms are fully validated, then the user continues without an account.
 * Creating an account uses the same password rules as the vault (policy.js).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $ } = PH;

  /** Fades a glass card out (the card itself — never a parent of glass). */
  function leave(card) {
    if (PH.reducedMotion()) return Promise.resolve();
    return card.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.97)' },
      ],
      { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    ).finished.catch(() => {});
  }

  // ------------------------------------------------------------------
  // Welcome
  // ------------------------------------------------------------------
  function showWelcome() {
    return new Promise((resolve) => {
      const screen = $('#screen-welcome');
      const card = $('.welcome-card', screen);
      const button = $('#welcome-continue');
      card.getAnimations().forEach((animation) => animation.cancel());
      PH.showScreen('screen-welcome');
      if (!PH.reducedMotion()) {
        card.animate(
          [
            { opacity: 0, transform: 'translateY(18px) scale(0.97)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 700, easing: PH.spring('snappy').easing, fill: 'backwards' },
        );
        const features = screen.querySelectorAll('.feature, .welcome-continue');
        features.forEach((node, index) =>
          node.animate(
            [
              { opacity: 0, transform: 'translateY(10px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 500, delay: 260 + index * 70, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
          ),
        );
      }
      button.focus();
      button.addEventListener(
        'click',
        async () => {
          PH.updateSettings({ onboarded: true }).catch(() => {});
          await leave(card);
          resolve();
        },
        { once: true },
      );
    });
  }

  // ------------------------------------------------------------------
  // Sign in / create account
  // ------------------------------------------------------------------
  const card = $('#signin-card');
  const form = $('#signin-form');
  const email = $('#signin-email');
  const password = $('#signin-password');
  const confirmInput = $('#signin-confirm');
  const confirmRow = $('#signin-confirm-row');
  const checksWrap = $('#signin-checks-wrap');
  const submit = $('#signin-submit');
  const toggle = $('#signin-toggle');
  const title = $('#signin-title');
  const reveals = PH.bindRevealButtons(card);
  let finishSignIn = null;

  const isRegister = () => form.dataset.mode === 'register';
  const checks = PH.Strength.createChecklist({
    passwordInput: password,
    confirmInput,
    listEl: $('#signin-checks'),
    userInputs: () => [email.value],
    isActive: isRegister,
  });
  email.addEventListener('input', () => {
    if (isRegister()) checks.refreshAnalysis();
  });

  function setMode(mode) {
    const register = mode === 'register';
    form.dataset.mode = mode;
    title.textContent = register ? 'Create Your Account' : 'Sign in to Password Helper';
    submit.textContent = register ? 'Create Account' : 'Sign In';
    toggle.textContent = register ? 'I already have an account' : 'Create an account';
    confirmRow.hidden = !register;
    confirmInput.value = '';
    checksWrap.classList.toggle('open', register);
    password.autocomplete = register ? 'new-password' : 'current-password';
    if (register) checks.run();
    else checks.reset();
  }

  async function attempt() {
    if (!email.value.trim() || !/^\S+@\S+\.\S+$/.test(email.value.trim())) {
      PH.replayClass(email, 'shake');
      email.focus();
      throw new Error('Enter your email address.');
    }
    if (!password.value) {
      password.focus();
      throw new Error('Enter your password.');
    }
    if (isRegister()) {
      const result = await checks.validateNow();
      if (result.stale) return;
      if (!result.ok) throw new Error(result.failure);
      if (result.breachUnavailable) PH.hud('Breach check unavailable — continuing without it.', { tone: 'warning' });
    }
    if (!navigator.onLine) throw new Error('No internet connection — signing in needs one.');
    try {
      if (isRegister()) await PH.Auth.register(email.value.trim(), password.value);
      else await PH.Auth.login(email.value.trim(), password.value);
    } catch (error) {
      if (error && error.code === 'NO_SERVER') {
        PH.hud('The account server isn’t connected yet — continue without an account for now.', { tone: 'info', duration: 5000 });
        return;
      }
      throw error;
    }
    done();
  }

  function clearForm() {
    form.reset();
    for (const controller of Object.values(reveals)) controller.hide();
    setMode('signin');
  }

  async function done() {
    const resolve = finishSignIn;
    finishSignIn = null;
    await leave(card);
    clearForm();
    if (resolve) resolve();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    PH.withBusy(submit, attempt);
  });
  toggle.addEventListener('click', () => setMode(isRegister() ? 'signin' : 'register'));
  $('#signin-skip').addEventListener('click', done);

  /** Shows the sign-in screen; resolves when the user signs in or skips. */
  function showSignIn() {
    return new Promise((resolve) => {
      finishSignIn = resolve;
      clearForm();
      card.getAnimations().forEach((animation) => animation.cancel());
      PH.showScreen('screen-signin');
      if (!PH.reducedMotion()) {
        card.animate(
          [
            { opacity: 0, transform: 'translateY(14px) scale(0.97)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
        );
      }
      email.focus();
    });
  }

  PH.Onboarding = { showWelcome, showSignIn };
})();
