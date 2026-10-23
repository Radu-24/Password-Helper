'use strict';

/**
 * Generates the app icon artwork: public/img/app-icon.svg.
 *   node scripts/make-icon.js            → writes the SVG
 *   npx electron scripts/render-icon.js  → renders the PNGs from it
 */
const fs = require('node:fs');
const path = require('node:path');

const out = process.argv[2] || path.join(__dirname, '..', 'public', 'img', 'app-icon.svg');

// macOS-style continuous-corner tile: superellipse |x/a|^n + |y/b|^n = 1
function squircle(cx, cy, size, n = 5, steps = 256) {
  const a = size / 2;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t), s = Math.sin(t);
    const x = cx + a * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = cy + a * Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

// Deterministic PRNG so the artwork is reproducible.
let seed = 20261023;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// Abstract code rain: columns of short rounded "glyph" bars, brightest at the head.
let rain = '';
const colW = 46;
for (let x = 112; x < 912; x += colW) {
  const head = 180 + rand() * 640; // y of the bright head
  const len = 5 + Math.floor(rand() * 9);
  for (let k = 0; k < len; k++) {
    const y = head - k * 38;
    if (y < 110 || y > 900) continue;
    const w = 14 + Math.floor(rand() * 3) * 6;
    const o = k === 0 ? 0.95 : Math.max(0.08, 0.7 - k * 0.075);
    const fill = k === 0 ? '#d9ffe6' : '#20e070';
    rain += `<rect x="${(x + (24 - w) / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="22" rx="5" fill="${fill}" opacity="${o.toFixed(2)}"/>`;
  }
}

const tile = squircle(512, 512, 824);
const shield = 'M512 238C590 286 676 304 748 306C752 314 752 330 752 520C752 668 650 766 512 822C374 766 272 668 272 520C272 330 272 314 276 306C348 304 434 286 512 238Z';
const keyhole = 'M512 412a62 62 0 0 1 34 113.8L566 652H458l20-126.2A62 62 0 0 1 512 412Z';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Password Helper app icon. Original artwork, MIT licensed with the app. -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f3d27"/>
      <stop offset="0.55" stop-color="#062114"/>
      <stop offset="1" stop-color="#020b06"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0" stop-color="#2dff8a" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#2dff8a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#eafff2" stop-opacity="0.42"/>
      <stop offset="0.5" stop-color="#c8ffe0" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#c8ffe0" stop-opacity="0.1"/>
    </linearGradient>
    <linearGradient id="rim" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.6"/>
    </linearGradient>
    <linearGradient id="hole" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#03130a"/>
      <stop offset="1" stop-color="#0a2c1a"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="tileClip"><path d="${tile}"/></clipPath>
    <clipPath id="shieldClip"><path d="${shield}"/></clipPath>
    <filter id="frost" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="tileShadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <g filter="url(#tileShadow)"><path d="${tile}" fill="url(#bg)"/></g>
  <g clip-path="url(#tileClip)">
    <g id="rain">${rain}</g>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <path d="${tile}" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="6"/>
  </g>
  <g filter="url(#shadow)">
    <g clip-path="url(#shieldClip)">
      <path d="${shield}" fill="#0d3621"/>
      <g filter="url(#frost)"><use href="#rain"/><use href="#rain"/></g>
      <path d="${shield}" fill="url(#glass)"/>
      <path d="M272 300H760V470C640 420 420 430 272 520Z" fill="url(#sheen)" opacity="0.55"/>
    </g>
    <path d="${shield}" fill="none" stroke="url(#rim)" stroke-width="9"/>
    <path d="${keyhole}" fill="url(#hole)"/>
    <path d="${keyhole}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4"/>
  </g>
</svg>
`;
fs.writeFileSync(out, svg);
console.log('wrote', out, svg.length, 'bytes');
