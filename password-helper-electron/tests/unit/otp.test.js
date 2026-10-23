'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Otp = require('../../public/js/otp.js');
const totp = require('../../src/totp');

const ascii = (text) => Otp.base32Encode(Buffer.from(text, 'ascii'));

// RFC 6238, Appendix B — the reference seeds are ASCII strings of these lengths.
const SEEDS = {
  SHA1: ascii('12345678901234567890'),
  SHA256: ascii('12345678901234567890123456789012'),
  SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
};
const RFC6238_VECTORS = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

test('TOTP matches the RFC 6238 test vectors (SHA-1, SHA-256, SHA-512)', () => {
  for (const [seconds, ...expected] of RFC6238_VECTORS) {
    ['SHA1', 'SHA256', 'SHA512'].forEach((algorithm, index) => {
      const { code } = totp.generate({ secret: SEEDS[algorithm], algorithm, digits: 8, period: 30 }, seconds * 1000);
      assert.equal(code, expected[index], `${algorithm} at T=${seconds}`);
    });
  }
});

test('HOTP matches the RFC 4226 test vectors', () => {
  const key = Buffer.from('12345678901234567890', 'ascii');
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => assert.equal(totp.hotp(key, counter), code, `counter ${counter}`));
});

test('generate() reports the seconds left in the current period', () => {
  const config = { secret: SEEDS.SHA1, period: 30 };
  assert.equal(totp.generate(config, 59_000).remaining, 1);
  assert.equal(totp.generate(config, 60_000).remaining, 30);
  assert.equal(totp.generate(config, 75_500).remaining, 15);
  assert.equal(totp.generate({ ...config, period: 60 }, 59_000).remaining, 1);
  assert.equal(totp.generate(config, 0).code.length, 6, 'defaults to 6 digits');
});

test('Base32 encodes and decodes (RFC 4648)', () => {
  assert.equal(Otp.base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(Buffer.from(Otp.base32Decode('mzxw 6ytb-oi======')).toString(), 'foobar');
  assert.throws(() => Otp.base32Decode('MZXW1'), { code: 'INVALID' }, '1 is not in the Base32 alphabet');
});

test('a plain setup key is accepted with sensible defaults', () => {
  assert.deepEqual(Otp.parseOtpInput('  jbsw y3dp ehpk 3pxp '), {
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    issuer: '',
    account: '',
  });
});

test('otpauth:// links are parsed, including issuer and account', () => {
  const link =
    'otpauth://totp/ACME%20Co:john.doe@email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60';
  assert.deepEqual(Otp.parseOtpInput(link), {
    secret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ',
    algorithm: 'SHA256',
    digits: 8,
    period: 60,
    issuer: 'ACME Co',
    account: 'john.doe@email.com',
  });
  // Issuer only in the label, no parameters besides the secret.
  const minimal = Otp.parseOtpInput('otpauth://totp/GitHub:radu?secret=JBSWY3DPEHPK3PXP');
  assert.equal(minimal.issuer, 'GitHub');
  assert.equal(minimal.account, 'radu');
  assert.equal(minimal.digits, 6);
});

test('unsupported or broken 2FA setups are rejected with a readable message', () => {
  const bad = [
    '',
    'JBSWY3DP', // 5 bytes — too short
    'JBSWY3DPEHPK3PX0', // 0 is not Base32
    'otpauth://hotp/Example?secret=JBSWY3DPEHPK3PXP&counter=1',
    'otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&digits=9',
    'otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
    'otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&period=5',
    'otpauth://totp/Example?issuer=NoSecret',
    'otpauth:/broken',
  ];
  for (const input of bad) {
    assert.throws(() => Otp.parseOtpInput(input), (error) => error.code === 'INVALID' && error.message.length > 10, input);
  }
});

test('sanitizeConfig keeps valid stored configs and rejects damaged ones', () => {
  const clean = Otp.sanitizeConfig({ secret: 'jbswy3dpehpk3pxp', algorithm: 'SHA512', digits: 8, period: 45, issuer: 'X', extra: 1 });
  assert.deepEqual(clean, { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA512', digits: 8, period: 45, issuer: 'X', account: '' });
  assert.equal(Otp.sanitizeConfig({ secret: 'short' }), null);
  assert.equal(Otp.sanitizeConfig(null), null);
  assert.equal(Otp.sanitizeConfig({ secret: 'JBSWY3DPEHPK3PXP', digits: 12 }).digits, 6, 'bad values fall back to defaults');
});

test('codes are grouped for reading', () => {
  assert.equal(Otp.formatCode('123456'), '123 456');
  assert.equal(Otp.formatCode('12345678'), '1234 5678');
  assert.equal(Otp.formatCode('1234567'), '1234567');
});
