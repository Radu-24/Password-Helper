# 🔐 Password Helper

**Password Helper** is a privacy-first password manager and strength analyzer for the desktop, built with Electron.
It started as a PyQt6 strength checker and grew into a full app with a hardened Electron client and (soon) a self-hosted sync server.

> ⚠️ **Pre-production test build.** The account server isn't online yet, so sign-in / create account are validated but not connected —
> choose **Continue without an account**. The vault works fully offline and is encrypted on disk, but this is still a prototype:
> don't rely on it as your only copy of real passwords yet.

---

## ✨ Features

### 🖥️ A Mac-style window (new in 2.0)
- Floating **glass sidebar** and panels over the **matrix rain** background — the rain shows softly through every surface
- Vault laid out like a native password manager: **list + detail**, inline editing, sheets, alerts, pop-up menus and **right-click menus**
- Spring animations everywhere they answer something you did; passwords **"decode" out of the rain** when they appear
- **Accent colours** (9), rain brightness, **Reduce motion** and **Reduce transparency** (solid panels — faster on computers without graphics acceleration)
- Resizable, collapsible sidebar; the window remembers its size and the last section you used
- Welcome screen on first launch; keyboard shortcuts for everything common (see below)

### 🛡️ Analyzer
- Strength estimate from [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn) with **English + Romanian** dictionaries — runs fully offline
- Checks based on **NIST SP 800-63B-4**: at least 15 characters, hard to guess, not in known breaches (no "must contain a symbol" rules)
- **Time to crack** for four attack scenarios (offline slow / fast hash, online with / without rate limits)
- Optional **Have I Been Pwned** breach check using k-anonymity (only 5 hex characters of the SHA-1 hash leave the computer) with response padding
- Pattern insights (common words, names, keyboard patterns, years…) and an educational SHA-256 view
- Length counted in real characters (`ă`, `🔐` = 1)

### 🎲 Generator
- Random passwords (8–64 characters, choose A–Z / a–z / 0–9 / symbols, optionally avoid look-alikes like `Il1O0o`)
- Passphrases from the **EFF Large Wordlist** (3–12 words, separator, capitals, optional number)
- OS random generator with rejection sampling (no modulo bias); entropy shown in bits
- Digits and symbols are **colour-coded**; one click to **copy**, **analyze**, or **save as a new vault item**

### 🗄️ Vault
- One **master password** (never stored) protects everything — **PBKDF2-HMAC-SHA256, 600,000 iterations** → **AES-256-GCM**
- Items: title, username, password, **website**, type, notes, **favourite**, **verification code**
- Passwords reach the page only when you reveal one (hidden again after 30 s); **copy** goes straight from the main process to the clipboard and is wiped after 30 s (configurable)
- **Search** (Ctrl+F), sort by name / date / type, keyboard navigation, right-click menu
- **Recently Deleted**: deleted items stay 30 days (with **Undo**), then they're removed for good
- Warnings for duplicates and reused passwords; **Change master password**; **encrypted backups** (`.phvault`)
- **Auto-lock** after inactivity, on sleep, optionally on minimise; **Ctrl+L** locks instantly; growing delays after wrong master passwords

### ⏱️ Verification codes (2FA)
- Time-based one-time codes (**TOTP, RFC 6238**: SHA-1/256/512, 6–8 digits) right next to the password they protect
- Set up from the **setup key**, an **`otpauth://` link**, or a **QR code**: take a screenshot of it, then press *Paste QR Code*
- A live preview shows the current code before you save, so you can compare it with the website
- **The secret never leaves the main process** — the page only ever receives the current code
- *Verification Codes* view: every code with its countdown ring; click to copy
- Not supported: counter-based codes (HOTP) and Steam Guard's custom format

### 📥 Import from browsers and password managers
- CSV exports from **Chrome / Edge / Brave / Opera, Firefox, Safari / Apple Passwords, Bitwarden, 1Password, KeePassXC, LastPass** — or any CSV with a password column
- The file is read and parsed in the main process; you see a preview (count, format, likely duplicates) before anything is saved
- Exact duplicates are skipped; 2FA keys in the export (Bitwarden, 1Password, Apple, KeePassXC, LastPass) come along
- Afterwards the app offers to move the **plain-text export file to the Trash**
- Where to export: Chrome — `chrome://password-manager/settings` → *Export passwords*; Firefox — `about:logins` → ⋯ → *Export Passwords*; other apps — look for *Export* in their password settings and pick **CSV**

### 🔒 Security view
- **Breached**, **reused** and **weak** passwords with what to do about each, and *Change on Website* shortcuts
- *Check for Breaches* tests every saved password against Have I Been Pwned (hash prefixes only)

### 🔑 Account (coming with the server)
- Sign-in / create-account screens with the same password policy (your email counts as "easy to guess")

---

## 🚀 Getting started

**Requirements:** Node.js **22.13 or newer** (`node -v`) and git.

```bash
git clone https://github.com/Radu-24/Password-Helper.git
cd Password-Helper/password-helper-electron
npm install
npm start          # the first start downloads the Electron binary (~100 MB)
```

Need a newer Node? With [nvm](https://github.com/nvm-sh/nvm): `nvm install 22 && nvm use 22`.

On first launch you get a welcome screen, then sign-in (skip it), then the main window. Open **All Items** to create the vault.

### ⌨️ Keyboard shortcuts

On macOS use ⌘ instead of Ctrl.

| Shortcut | Action |
|---|---|
| Ctrl+1 … Ctrl+6 | Analyzer, Generator, All Items, Favourites, Verification Codes, Security |
| Ctrl+, | Settings |
| Ctrl+F | Search the vault |
| Ctrl+N | New item |
| Ctrl+E / Enter | Edit the selected item |
| Ctrl+C / Ctrl+Shift+C | Copy the selected item's password / username |
| ↑ ↓ Home End | Move through the list; Delete removes the selected item |
| Ctrl+G | Generate a password (in the Generator or the item editor) |
| Ctrl+L | Lock the vault |
| Ctrl+Shift+S | Show or hide the sidebar |
| Esc | Close the sheet / menu, cancel editing |

### 📁 Where your data lives

| OS | Folder |
|---|---|
| Linux | `~/.config/password-helper-electron/` |
| Windows | `%APPDATA%\password-helper-electron\` |
| macOS | `~/Library/Application Support/password-helper-electron/` |

- `vault.json` — the encrypted vault (`vault.json.bak` = previous version)
- `settings.json` — preferences (no secrets)

To start over, close the app and delete `vault.json` + `vault.json.bak` (this erases the vault — export a backup first).
Settings → **Data Folder** takes you there.

---

## 🧪 Tests and checks

```bash
npm test            # unit tests (node:test) — crypto, storage, TOTP (RFC 6238 vectors), CSV import, policy, generator, HIBP…
npm run test:e2e    # end-to-end tests: launches the real app with Playwright and clicks through it
npm run lint        # ESLint
npm run check       # all of the above
```

The end-to-end tests use a temporary data folder, stubbed file dialogs and a fake Have I Been Pwned API, so they never touch your vault, your files or the network.

### 🎨 Icons and artwork

```bash
npm install --no-save lucide-static@1.49.0 && npm run icons   # rebuilds public/js/icons.js from the icons the code uses
npm run icon:svg && npm run icon:png                          # regenerates the app icon (SVG → build/icon.png, public/img/app-icon-256.png)
```

## 📦 Building installers

```bash
npm run dist:linux  # → dist/*.AppImage and dist/*.deb
npm run dist:win    # → dist/*.exe (run on Windows)
```

Packaged builds turn on Electron's security fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS` / `--inspect`, and app code is only loaded
from `app.asar` (with integrity checks where the OS supports them). Installers use the app icon in `build/icon.png`.

---

## 🔒 Security model

| Layer | What it does |
|---|---|
| **Process isolation** | The page runs sandboxed with context isolation and **no Node.js**. It can only call the small `window.api` exposed by `preload.js`. |
| **IPC checks** | The main process only answers requests coming from the app's own page. Inputs are validated; errors come back as codes, never stack traces. |
| **Content-Security-Policy** | `default-src 'none'`, `script-src 'self'`, `connect-src 'none'`, no inline scripts or styles. The page can't reach the network at all; fonts and icons ship with the app. |
| **Navigation lock-down** | Navigation away from the app, new windows, `<webview>` and permission requests (camera, notifications, …) are blocked. *Open website* only accepts `http(s)` addresses. |
| **Vault crypto** | Key = PBKDF2-HMAC-SHA256(NFKC(master password), 16-byte salt, 600k) → AES-256-GCM with a fresh 12-byte IV per save. The key and decrypted items exist **only in the main process** and are dropped on lock. |
| **2FA secrets** | Stored inside the encrypted vault; codes are computed in the main process. The page never receives a secret — not in the list, not in the editor. |
| **CSV import** | Read and parsed in the main process; the plain-text rows are dropped as soon as they're imported (or when the vault locks). |
| **Breach checks** | Only a 5-character SHA-1 prefix is sent to `api.pwnedpasswords.com`, with `Add-Padding: true`. |
| **Single instance** | Only one copy of the app can run, so two processes never write the vault at once. |

**Limits worth knowing:** anything that can read your user account's memory or keystrokes (malware, a keylogger) can still capture the master password.
JavaScript can't securely wipe strings from memory, so decrypted data is dropped on lock but not overwritten. Keeping 2FA codes next to passwords is
convenient, but it means one vault holds both factors — keep the master password strong. PBKDF2 is used instead of Argon2id because Electron's crypto
library (BoringSSL) has no Argon2 and PBKDF2 is available on every future client (web, Android, iOS) — the KDF settings are stored in the vault header,
so they can be raised later.

---

## 📂 Project structure

```plaintext
Password-Helper/
├── README.md
├── LICENSE
└── password-helper-electron/
    ├── main.js                 # main process: window, security, IPC
    ├── preload.js              # the only bridge → window.api
    ├── src/
    │   ├── vault-store.js      # encrypted vault file (PBKDF2 + AES-256-GCM), Recently Deleted
    │   ├── vault-service.js    # auto-lock, health checks, 2FA codes
    │   ├── totp.js             # RFC 6238 / 4226 codes
    │   ├── csv-import.js       # browser / password-manager CSV exports
    │   ├── qr.js               # QR codes from the clipboard (jsQR)
    │   ├── settings-store.js
    │   ├── analysis.js         # zxcvbn-ts (EN + RO)
    │   ├── hibp.js             # Pwned Passwords range API
    │   └── clipboard-guard.js
    ├── public/                 # the page (sandboxed renderer) — one window, many views
    │   ├── index.html
    │   ├── css/   tokens · base · controls · shell · overlays · views
    │   ├── js/    core · matrix · overlays · controls · app · vault-model
    │   │          policy · otp · generator (+ EFF wordlist) · strength · icons (Lucide)
    │   │   └── views/  analyzer · generator · vault · item-editor · codes · security · settings · vault-gate · onboarding
    │   ├── fonts/  Inter, JetBrains Mono (OFL)
    │   └── img/    app icon
    ├── build/icon.png          # installer icon
    ├── scripts/                # icon builders
    ├── tests/
    │   ├── unit/               # node --test
    │   └── e2e/                # Playwright + Electron
    ├── eslint.config.js
    ├── playwright.config.js
    └── package.json            # scripts + electron-builder config
```

---

## 🚧 Roadmap

- [x] Password strength analyzer (zxcvbn-ts, NIST SP 800-63B-4 checks)
- [x] Have I Been Pwned breach check (k-anonymity + padding)
- [x] Electron hardening (sandbox, context isolation, CSP, IPC validation)
- [x] Encrypted local vault (PBKDF2 600k + AES-256-GCM) with auto-lock
- [x] Password / passphrase generator, vault health and breach scan, encrypted backups
- [x] Unit + end-to-end tests, linting, installers
- [x] 2.0: Mac-style interface, verification codes (TOTP), import from browsers, favourites, Recently Deleted, app icon
- [ ] Self-hosted sync server (Node.js + Express on the QNAP NAS, JWT auth) — client-side encryption, the server only stores ciphertext
- [ ] Expose the server through a static IPv4 (with firewall / HTTPS)
- [ ] Microsoft code signing and verification
- [ ] Web and mobile clients (Android / iOS)
- [ ] Optional biometric unlock

---

## 📜 History

Password Helper began as a local desktop tool focused on password strength analysis using **PyQt6**.
Once secure storage was needed, it was rebuilt as an **Electron** app with a custom backend, then hardened:
sandboxed pages, an encrypted vault in the main process, and automated tests. Version 2.0 rebuilt the interface
as a single Mac-style window and added verification codes and imports.

---

## 📄 License and credits

MIT © Matei Radu — see [LICENSE](LICENSE). The app icon is original artwork, MIT-licensed with the app.

- Strength estimation: [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn) (MIT)
- QR decoding: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)
- Icons: [Lucide](https://lucide.dev) (ISC) · fonts: [Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (SIL OFL 1.1)
- Passphrase words: [EFF Large Wordlist](https://www.eff.org/dice) (CC BY 3.0 US)
- Breach data: [Have I Been Pwned — Pwned Passwords](https://haveibeenpwned.com/Passwords)
- Password rules: [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) · key-derivation settings: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- One-time codes: [RFC 6238 (TOTP)](https://www.rfc-editor.org/rfc/rfc6238) and [RFC 4226 (HOTP)](https://www.rfc-editor.org/rfc/rfc4226)
