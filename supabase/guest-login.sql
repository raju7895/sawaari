-- ═══════════════════════════════════════════════════════════════════════════
-- GUEST LOGIN AND THE DEMO ACCOUNTS
-- ═══════════════════════════════════════════════════════════════════════════
-- Two ways in that need no e-mail address, and therefore cannot be stopped
-- by a mail quota or a phone provider:
--
--   • a guest  — supabase.auth.signInAnonymously() creates an account with
--                 no address at all. The trigger below gives it the role
--                 "guest": it can browse and book a ride, but it can
--                 never become a driver and never reach the console.
--   • a demo   — two shared accounts anybody may use to look around:
--                 demo.passenger@sawaari.app (rider) and
--                 demo.driver@sawaari.app (driver, verified).
--
-- NOTHING is dropped: one CHECK constraint is widened and one function is
-- replaced. Every statement is idempotent — run it as often as you like.
--
-- Before you run it:
--   Supabase → Authentication → Sign In / Providers → Anonymous sign-ins → ON
--   (without that the guest button answers "Anonymous sign-ins are disabled")
--
-- The demo passwords are public by design — they are printed in the app on
-- purpose. They are used nowhere else, and a demo account is never an admin.

-- ── 1. the role column learns "guest" ───────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('rider', 'guest', 'driver', 'admin'));

-- ── 2. the sign-up trigger ─────────────────────────────────────────────
-- An anonymous sign-in has no address and no password: it is a guest, and
-- the role in the metadata cannot talk its way out of that.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_role  text := coalesce(new.raw_user_meta_data ->> 'role', 'rider');
  v_phone text;
  v_name  text;
begin
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

  -- a driver gets a driver row, linked by user_id
  if v_role = 'driver' then
    insert into public.drivers (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 3. the two demo accounts ───────────────────────────────────────────
-- The ACCOUNTS are created in the dashboard, not here — that is where the
-- password is chosen, so it never ends up in this file or in the
-- repository:
--
--   Supabase → Authentication → Users → Add user → Create new user
--     demo.passenger@sawaari.app   (tick "Auto Confirm User")
--     demo.driver@sawaari.app      (tick "Auto Confirm User")
--
-- Put the same two passwords in the Render environment
-- (VITE_DEMO_PASSENGER_PASSWORD and VITE_DEMO_DRIVER_PASSWORD) and the
-- app signs in with them. They are public by design — anybody may use the
-- demo accounts — but they are used nowhere else, and a demo account is
-- never an admin.
--
-- What follows only puts the accounts that exist into order.
insert into public.profiles (id, role, full_name, phone, email)
select u.id, 'rider', 'Demo Passenger', '+919000000001', u.email
  from auth.users u
 where u.email = 'demo.passenger@sawaari.app'
   and not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.profiles (id, role, full_name, phone, email)
select u.id, 'driver', 'Demo Driver', '+919000000002', u.email
  from auth.users u
 where u.email = 'demo.driver@sawaari.app'
   and not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles
   set role = 'rider', full_name = 'Demo Passenger', phone = '+919000000001'
 where email = 'demo.passenger@sawaari.app';

update public.profiles
   set role = 'driver', full_name = 'Demo Driver', phone = '+919000000002'
 where email = 'demo.driver@sawaari.app';

-- the demo driver is verified, so it can accept rides
insert into public.drivers (user_id, is_verified)
select p.id, true from public.profiles p
 where p.email = 'demo.driver@sawaari.app'
on conflict (user_id) do update set is_verified = true;

-- and it has a vehicle
insert into public.vehicles (driver_id, registration_number, vehicle_type, model, capacity)
select d.id, 'KA01DEMO01', 'auto', 'Demo Auto', 3
  from public.drivers d join public.profiles p on p.id = d.user_id
 where p.email = 'demo.driver@sawaari.app'
on conflict (registration_number) do nothing;

-- ── 4. what to check afterwards ─────────────────────────────────────────
--   select u.email, u.is_anonymous, p.role, p.id = u.id as same_id
--     from auth.users u left join public.profiles p on p.id = u.id
--    order by u.created_at desc limit 10;
