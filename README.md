# 🔐 Password Helper

**Password Helper** is a privacy-first password analyzer and encrypted password vault for the desktop, built with Electron.
It started as a PyQt6 strength checker and grew into a full app with a hardened Electron client and (soon) a self-hosted sync server.

> ⚠️ **Pre-production test build.** The account server isn't online yet, so login/register are validated but not connected —
> use **Skip for now**. The vault works fully offline and is encrypted on disk, but this is still a prototype:
> don't rely on it as your only copy of real passwords yet.

---

## ✨ Features

### 🛡️ Password Analyzer
- Strength estimate from [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn) with **English + Romanian** dictionaries — runs fully offline
- Checks based on **NIST SP 800-63B-4**: at least 15 characters, hard to guess, not in known breaches (no "must contain a symbol" rules)
- Optional **Have I Been Pwned** breach check using k-anonymity (only 5 hex characters of the SHA-1 hash leave the computer) with response padding
- Pattern insights (common words, names, keyboard patterns, years…) and an educational SHA-256 view
- Length counted in real characters (`ă`, `🔐` = 1)

### 🎲 Password Generator
- Random passwords (8–64 characters, choose a–z / A–Z / 0–9 / symbols, optionally avoid look-alikes like `Il1O0o`)
- Passphrases from the **EFF Large Wordlist** (3–12 words, separator, capitals, optional number)
- Uses the OS random generator with rejection sampling (no modulo bias) and shows the entropy in bits
- One click to copy, or to check the result in the Analyzer; your options are remembered
- 🎲 button inside the vault's password field fills in a fresh password

### 🗄️ Encrypted Vault
- One **master password** (never stored) protects everything
- **PBKDF2-HMAC-SHA256, 600,000 iterations** → **AES-256-GCM**; the file header is authenticated too
- Atomic saves (no half-written files) plus a `.bak` of the previous version
- Passwords are only sent to the page when you press 👁 and hide again after 30 s
- **Copy** username / password straight to the clipboard — copied passwords are wiped after 30 s (configurable), but only if you haven't copied something else since
- **Search** (Ctrl+F), sort, **edit**, delete with confirmation
- **Vault health**: weak and reused passwords are flagged; **Check breaches** tests every saved password against Have I Been Pwned
- Warnings when you save a duplicate entry or a password you already use elsewhere
- **Change master password**, **export / import encrypted backups** (`.phvault`)
- **Auto-lock** after inactivity (configurable), when the computer sleeps, and optionally when the window is minimised; **Ctrl+L** or the 🔓 pill in the titlebar locks it instantly
- Slower and slower retries after wrong master passwords
- Entries from older versions (unencrypted localStorage) are moved into the vault automatically and wiped

### ⚙️ Quality of life
- Remembers window size and position; optional skip of the login screen at startup
- Keyboard: **Esc** back, **Enter** submit, **Ctrl+L** lock, **Ctrl+F** search, **Ctrl+N** new entry, **Ctrl+G** generate
- Caps Lock warning on the unlock screen; matrix background can be switched off (and pauses when the window is hidden)

### 🔑 Account (coming with the server)
- Login / register screens with the same password policy (your e-mail counts as "easy to guess")

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

### Where your data lives

| OS | Folder |
|---|---|
| Linux | `~/.config/password-helper-electron/` |
| Windows | `%APPDATA%\password-helper-electron\` |
| macOS | `~/Library/Application Support/password-helper-electron/` |

- `vault.json` — the encrypted vault (`vault.json.bak` = previous version)
- `settings.json` — preferences (no secrets)

To start over, close the app and delete `vault.json` + `vault.json.bak` (this erases the vault — export a backup first).

Settings → **Open data folder** takes you there.

---

## 🧪 Tests and checks

```bash
npm test            # unit tests (node:test) — crypto, storage, policy, generator, HIBP, clipboard, auto-lock
npm run test:e2e    # end-to-end tests: launches the real app with Playwright
npm run lint        # ESLint
npm run check       # all of the above
```

The end-to-end tests use a temporary data folder and a fake Have I Been Pwned API, so they never touch your vault or the network.

## 📦 Building installers

```bash
npm run dist:linux  # → dist/*.AppImage and dist/*.deb
npm run dist:win    # → dist/*.exe (run on Windows)
```

Packaged builds turn on Electron's security fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS` / `--inspect`, and app code is only loaded
from `app.asar` (with integrity checks where the OS supports them). There's no app icon yet, so installers use Electron's default icon.

---

## 🔒 Security model

| Layer | What it does |
|---|---|
| **Process isolation** | Pages run sandboxed with context isolation and **no Node.js**. They can only call the small `window.api` exposed by `preload.js`. |
| **IPC checks** | The main process only answers requests coming from the app's own pages. Inputs are validated; errors come back as codes, never stack traces. |
| **Content-Security-Policy** | Every page: `script-src 'self'`, `connect-src 'none'`, no inline scripts or handlers. Pages can't reach the network at all. |
| **Navigation lock-down** | Navigation away from the app, new windows, `<webview>` and permission requests (camera, notifications, …) are blocked. |
| **Vault crypto** | Key = PBKDF2-HMAC-SHA256(NFKC(master password), 16-byte salt, 600k) → AES-256-GCM with a fresh 12-byte IV per save. The key and decrypted entries exist **only in the main process** and are dropped on lock. |
| **Breach checks** | Only a 5-character SHA-1 prefix is sent to `api.pwnedpasswords.com`, with `Add-Padding: true`. |
| **Single instance** | Only one copy of the app can run, so two processes never write the vault at once. |

**Limits worth knowing:** anything that can read your user account's memory or keystrokes (malware, a keylogger) can still capture the master password.
JavaScript can't securely wipe strings from memory, so decrypted data is dropped on lock but not overwritten. PBKDF2 is used instead of Argon2id because
Electron's crypto library (BoringSSL) has no Argon2 and PBKDF2 is available on every future client (web, Android, iOS) — the KDF settings are stored in the
vault header, so they can be raised later.

---

## 📂 Project structure

```plaintext
Password-Helper/
├── README.md
├── LICENSE
└── password-helper-electron/
    ├── main.js              # main process: window, security, IPC
    ├── preload.js           # the only bridge → window.api
    ├── src/
    │   ├── vault-store.js   # encrypted vault file (PBKDF2 + AES-256-GCM)
    │   ├── vault-service.js # auto-lock, health checks
    │   ├── settings-store.js
    │   ├── analysis.js      # zxcvbn-ts (EN + RO)
    │   ├── hibp.js          # Pwned Passwords range API
    │   └── clipboard-guard.js
    ├── public/              # pages (sandboxed renderer)
    │   ├── login.html  index.html  vault.html  vault_view.html
    │   ├── css/  base.css + one file per page
    │   ├── js/   common.js (titlebar, toasts, dialogs…), policy.js (shared rules),
    │   │         generator.js + wordlist-eff.js, page scripts
    │   └── icons/
    ├── tests/
    │   ├── unit/            # node --test
    │   └── e2e/             # Playwright + Electron
    ├── eslint.config.js
    ├── playwright.config.js
    └── package.json         # scripts + electron-builder config
```

---

## 🚧 Roadmap

- [x] Password strength analyzer (zxcvbn-ts, NIST SP 800-63B-4 checks)
- [x] Have I Been Pwned breach check (k-anonymity + padding)
- [x] Electron hardening (sandbox, context isolation, CSP, IPC validation)
- [x] Encrypted local vault (PBKDF2 600k + AES-256-GCM) with auto-lock
- [x] Password / passphrase generator, vault health and breach scan, encrypted backups
- [x] Unit + end-to-end tests, linting, installers
- [ ] Self-hosted sync server (Node.js + Express on the QNAP NAS, JWT auth) — client-side encryption, the server only stores ciphertext
- [ ] Expose the server through a static IPv4 (with firewall / HTTPS)
- [ ] Microsoft code signing and verification
- [ ] Web and mobile clients (Android / iOS)
- [ ] Optional biometric unlock

---

## 📜 History

Password Helper began as a local desktop tool focused on password strength analysis using **PyQt6**.
Once secure storage was needed, it was rebuilt as an **Electron** app with a custom backend, and then hardened:
sandboxed pages, an encrypted vault in the main process, and automated tests.

---

## 📄 License and credits

MIT © Matei Radu — see [LICENSE](LICENSE).

- Strength estimation: [zxcvbn-ts](https://github.com/zxcvbn-ts/zxcvbn) (MIT)
- Passphrase words: [EFF Large Wordlist](https://www.eff.org/dice) (CC BY 3.0 US)
- Breach data: [Have I Been Pwned — Pwned Passwords](https://haveibeenpwned.com/Passwords)
- Password rules: [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) · key-derivation settings: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
