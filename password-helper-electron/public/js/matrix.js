/**
 * The matrix rain behind the window — the app's wallpaper.
 * Same look as the first version: katakana and digits, ~30 fps.
 * Paused while the window is hidden; switched off in Settings or by
 * "Reduce motion" (then it shows one still frame).
 */
(function () {
  'use strict';

  const PH = window.PH;
  const CHARS = 'アァイィウエェカキクケコサシスセソタチツテトナニヌネノ0123456789'.split('');
  const FONT_SIZE = 14;
  const FRAME_MS = 33;

  const canvas = document.getElementById('matrix');
  const ctx = canvas.getContext('2d');
  let drops = [];
  let last = 0;
  let rafId = 0;
  let enabled = true;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const columns = Math.floor(canvas.width / FONT_SIZE);
    // Every stream starts at the top (the opening "curtain"); resizing keeps the ones already falling.
    drops = Array.from({ length: columns }, (_, i) => drops[i] ?? 1);
  }

  function draw() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0';
    ctx.font = `${FONT_SIZE}px monospace`;
    for (let i = 0; i < drops.length; i++) {
      const char = CHARS[Math.floor(Math.random() * CHARS.length)];
      ctx.fillText(char, i * FONT_SIZE, drops[i] * FONT_SIZE);
      drops[i] = drops[i] * FONT_SIZE > canvas.height && Math.random() > 0.975 ? 0 : drops[i] + 1;
    }
  }

  /** A still frame for "reduce motion": a few dozen frames drawn at once. */
  function drawStill() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 60; i++) draw();
  }

  function frame(time) {
    rafId = requestAnimationFrame(frame);
    if (time - last < FRAME_MS) return;
    last = time;
    draw();
  }

  function sync() {
    cancelAnimationFrame(rafId);
    rafId = 0;
    canvas.classList.toggle('off', !enabled);
    if (!enabled || document.hidden) return;
    if (PH.reducedMotion()) drawStill();
    else rafId = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', () => {
    resize();
    if (PH.reducedMotion()) drawStill();
  });
  document.addEventListener('visibilitychange', sync);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sync);

  PH.onSettings((settings, previous) => {
    const intensity = Number(settings.backgroundIntensity) || 70;
    canvas.style.setProperty('--rain-opacity', String(0.15 + 0.85 * (intensity / 100)));
    const nextEnabled = settings.matrixBackground !== false;
    if (nextEnabled !== enabled || settings.reduceMotion !== previous.reduceMotion || !rafId) {
      enabled = nextEnabled;
      sync();
    }
  });
})();
