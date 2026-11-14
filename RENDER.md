# Deploying Sawaari — Supabase + Render

There is **no server process**. Supabase is the whole backend (Auth, Postgres
with row-level security, Storage, Realtime) and Render serves the static
bundle.

```
browser ──► static site on Render
   │
   ├── Auth        ──► supabase.auth.*        (signUp / signInWithPassword / resetPasswordForEmail)
   ├── Data        ──► PostgREST  + RLS      (only your own rows)
   ├── Files       ──► Storage               (avatars public, driver-documents private)
   └── Live rides  ──► Realtime              (postgres_changes on `rides`)
```

## 1. Supabase — one migration

Open **Supabase → SQL Editor → New query**, paste
`supabase/migrations/20261114000000_sawaari.sql` and run it. It is idempotent:
running it twice changes nothing.

It creates nine tables (`profiles`, `drivers`, `vehicles`, `rides`, `payments`,
`ratings`, `saved_places`, `admin_actions`, `app_settings`), the row-level
security policies, the signup trigger, the two storage buckets, realtime on
`rides` and the RPCs (`book_ride`, `accept_ride`, `update_ride_status`,
`quote_ride`, `get_ride_by_share_token`, `admin_*`).

## 2. Supabase — Auth settings

**Authentication → URL Configuration**

| Field | Value |
|---|---|
| Site URL | `https://sawaari-web.onrender.com` |
| Redirect URLs | `http://localhost:5173/**` · `https://sawaari-web.onrender.com/**` |

**Authentication → Providers → Email**

| Setting | Value | Effect |
|---|---|---|
| Enable the email provider | on | sign-up and sign-in work |
| Confirm email | **off while you are testing** | sign-up returns a session and the rider can sign in at once. **Switch it on for production** — then sign-up shows "check your e-mail" and the account only works after the link is clicked |
| Leaked password protection | **on** | new passwords are checked against a breach list |

## 3. Supabase — the administrator

The administrator is an ordinary auth user whose profile row has
`role = 'admin'`. The database checks it on every request; the screens do not.

1. **Authentication → Users → Add user** — e-mail
   `your-admin-email@example.com`, a password of your choosing, **Auto Confirm
   User** ticked.
2. **SQL Editor** — run:

```sql
update public.profiles set role = 'admin'
 where email = 'your-admin-email@example.com';
```

3. Sign in at `https://<your-site>/admin/login`. If the profile row does not
   exist yet, create it first:

```sql
insert into public.profiles (id, role, full_name, email)
select id, 'admin', 'Platform Owner', email from auth.users
 where email = 'your-admin-email@example.com'
on conflict (id) do update set role = 'admin';
```

## 4. Render — the static site

The repository contains `render.yaml`, a blueprint that does it all.

**Render → New → Blueprint → select `raju7895/sawaari` → Apply**, then fill in:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://vwpxxgmcjrzegnqrpvsv.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon / publishable key (Project Settings → API Keys) |

Nothing else. The service is:

| Setting | Value |
|---|---|
| Type | Static Site |
| Branch | `main` |
| Root Directory | `web` |
| Build Command | `npm install --include=dev && npm run build` |
| Publish Directory | `./dist` |
| Auto-Deploy | **Yes** |
| Health Check Path | — |
| Rewrite rule | `/*` → `/index.html` (the blueprint adds it) |

> **`--include=dev` is not optional.** If `NODE_ENV=production` is set in the
> environment, `npm install` skips devDependencies and the build dies with
> *"vite is not recognized"*.
>
> **Vite compiles the environment variables into the bundle.** After changing
> one, use **Clear build cache & deploy** — a cached build keeps the old
> address.

## 5. After the deploy

1. `https://<your-site>/api/health` — no, there is no API any more. Open the
   site and sign up.
2. Check the browser console: no red errors.
3. `https://<your-site>/admin/login` — sign in as the administrator.

## 6. Keeping it in sync

```bash
git add -A
git commit -m "your change"
git push origin main        # Render rebuilds and redeploys automatically
```

## 7. Free-tier notes

| Limit | Effect |
|---|---|
| Supabase pauses the project after a week of inactivity | the site returns an error until you press **Restore** in the Supabase dashboard |
| Render's free static sites are always on | no cold start, but no server either |
| Supabase free tier | 500 MB of database, 1 GB of storage, 5 GB of egress |
