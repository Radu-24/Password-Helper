'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv, parseImport, detectFormat, hostnameOf, MAX_FILE_BYTES } = require('../../src/csv-import');

test('parseCsv follows RFC 4180: quotes, escaped quotes, commas and newlines in fields, CRLF', () => {
  const text = 'a,b,c\r\n"x, y","say ""hi""","line 1\nline 2"\r\n\r\nlast,,\n';
  assert.deepEqual(parseCsv(text), [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line 1\nline 2'],
    ['last', '', ''],
  ]);
  assert.deepEqual(parseCsv('﻿name,password\nA,B'), [['name', 'password'], ['A', 'B']], 'BOM is removed');
});

test('Chrome / Edge / Brave exports', () => {
  const csv = 'name,url,username,password,note\nGitHub,https://github.com/login,radu,gh-pass,work account\n';
  const result = parseImport(csv);
  assert.equal(result.format, 'Chrome / Edge / Brave');
  assert.deepEqual(result.entries, [
    {
      label: 'GitHub',
      type: 'Website',
      username: 'radu',
      password: 'gh-pass',
      url: 'https://github.com/login',
      notes: 'work account',
      totp: null,
      favorite: false,
    },
  ]);
});

test('Firefox exports (no title column → the host name becomes the title)', () => {
  const csv =
    '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n' +
    '"https://www.accounts.google.com","me@gmail.com","ff-pass",,"https://accounts.google.com","{1}","1","2","3"\n';
  const { format, entries } = parseImport(csv);
  assert.equal(format, 'Firefox');
  assert.equal(entries[0].label, 'accounts.google.com');
  assert.equal(entries[0].username, 'me@gmail.com');
});

test('Bitwarden exports: logins only, favourites and 2FA keys are kept', () => {
  const csv =
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
    ',1,login,Proton,,,0,https://proton.me,radu,bw-pass,otpauth://totp/Proton:radu?secret=JBSWY3DPEHPK3PXP&issuer=Proton\n' +
    ',,note,My note,secret text,,0,,,,\n' +
    ',,login,Broken 2FA,,,0,https://x.example,u,p2,not-a-key!\n';
  const result = parseImport(csv);
  assert.equal(result.format, 'Bitwarden');
  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped, 1, 'the secure note is skipped');
  assert.equal(result.totpIgnored, 1);
  const [proton, broken] = result.entries;
  assert.equal(proton.favorite, true);
  assert.equal(proton.totp.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(proton.totp.issuer, 'Proton');
  assert.equal(broken.totp, null);
});

test('Safari / Apple Passwords, 1Password, KeePassXC and LastPass are recognised', () => {
  const cases = [
    ['Title,URL,Username,Password,Notes,OTPAuth\nApple,https://apple.com,me,pw,,\n', 'Safari / Apple Passwords'],
    ['Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nX,https://x.com,u,pw,,true,false,,\n', '1Password'],
    ['Group,Title,Username,Password,URL,Notes,TOTP,Icon,Last Modified,Created\nRoot,X,u,pw,https://x.com,,,0,,\n', 'KeePassXC'],
    ['url,username,password,totp,extra,name,grouping,fav\nhttps://x.com,u,pw,,,X,,0\n', 'LastPass'],
    ['Website,Login,Password\nx.com,u,pw\n', 'CSV'],
  ];
  for (const [csv, format] of cases) assert.equal(parseImport(csv).format, format, format);
  assert.equal(parseImport(cases[1][0]).entries[0].favorite, true, '1Password "true" favourite');
});

test('LastPass secure notes and rows without a password are skipped', () => {
  const csv = 'url,username,password,totp,extra,name,grouping,fav\nhttp://sn,,,,secret note,Note,,0\nhttps://a.com,u,pw,,,A,,1\n';
  const result = parseImport(csv);
  assert.equal(result.entries.length, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.entries[0].favorite, true);
});

test('files that are not password exports are refused', () => {
  assert.throws(() => parseImport('name,email\nRadu,r@example.com\n'), { code: 'INVALID' });
  assert.throws(() => parseImport('password\n'), { code: 'INVALID' }, 'header only');
  assert.throws(() => parseImport(''), { code: 'INVALID' });
  assert.equal(detectFormat(['password']), null, 'a password column alone is not enough');
  assert.ok(MAX_FILE_BYTES >= 1024 * 1024);
});

test('titles fall back to the host name, then the username', () => {
  const csv = 'url,username,password\nhttps://www.example.com/login,,a\n,only-user,b\n,,c\n';
  // "url" without "name"/"title" still counts as a password export.
  assert.deepEqual(parseImport(csv).entries.map((entry) => entry.label), ['example.com', 'only-user', 'Imported item']);
  assert.equal(hostnameOf('github.com/login'), 'github.com');
  assert.equal(hostnameOf('::not a url::'), '');
});
