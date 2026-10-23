'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { VaultStore } = require('../../src/vault-store');
const { VaultService } = require('../../src/vault-service');
const hibp = require('../../src/hibp');
const analysis = require('../../src/analysis');

const MASTER = 'Correct-Horse-Battery-Staple-2026';

function setup(t, { autoLock = 5, fetch } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const timers = [];
  const service = new VaultService({
    store: new VaultStore({ filePath: path.join(dir, 'vault.json'), iterations: 1000 }),
    analysis,
    hibp,
    fetch: fetch || (async () => ({ ok: true, status: 200, text: async () => '' })),
    getAutoLockMinutes: () => autoLock,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
  });
  const activeTimers = () => timers.filter((timer) => !timer.cancelled);
  return { service, timers, activeTimers };
}

test('the master password must satisfy the policy', async (t) => {
  const { service } = setup(t);
  await assert.rejects(service.create('short'), { code: 'INVALID' });
  await assert.rejects(service.create('aaaaaaaaaaaaaaaaaaaa'), { code: 'INVALID' }, 'long but trivially guessable');
  await service.create(MASTER);
  assert.deepEqual(service.status(), { exists: true, unlocked: true });
});

test('auto-lock fires after inactivity and every action restarts it', async (t) => {
  const { service, activeTimers } = setup(t, { autoLock: 5 });
  const events = [];
  service.on('locked', (reason) => events.push(reason));
  await service.create(MASTER);
  assert.equal(activeTimers().length, 1);
  assert.equal(activeTimers()[0].ms, 5 * 60_000);

  await service.add({ label: 'a', password: 'x' });
  assert.equal(activeTimers().length, 1, 'old timer cancelled, new one started');

  activeTimers()[0].fn();
  assert.deepEqual(events, ['timeout']);
  assert.equal(service.status().unlocked, false);
  service.lock('manual');
  assert.deepEqual(events, ['timeout'], 'locking an already locked vault emits nothing');
});

test('auto-lock "never" (0) schedules nothing', async (t) => {
  const { service, activeTimers } = setup(t, { autoLock: 0 });
  await service.create(MASTER);
  assert.equal(activeTimers().length, 0);
});

test('add/update report how many other entries share the password', async (t) => {
  const { service } = setup(t);
  await service.create(MASTER);
  const first = await service.add({ label: 'a', password: 'shared-secret' });
  assert.equal(first.reusedCount, 0);
  assert.equal(first.password, undefined);
  const second = await service.add({ label: 'b', password: 'shared-secret' });
  assert.equal(second.reusedCount, 1);
  const changed = await service.update(second.id, { label: 'b', password: 'now-unique' });
  assert.equal(changed.reusedCount, 0);
});

test('list() flags weak and reused passwords without exposing them', async (t) => {
  const { service } = setup(t);
  await service.create(MASTER);
  await service.add({ label: 'one', password: 'password123' });
  await service.add({ label: 'two', password: 'password123' });
  await service.add({ label: 'three', password: 'x7#Kq!vR2mZ9@Lp4-tiger-lamp' });
  const { entries, breachCheckedAt } = await service.list();
  assert.equal(breachCheckedAt, null);
  const byLabel = Object.fromEntries(entries.map((entry) => [entry.label, entry]));
  assert.equal(byLabel.one.weak, true);
  assert.equal(byLabel.one.reusedCount, 1);
  assert.equal(byLabel.three.weak, false);
  assert.equal(byLabel.three.reusedCount, 0);
  assert.equal(byLabel.three.breachCount, null);
  for (const entry of entries) assert.equal(entry.password, undefined);
});

test('checkBreaches sends only hash prefixes and records counts', async (t) => {
  hibp.clearCache();
  const pwned = 'password123';
  const hash = crypto.createHash('sha1').update(pwned).digest('hex').toUpperCase();
  const requested = [];
  const fetch = async (url) => {
    requested.push(url);
    const body = url.endsWith(hash.slice(0, 5)) ? `${hash.slice(5)}:2420\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0` : 'AAAA:1';
    return { ok: true, status: 200, text: async () => body };
  };
  const { service } = setup(t, { fetch });
  await service.create(MASTER);
  await service.add({ label: 'old', password: pwned });
  await service.add({ label: 'old-again', password: pwned });
  await service.add({ label: 'fresh', password: 'x7#Kq!vR2mZ9@Lp4-tiger-lamp' });

  const summary = await service.checkBreaches();
  assert.deepEqual(summary, { checked: 3, breached: 2, failed: 0 });
  assert.equal(requested.length, 2, 'one request per unique password');
  for (const url of requested) assert.match(url, /\/range\/[0-9A-F]{5}$/);

  const { entries, breachCheckedAt } = await service.list();
  assert.ok(breachCheckedAt);
  assert.equal(entries.find((entry) => entry.label === 'old').breachCount, 2420);
  assert.equal(entries.find((entry) => entry.label === 'fresh').breachCount, 0);

  service.lock();
  await service.unlock(MASTER);
  const after = await service.list();
  assert.equal(after.entries[0].breachCount, null, 'results are forgotten when the vault locks');
});

test('network failures are counted, not reported as clean', async (t) => {
  hibp.clearCache();
  const { service } = setup(t, { fetch: async () => { throw new Error('offline'); } });
  await service.create(MASTER);
  await service.add({ label: 'a', password: 'something-unique-123' });
  const summary = await service.checkBreaches();
  assert.deepEqual(summary, { checked: 1, breached: 0, failed: 1 });
  const { entries } = await service.list();
  assert.equal(entries[0].breachCount, null);
});

test('totpCodes returns current codes without secrets, and does not keep the vault awake', async (t) => {
  const { service, timers } = setup(t);
  await service.create(MASTER);
  const secret = require('../../public/js/otp.js').base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  const withCode = await service.add({ label: 'A', password: 'p1', totp: { secret, digits: 8, period: 30, algorithm: 'SHA1' } });
  await service.add({ label: 'B', password: 'p2' });
  const scheduled = timers.length;

  const codes = service.totpCodes(undefined, 59_000);
  assert.deepEqual(codes, [{ id: withCode.id, code: '94287082', period: 30, remaining: 1 }]); // RFC 6238 vector
  assert.equal(timers.length, scheduled, 'reading codes must not restart the auto-lock timer');
  assert.deepEqual(service.totpCodes(['nope'], 59_000), []);

  const { entries } = await service.list();
  assert.deepEqual(entries.map((entry) => [entry.label, entry.hasTotp, 'totp' in entry]), [['A', true, false], ['B', false, false]]);
  service.lock();
  assert.throws(() => service.totpCodes(), { code: 'LOCKED' });
});

test('deleted items are left out of health checks and 2FA codes', async (t) => {
  const { service } = setup(t);
  await service.create(MASTER);
  const secret = 'JBSWY3DPEHPK3PXP';
  const a = await service.add({ label: 'A', password: 'same-password-123', totp: secret });
  const b = await service.add({ label: 'B', password: 'same-password-123' });
  assert.equal(b.reusedCount, 1);
  await service.remove(a.id);

  const { entries } = await service.list();
  const deleted = entries.find((entry) => entry.id === a.id);
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.weak, false);
  assert.equal(entries.find((entry) => entry.id === b.id).reusedCount, 0, 'a deleted twin no longer counts as reuse');
  assert.deepEqual(service.totpCodes(), []);
  await service.restore(a.id);
  assert.equal(service.totpCodes().length, 1);
});

test('previewTotp checks a setup key without saving it', async (t) => {
  const { service } = setup(t);
  const preview = service.previewTotp('otpauth://totp/Site:me?secret=JBSWY3DPEHPK3PXP&issuer=Site', 59_000);
  assert.equal(preview.issuer, 'Site');
  assert.equal(preview.account, 'me');
  assert.equal(preview.code.length, 6);
  assert.equal(preview.remaining, 1);
  assert.equal('secret' in preview, false);
  assert.throws(() => service.previewTotp('nope'), { code: 'INVALID' });
});
