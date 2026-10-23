'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const hibp = require('../../src/hibp');

function fakeFetch(body = 'ABC:1', { status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetch, calls };
}

test('only well-formed 5-character uppercase prefixes are sent', async () => {
  const { fetch, calls } = fakeFetch();
  for (const bad of ['abcde', 'ABCD', 'ABCDEF', '../xx', '', null, 12345]) {
    await assert.rejects(hibp.fetchRange(bad, { fetch }), TypeError);
  }
  assert.equal(calls.length, 0);
});

test('requests are padded and cached', async () => {
  hibp.clearCache();
  const { fetch, calls } = fakeFetch('SUFFIX:5');
  const body = await hibp.fetchRange('21BD1', { fetch });
  assert.equal(body, 'SUFFIX:5');
  assert.equal(calls[0].url, 'https://api.pwnedpasswords.com/range/21BD1');
  assert.equal(calls[0].init.headers['Add-Padding'], 'true');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'has a timeout');

  await hibp.fetchRange('21BD1', { fetch });
  assert.equal(calls.length, 1, 'second lookup served from cache');

  const now = Date.now() + 2 * 60 * 60 * 1000; // two hours later → expired
  await hibp.fetchRange('21BD1', { fetch, now: () => now });
  assert.equal(calls.length, 2);
});

test('HTTP errors surface as exceptions (never as "not breached")', async () => {
  hibp.clearCache();
  const { fetch } = fakeFetch('', { status: 503 });
  await assert.rejects(hibp.fetchRange('ABCDE', { fetch }), /HTTP 503/);
});
