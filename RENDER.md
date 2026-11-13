# Deploying on Render — exact field values

Three things to create: **Postgres**, the **API** (web service) and the **Web app** (static site).

> The repo already contains `render.yaml`, which does all of this automatically.
> **Render → New → Blueprint → select `raju7895/sawaari`** is the one-click path.
> Use the manual steps below if you prefer to configure each piece yourself.

---

## 1. Database — Render → New → Postgres

| Field | Value |
|---|---|
| Name | `sawaari-db` |
| Region | Mumbai (or the closest to your riders) |
| Plan | Basic-256mb (free works for testing but is wiped after 30 days) |

Render injects `DATABASE_URL` into every service you link to this database — nothing to copy.

---

## 2. API — Render → New → Web Service → connect the repo

| Field | Value |
|---|---|
| **Root Directory** | `server` |
| **Build Command** | `npm ci && npm run migrate && npm run seed && npm run seed:superadmin` |
| **Start Command** | `node src/index.js` |
| **Health Check Path** | `/api/health` |
| Instance type | Starter ($7/mo) — the free tier sleeps and has strict limits |
| Node version | `20` (add env var `NODE_VERSION=20`) |

### Environment variables for the API

Render's **Environment** tab → *Add from .env* or add one by one:

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `NODE_VERSION` | `20` | optional, `engines` in package.json already pins it |
| `DATABASE_URL` | *(leave empty — Render injects it)* | only if you created the DB by hand |
| `JWT_SECRET` | **Generate** | Render's "Generate" button |
| `OTP_PEPPER` | **Generate** | Render's "Generate" button |
| `ADMIN_TOTP_ENCRYPTION_KEY` | **Generate** | encrypts the 2FA secrets |
| `SUPER_ADMIN_EMAIL` | your email | owner account |
| `SUPER_ADMIN_PASSWORD` | your deployment secret | **no spaces, no `#`, no quotes** |
| `SUPER_ADMIN_NAME` | your name | shown in the console |
| `APP_URL` | `https://<your-static-site>.onrender.com` | used in share links |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | staff account | optional, generated if unset |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | from Razorpay | optional — UPI QR + cash work without it |
| `SMS_PROVIDER` | `none` \| `msg91` \| `twilio` | optional |
| `SMS_DEV_MODE` | `false` | **must be false in production** (otherwise OTPs print to the log) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | your SMTP | optional |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | web-push keys | optional |

> **`SUPER_ADMIN_PASSWORD` must be set.** Without it the first deploy generates a random
> password that disappears with the container's filesystem on the next deploy.

---

## 3. Web app — Render → New → Static Site → connect the repo

| Field | Value |
|---|---|
| **Root Directory** | `web` |
| **Build Command** | `npm ci && npm run build` |
| **Publish Directory** | `./dist` |
| **Rewrite rule** | `/*` → `/index.html` (in *Redirects & Rewrites*) |

### Environment variables for the static site

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://sawaari-api.onrender.com` |

> `VITE_API_URL` is read **at build time** — Render's build step has the service's
> environment variables available, so setting it in the Environment tab is enough.
> Change it → *Save & Deploy* to rebuild.

---

## 4. First sign-in

1. Open `https://<your-static-site>.onrender.com/admin-login`.
2. Enter `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD`.
3. Two-factor authentication is mandatory — get the code from the **Render Shell**:

   ```bash
   cd server && npm run admin:2fa -- --code
   ```

   It prints the TOTP secret (add it to Google Authenticator / Authy / 1Password),
   the `otpauth://` URI and a live 6-digit code.

---

## 5. Point the installed apps at the live API

No rebuild needed — **Server settings** on the home or login screen of the APK,
the desktop app or the PWA:

```
https://sawaari-api.onrender.com
```

---

## 6. Known platform limits (Render free/starter tier)

| Limit | Effect | Fix |
|---|---|---|
| Ephemeral filesystem | uploaded driver documents and avatars are lost on redeploy | attach a disk or S3 for production |
| Free tier sleeps | first request after idle takes ~30 s | use the Starter plan |
| Free Postgres | wiped every 30 days | paid plan |
| 100 free build minutes/month | builds stop after that | upgrade |

---

## 7. Checklist before you invite anyone

- [ ] `JWT_SECRET`, `OTP_PEPPER`, `ADMIN_TOTP_ENCRYPTION_KEY` are set and unique
- [ ] `SUPER_ADMIN_PASSWORD` is set (and has no `#`, quote or space)
- [ ] `SMS_DEV_MODE=false`
- [ ] `NODE_ENV=production`
- [ ] `APP_URL` matches the live web address
- [ ] the static site rewrite `/* → /index.html` is in place (otherwise deep links 404)
- [ ] `npm run admin:2fa` has been run and the secret saved in your authenticator
- [ ] the database is backed up: `npm run db:backup`
