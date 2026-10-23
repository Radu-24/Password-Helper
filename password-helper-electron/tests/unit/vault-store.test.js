'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { VaultStore, VaultError } = require('../../src/vault-store');

const MASTER = 'correct horse battery staple 42';
const FAST = 1000; // PBKDF2 iterations for tests (production uses 600,000)

function tempVault(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-vault-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'vault.json');
  return { dir, filePath, store: new VaultStore({ filePath, iterations: FAST, ...options }) };
}

const sample = (overrides = {}) => ({
  label: 'example.com',
  type: 'Website',
  username: 'radu@example.com',
  password: 'S3cret-Pass!',
  notes: 'recovery: blue',
  ...overrides,
});

async function rejectsWithCode(promiseOrFn, code) {
  await assert.rejects(promiseOrFn, (error) => {
    assert.ok(error instanceof VaultError, `expected VaultError, got ${error}`);
    assert.equal(error.code, code);
    return true;
  });
}

test('create → lock → unlock round-trips entries', async (t) => {
  const { store, filePath } = tempVault(t);
  assert.equal(store.exists(), false);
  await store.create(MASTER);
  assert.equal(store.unlocked, true);
  const added = await store.add(sample());
  assert.equal(added.password, undefined, 'add() must not return the password');
  store.lock();
  assert.equal(store.unlocked, false);

  const reopened = new VaultStore({ filePath });
  await reopened.unlock(MASTER);
  const [entry] = reopened.list();
  assert.equal(entry.label, 'example.com');
  assert.equal(entry.password, undefined, 'list() must not expose passwords');
  assert.equal(reopened.getEntry(entry.id).password, 'S3cret-Pass!');
});

test('the file on disk contains no plaintext', async (t) => {
  const { store, filePath } = tempVault(t);
  await store.create(MASTER);
  await store.add(sample());
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const secret of ['S3cret-Pass!', 'example.com', 'radu@example.com', 'recovery', MASTER]) {
    assert.equal(raw.includes(secret), false, `"${secret}" leaked into the file`);
  }
  const file = JSON.parse(raw);
  assert.equal(file.kdf.name, 'PBKDF2-HMAC-SHA256');
  assert.equal(file.cipher.name, 'AES-256-GCM');
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('default iteration count follows OWASP (600,000)', () => {
  const store = new VaultStore({ filePath: path.join(os.tmpdir(), 'unused.json') });
  assert.equal(store.iterations, 600_000);
});

test('wrong password is rejected and repeated failures are throttled', async (t) => {
  let now = 1_000_000;
  const { store, filePath } = tempVault(t, { now: () => now });
  await store.create(MASTER);
  store.lock();

  const attacker = new VaultStore({ filePath, now: () => now });
  for (let i = 0; i < 3; i++) await rejectsWithCode(attacker.unlock('wrong password'), 'WRONG_PASSWORD');
  await rejectsWithCode(attacker.unlock(MASTER), 'THROTTLED'); // even the right one waits
  now += 1000;
  await rejectsWithCode(attacker.unlock('wrong again'), 'WRONG_PASSWORD');
  await rejectsWithCode(attacker.unlock(MASTER), 'THROTTLED');
  now += 2000;
  await attacker.unlock(MASTER);
  assert.equal(attacker.unlocked, true);
  assert.equal(attacker.failedAttempts, 0);
});

test('parallel unlock attempts are refused while one is running', async (t) => {
  const { store, filePath } = tempVault(t);
  await store.create(MASTER);
  store.lock();
  const attacker = new VaultStore({ filePath });
  const results = await Promise.allSettled(['a', 'b', 'c'].map((guess) => attacker.unlock(guess)));
  assert.deepEqual(results.map((r) => r.reason.code).sort(), ['THROTTLED', 'THROTTLED', 'WRONG_PASSWORD']);
});

test('tampering with the data or the header is detected', async (t) => {
  const { store, filePath } = tempVault(t);
  await store.create(MASTER);
  await store.add(sample());
  store.lock();
  const original = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const flipped = Buffer.from(original.data, 'base64');
  flipped[0] ^= 0xff;
  fs.writeFileSync(filePath, JSON.stringify({ ...original, data: flipped.toString('base64') }));
  await rejectsWithCode(new VaultStore({ filePath }).unlock(MASTER), 'WRONG_PASSWORD');

  fs.writeFileSync(filePath, JSON.stringify({ ...original, kdf: { ...original.kdf, iterations: 999 } }));
  await rejectsWithCode(new VaultStore({ filePath }).unlock(MASTER), 'WRONG_PASSWORD');

  fs.writeFileSync(filePath, JSON.stringify({ ...original, kdf: { ...original.kdf, iterations: 1e12 } }));
  await rejectsWithCode(new VaultStore({ filePath }).unlock(MASTER), 'CORRUPT');

  fs.writeFileSync(filePath, '{ not json');
  await rejectsWithCode(new VaultStore({ filePath }).unlock(MASTER), 'CORRUPT');
});

test('unicode master passwords are normalised (NFKC)', async (t) => {
  const composed = 'parolă-de-test-foarte-lungă'; // ă = U+0103
  const decomposed = composed.normalize('NFD'); // a + U+0306
  assert.notEqual(composed, decomposed);
  const { store, filePath } = tempVault(t);
  await store.create(composed);
  store.lock();
  await new VaultStore({ filePath }).unlock(decomposed);
});

test('add / update / remove persist and validate input', async (t) => {
  const { store, filePath } = tempVault(t);
  await store.create(MASTER);
  const a = await store.add(sample());
  const b = await store.add(sample({ label: '  padded  ', type: 'Spaceship', password: '  keep spaces  ' }));
  assert.equal(b.label, 'padded', 'labels are trimmed');
  assert.equal(b.type, 'Other', 'unknown types fall back to Other');
  assert.equal(store.getEntry(b.id).password, '  keep spaces  ', 'passwords are never trimmed');

  const updated = await store.update(a.id, sample({ label: 'renamed.com' }));
  assert.equal(updated.label, 'renamed.com');
  assert.ok(updated.updatedAt >= a.updatedAt);
  await store.remove(b.id);

  await rejectsWithCode(store.add(sample({ label: '   ' })), 'INVALID');
  await rejectsWithCode(store.add(sample({ password: '' })), 'INVALID');
  await rejectsWithCode(store.add(sample({ notes: 'x'.repeat(10_001) })), 'INVALID');
  await rejectsWithCode(store.add(sample({ label: 42 })), 'INVALID');
  await rejectsWithCode(store.update('missing', sample()), 'NOT_FOUND');
  await rejectsWithCode(store.remove('missing'), 'NOT_FOUND');

  store.lock();
  const reopened = new VaultStore({ filePath });
  await reopened.unlock(MASTER);
  assert.deepEqual(reopened.list().map((e) => e.label), ['renamed.com']);
});

test('a locked vault refuses every operation', async (t) => {
  const { store } = tempVault(t);
  await store.create(MASTER);
  const { id } = await store.add(sample());
  store.lock();
  assert.throws(() => store.list(), { code: 'LOCKED' });
  assert.throws(() => store.getEntry(id), { code: 'LOCKED' });
  await rejectsWithCode(store.add(sample()), 'LOCKED');
  await rejectsWithCode(store.remove(id), 'LOCKED');
});

test('create imports entries from the old localStorage format', async (t) => {
  const { store } = tempVault(t);
  const legacy = [
    { label: 'old-site', type: 'Website', user: 'radu', pass: 'old-pass', notes: '' },
    { id: 'abcdef12-3456', label: 'phase1', type: 'App', username: 'u', password: 'p', notes: 'n', createdAt: '2026-01-01T00:00:00.000Z' },
    { label: '', pass: 'no label' }, // invalid → skipped, not fatal
    null,
  ];
  const result = await store.create(MASTER, legacy);
  assert.deepEqual(result, { imported: 2, skipped: 2 });
  const [oldSite, phase1] = store.list();
  assert.equal(oldSite.username, 'radu');
  assert.equal(store.getEntry(oldSite.id).password, 'old-pass');
  assert.equal(phase1.id, 'abcdef12-3456', 'existing ids are kept');
  assert.equal(phase1.createdAt, '2026-01-01T00:00:00.000Z');
});

test('importEntries skips duplicates and invalid rows', async (t) => {
  const { store } = tempVault(t);
  await store.create(MASTER);
  const existing = await store.add(sample());
  const result = await store.importEntries([
    { id: existing.id, label: 'same id', password: 'x' },
    sample({ label: 'EXAMPLE.COM', username: 'RADU@example.com' }), // same label+user+password
    sample({ label: 'new.com' }),
    { label: 'broken' }, // no password
  ]);
  assert.deepEqual(result, { added: 1, skipped: 3 });
  assert.equal(store.list().length, 2);
});

test('changePassword re-keys the vault', async (t) => {
  const { store, filePath } = tempVault(t);
  await store.create(MASTER);
  await store.add(sample());
  const saltBefore = JSON.parse(fs.readFileSync(filePath, 'utf8')).kdf.salt;
  await rejectsWithCode(store.changePassword('not the master', 'a brand new master password'), 'WRONG_PASSWORD');
  await store.changePassword(MASTER, 'a brand new master password');
  assert.notEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')).kdf.salt, saltBefore, 'new salt');
  store.lock();
  await rejectsWithCode(new VaultStore({ filePath }).unlock(MASTER), 'WRONG_PASSWORD');
  const reopened = new VaultStore({ filePath });
  await reopened.unlock('a brand new master password');
  assert.equal(reopened.list().length, 1);
});

test('saves are atomic, queued and keep a backup', async (t) => {
  const { store, dir, filePath } = tempVault(t);
  await store.create(MASTER);
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.add(sample({ label: `site-${i}` }))));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['vault.json', 'vault.json.bak']);
  store.lock();
  const reopened = new VaultStore({ filePath });
  await reopened.unlock(MASTER);
  assert.equal(reopened.list().length, 12, 'no update lost to a race');
});

test('backups can be exported and read back with their own password', async (t) => {
  const { store, dir } = tempVault(t);
  await store.create(MASTER);
  await store.add(sample());
  const backup = path.join(dir, 'backup.phvault');
  await store.exportTo(backup);
  const entries = await VaultStore.readBackup(backup, MASTER);
  assert.equal(entries[0].password, 'S3cret-Pass!');
  await rejectsWithCode(VaultStore.readBackup(backup, 'nope'), 'WRONG_PASSWORD');
  fs.writeFileSync(path.join(dir, 'random.json'), '{"hello":1}');
  await rejectsWithCode(VaultStore.readBackup(path.join(dir, 'random.json'), MASTER), 'CORRUPT');
});

test('creating twice or unlocking nothing fails cleanly', async (t) => {
  const { store, filePath } = tempVault(t);
  await rejectsWithCode(store.unlock(MASTER), 'NO_VAULT');
  await store.create(MASTER);
  await rejectsWithCode(store.create(MASTER), 'VAULT_EXISTS');
  await rejectsWithCode(new VaultStore({ filePath }).unlock(''), 'WRONG_PASSWORD');
});
