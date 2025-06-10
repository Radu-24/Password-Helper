# 🔐 Password Helper

**Password Helper** is a full-stack, privacy-first password manager designed to offer powerful security tools in a sleek and modern interface.  
Originally built in PyQt6 as a password strength analyzer, it has since evolved into a full Electron app with custom backend integration — fully self-hosted for local security and future global scaling.

> ⚠️ Currently in **prototype stage**, running on a private QNAP NAS with Docker.  
> The app will remain local-only until a static IPv4 is obtained. Once stable, it will be submitted for Microsoft certification and made publicly available.

---

## 📜 History

Password Helper began as a local desktop tool focused on password strength analysis using PyQt6.  
Once the need for secure storage and account-bound encryption emerged, the app was redesigned from scratch into a modern full-stack architecture:

- 💻 Electron frontend with HTML, CSS, and JavaScript
- 🔍 Live password strength analysis using `zxcvbn`
- 🔐 SHA-256 generator and breach check via Have I Been Pwned API
- 🧠 Custom SPA layout with animated transitions, toast notifications, and requirement tracking
- 🔧 Backend running on Node.js + Express, containerized via Docker on a private NAS

---

## 🌍 Project Scope

Password Helper includes:

- ✅ Electron desktop interface with dark-themed matrix visuals
- ✅ Password analyzer with animated strength bar and real-time feedback
- ✅ Live requirement list that dynamically fades out upon fulfillment
- ✅ SHA-256 hash generator + data breach check
- ✅ JWT-protected login/register system
- 🧱 Encrypted password vault (AES-256 support in development)
- ⚙️ Custom settings for password clearing and UI behavior
- 📱 Future: Web app + mobile client for encrypted sync

---

## 🔒 Security Highlights

### ✅ Implemented
- 🔑 JWT authentication with access token expiration
- 🔐 `bcrypt` password hashing for all credentials
- 📊 Real-time strength validation via `zxcvbn`
- 📡 Have I Been Pwned API integration for breach detection
- 🔐 Sensitive fields hidden from memory or reflow
- 📦 Server logic runs only in Docker on local NAS
- 🔒 No password or vault content stored unencrypted

### 🧩 In Progress
- 🧱 AES-256 encryption layer for stored vault data
- 🔐 Per-user encryption key model
- 🛡 Rate limiting, secure headers, and CORS lockdown
- ⏳ Session timeouts and client auto-logout

---

## 📦 Stack

- **Frontend:** HTML, CSS, JavaScript, Electron
- **Backend:** Node.js, Express.js
- **Database:** MongoDB 4.4
- **Security:** AES-256 (WIP), JWT, bcrypt, HTTPS (planned)
- **Hosting:** Docker on QNAP NAS
- **Utilities:** Postman, GitHub Desktop, custom test scripts

---

## 🚧 Roadmap

- [x] Design and implement password strength analyzer
- [x] Migrate UI to Electron SPA with dynamic routing
- [x] Integrate `zxcvbn` and real-time validation
- [x] Create toast system and requirement animations
- [x] Develop Node.js backend with JWT auth
- [x] Dockerize and host backend on NAS (port 5099)
- [ ] Finalize AES-256 encryption for password vault
- [ ] Complete CRUD vault operations with encryption
- [ ] Expose server through static IPv4 (with firewall)
- [ ] Submit app for Microsoft verification
- [ ] Build mobile client (Android/iOS)
- [ ] Develop web-accessible version
- [ ] Add optional biometric unlock and secure sync

---

## 🧠 Current Development Focus

> 🔐 Vault encryption using AES-256 (in progress)  
> ⚙️ Backend CRUD endpoint testing via Postman  
> 🧱 JWT auth system and route protection completed  
> 🧪 Frontend and backend tested locally via Docker on QNAP NAS  
> 🔜 Planning external access, sync, and secure mobile integration

---

## 📂 Project Structure

```plaintext
Password-Helper/
├── backend/
│   ├── Dockerfile
│   ├── .env (excluded from repo)
│   ├── routes/
│   ├── models/
│   └── server.js
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── vault_view.html
│   ├── scripts/
│   └── styles/
└── README.md
```

---

## ⚠️ Warning

This project is still under active development.  
Do **NOT** store real-world or production passwords in the current prototype.  
Vault encryption is incomplete and cloud access is not yet secured.

---

## 📞 Contact

A support page and issue tracker will go live once the first public version is released.  
For now, feedback and testing are limited to internal use.

---

## ⭐️ Contribute

This repo is currently private and closed to outside contributions until the encryption and API systems are fully stabilized.  
Once ready, external code reviews and feature ideas will be welcome.
