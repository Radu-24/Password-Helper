'use strict';

/**
 * Copies secrets to the clipboard and wipes them again after a delay — but only
 * if the clipboard still holds what we put there (never wipes something the
 * user copied afterwards).
 */
class ClipboardGuard {
  /**
   * @param {{clipboard: {writeText:Function, readText:Function, clear:Function}, schedule?:Function, cancel?:Function}} deps
   */
  constructor({ clipboard, schedule = setTimeout, cancel = clearTimeout }) {
    this.clipboard = clipboard;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timer = null;
    this.lastSecret = null;
  }

  /**
   * @param {string} text
   * @param {number} clearAfterSeconds  0 = never clear
   * @returns {{clearsInSeconds:number}}
   */
  copy(text, clearAfterSeconds) {
    if (typeof text !== 'string' || text === '') throw new TypeError('Nothing to copy.');
    this.clipboard.writeText(text);
    this.cancelTimer();
    this.lastSecret = text;
    if (clearAfterSeconds > 0) {
      this.timer = this.schedule(() => this.clearIfOurs(), clearAfterSeconds * 1000);
    }
    return { clearsInSeconds: clearAfterSeconds > 0 ? clearAfterSeconds : 0 };
  }

  /** Clears the clipboard if it still contains the last secret we copied. */
  clearIfOurs() {
    this.cancelTimer();
    if (this.lastSecret !== null && this.clipboard.readText() === this.lastSecret) this.clipboard.clear();
    this.lastSecret = null;
  }

  cancelTimer() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}

module.exports = { ClipboardGuard };
