-- ═══════════════════════════════════════════════════════════════════════════
-- GUEST LOGIN AND THE DEMO ACCOUNT
-- ═══════════════════════════════════════════════════════════════════════════
-- Two owner-controlled ways in that do not need an e-mail address and
-- therefore cannot be stopped by a mail quota or a phone provider:
--
--   • a guest  — supabase.auth.signInAnonymously() creates an account with
--                 no address at all. The trigger below gives it the role
--                 "guest" and the name "Guest".
--   • a demo   — one shared account (demo@sawaari.app) that anybody can
--                 use to look around. The password is public by design;
--                 it is set here, not in the code.
--
-- NOTHING is dropped: only a CHECK constraint is widened and a function is
-- replaced. Run it as often as you like — every statement is idempotent.
--
-- Before you run it: Supabase → Authentication → Sign In / Providers →
-- Anonymous sign-ins → ON. Without that the guest button answers
-- "Anonymous sign-ins are disabled".

-- ── 1. the role column learns "guest" ───────────────────────────────────
-- Only the CHECK is replaced; no row is touched.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('rider', 'guest', 'driver', 'admin'));

-- ── 2. the sign-up trigger gives a guest its role ───────────────────────
-- The same trigger as before, with one addition: an anonymous sign-in
-- (no e-mail address) becomes a guest.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role  text := coalesce(new.raw_user_meta_data ->> 'role', 'rider');
  v_phone text;
  v_name  text;
  v_id    uuid;
begin
  /* an anonymous sign-in has no address and no password: it is a guest */
  if new.is_anonymous then
    v_role := 'guest';
  elsif v_role <> 'driver' then
    v_role := 'rider';
  end if;

  v_phone := public.normalize_phone(coalesce(new.raw_user_meta_data ->> 'phone', new.phone));

  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    nullif(split_part(coalesce(v_phone, ''), '+', 2), '')
  );

  insert into public.profiles (id, role, full_name, phone, email)
  values (
    new.id,
    v_role,
    coalesce(nullif(v_name, ''), case when v_role = 'guest' then 'Guest' else 'Rider' end),
    v_phone,
    nullif(new.email, '')
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = coalesce(excluded.phone, public.profiles.phone),
        email = coalesce(excluded.email, public.profiles.email);

  select id into v_id from public.drivers where user_id = new.id;
  if v_role = 'driver' and v_id is null then
    insert into public.drivers (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 3. the shared demo account ──────────────────────────────────────────
-- The password is public by design — it is a demo account that anybody
-- may use. Change the password below if you want a different one; the
-- app reads it from VITE_DEMO_ACCOUNT_PASSWORD in the build environment.
--
-- (You can also create it in the dashboard:
--  Authentication → Users → Add user → Auto Confirm User → set a password,
--  and skip this part.)
do $$
declare
  v_id uuid := gen_random_uuid();
  v_password constant text := 'SawaariDemo2026';
begin
  insert into auth.users (
    id, aud, role, instance_id, email, email_confirmed_at,
    encrypted_password, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    v_id, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
    'demo@sawaari.app', now(),
    crypt(v_password, gen_salt('bf', 10)),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Demo Rider","role":"rider"}'::jsonb,
    now(), now()
  )
  on conflict (email) do update
    set encrypted_password = crypt(v_password, gen_salt('bf', 10)),
        email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
        updated_at = now();

  -- the identity row GoTrue expects (without it the sign-in is refused)
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at
  )
  select gen_random_uuid(), u.id, lower(u.email),
         jsonb_build_object('email', lower(u.email), 'email_verified', true,
                            'phone_verified', false, 'sub', u.id::text),
         'email', now(), now()
    from auth.users u
   where u.email = 'demo@sawaari.app'
     and not exists (select 1 from auth.identities i where i.user_id = u.id);
end $$;

-- the demo rider needs a profile row like everybody else
insert into public.profiles (id, role, full_name, phone, email)
select u.id, 'rider', coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), 'Demo Rider'),
       public.normalize_phone(u.raw_user_meta_data ->> 'phone'), u.email
  from auth.users u
 where u.email = 'demo@sawaari.app'
   and not exists (select 1 from public.profiles p where p.id = u.id);

-- ── 4. what to check afterwards ─────────────────────────────────────────
--   select id, email, created_at from auth.users order by created_at desc limit 10;
--   select p.id, p.role, p.full_name, u.email
--     from public.profiles p join auth.users u on u.id = p.id
--    order by p.created_at desc limit 10;
