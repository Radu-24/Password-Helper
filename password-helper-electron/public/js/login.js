/**
 * login.html — account login / register.
 *
 * The account server isn't online yet, so PH.Auth (auth.js) is a stub: forms
 * are fully validated, then the user is told to continue with "Skip for now".
 * Register mode uses the same password policy as the rest of the app (policy.js).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const { $ } = PH;

  const card = $('#card');
  const form = $('#loginForm');
  const email = $('#email');
  const password = $('#password');
  const confirmInput = $('#confirmPassword');
  const confirmWrapper = $('#confirmWrapper');
  const requirements = $('#passwordRequirements');
  const submitBtn = $('#submitBtn');
  const toggleMode = $('#toggleMode');

  PH.bindReveal($('#togglePassword'), password);
  PH.bindReveal($('#toggleConfirmPassword'), confirmInput);

  const isRegister = () => form.dataset.mode === 'register';

  // Live checks only run in register mode; in login mode the password is just sent.
  const checks = PH.Strength.createChecklist({
    passwordInput: password,
    confirmInput,
    listEl: requirements,
    userInputs: () => [email.value],
    isActive: isRegister,
  });
  email.addEventListener('input', () => {
    if (isRegister()) checks.refreshAnalysis();
  });

  function setMode(mode) {
    const register = mode === 'register';
    PH.animateHeight(card, () => {
      form.dataset.mode = mode;
      submitBtn.textContent = register ? 'Register' : 'Log In';
      toggleMode.textContent = register ? 'Already have an account? Log In' : 'Create account';
      card.classList.toggle('register', register);
      requirements.classList.toggle('active', register);
      confirmWrapper.classList.toggle('hidden', !register);
      // A hidden `required` field would silently block the login form.
      confirmInput.required = register;
      password.autocomplete = register ? 'new-password' : 'current-password';
    });
    if (register) checks.run();
    else checks.reset();
  }

  async function submit() {
    if (!navigator.onLine) {
      PH.toast('⚠️ No internet — account login needs a connection.', { type: 'warning' });
      return;
    }

    if (isRegister()) {
      const result = await checks.validateNow();
      if (result.stale) return;
      if (!result.ok) {
        PH.toast(`❗ ${result.failure}`, { type: 'error' });
        return;
      }
      if (result.breachUnavailable) PH.toast('Breach check unavailable — continuing without it.', { type: 'warning' });
    }

    try {
      if (isRegister()) await PH.Auth.register(email.value.trim(), password.value);
      else await PH.Auth.login(email.value.trim(), password.value);
      PH.go('index.html');
    } catch (error) {
      if (error && error.code === 'NO_SERVER') {
        PH.toast('ℹ️ Account server isn’t connected yet — use “Skip for now” to continue offline.', { duration: 4500 });
      } else {
        PH.toast(`❗ ${(error && error.message) || 'Something went wrong.'}`, { type: 'error' });
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;
    const label = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = isRegister() ? 'Checking…' : 'Logging in…';
    try {
      await submit();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }
  });

  toggleMode.addEventListener('click', () => setMode(isRegister() ? 'login' : 'register'));
  $('#skipBtn').addEventListener('click', () => PH.go('index.html'));
})();
