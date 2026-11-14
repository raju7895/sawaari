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
