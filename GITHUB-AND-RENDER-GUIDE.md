# Push to GitHub + deploy on Render — complete guide

Everything below is written for **this** project (Sawaari) and reflects the
files as they are today. Follow it top to bottom the first time.

---

## 0. Your project at a glance (the facts the rest of this guide depends on)

| | |
|---|---|
| **Project type** | **Node + Express API** (PostgreSQL, Socket.IO) **+ React (Vite) front end** |
| **Render resources** | 3 — Postgres + **Web Service** (API) + **Static Site** (web app) |
| **Node version** | **20** (`engines: { "node": ">=20 <25" }` in both package.json files) |
| **Local run** | `start-sawaari.ps1` (Windows) · `cd server && npm start` + `cd web && npm run dev` |
| **Build command** | `npm ci --include=dev && npm run migrate && npm run seed && npm run seed:superadmin` (API) · `npm ci --include=dev && npm run build` (web) |
| **Start command** | `node src/index.js` (API) |
| **Publish directory** | `./dist` (web, relative to root `web`) |
| **Health check** | `/api/health` |
| **Database** | Render Postgres → `DATABASE_URL` is injected automatically |
| **Secrets in the repo** | none — everything lives in `server/.env` locally and in Render's Environment tab |

### Folder structure

```
sawaari/
├── server/                    ← the API (Render "Web Service", root dir = server)
│   ├── src/
│   │   ├── index.js           ← app + server.listen(PORT)
│   │   ├── config.js          ← reads every environment variable
│   │   ├── routes/            ← auth, bookings, drivers, admin, super…
│   │   ├── services/          ← rbac, audit, crypto, adminSession, ownerCheck
│   │   ├── scripts/           ← migrate/seed/test/backup helpers
│   │   ├── db.js, migrate.js, seed.js
│   ├── .env                   ← LOCAL ONLY, never committed
│   ├── .env.example           ← the committed template (no real values)
│   └── package.json
├── web/                       ← the front end (Render "Static Site", root dir = web)
│   ├── src/                   ← React pages, components, api.js
│   ├── public/                ← manifest.webmanifest, sw.js, icons
│   ├── capacitor.config.json  ← Android wrapper config
│   ├── android/               ← the native Android project
│   ├── package.json
│   └── vite.config.js
├── electron/                  ← Windows desktop shell + NSIS installer scripts
├── scripts/                   ← build, audit, packaging, verification tooling
├── render.yaml                ← the Render blueprint (one-click)
├── render / fly / docker      ← RENDER.md, fly.toml, Dockerfiles, Procfile
├── .gitignore
└── README.md
```

### Environment variables the code reads (names only)

**Required in production**

`DATABASE_URL` (injected by Render) · `JWT_SECRET` · `OTP_PEPPER` ·
`ADMIN_TOTP_ENCRYPTION_KEY` · `SUPER_ADMIN_PASSWORD` · `SUPER_ADMIN_EMAIL` ·
`APP_URL` · `NODE_ENV` · `PORT` (injected by Render)

**Optional — features stay off without them**

`ADMIN_EMAIL` · `ADMIN_PASSWORD` · `ADMIN_PHONE` · `SUPER_ADMIN_NAME` ·
`SUPER_ADMIN_PHONE` · `UPLOAD_DIR` · `SMS_PROVIDER` · `SMS_DEV_MODE` ·
`MSG91_AUTH_KEY` · `MSG91_SENDER_ID` · `MSG91_TEMPLATE_ID` ·
`TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` · `TWILIO_FROM` ·
`SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `SMTP_PASS` · `SMTP_FROM` ·
`RAZORPAY_KEY_ID` · `RAZORPAY_KEY_SECRET` · `RAZORPAY_WEBHOOK_SECRET` ·
`VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` ·
`OSRM_BASE_URL` · `OSRM_FALLBACK_URLS` · `NOMINATIM_BASE_URL` ·
`ADMIN_MAX_LOGIN_ATTEMPTS` · `ADMIN_LOCKOUT_MINUTES` ·
`ADMIN_MAX_FAILED_ATTEMPTS` · `ADMIN_ACCOUNT_LOCK_MINUTES` ·
`ADMIN_SESSION_HOURS` · `ADMIN_INVITE_EXPIRY_HOURS` ·
`ADMIN_LOGIN_RATE_LIMIT` · `ADMIN_2FA_RATE_LIMIT` · `NODE_VERSION`

---

## 1. GitHub repository settings

Open <https://github.com/new> and create the repository like this:

| Setting | Value | Why |
|---|---|---|
| **Owner** | `raju7895` | the account your Git credentials are signed in as |
| **Repository name** | `sawaari` | the remote is already `https://github.com/raju7895/sawaari.git`; the name must match the remote you push to |
| **Visibility** | **Private** | the git history contains your e-mail address and a legacy password — a private repo keeps them out of search engines. You can flip it later, but the history keeps them either way |
| **Default branch** | `main` | the branch Render will watch; the local repo is already on `main` |
| **Add a README** | **uncheck** | the project already has a full `README.md` — a second one causes a conflict on the first push |
| **Add .gitignore** | **uncheck** | the project has a tailored `.gitignore`; letting GitHub add a Node template would overwrite it |
| **Choose a license** | **uncheck** | optional; the project is `private: true` and `UNLICENSED` |
| **Initialize with…** | nothing | you initialise locally, so no "Import" / "Push existing" commit |

If the repository already exists (it does), verify instead of creating:

```bash
git remote -v      # must print https://github.com/raju7895/sawaari.git
git branch --show-current   # must print main
```

---

## 2. `.gitignore` (already in the repo — keep it as it is)

The file exists and is tailored. Copy this into `.gitignore` only if you
are recreating the project from scratch:

```gitignore
# Dependencies
node_modules/

# Build output
web/dist/
web/.vite/

# Environment & secrets
.env
.env.*
!.env.example

# Uploads (user documents, avatars)
server/uploads/*/*
!server/uploads/avatars/.gitkeep
!server/uploads/documents/.gitkeep
!server/uploads/vehicles/.gitkeep

# Database dumps + the generated super-admin credentials file (never commit)
server/backups/

# Logs
logs/
.logs/
*.log
npm-debug.log*

# Build toolchains and generated installers
.toolchain/
dist-android/
dist-windows/
electron/node_modules/
electron/dist/
web/android/.gradle/
web/android/build/
web/android/app/build/
web/android/local.properties
web/android/gradle/
web/android/gradlew
web/android/gradlew.bat
web/android/capacitor-cordova-android-plugins/
web/android/app/src/main/assets/public/

# Android release signing — never commit these
web/android/*.keystore
web/android/keystore.properties
*.jks

# OS/editor noise
.DS_Store
Thumbs.db
desktop.ini
.idea/
.vscode/
*.swp

# Local DB dumps
*.sql.gz
*.dump
```

**Verify nothing sensitive is tracked** (must print nothing):

```bash
git ls-files | grep -E "\.env$|\.env\.local$|keystore|\.jks$|backups/" 
```

---

## 3. Terminal commands

### 3a. Windows (PowerShell)

```powershell
cd C:\Users\zerox\Downloads\transport

# 1. make sure the repo exists and the remote is right
git status
git remote -v

# 2. stage everything, then LOOK at what is about to be committed
git add -A
git status                     # read the list — no .env, no keystore, no backups

# 3. run the project's own safety checks before committing
node scripts/audit-before-push.js    # must print "0 secret leaks / 0 personal-data hits"
node scripts/deploy-audit.js         # must print "CONFIRMED (0)"

# 4. commit
git add -A
git commit -m "Your change description here"

# 5. push (first time)
git push -u origin main
# (later pushes are just: git push)
```

### 3b. macOS / Linux (bash)

```bash
cd ~/Downloads/transport

git status
git remote -v

git add -A
git status

node scripts/audit-before-push.js
node scripts/deploy-audit.js

git add -A
git commit -m "Your change description here"

git push -u origin main
```

### 3c. If you are starting a brand-new repository instead

```bash
# Windows PowerShell
git init
git branch -M main
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/raju7895/sawaari.git
git push -u origin main
```

```bash
# macOS / Linux
git init
git branch -M main
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/raju7895/sawaari.git
git push -u origin main
```

**If `git push` asks for credentials:** GitHub no longer accepts account
passwords. Use a **Personal Access Token** (GitHub → *Settings* →
*Developer settings* → *Personal access tokens* → *Fine-grained tokens* →
repo scope → *Contents: read and write*), or sign in with the browser
(`git config --global credential.helper manager` on Windows / `git
config --global credential.helper osxkeychain` on macOS). This machine
already has Git Credential Manager configured for `raju7895`.

**There is a helper too:** double-click `push-to-github.bat` (Windows) — it
runs the secret audit, checks the remote and pushes.

---

## 4. Render settings

### 4a. The one-click path (recommended)

The repository contains `render.yaml`, a Render **blueprint**. It creates
the database, the API and the static site with the right commands.

1. Render → **New** → **Blueprint**
2. Select `raju7895/sawaari` → **Apply**
3. Render will ask for the values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `SUPER_ADMIN_EMAIL` | your Gmail address |
   | `SUPER_ADMIN_PASSWORD` | your deployment secret — **no spaces, no `#`, no quotes** |
   | `APP_URL` | `https://<your-static-site>.onrender.com` |
   | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | optional |

   `JWT_SECRET`, `OTP_PEPPER` and `ADMIN_TOTP_ENCRYPTION_KEY` are generated
   automatically (`generateValue: true`).

### 4b. The manual path — exact values

**Resource 1 — Postgres**

| Field | Value | Why |
|---|---|---|
| Name | `sawaari-db` | referenced by the services |
| Region | Mumbai (or nearest to your riders) | latency for your users |
| Plan | `basic-256mb` (paid) or `free` | the free DB is wiped after 30 days |

Render injects `DATABASE_URL` into every service linked to this database.

**Resource 2 — API (Web Service)**

| Field | Value | Why |
|---|---|---|
| **Service type** | **Web Service** | it runs a Node process, not static files |
| **Root Directory** | `server` | the API's package.json lives there |
| **Build Command** | `npm ci --include=dev && npm run migrate && npm run seed && npm run seed:superadmin` | `--include=dev` is mandatory (see §5); migrate/seed create the schema and the cities |
| **Start Command** | `node src/index.js` | starts the server on `$PORT` |
| **Health Check Path** | `/api/health` | Render waits for this before routing traffic |
| **Instance type** | `starter` | the free tier sleeps and has strict limits |
| **Branch** | `main` | matches the local branch |
| **Auto-Deploy** | **Yes** | every push to `main` rebuilds and redeploys |
| **Node version** | env `NODE_VERSION=20` | `engines.node` in package.json is the fallback |
| **Env `FRONTEND_URL`** | `https://<your-static-site>.onrender.com` | the **CORS allowlist** — the browser may only call the API from this origin |

**Resource 3 — Web app (Static Site)**

| Field | Value | Why |
|---|---|---|
| **Service type** | **Static Site** | the front end is a static Vite bundle |
| **Root Directory** | `web` | the front end's package.json lives there |
| **Build Command** | `npm ci --include=dev && npm run build` | produces `dist/` |
| **Publish Directory** | `./dist` | relative to the root directory `web` |
| **Rewrite rule** | `/*` → `/index.html` | without it every deep link (`/admin/bookings`) returns 404 |
| **Branch / Auto-Deploy** | `main` / Yes | |
| **Env `VITE_API_URL`** | `https://<your-api-service>.onrender.com` | the **API address**, read at build time — https, no trailing slash |

> **`VITE_API_URL` is compiled into the bundle.** After changing it you must
> use **Clear build cache & deploy** (not just *Save & Deploy*) on the static
> site — a cached build keeps the old address and every request keeps failing.

> **Deploy order: API first, then the static site.** The static site needs
> the API's address before it can be built, and the API needs the static
> site's address for `FRONTEND_URL`. Build the API → copy its address into
> the static site's `VITE_API_URL` → build the static site.

### 4c. Environment variables (Render → Environment tab)

Secrets are entered **only** in Render's Environment tab, never in a
committed file. To move a local value over:

```powershell
# read the value from your local .env (do NOT paste it into the repo)
Get-Content server\.env | Select-String "SUPER_ADMIN_PASSWORD"
```

Then in Render: **Environment → Add from .env** (pastes a whole file) or
**Add from .env → + Add** for a single key.

| Key | Example value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `NODE_VERSION` | `20` | |
| `DATABASE_URL` | *(leave empty)* | Render injects it |
| `JWT_SECRET` | *(Generate button)* | ≥ 32 chars — the API refuses to start otherwise |
| `OTP_PEPPER` | *(Generate button)* | ≥ 16 chars |
| `ADMIN_TOTP_ENCRYPTION_KEY` | *(Generate button)* | encrypts the 2FA secrets at rest |
| `SUPER_ADMIN_EMAIL` | `you@example.com` | the owner account |
| `SUPER_ADMIN_PASSWORD` | `YourStrongSecret2026` | **no spaces, no `#`, no quotes** |
| `SUPER_ADMIN_NAME` | `Platform Owner` | shown in the console |
| `APP_URL` | `https://sawaari-web.onrender.com` | used in share links |
| `FRONTEND_URL` | `https://sawaari-web.onrender.com` | **CORS allowlist** — the API only answers this origin (comma separated for several). Empty = any origin allowed |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | *(optional)* | a staff admin; generated if unset |
| `RAZORPAY_KEY_ID` / `_SECRET` / `_WEBHOOK_SECRET` | *(optional)* | UPI QR and cash work without them |
| `SMS_PROVIDER` | `none` | `msg91` / `twilio` to enable SMS |
| `SMS_DEV_MODE` | `false` | **must be false in production** (otherwise OTPs are printed in the log) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | *(optional)* | email verification and password reset |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | *(optional)* | web push |
| `VITE_API_URL` | `https://sawaari-api.onrender.com` | **static site only** |

> **Secrets stay out of the repo.** `server/.env` is git-ignored; only
> `server/.env.example` (empty placeholders) is committed. Run
> `node scripts/audit-before-push.js` before every push — it fails the
> commit if a live value appears in a tracked file.

---

## 5. Code changes Render needs (all already done in this project)

| # | What Render requires | Where | Status |
|---|---|---|---|
| 1 | The server must listen on `$PORT`, not a hardcoded port | `server/src/index.js` → `server.listen(config.port)`; `config.js` reads `process.env.PORT` (default 4000) | ✅ done |
| 2 | The build must not lose its tools when `NODE_ENV=production` | every build command uses `npm ci --include=dev` | ✅ done |
| 3 | The Node version must be pinned | `engines: { "node": ">=20 <25" }` in `server/package.json` and `web/package.json` | ✅ done |
| 4 | The app must know it sits behind a proxy | `app.set('trust proxy', 1)` in `server/src/index.js` — without it every request looks like it comes from the proxy and the per-IP rate limiter blocks all logins | ✅ done |
| 5 | A `start` script must exist | `server/package.json` → `"start": "node src/index.js"` | ✅ done |
| 6 | Schema and seed data must exist before traffic arrives | the build command runs `npm run migrate && npm run seed && npm run seed:superadmin` | ✅ done |
| 7 | The client needs the API address at build time | `web/src/serverConfig.js` resolves *saved address → `VITE_API_URL` → same origin (probed) → dev fallback* | ✅ done |
| 8 | The API must allow the front end's origin | `server/src/index.js` builds the CORS allowlist from `FRONTEND_URL` + `APP_URL` (+ dev origins outside production) | ✅ done |

**If you ever add a new service**, the three things that break Render are:
a hardcoded port, a missing `--include=dev`, and a start command that does
not read `$PORT`.

---

## 6. Verify the deployment

### Right after the first deploy

1. **API health** — open `https://sawaari-api.onrender.com/api/health` →
   `{"ok":true, "integrations":{"database":true}}`.
   *`database:false` means the database is not attached or `DATABASE_URL` is wrong.*
2. **Static site** — open `https://sawaari-web.onrender.com` → the landing
   page loads. Deep link `https://sawaari-web.onrender.com/admin-login` →
   it must load the admin login, **not** 404 (that tests the rewrite rule).
3. **Owner sign-in** — `https://sawaari-web.onrender.com/admin-login` with
   `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD`.
4. **2FA enrolment** — in Render's **Shell** tab:

   ```bash
   cd server && npm run admin:2fa -- --code
   ```

   It prints the TOTP secret, the `otpauth://` URI, the backup codes and a
   live 6-digit code. Add it to Google Authenticator / Authy / 1Password.
5. **Installed apps** — open the APK or the desktop app → *Server settings*
   → `https://sawaari-api.onrender.com` → *Test connection* → *Save & reload*.

### The project's own end-to-end check

```bash
node scripts/verify-render-build.js
```

It clones the repository into a temp folder, creates a **fresh database**,
runs the exact build commands, starts the API, polls `/api/health`, signs
the owner in, builds the web app and inspects the bundle — **23 checks**.
Run it before you push; it reproduces a Render deploy without touching
Render.

### Common errors

| Symptom in the Render log | Cause | Fix |
|---|---|---|
| `'vite' is not recognized as an internal or external command` | `npm ci` skipped devDependencies because `NODE_ENV=production` | use `npm ci --include=dev` in the build command |
| `Refusing to start in production: JWT_SECRET is missing…` | the secret env var was not set (or is the published default) | set `JWT_SECRET` (Generate) and `OTP_PEPPER`, then redeploy |
| `npm ci can only install with an existing package-lock.json` | `package-lock.json` was not committed, or `package.json` changed without it | run `npm install` locally and commit the updated lockfile |
| Health check failed | wrong Root Directory, or a start command that does not bind `$PORT` | Root Directory `server`, start `node src/index.js`, health `/api/health` |
| The site loads but every deep link 404s | the rewrite rule is missing | Static Site → *Redirects & Rewrites* → `/*` → `/index.html` |
| The web app talks to the wrong / no API | `VITE_API_URL` is read at **build** time | set it in the static site's Environment tab, then **Clear build cache & deploy** |
| Owner login rejected after the first deploy | `SUPER_ADMIN_PASSWORD` was empty — the seed generated a random one that vanished with the container | set the variable and redeploy |
| Owner login rejected but the password is right | the 2FA code is missing or the secret changed | `npm run admin:2fa -- --code` in the Shell |
| Logins blocked from one network ("too many attempts") | the rate limiter cannot see the real client IP | `app.set('trust proxy', 1)` must be present (it is) |
| `ECONNREFUSED … 5432` in the log | the database is not attached | create the Postgres and link it to the service, or set `DATABASE_URL` |
| Build runs out of minutes | the free tier's 100 build minutes/month are used up | Starter plan; or rebuild less often |
| Uploads vanish after a redeploy | Render's filesystem is ephemeral | attach a disk or use object storage |

---

## 7. Pushing future updates

### The loop

```powershell
# 1. edit your code

# 2. test it locally
cd server
node src/scripts/e2e-test.js            # 61/61
node src/scripts/test-admin-api.js      # 64/64
node src/scripts/cross-client-test.js   # 21/21
cd ..

# 3. the safety checks (both must pass)
node scripts/audit-before-push.js       # 0 secret leaks, 0 personal-data hits
node scripts/deploy-audit.js            # CONFIRMED (0)

# 4. commit and push
git add -A
git commit -m "feat: what changed"
git push                                # → Render auto-deploys main
```

On macOS/Linux the commands are identical (`node` works the same).

### What happens after the push

1. Render notices the new commit on `main` and starts a build.
2. The API service rebuilds, re-runs the migrations and the seeds, and
   restarts. **Migrations run automatically** — add a new `server/src/db/…`
   migration file and it is applied on the next deploy.
3. The static site rebuilds with the current `VITE_API_URL`.
4. Watch it: Render → your service → *Events* (live log) or the deploy
   badge on the repo.

### Roll back

Render keeps the previous build: **Deploys → pick the last good one →
*Rollback to this deploy***. For a code rollback, revert the commit and
push:

```bash
git revert <bad-commit>
git push
```

### Rules that keep the deploys green

* **Never commit `.env`.** Put secrets in Render's Environment tab; use
  `server/.env` locally only. `node scripts/audit-before-push.js` enforces
  this.
* **Always commit `package-lock.json`** together with `package.json`, or
  `npm ci` fails on Render.
* **Keep the build command `npm ci --include=dev`** — it is what stops the
  "vite is not recognized" failure from coming back.
* **Never rename or move a file in a way that changes the case of its
  path** (`Admin.js` → `admin.js`). Linux is case-sensitive; the deploy
  audit flags this.
* **After changing anything in `web/src`, redeploy the static site** —
  the bundle is compiled at build time.
* **After changing the API, redeploy the API service** — the process must
  restart to pick up the new code.
