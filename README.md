# 🛺 Sawaari — local auto-rickshaw booking

Riders book a ride, drivers accept it, and the administrator keeps the
platform honest. **Supabase is the whole backend** — authentication, the
database (with row-level security), file storage and live ride updates. The
front end is a static React bundle that Render serves.

```
browser ──► static site (Render)
   ├── Auth        supabase.auth.signUp / signInWithPassword / resetPasswordForEmail
   ├── Data        PostgREST + RLS      (a user only ever sees their own rows)
   ├── Files       Storage              (avatars public · driver-documents private)
   └── Live rides  Realtime             (postgres_changes on `rides`)
```

There is no API server to run, no database to create and no JWT to manage.

---

## Roles

| Role | What they can do |
|---|---|
| `rider` | book a ride, follow it live, cancel, rate the driver, save places |
| `driver` | add a vehicle, upload documents, go online, accept rides, drive, get paid |
| `admin` | the master console: users, drivers, rides, payments, ratings, fares, activity log |

The role lives in `profiles.role` and is **enforced by the database**. A user
can never change their own role, and a signup can only ever create a rider
or a driver — the database trigger ignores anything else.

---

## Getting started

### 1. Supabase

1. Create a project at <https://supabase.com>.
2. **SQL Editor → New query**, paste
   `supabase/migrations/20261114000000_sawaari.sql` and run it. It is
   idempotent — running it twice changes nothing.
3. **Authentication → URL Configuration**
   * Site URL: `http://localhost:5173` (later your Render URL)
   * Redirect URLs: `http://localhost:5173/**`
4. **Authentication → Providers → Email** — enable it. Turn *Confirm email*
   off while you are testing (so a new account can sign in straight away),
   on for production.
5. Copy **Project Settings → API**: the project URL and the anon /
   publishable key.

### 2. The web app

```bash
cd web
npm install
cp .env.example .env      # or: copy .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

### 3. The administrator

Create the user in **Supabase → Authentication → Users → Add user** (tick
*Auto Confirm User*), then run in the SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'your-admin-email@example.com';
```

> **Create the account in the dashboard, never with `insert into
> auth.users`.** A row that is put into `auth.users` by hand is missing the
> `auth.identities` row, the `instance_id` and a few token columns that GoTrue
> expects to be present, and the sign-in is refused with *Invalid login
> credentials* — with no hint of what is wrong. The dashboard does it
> correctly.

Two things worth checking before you invite anybody:

* **Authentication → Rate Limits → Emails.** The default limit is low, and
  once it is reached every sign-up and every password reset answers *429
  email rate limit exceeded*.
* **Authentication → SMTP.** The built-in mailer only delivers to the
  members of your project team. For real riders and drivers, add an SMTP
  provider.

### How an account is confirmed

A new account is confirmed with a **6-digit code** that arrives by e-mail
(the *Confirm signup* template has to contain `{{ .Token }}`), and the
confirmation **link** keeps working as well:

| Screen | What it does |
|---|---|
| `/register` | creates the account, then sends the visitor to `/verify` |
| `/verify` | the 6-digit code, a *Resend code* button with a 60-second cooldown |
| `/auth/callback` | where a confirmation link lands; waits for the session, then goes to the home of the role |
| `/forgot-password` | sends the reset link to `/reset-password` |
| `/reset-password` | where a new password is chosen |

Sign-in also works without a password: *Sign in with a code* sends a code
to the address and the same `/verify` screen takes it.

`scripts/verify-otp.js` walks the whole flow from the command line:

```bash
node scripts/verify-otp.js --email you@example.com
```

---

## Deploying

The repository contains `render.yaml`. **Render → New → Blueprint → select
the repo → Apply**, then fill in `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`.

* Type: **Static Site** · Root Directory: `web`
* Build: `npm install --include=dev && npm run build` · Publish: `./dist`
* Rewrite rule: `/*` → `/index.html`

**RENDER.md** has the click-by-click steps and the dashboard settings.

---

## The database

| Table | What it holds |
|---|---|
| `profiles` | one row per auth user — role, name, phone, avatar, `is_blocked`, `is_verified` |
| `drivers` | the driver half of a profile — verified, online, rating, earnings |
| `vehicles` | the autos a driver owns |
| `rides` | every booking — route, server-calculated fare, status, OTP, share link |
| `payments` | one row per completed ride (cash, pending) |
| `ratings` | rider ↔ driver stars |
| `saved_places` | the rider's favourite addresses |
| `admin_actions` | every administrative action, append-only |
| `app_settings` | the fare table |

**Business rules live in Postgres**, never in the browser:

| Function | What it does |
|---|---|
| `book_ride()` | checks you are signed in, not blocked and have no active ride, then calculates the fare from `app_settings` and inserts the ride |
| `accept_ride()` | only verified drivers; the update only touches a ride that is still `requested` and has no driver, so two drivers can never take the same ride |
| `update_ride_status()` | `accepted → ongoing → completed`; either side may cancel while it is still `requested` or `accepted`; completing stamps the ride and creates the payment row |
| `quote_ride()` | the fare estimate, computed the same way as the real thing |
| `get_ride_by_share_token()` | the public "follow my ride" link |
| `admin_set_user_state()`, `admin_verify_driver()`, `admin_set_fares()` | the console's writes, each one recorded in `admin_actions` |

---

## Security

* **Row-level security is on for every table.** A user reads and writes only
  their own rows; a driver additionally sees the open requests; an
  administrator sees everything — and only what their permissions allow.
* **The role, `is_blocked` and `is_verified` are protected** by a trigger
  and by column-level grants: a user cannot change them, and neither can a
  stolen session.
* **The publishable key is meant to be public.** It can only read what the
  signed-in person is allowed to read. The **service-role key must never
  appear in the front end** — it bypasses every policy.
* **`admin_actions` is append-only** — updating or deleting a row raises.
* **The signup trigger only accepts `rider` and `driver`.** Asking for
  `admin` in the signup metadata stores `rider`.

---

## The apps beyond the browser

The same front end ships as an Android APK and a Windows desktop app:

```bash
node scripts/build-all.js     # the web build, the signed APK and the Windows installer
```

`BUILD-AND-INSTALL.md` explains the toolchain, `INSTALL-GUIDE.md` the
installation.

---

## Scripts

| Script | What it does |
|---|---|
| `scripts/audit-project.js` | the project audit: dead code, broken imports, secrets, leftovers |
| `scripts/audit-before-push.js` | the secret scan — it fails the commit if a credential appears in a tracked file |
| `scripts/verify-render-build.js` | clones the repository and builds it exactly as Render does, then inspects the bundle |
| `scripts/deploy-render.js` | manages the static site through the Render API (`RENDER_API_KEY`) |
| `scripts/check-imports.js` | proves that a file is imported by nothing before you delete it |
| `scripts/check-hooks.js` | a React hook that is used but never imported — a crash on that screen only |
| `scripts/check-free-variables.js` | an identifier that is used but never declared — the same kind of crash |
| `scripts/check-api.js` | runs every PostgREST select the app makes against the live project — a broken embed is a 4xx, not a build error |
| `scripts/verify-otp.js` | walks the sign-up → code → confirmed → sign-in flow from the command line |
| `scripts/build-all.js` | builds the web app, the APK and the Windows installer |

---

## Documentation

| File | What is in it |
|---|---|
| **RENDER.md** | the Supabase and Render setup, click by click |
| **DEPLOY.md** | going live, and what must never be committed |
| **BUILD-AND-INSTALL.md** | building the APK and the desktop app |
| **INSTALL-GUIDE.md** | installing the apps |
| **AUDIT-REPORT.md** | the earlier audit of the platform |
