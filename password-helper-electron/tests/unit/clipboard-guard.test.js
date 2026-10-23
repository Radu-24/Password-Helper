'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ClipboardGuard } = require('../../src/clipboard-guard');

function setup() {
  const clipboard = {
    text: '',
    writeText(value) {
      this.text = value;
    },
    readText() {
      return this.text;
    },
    clear() {
      this.text = '';
    },
  };
  const timers = [];
  const guard = new ClipboardGuard({
    clipboard,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
  });
  const fire = () => timers.filter((t) => !t.cancelled).forEach((t) => t.fn());
  return { clipboard, guard, timers, fire };
}

test('secrets are cleared after the configured delay', () => {
  const { clipboard, guard, timers, fire } = setup();
  assert.deepEqual(guard.copy('s3cret', 30), { clearsInSeconds: 30 });
  assert.equal(clipboard.text, 's3cret');
  assert.equal(timers[0].ms, 30_000);
  fire();
  assert.equal(clipboard.text, '');
});

test('something the user copied afterwards is never wiped', () => {
  const { clipboard, guard, fire } = setup();
  guard.copy('s3cret', 15);
  clipboard.writeText('my own text');
  fire();
  assert.equal(clipboard.text, 'my own text');
});

test('a new copy replaces the old timer; 0 means never clear', () => {
  const { clipboard, guard, timers, fire } = setup();
  guard.copy('first', 15);
  guard.copy('second', 0);
  assert.equal(timers[0].cancelled, true);
  fire();
  assert.equal(clipboard.text, 'second');
  guard.clearIfOurs(); // e.g. on quit
  assert.equal(clipboard.text, '');
});

test('empty values are refused', () => {
  const { guard } = setup();
  assert.throws(() => guard.copy('', 30), TypeError);
  assert.throws(() => guard.copy(undefined, 30), TypeError);
});
