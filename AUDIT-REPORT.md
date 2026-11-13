# Sawaari — deployment audit and handover

Audit of the repository `raju7895/sawaari` (branch `main`), covering the
deployment configuration, the source tree, the dependencies and the three
installable clients (Android APK, Windows installer/portable, PWA).

Everything below was **verified by running it**, not by reading it.

---

## A. Deployment blocker — **CONFIRMED, fixed**

### A1. `npm ci` dropped the build tools and the static site never compiled

Render sets `NODE_ENV=production` on every build. `npm ci` honours that
variable and **skips `devDependencies`**. The whole build toolchain of the
web app lives there:

| Package | Where it is declared | Needed for |
|---|---|---|
| `vite` | `web/package.json → devDependencies` | `npm run build` |
| `tailwindcss` | `web/package.json → devDependencies` | styling |
| `postcss`, `autoprefixer` | `web/package.json → devDependencies` | CSS pipeline |

**Proof** (clean clone → `NODE_ENV=production npm ci`):

```
node_modules/vite present : False
.bin/vite present          : False

> vite build
'vite' is not recognized as an internal or external command,
operable program or batch file.
build exit code : 1
```

With `npm ci --include=dev` the same clean checkout builds in ~29 s with
exit code 0.

**Files changed**

| File | Change |
|---|---|
| `render.yaml` | both build commands → `npm ci --include=dev …` |
| `fly.toml` | `npm ci --omit=dev` → `npm ci --include=dev` |
| `web/Dockerfile` | `RUN npm ci` → `RUN npm ci --include=dev` |
| `server/Dockerfile` | `npm ci --omit=dev` → `npm ci --include=dev` |
| `RENDER.md`, `DEPLOY.md` | the exact commands, with the reason |
| `scripts/verify-render-build.js` | simulates Render from a clean clone (23 checks) |
| `scripts/deploy-audit.js` | **now detects this class of bug automatically** |

### A2. The API booted in production with a publicly known JWT secret — **CONFIRMED, fixed**

`server/src/config.js` fell back to `dev-jwt-secret-change-me` and
`dev-otp-pepper-change-me` when the environment variables were missing.
Those defaults are printed in this public repository, so anybody could have
forged an admin session token or decrypted the stored TOTP secrets.

The API now refuses to start in production:

```
Refusing to start in production: JWT_SECRET is missing, still the published
development default, or shorter than 32 characters. Set it in the
environment (openssl rand -hex 32).
```

`render.yaml` generates `JWT_SECRET`, `OTP_PEPPER` and
`ADMIN_TOTP_ENCRYPTION_KEY` with `generateValue: true`, so the blueprint
path is safe by default.

---

## B. Corrupted files — **1 CONFIRMED (fixed), 3 false positives (resolved)**

### B1. `README.md` was destroyed — **CONFIRMED, fixed**

A mistaken `String.replace()` had replaced the whole file with one table row
repeated 462 times:

```
| Staff   | `admin@example.com`  | from `ADMIN_PASSWORD` (generated if unset)||| Staff   | …
```

| | |
|---|---|
| Size | 1,809,294 bytes (should be ~23,000) |
| Longest line | 43,528 characters |
| Introduced in | commit `19afeae` — **already published to GitHub** |
| Detected by | `scripts/deploy-audit.js` §1b (added in this audit) |
| Restored by | `scripts/restore-readme.js` (from the git history or the source archive) |

The restore script:

* takes the newest **healthy** README from the git history, falling back to
  the one inside `sawaari-platform.zip`,
* re-applies the publish scrub with **function** replacements, so a `$` in
  the replacement text can never be read as a special pattern again,
* refuses to write a file whose longest line exceeds 1,200 characters, that
  does not start with a heading, or that has fewer than five headings.

The restored README also had the staff credentials scrubbed out
(`Admin@…`, `admin@sawaari.local` → placeholders) — those had survived
because the file was corrupted before the scrub script could reach it.

### B2. The three "unresolved import" hits — **false positives, resolved**

`scripts/scrub-published-secrets.js` embeds source code as *text* (the
replacement strings it writes). The import scanner read those strings as
real imports and reported three unresolvable `require('../config')`.

The scanner now applies strict import resolution **only to application
code** (`server/src/**`, `web/src/**`). Tooling scripts that legitimately
embed code are still checked for *undeclared packages*, which is the part
that matters.

### B3. Zero-byte files — **none**

The only zero-byte files in the tree are three deliberate placeholders that
keep the empty upload directories in git:

```
server/uploads/avatars/.gitkeep
server/uploads/documents/.gitkeep
server/uploads/vehicles/.gitkeep
```

### B4. Everything else — **clean**

0 merge-conflict markers · 0 invalid JSON · 0 binary blobs in text files ·
0 stray `.bak`/`.log`/`.DS_Store` files · 0 broken or case-mismatched
imports · 0 imports of undeclared packages.

---

## C. Unused / usable files — **nothing deleted, nothing is dead weight**

A naive scanner flags `electron-builder`, the nine `@capacitor/*` packages,
`autoprefixer` and `postcss` as "declared but never imported". All of them
are genuinely used — just not through an `import` statement:

| Package | How it is really used |
|---|---|
| `electron-builder` | CLI, run by `electron/package.json → dist` |
| `@capacitor/cli` | CLI, run as `cap sync android` (`web/package.json → android:sync`) |
| `@capacitor/app` | `await import('@capacitor/app')` in `BackButtonHandler.jsx` |
| `@capacitor/android`, `camera`, `filesystem`, `geolocation`, `network`, `preferences`, `push-notifications`, `splash-screen`, `status-bar` | linked as native Gradle projects — `web/android/capacitor.build.gradle` |
| `@capacitor/core` | required by `@capacitor/android` (the JS runtime of the bridge) |
| `autoprefixer`, `tailwindcss`, `postcss` | referenced by `web/postcss.config.js` |

The audit now proves each of these instead of guessing, so the "unused
dependency" list is empty and stays empty.

**No file was deleted from the repository.**

---

## D. Dependency issues

### D1. Missing dependencies — **none**

Every import in the application code resolves to a package that is declared
in the matching `package.json`, and every declared package is used.

### D2. `npm audit` — **server fixed completely, web partly**

| Tree | Before | After |
|---|---|---|
| `server` | 2 high (`nodemailer`, `zod`) | **0 vulnerabilities** |
| `web` | 1 critical, 2 high, 6 moderate | 1 critical, 1 high, 2 moderate |

**Upgrades applied**

| Package | Before | After | Note |
|---|---|---|---|
| `zod` | 3.25.76 | **4.6.7** | major upgrade; all 146 API tests still pass |
| `nodemailer` | 6.10.1 | **10.5.0** | major upgrade; public API unchanged |
| `vite` | 5.4.21 | **6.4.6** | clears the path-traversal and `launch-editor` advisories |
| `react-router-dom` | 6.30.6 | 6.30.6 | see D4 |
| `esbuild` | 0.21.5 | **0.25.12** | pulled in by vite 6 |
| `rimraf`, `glob`, `minimatch` | transitive | **pinned via `overrides`** | to the patched releases |

`web/package.json` now carries:

```json
"overrides": {
  "rimraf": "^5.0.10",
  "glob": "^14.0.6",
  "minimatch": "^11.0.8"
}
```

`cap sync android` was re-run afterwards to prove the CLI still works.

### D3. `tar` (critical + high) — **POSSIBLE, deliberately left**

`tar@6.2.1` arrives with `@capacitor/cli@6` and is affected by the
hardlink-path-traversal advisories.

* It is a **build-time tool only** — it runs on a developer machine or on
  Render's build worker, never in the running app, and the only tarball it
  ever opens is the Android platform template from the npm registry.
* The patched line is `tar@7.5.21+`. **Overriding to it breaks the CLI**:
  `@capacitor/cli` calls the callback-style `tar.extract()`, which v7
  removed — `cap sync android` failed with
  `TypeError: Cannot read properties of undefined (reading 'extract')`.
* The real fix is `@capacitor/cli@8` → Capacitor 8 → a new Android project,
  a new keystore and a re-signed APK. That is a migration, not a patch, and
  it would invalidate the currently published signing key's continuity.

**Decision:** leave `tar` at 6.x, document it, and take the Capacitor 8
upgrade as a planned piece of work. If you want it gone sooner, the
alternative is to drop `@capacitor/cli` from `dependencies` (it is only
needed for `cap sync`) and run it from a separate tooling project.

### D4. `react-router-dom` (moderate ×2) — **POSSIBLE, mitigated in code**

`GHSA-wrjc-x8rr-h8h6` (open redirect through `navigate()`) and
`GHSA-337j-9hxr-rhxg` (constructor injection through `deserializeErrors()`)
are fixed only in **7.18.0+** — there is no patched 6.x release.

* The SSR advisory does not apply: the app is a client-side Vite SPA.
* The open-redirect advisory *did* apply: the notification panel navigated
  to a URL stored in the database (`n.data.url`) and the login page
  navigated to `location.state.from`.

Both are now closed in code by `safeInternalPath()` (`web/src/api.js`),
which accepts only a rooted in-app path and rejects `//host`,
`/\host`, absolute URLs, `javascript:` and header characters. It is applied
in `DashboardLayout.jsx` and `auth/Login.jsx`, and proven by
`scripts/test-safe-url.js` (**19/19** payloads rejected or allowed as
expected).

**Upgrade path:** `react-router-dom@7.18.5` — a major upgrade to test
against the full suite before shipping.

---

## E. Configuration fixes

| # | What | Where |
|---|---|---|
| E1 | Build commands must include the dev dependencies | `render.yaml`, `fly.toml`, `web/Dockerfile`, `server/Dockerfile` |
| E2 | Production refuses to boot with weak/missing secrets | `server/src/config.js` |
| E3 | Node range pinned so Render never picks an incompatible runtime | `server/package.json`, `web/package.json` → `engines.node: ">=20 <25"` |
| E4 | `.gitignore` covers `node_modules`, `.env`, `dist`, `backups`, the keystore | `.gitignore` |
| E5 | No literal secrets in the deployment manifest — `generateValue: true` / `sync: false` only | `render.yaml` (checked by the audit) |
| E6 | Published defaults carry no working credential (staff password blank, owner address `owner@example.com`) | `server/.env.example`, `README.md` |
| E7 | `overrides` pin the patched transitive build tools | `web/package.json` |
| E8 | npm 12's `allowScripts` policy lists the esbuild versions in use | `web/package.json` |
| E9 | The source archive is regenerated from the tree, so it always matches the code and carries no personal data | `scripts/package-source.ps1` |
| E10 | The build script works with modern Node (`spawn` of `.cmd`/`.bat` is blocked without a shell) and clears a locked `win-unpacked` folder | `scripts/build-all.js` |

---

## F. Step-by-step: deploying on Render

1. **Push** — already done: `git push origin main` (branch `main`).
2. **Create the blueprint** — Render → *New* → *Blueprint* → select
   `raju7895/sawaari` → *Apply*. The blueprint creates the Postgres
   database, the API service and the static site.
3. **Fill in the secrets** Render asks for:

   | Variable | Value |
   |---|---|
   | `SUPER_ADMIN_EMAIL` | your Gmail address (the one you want to sign in with) |
   | `SUPER_ADMIN_PASSWORD` | your deployment secret — **no spaces, no `#`, no quotes** |
   | `APP_URL` | `https://<the static site>.onrender.com` |
   | `RAZORPAY_KEY_ID` / `_SECRET` / `_WEBHOOK_SECRET` | optional — UPI QR and cash work without them |

   `JWT_SECRET`, `OTP_PEPPER` and `ADMIN_TOTP_ENCRYPTION_KEY` are generated
   by the blueprint. **Do not leave `SUPER_ADMIN_PASSWORD` empty** — the
   seed would generate a random password that disappears with the
   container's filesystem on the next deploy.

4. **If you configure the services by hand instead**, use exactly:

   | Service | Root directory | Build command | Start / publish |
   |---|---|---|---|
   | API | `server` | `npm ci --include=dev && npm run migrate && npm run seed && npm run seed:superadmin` | start `node src/index.js`, health check `/api/health` |
   | Static site | `web` | `npm ci --include=dev && npm run build` | publish `./dist`, rewrite `/*` → `/index.html` |

5. **Enrol 2FA** — in the Render **Shell**:

   ```bash
   cd server && npm run admin:2fa -- --code
   ```

   It prints the TOTP secret, the `otpauth://` URI, the backup codes and a
   live 6-digit code.

6. **Point the installed apps at the live API** — no rebuild: *Server
   settings* on the login screen of the APK, the desktop app or the PWA →
   `https://sawaari-api.onrender.com`.

---

## G. Final checklist

### Verified green

| Check | Command | Result |
|---|---|---|
| API end-to-end | `cd server && node src/scripts/e2e-test.js` | **61 / 61** |
| Admin, RBAC, audit log | `node src/scripts/test-admin-api.js` | **64 / 64** |
| Cross-client (rider / driver / admin) | `node src/scripts/cross-client-test.js` | **21 / 21** |
| Endpoint sweep | `node src/scripts/sweep-admin-api.js` | **43 ok, 0 failing** |
| Frontend scan | `node src/scripts/sweep-frontend.js` | **66 files, 0 errors, 0 warnings** |
| Database integrity | `node src/scripts/db-integrity.js` | **0 orphans** |
| Open-redirect guard | `node scripts/test-safe-url.js` | **19 / 19** |
| **Render simulation (clean clone + fresh DB)** | `node scripts/verify-render-build.js` | **23 / 23** |
| Deployment audit | `node scripts/deploy-audit.js` | **0 confirmed**, 2 possible (env fallbacks — see below) |
| Secret / personal-data audit | `node scripts/audit-before-push.js` | **0 leaks, 0 personal-data hits** |
| Dependency audit | `node scripts/npm-audit-summary.js` | server **0**, web 4 (see D3/D4) |
| APK signature | `apksigner verify` | **v1 + v2**, `CN=Sawaari`, exit 0 |

### The two remaining "possible" findings

Both are env-var **fallbacks** in `server/src/config.js`, and both are on
the Render checklist above:

| Variable | Fallback | Why it is fine |
|---|---|---|
| `APP_URL` | `http://localhost:5173` | Render injects the real value; set it in the Environment tab |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/sawaari` | Render injects it for the attached database |

### Before you invite anybody

- [ ] `JWT_SECRET`, `OTP_PEPPER`, `ADMIN_TOTP_ENCRYPTION_KEY` are set and unique
- [ ] `SUPER_ADMIN_PASSWORD` is set (no `#`, no quote, no space)
- [ ] `SUPER_ADMIN_EMAIL` is the Gmail address you want to sign in with
- [ ] `SMS_DEV_MODE=false` in production
- [ ] `APP_URL` matches the live web address
- [ ] the static-site rewrite `/* → /index.html` is in place (deep links 404 without it)
- [ ] `npm run admin:2fa` has been run and the secret saved in your authenticator
- [ ] `cd server && npm run db:backup` — the database is backed up
- [ ] the static site points at the live API (`VITE_API_URL`), then redeploy

### Known limitations (not bugs)

| Limit | Effect | Mitigation |
|---|---|---|
| Render's ephemeral filesystem | uploaded driver documents are lost on redeploy | attach a disk or object storage |
| Render free tier sleeps | first request after idle takes ~30 s | use the Starter plan |
| Free Postgres is wiped every 30 days | data loss | paid plan |
| The Windows binaries are unsigned | Smart App Control / WDAC blocks them | sign them, or use the PWA |
| The owner's e-mail address **and the legacy staff password (`Admin@…`)** are in the **git history** (commit `4be8452` — the first upload, and the scrub script's pattern in `19afeae`…`a01ad25`). The working tree is clean | personal data and a published password in the repository history | rotate the staff password, then rewrite the history (`git filter-repo` + force-push) or make the repository private |
| `tar` / `react-router-dom` advisories | build-time / mitigated in code | see D3 and D4 |

---

## Repository map

```
render.yaml              Render blueprint (DB + API + static site)
RENDER.md                exact Render field values
DEPLOY.md                Render / Fly.io / Docker
BUILD-AND-INSTALL.md     how to build the APK, the desktop app and the PWA
INSTALL-GUIDE.md         how to install them
server/                  Express API, Socket.IO, PostgreSQL, Super Admin console
  src/routes/admin*.js   RBAC-protected admin API
  src/routes/super.js    master control console API
  src/services/          rbac, audit, crypto, adminSession, ownerCheck
  src/scripts/           migrations, seeds, test suites, backups
web/                     React + Vite front end (same code for APK, desktop, PWA)
  src/serverConfig.js    runtime API address (Server settings)
electron/                Electron shell + hand-written NSIS installer scripts
scripts/                 build, audit, packaging and verification tooling
```
