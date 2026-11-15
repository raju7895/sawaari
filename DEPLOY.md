# Going live

Sawaari has **no server**. Supabase is the backend (Auth, Postgres, Storage,
Realtime) and Render serves the static bundle. There is nothing to build
except the front end, and nothing to run except the static site.

## 1. Supabase

Run `supabase/migrations/20261114000000_sawaari.sql` in the **SQL Editor**
(idempotent — safe to run again). Then set the authentication options and
create the administrator. **RENDER.md** has the click-by-click steps.

## 2. Render

Push the repository, then **Render → New → Blueprint** and select it. Fill in
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; everything else is in
`render.yaml`.

## 3. Locally

```bash
cd web
npm install
cp .env.example .env      # fill in the Supabase URL and the anon key
npm run dev               # http://localhost:5173
```

There is no API to start and no database to create — Supabase has both.

## 4. Before you invite anybody

```bash
# the secret scan
node scripts/audit-before-push.js

# the deployment check — it clones the repo and builds it exactly as Render does
node scripts/verify-render-build.js

# the project audit
node scripts/audit-project.js

# a React hook used but never imported, and an identifier used but never declared
cd web && node ../scripts/check-hooks.js && node ../scripts/check-free-variables.js

# every select the app makes, against the live project
# (the credentials come from the environment, never from the repository)
$env:VITE_SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "sb_publishable_..."
$env:SAWAARI_TEST_EMAIL = "you@example.com"
$env:SAWAARI_TEST_PASSWORD = "..."
node scripts/check-api.js
```

### The two settings that stop people signing up

Both are in **Supabase → Authentication** and both fail silently, with an
error the visitor never sees:

| Setting | What happens when it is wrong |
|---|---|
| **Rate Limits → Emails** | *429 email rate limit exceeded* — no sign-up, no password reset |
| **Providers → SMTP** | the built-in mailer only delivers to your own team members; everybody else gets nothing |

Create the administrator in **Authentication → Users → Add user**, not with
`insert into auth.users` — a row written by hand has no `auth.identities`
row and GoTrue refuses the sign-in with *Invalid login credentials*.

### How a new account signs in

```
register  ──►  supabase.auth.signUp({ email, password, options: {
                     data: { full_name, phone, role },
                     emailRedirectTo: origin + '/auth/callback' } })
            │
            ├─ e-mail arrives with a 6-digit code  ──►  /verify
            │      supabase.auth.verifyOtp({ email, token, type: 'email' })
            │      "Resend code" → supabase.auth.resend({ type: 'signup', email })
            │
            └─ the link in the e-mail  ─────────►  /auth/callback
                   (waits for the session, then goes to the home of the role)

sign in   ──►  email + password
            ├─ "e-mail not confirmed"  ─────────►  /verify (+ a new code)
            └─ "sign in with a code"  ─────────►  /verify (mode=magic)
```

The **code** only appears in the e-mail when the *Confirm signup* and
*Magic Link* templates contain `{{ .Token }}`. Put that in the template
**next to** `{{ .ConfirmationURL }}` — then the e-mail carries the code
*and* the link, and both ways in work.

`scripts/verify-otp.js` walks the whole flow from the command line:

```bash
node scripts/verify-otp.js --email you@example.com
```

## 5. What must never be committed

- `.env` and anything else with a secret in it (`.gitignore` covers it)
- the Supabase **service_role / secret** key — it belongs in a server
  environment only, and there is no server any more, so it should not exist
  anywhere
- anybody's password

The anon / publishable key **is** meant to be public: every table is protected
by row-level security, and the key can only read what the signed-in person is
allowed to read.

## 6. Deploying the Android app and the desktop app

The APK and the desktop app are the same front end in a shell. They talk to
Supabase directly, so there is no server address to type in any more.

```bash
node scripts/build-all.js     # the web build, the signed APK and the Windows installer
```

The Android app still needs the back button and the camera/location
permissions — they are in `web/android/app/src/main/AndroidManifest.xml`.
