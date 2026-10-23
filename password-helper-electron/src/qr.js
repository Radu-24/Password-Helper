'use strict';

/**
 * Reads a QR code from an image (e.g. a screenshot on the clipboard), so a
 * site's 2FA QR code can be added without a phone. Main process only.
 */

const jsQR = require('jsqr');

const MAX_SIDE = 1600; // big screenshots are scaled down first — QR codes survive that fine

/**
 * @param {Electron.NativeImage} image
 * @returns {string|null} the QR code's text, or null if none was found
 */
function decodeNativeImage(image) {
  if (!image || image.isEmpty()) return null;
  let { width, height } = image.getSize();
  let source = image;
  if (Math.max(width, height) > MAX_SIDE) {
    source = width >= height ? image.resize({ width: MAX_SIDE }) : image.resize({ height: MAX_SIDE });
    ({ width, height } = source.getSize());
  }
  const bitmap = source.toBitmap(); // BGRA on most platforms
  const rgba = new Uint8ClampedArray(bitmap.length);
  for (let i = 0; i < bitmap.length; i += 4) {
    rgba[i] = bitmap[i + 2];
    rgba[i + 1] = bitmap[i + 1];
    rgba[i + 2] = bitmap[i];
    rgba[i + 3] = 255;
  }
  const result = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  return result ? result.data : null;
}

module.exports = { decodeNativeImage };
