'use strict';

/**
 * Renders public/img/app-icon.svg to the PNG icons the app and installers use:
 *   build/icon.png               1024×1024 (electron-builder: Linux, Windows, macOS)
 *   public/img/app-icon-256.png  window icon
 *
 * Run with: npx electron scripts/render-icon.js
 * (Add --no-sandbox when running as root, e.g. in a container.)
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'public', 'img', 'app-icon.svg'), 'utf8');
const TARGETS = [
  { size: 1024, file: path.join(ROOT, 'build', 'icon.png') },
  { size: 256, file: path.join(ROOT, 'public', 'img', 'app-icon-256.png') },
];

async function render(win, size) {
  win.setContentSize(size, size);
  const svg = SVG.replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
  const page = path.join(os.tmpdir(), `ph-icon-${process.pid}-${size}.html`);
  fs.writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`);
  try {
    await win.loadFile(page);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    return image.resize({ width: size, height: size, quality: 'best' }).toPNG();
  } finally {
    fs.rmSync(page, { force: true });
  }
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  try {
    for (const { size, file } of TARGETS) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await render(win, size));
      console.log(`wrote ${path.relative(ROOT, file)} (${size}×${size})`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  app.quit();
});
