'use strict';

/**
 * Import passwords from CSV exports of other password managers and browsers.
 *
 * Runs in the main process: the plaintext file is parsed here and only a
 * summary (counts, a few titles) is sent to the page. The parsed entries go
 * straight into the encrypted vault.
 *
 * Supported (by header detection):
 *   Chrome / Edge / Brave / Opera  name,url,username,password,note
 *   Firefox                        url,username,password,httpRealm,formActionOrigin,guid,…
 *   Safari / Apple Passwords       Title,URL,Username,Password,Notes,OTPAuth
 *   Bitwarden                      folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
 *   1Password                      Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes
 *   KeePassXC                      Group,Title,Username,Password,URL,Notes,TOTP,Icon,Last Modified,Created
 *   LastPass                       url,username,password,totp,extra,name,grouping,fav
 *   …and any other CSV with a "password" column plus a title, name or URL column.
 */

const Otp = require('../public/js/otp.js');

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** RFC 4180 CSV → array of rows (arrays of strings). Handles quotes, "" escapes, CRLF and newlines inside quotes. */
function parseCsv(text) {
  const input = String(text).replace(/^\uFEFF/, ''); // UTF-8 BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') inQuotes = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const COLUMN_NAMES = {
  title: ['title', 'name'],
  url: ['url', 'login_uri', 'website', 'web site', 'uri', 'login url', 'site'],
  username: ['username', 'login_username', 'user name', 'user', 'login', 'email', 'e-mail'],
  password: ['password', 'login_password'],
  notes: ['notes', 'note', 'extra', 'comments', 'comment'],
  totp: ['totp', 'otpauth', 'login_totp', 'otp', 'one-time password'],
  favorite: ['favorite', 'favourite', 'fav'],
  type: ['type'],
};

/** Works out which column holds what, and which app the file probably came from. */
function detectFormat(header) {
  const names = header.map((name) => String(name).trim().toLowerCase());
  const columns = {};
  for (const [field, aliases] of Object.entries(COLUMN_NAMES)) {
    for (const alias of aliases) {
      const index = names.indexOf(alias);
      if (index !== -1) {
        columns[field] = index;
        break;
      }
    }
  }
  if (columns.password === undefined || (columns.title === undefined && columns.url === undefined)) return null;

  const has = (name) => names.includes(name);
  let format = 'CSV';
  if (has('login_uri') || has('login_password')) format = 'Bitwarden';
  else if (has('httprealm') || has('formactionorigin')) format = 'Firefox';
  else if (has('grouping') && has('extra')) format = 'LastPass';
  else if (has('group') && has('title') && has('totp')) format = 'KeePassXC';
  else if (has('archived') && has('otpauth')) format = '1Password';
  else if (has('otpauth') && has('title')) format = 'Safari / Apple Passwords';
  else if (has('name') && has('url') && has('username') && has('password')) format = 'Chrome / Edge / Brave';
  return { format, columns };
}

function hostnameOf(url) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Turns CSV text into vault entries (not yet validated by the vault — it does that on import).
 * @returns {{format:string, entries:object[], skipped:number, totpIgnored:number}}
 */
function parseImport(text) {
  if (Buffer.byteLength(String(text), 'utf8') > MAX_FILE_BYTES) {
    throw Object.assign(new Error('That file is too big to be a password export.'), { code: 'INVALID' });
  }
  const rows = parseCsv(text);
  if (rows.length < 2) throw Object.assign(new Error('That file has no password rows.'), { code: 'INVALID' });
  const detected = detectFormat(rows[0]);
  if (!detected) {
    throw Object.assign(new Error('That doesn’t look like a password export — no “password” column was found.'), { code: 'INVALID' });
  }

  const { columns, format } = detected;
  const cell = (row, field) => (columns[field] === undefined ? '' : String(row[columns[field]] ?? '').trim());
  const entries = [];
  let skipped = 0;
  let totpIgnored = 0;

  for (const row of rows.slice(1)) {
    const type = cell(row, 'type').toLowerCase();
    if (format === 'Bitwarden' && type && type !== 'login') {
      skipped += 1; // secure notes, cards, identities
      continue;
    }
    const password = columns.password === undefined ? '' : String(row[columns.password] ?? '');
    let url = cell(row, 'url');
    if (format === 'LastPass' && url === 'http://sn') url = ''; // LastPass secure notes
    if (!password) {
      skipped += 1;
      continue;
    }

    let totp = null;
    const totpRaw = cell(row, 'totp');
    if (totpRaw) {
      try {
        totp = Otp.parseOtpInput(totpRaw);
      } catch {
        totpIgnored += 1;
      }
    }

    const username = cell(row, 'username');
    const label = cell(row, 'title') || hostnameOf(url) || username || 'Imported item';
    const favoriteRaw = cell(row, 'favorite').toLowerCase();
    entries.push({
      label: label.slice(0, 200),
      type: url ? 'Website' : 'Other',
      username: username.slice(0, 320),
      password: password.slice(0, 1024),
      url: url.slice(0, 2048),
      notes: cell(row, 'notes').slice(0, 10000),
      totp,
      favorite: ['1', 'true', 'yes'].includes(favoriteRaw),
    });
  }
  return { format, entries, skipped, totpIgnored };
}

module.exports = { parseCsv, detectFormat, parseImport, hostnameOf, MAX_FILE_BYTES };
