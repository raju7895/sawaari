# Going live

The app has three deployable pieces that share **one API and one database**:

```
web (static SPA)  ──►  API (Express + Socket.IO)  ──►  PostgreSQL
```

The phone app, the desktop app and the website all talk to the same API, so a ride
booked on one shows up in the admin console on the others.

---

## 1. Deploy the API + database

### Render (easiest — blueprint included)

1. Push the repo to GitHub.
2. Render → **New → Blueprint** → select the repo → apply. It creates the
   Postgres database, the API service and the static site.
3. Fill in the secrets Render asks for:

   | Variable | Value |
   |---|---|
   | `SUPER_ADMIN_EMAIL` | your email |
   | `SUPER_ADMIN_PASSWORD` | your deployment secret |
   | `APP_URL` | `https://<the static site>` |
   | `RAZORPAY_KEY_ID` / `_SECRET` / `_WEBHOOK_SECRET` | optional, for online payments |

   `JWT_SECRET`, `OTP_PEPPER` and `ADMIN_TOTP_ENCRYPTION_KEY` are generated for you.
4. The build command runs `npm run migrate && npm run seed`, so the schema and the
   cities/pricing are created automatically.

   If you set the fields by hand instead of using the blueprint, use these exact
   values — the `--include=dev` flag is **required** (Render sets
   `NODE_ENV=production`, and a plain `npm ci` then drops the build tools):

   | Service | Root directory | Build command | Start / publish |
   |---|---|---|---|
   | API | `server` | `npm ci --include=dev && npm run migrate && npm run seed && npm run seed:superadmin` | start `node src/index.js` |
   | Static site | `web` | `npm ci --include=dev && npm run build` | publish `./dist` |

### Fly.io

```bash
fly launch --no-deploy --copy-config
fly postgres create --name sawaari-db
fly postgres attach sawaari-db
fly secrets set JWT_SECRET=$(openssl rand -hex 32) \
                OTP_PEPPER=$(openssl rand -hex 24) \
                ADMIN_TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32) \
                SUPER_ADMIN_PASSWORD='<your secret>' \
                SUPER_ADMIN_EMAIL='you@example.com' \
                APP_URL='https://your-site'
fly deploy
```

### Docker (any VPS)

```bash
docker build -t sawaari-api ./server
docker build -t sawaari-web --build-arg VITE_API_URL=https://api.example.com ./web
docker run -d -p 4000:4000 --env-file server/.env sawaari-api
docker run -d -p 80:80 sawaari-web
```

Put a reverse proxy (Caddy or nginx) in front for **HTTPS** — Caddy gets
certificates automatically:

```
api.example.com {
    reverse_proxy 127.0.0.1:4000
}
app.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

---

## 2. Point the installed apps at the live API

The apps read the API address at runtime (**Server settings** on the home or login
screen), so no rebuild is needed:

```
https://api.example.com
```

To bake it in instead, build with `VITE_API_URL=https://api.example.com`.

---

## 3. Before you go live

```bash
# 1. take a database backup
cd server && npm run db:backup

# 2. audit the repository for secrets
node scripts/audit-before-push.js

# 3. run the full test suite
node src/scripts/e2e-test.js
node src/scripts/test-admin-api.js
```

Checklist:

- [ ] `JWT_SECRET`, `OTP_PEPPER`, `ADMIN_TOTP_ENCRYPTION_KEY` are set (and unique)
- [ ] `SUPER_ADMIN_PASSWORD` is a strong deployment secret — **never in git**
- [ ] `SMS_DEV_MODE=false` (otherwise OTPs are printed to the log)
- [ ] `NODE_ENV=production`
- [ ] HTTPS is on for both the API and the web app
- [ ] `APP_URL` matches the public web address (used in share links)
- [ ] the database is backed up (`npm run db:backup`)
- [ ] the admin console is reachable only over HTTPS

---

## 4. What must never be committed

`.gitignore` already excludes them, and `scripts/audit-before-push.js` fails the
build if any of them slip in:

| File | What it holds |
|---|---|
| `server/.env` | every secret (JWT, peppers, admin password, DB URL) |
| `server/backups/` | database dumps + the owner's password and 2FA secret |
| `web/android/*.keystore` | the APK signing key |
| `web/android/keystore.properties` | the keystore passwords |
| `server/uploads/**` (except `.gitkeep`) | riders' uploaded documents and photos |

---

## 5. Keeping the released apps in sync

The APK is signed with `web/android/sawaari-release.keystore`. **Keep a copy**
(or you cannot publish an update to the same listing). The web/PWA and the desktop
app update automatically — the desktop app reads the build that is bundled with it,
so ship a new installer when the web build changes.
