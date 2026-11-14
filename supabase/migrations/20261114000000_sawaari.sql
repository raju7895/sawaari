-- ═══════════════════════════════════════════════════════════════════════════
-- SAWAARI — the whole backend, in Supabase.
-- ═══════════════════════════════════════════════════════════════════════════
-- One idempotent migration: Auth + Postgres + Storage + Realtime.
-- Run it in the Supabase SQL Editor as often as you like — every statement
-- is guarded, so a second run changes nothing.
--
--   profiles      one row per auth user — role, name, phone, avatar
--   drivers       the driver side of a profile (verification, online, earnings)
--   vehicles      the autos a driver owns
--   rides         the bookings, with the fare calculated by the server
--   payments      one row per completed ride
--   ratings       rider ↔ driver stars
--   saved_places  the rider's favourite addresses
--   admin_actions every administrative action, append-only
--   app_settings  the fare table and the platform settings
--
-- Security model
--   · RLS is enabled on EVERY table.
--   · A user sees and writes only their own rows.
--   · admin_actions is readable by admins and writable by nobody (the RPCs
--     write it).
--   · role, is_blocked and is_verified can only be changed by an admin or
--     from the SQL editor (auth.uid() is null there).
--   · The business rules (fare, accepting a ride, the status machine) live in
--     Postgres functions, never in the browser.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── extensions ─────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.  TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles: one row per auth user ─────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'rider'
                 check (role in ('rider','driver','admin')),
  full_name    text not null default '',
  phone        text unique,
  email        text,
  avatar_path  text,
  is_blocked   boolean not null default false,
  is_verified  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists profiles_role_idx    on public.profiles (role);
create index if not exists profiles_created_idx on public.profiles (created_at desc);
create index if not exists profiles_phone_idx   on public.profiles (phone);

-- ── drivers: the driver half of a profile ───────────────────────────────
create table if not exists public.drivers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references public.profiles(id) on delete cascade,
  is_verified    boolean not null default false,
  is_online      boolean not null default false,
  rating_avg     numeric(3,2) not null default 0,
  rating_count   int not null default 0,
  rides_completed int not null default 0,
  total_earnings numeric(12,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists drivers_user_idx     on public.drivers (user_id);
create index if not exists drivers_online_idx  on public.drivers (is_online, is_verified);

-- ── vehicles ────────────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.drivers(id) on delete cascade,
  registration_number text not null unique,
  vehicle_type        text not null default 'auto'
                        check (vehicle_type in ('auto','e_rickshaw')),
  model               text,
  capacity            int not null default 3 check (capacity between 1 and 8),
  photo_path          text,
  is_primary          boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists vehicles_driver_idx on public.vehicles (driver_id);

-- ── rides ───────────────────────────────────────────────────────────────
create table if not exists public.rides (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique,
  rider_id       uuid not null references public.profiles(id) on delete cascade,
  driver_id      uuid references public.drivers(id) on delete set null,
  vehicle_type   text not null default 'auto' check (vehicle_type in ('auto','e_rickshaw')),
  pickup_address text not null,
  pickup_lat     double precision,
  pickup_lng     double precision,
  drop_address   text not null,
  drop_lat       double precision,
  drop_lng       double precision,
  distance_km    numeric(8,2) not null default 0 check (distance_km >= 0),
  duration_min   int not null default 0 check (duration_min >= 0),
  fare           numeric(10,2) not null default 0 check (fare >= 0),
  fare_breakdown jsonb not null default '{}'::jsonb,
  status         text not null default 'requested'
                   check (status in ('requested','accepted','ongoing','completed','cancelled')),
  ride_otp       text not null,
  share_token    text not null unique,
  cancelled_by   uuid references public.profiles(id) on delete set null,
  cancel_reason  text,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists rides_rider_idx    on public.rides (rider_id, created_at desc);
create index if not exists rides_driver_idx   on public.rides (driver_id, created_at desc);
create index if not exists rides_status_idx   on public.rides (status);
create index if not exists rides_created_idx  on public.rides (created_at desc);

-- ── payments ────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid not null references public.rides(id) on delete cascade,
  rider_id   uuid not null references public.profiles(id) on delete cascade,
  driver_id  uuid references public.drivers(id) on delete set null,
  method     text not null default 'cash' check (method in ('cash','online')),
  amount     numeric(10,2) not null default 0 check (amount >= 0),
  status     text not null default 'pending' check (status in ('pending','paid','refunded','failed')),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_ride_idx  on public.payments (ride_id);
create index if not exists payments_rider_idx on public.payments (rider_id);
create index if not exists payments_status_idx on public.payments (status);

-- ── ratings ─────────────────────────────────────────────────────────────
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  ride_id    uuid not null references public.rides(id) on delete cascade,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  rating     int not null check (rating between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  unique (ride_id, from_user)          -- one rating per person per ride
);
create index if not exists ratings_to_user_idx on public.ratings (to_user);
create index if not exists ratings_ride_idx   on public.ratings (ride_id);

-- ── driver documents ────────────────────────────────────────────────────
-- The files live in the private `driver-documents` bucket; this table holds
-- their metadata so the driver and the admin can find and review them.
create table if not exists public.driver_documents (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  doc_type    text not null check (doc_type in ('license','aadhaar','vehicle_rc','insurance','profile_photo')),
  file_path   text not null,
  doc_number  text,
  status      text not null default 'pending' check (status in ('pending','verified','rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists driver_documents_driver_idx on public.driver_documents (driver_id);
create index if not exists driver_documents_status_idx on public.driver_documents (status);

-- ── saved places ────────────────────────────────────────────────────────
create table if not exists public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  label      text not null,
  address    text not null,
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now()
);
create index if not exists saved_places_user_idx on public.saved_places (user_id);

-- ── admin actions (append-only) ─────────────────────────────────────────
create table if not exists public.admin_actions (
  id          bigserial primary key,
  admin_id    uuid references public.profiles(id) on delete set null,
  admin_email text,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_admin_idx   on public.admin_actions (admin_id, created_at desc);

-- ── app settings (the fare table and the platform settings) ─────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.  updated_at TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','drivers','vehicles','rides','payments','saved_places','driver_documents','app_settings'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3.  THE PROFILE TRIGGER  (runs on every signup)
-- ═══════════════════════════════════════════════════════════════════════════
-- Only 'rider' and 'driver' are accepted from the signup metadata — a
-- visitor can never make themselves an admin. Drivers also get a row in
-- public.drivers.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role  text := coalesce(new.raw_user_meta_data ->> 'role', 'rider');
  v_name  text := coalesce(new.raw_user_meta_data ->> 'full_name',
                            new.raw_user_meta_data ->> 'name',
                            split_part(coalesce(new.email, ''), '@', 1));
  v_phone text := coalesce(new.raw_user_meta_data ->> 'phone', new.phone);
  v_id    uuid;
begin
  if v_role <> 'driver' then v_role := 'rider'; end if;

  insert into public.profiles (id, role, full_name, phone, email)
  values (new.id, v_role, coalesce(nullif(v_name, ''), 'Rider'), nullif(v_phone, ''), new.email)
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4.  IS_ADMIN + THE ROLE PROTECTION
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin' and not p.is_blocked
  );
$$;

-- Nobody may change role, is_blocked or is_verified — except an admin, or
-- the SQL editor (where auth.uid() is null, so the guard lets it through).
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;          -- the SQL editor
  if (new.role         is distinct from old.role)
     or (new.is_blocked  is distinct from old.is_blocked)
     or (new.is_verified is distinct from old.is_verified) then
    if not public.is_admin() then
      raise exception 'Only an administrator can change role, is_blocked or is_verified.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- The audit trail is append-only for everybody, admins included.
create or replace function public.admin_actions_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'admin_actions is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists admin_actions_no_update on public.admin_actions;
create trigger admin_actions_no_update
  before update or delete on public.admin_actions
  for each row execute function public.admin_actions_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5.  ROW LEVEL SECURITY — EVERY TABLE
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['profiles','drivers','vehicles','rides','payments','ratings','saved_places','driver_documents','admin_actions','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── profiles ────────────────────────────────────────────────────────────
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for insert to authenticated
  with check (public.is_admin());

-- A user may change their own name, phone, e-mail and avatar — never the
-- role or the flags (the trigger above enforces that as well).
revoke update on public.profiles from authenticated;
grant update (full_name, phone, email, avatar_path) on public.profiles to authenticated;
grant update (role, is_blocked, is_verified) on public.profiles to service_role;

-- ── drivers ─────────────────────────────────────────────────────────────
drop policy if exists drivers_select on public.drivers;
create policy drivers_select on public.drivers for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or (is_verified and is_online));

drop policy if exists drivers_update on public.drivers;
create policy drivers_update on public.drivers for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

revoke update on public.drivers from authenticated;
grant update (is_online) on public.drivers to authenticated;
grant update (is_verified, rating_avg, rating_count, rides_completed, total_earnings)
  on public.drivers to service_role;

-- ── vehicles ────────────────────────────────────────────────────────────
drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
  using (driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin());

drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (driver_id in (select id from public.drivers where user_id = auth.uid()));

drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update to authenticated
  using (driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin())
  with check (driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin());

-- ── rides ───────────────────────────────────────────────────────────────
drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides for select to authenticated
  using (rider_id = auth.uid()
         or driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin());

drop policy if exists rides_update on public.rides;
create policy rides_update on public.rides for update to authenticated
  using (rider_id = auth.uid()
         or driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin())
  with check (rider_id = auth.uid()
         or driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin());

-- ── payments ────────────────────────────────────────────────────────────
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (rider_id = auth.uid()
         or driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin());

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── ratings ─────────────────────────────────────────────────────────────
drop policy if exists ratings_select on public.ratings;
create policy ratings_select on public.ratings for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid() or public.is_admin());

drop policy if exists ratings_insert on public.ratings;
create policy ratings_insert on public.ratings for insert to authenticated
  with check (from_user = auth.uid());

drop policy if exists ratings_delete on public.ratings;
create policy ratings_delete on public.ratings for delete to authenticated
  using (public.is_admin());

-- ── driver documents ────────────────────────────────────────────────────
drop policy if exists driver_documents_select on public.driver_documents;
create policy driver_documents_select on public.driver_documents for select to authenticated
  using (driver_id in (select id from public.drivers where user_id = auth.uid())
         or public.is_admin());

drop policy if exists driver_documents_insert on public.driver_documents;
create policy driver_documents_insert on public.driver_documents for insert to authenticated
  with check (driver_id in (select id from public.drivers where user_id = auth.uid()));

drop policy if exists driver_documents_update on public.driver_documents;
create policy driver_documents_update on public.driver_documents for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── saved places ────────────────────────────────────────────────────────
drop policy if exists saved_places_all on public.saved_places;
create policy saved_places_all on public.saved_places for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── admin actions (read for admins, written by the functions) ───────────
drop policy if exists admin_actions_select on public.admin_actions;
create policy admin_actions_select on public.admin_actions for select to authenticated
  using (public.is_admin());

-- ── app settings ────────────────────────────────────────────────────────
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using (true);

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 6.  THE BUSINESS LOGIC — Postgres functions, never the browser
-- ═══════════════════════════════════════════════════════════════════════════

-- ── write an admin action ───────────────────────────────────────────────
create or replace function public.log_admin_action(
  p_action text, p_target_type text default null, p_target_id text default null,
  p_details jsonb default null
)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  insert into public.admin_actions (admin_id, admin_email, action, target_type, target_id, details)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          p_action, p_target_type, p_target_id, p_details)
  returning id into v_id;
  return v_id;
end $$;

-- ── the fare table ──────────────────────────────────────────────────────
create or replace function public.fares()
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select value from public.app_settings where key = 'fares'),
    '{"auto":{"baseFare":30,"perKm":12,"perMinute":1,"minFare":50},
      "e_rickshaw":{"baseFare":40,"perKm":15,"perMinute":1,"minFare":70}}'::jsonb);
$$;

-- ── book a ride ─────────────────────────────────────────────────────────
-- The fare is calculated HERE, from app_settings — the browser never sends
-- an amount.
create or replace function public.book_ride(
  p_pickup_address text,
  p_drop_address   text,
  p_vehicle_type   text default 'auto',
  p_pickup_lat     double precision default null,
  p_pickup_lng     double precision default null,
  p_drop_lat       double precision default null,
  p_drop_lng       double precision default null,
  p_distance_km    numeric default 0,
  p_duration_min   int default 0
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.profiles%rowtype;
  v_fares   jsonb;
  v_cfg     jsonb;
  v_base    numeric; v_per_km numeric; v_per_min numeric; v_min numeric;
  v_fare    numeric; v_otp text; v_ref text; v_share text; v_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'You must be signed in to book a ride.');
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Your profile is missing. Please sign in again.');
  end if;
  if v_profile.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'Your account is blocked. Please contact support.');
  end if;

  if exists (select 1 from public.rides
              where rider_id = auth.uid()
                and status in ('requested','accepted','ongoing')) then
    return jsonb_build_object('ok', false, 'error', 'You already have an active ride.');
  end if;

  if p_pickup_address is null or btrim(p_pickup_address) = '' or p_drop_address is null or btrim(p_drop_address) = '' then
    return jsonb_build_object('ok', false, 'error', 'Please enter both a pickup and a drop address.');
  end if;

  v_fares := public.fares();
  v_cfg := coalesce(v_fares -> p_vehicle_type, v_fares -> 'auto');
  v_base    := coalesce((v_cfg ->> 'baseFare')::numeric, 30);
  v_per_km  := coalesce((v_cfg ->> 'perKm')::numeric, 12);
  v_per_min := coalesce((v_cfg ->> 'perMinute')::numeric, 1);
  v_min     := coalesce((v_cfg ->> 'minFare')::numeric, 50);

  v_fare := greatest(v_min, v_base + (greatest(coalesce(p_distance_km,0),0) * v_per_km)
                              + (greatest(coalesce(p_duration_min,0),0) * v_per_min));

  v_otp  := lpad((floor(random() * 1000000))::text, 6, '0');
  v_ref  := 'SW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
  v_share := replace(gen_random_uuid()::text, '-', '');

  insert into public.rides (
    ref, rider_id, vehicle_type, pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng, distance_km, duration_min,
    fare, fare_breakdown, status, ride_otp, share_token
  ) values (
    v_ref, auth.uid(), p_vehicle_type, btrim(p_pickup_address), p_pickup_lat, p_pickup_lng,
    btrim(p_drop_address), p_drop_lat, p_drop_lng,
    greatest(coalesce(p_distance_km,0),0), greatest(coalesce(p_duration_min,0),0),
    v_fare,
    jsonb_build_object('baseFare', v_base, 'perKm', v_per_km, 'perMinute', v_per_min,
                       'minFare', v_min, 'distanceKm', coalesce(p_distance_km,0),
                       'durationMin', coalesce(p_duration_min,0), 'currency', 'INR'),
    'requested', v_otp, v_share
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'rideId', v_id, 'ref', v_ref, 'rideOtp', v_otp,
                             'shareToken', v_share, 'fare', v_fare,
                             'fareBreakdown', jsonb_build_object(
                               'baseFare', v_base, 'perKm', v_per_km, 'perMinute', v_per_min,
                               'minFare', v_min, 'distanceKm', coalesce(p_distance_km,0),
                               'durationMin', coalesce(p_duration_min,0), 'currency', 'INR'));
end $$;

-- ── accept a ride ───────────────────────────────────────────────────────
-- The UPDATE only touches a ride that is still 'requested' and has no
-- driver, so two drivers can never take the same ride.
create or replace function public.accept_ride(p_ride_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_driver public.drivers%rowtype;
  v_rider  uuid;
  v_count  int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'You must be signed in.');
  end if;

  select * into v_driver from public.drivers where user_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Only drivers can accept rides.');
  end if;
  if not v_driver.is_verified then
    return jsonb_build_object('ok', false, 'error', 'Your driver account is not verified yet.');
  end if;

  select rider_id into v_rider from public.rides where id = p_ride_id for update;
  if v_rider = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'You cannot accept your own ride.');
  end if;

  update public.rides
     set driver_id = v_driver.id, status = 'accepted'
   where id = p_ride_id and status = 'requested' and driver_id is null;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'That ride has already been taken.');
  end if;

  update public.drivers set is_online = true where id = v_driver.id;

  return jsonb_build_object('ok', true, 'rideId', p_ride_id);
end $$;

-- ── the status machine ───────────────────────────────────────────────────
-- driver: accepted → ongoing → completed
-- rider or driver: cancel while the ride is still requested or accepted
-- on completion the ride is stamped and a cash payment row is created
create or replace function public.update_ride_status(
  p_ride_id uuid, p_status text, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ride    public.rides%rowtype;
  v_driver  uuid;
  v_is_driver boolean := false;
  v_is_rider  boolean := false;
  v_fare     numeric;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'You must be signed in.');
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That ride does not exist.');
  end if;

  select id into v_driver from public.drivers where user_id = auth.uid();
  v_is_driver := (v_ride.driver_id is not null and v_driver is not null and v_ride.driver_id = v_driver);
  v_is_rider  := (v_ride.rider_id = auth.uid());

  if not (v_is_driver or v_is_rider or public.is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'This is not your ride.');
  end if;

  if p_status = 'cancelled' then
    if v_ride.status not in ('requested','accepted') then
      return jsonb_build_object('ok', false, 'error', 'This ride can no longer be cancelled.');
    end if;
    update public.rides
       set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancel_reason = p_reason
     where id = p_ride_id;
    return jsonb_build_object('ok', true, 'rideId', p_ride_id, 'status', 'cancelled');
  end if;

  if not v_is_driver then
    return jsonb_build_object('ok', false, 'error', 'Only the driver can change the ride status.');
  end if;

  if p_status = 'ongoing' and v_ride.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'error', 'This ride cannot be started yet.');
  end if;
  if p_status = 'completed' and v_ride.status <> 'ongoing' then
    return jsonb_build_object('ok', false, 'error', 'This ride cannot be completed yet.');
  end if;

  if p_status = 'ongoing' then
    update public.rides set status = 'ongoing' where id = p_ride_id;
    return jsonb_build_object('ok', true, 'rideId', p_ride_id, 'status', 'ongoing');
  end if;

  if p_status = 'completed' then
    v_fare := coalesce(v_ride.fare, 0);
    update public.rides
       set status = 'completed', completed_at = now()
     where id = p_ride_id;

    update public.drivers
       set rides_completed = rides_completed + 1,
           total_earnings = total_earnings + v_fare
     where id = v_ride.driver_id;

    insert into public.payments (ride_id, rider_id, driver_id, method, amount, status)
    values (p_ride_id, v_ride.rider_id, v_ride.driver_id, 'cash', v_fare, 'pending')
    on conflict do nothing;

    return jsonb_build_object('ok', true, 'rideId', p_ride_id, 'status', 'completed');
  end if;

  return jsonb_build_object('ok', false, 'error', 'Unknown status.');
end $$;

-- ── quote a fare without booking (same maths as book_ride) ──────────────
create or replace function public.quote_ride(
  p_vehicle_type text default 'auto',
  p_distance_km numeric default 0,
  p_duration_min int default 0
)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with f as (select public.fares() as cfg),
       c as (select coalesce(f.cfg -> p_vehicle_type, f.cfg -> 'auto') as v from f)
  select jsonb_build_object(
    'ok', true,
    'fare', greatest(
      coalesce((c.v ->> 'minFare')::numeric, 50),
      coalesce((c.v ->> 'baseFare')::numeric, 30)
      + coalesce(greatest(coalesce(p_distance_km,0),0),0) * coalesce((c.v ->> 'perKm')::numeric, 12)
      + coalesce(greatest(coalesce(p_duration_min,0),0),0) * coalesce((c.v ->> 'perMinute')::numeric, 1)),
    'breakdown', jsonb_build_object(
      'baseFare', coalesce((c.v ->> 'baseFare')::numeric, 30),
      'perKm', coalesce((c.v ->> 'perKm')::numeric, 12),
      'perMinute', coalesce((c.v ->> 'perMinute')::numeric, 1),
      'minFare', coalesce((c.v ->> 'minFare')::numeric, 50),
      'distanceKm', coalesce(p_distance_km,0), 'durationMin', coalesce(p_duration_min,0),
      'currency', 'INR'))
    from c;
$$;

-- ── the public ride-tracking link (no sign-in needed) ───────────────────
create or replace function public.get_ride_by_share_token(p_token text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ref', r.ref, 'status', r.status, 'vehicleType', r.vehicle_type,
    'fare', r.fare, 'distanceKm', r.distance_km,
    'pickup', jsonb_build_object('address', r.pickup_address, 'lat', r.pickup_lat, 'lng', r.pickup_lng),
    'drop', jsonb_build_object('address', r.drop_address, 'lat', r.drop_lat, 'lng', r.drop_lng),
    'riderName', p.full_name, 'riderPhone', p.phone,
    'driverName', dp.full_name, 'driverPhone', dp.phone,
    'vehicleRegistration', v.registration_number,
    'createdAt', r.created_at, 'completedAt', r.completed_at, 'cancelledAt', r.cancelled_at
  )
  from public.rides r
  left join public.profiles p on p.id = r.rider_id
  left join public.drivers d on d.id = r.driver_id
  left join public.profiles dp on dp.id = d.user_id
  left join lateral (select registration_number from public.vehicles
                       where driver_id = r.driver_id order by is_primary desc limit 1) v on true
  where r.share_token = p_token;
$$;

-- ── an admin helper: set a role / block a user / verify a driver ────────
create or replace function public.admin_set_user_state(
  p_user_id uuid, p_role text default null, p_blocked boolean default null,
  p_verified boolean default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Administrator access only.');
  end if;

  update public.profiles
     set role = coalesce(p_role, role),
         is_blocked = coalesce(p_blocked, is_blocked),
         is_verified = coalesce(p_verified, is_verified)
   where id = p_user_id;

  perform public.log_admin_action('user.update', 'profile', p_user_id::text,
    jsonb_build_object('role', p_role, 'blocked', p_blocked, 'verified', p_verified));

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_driver_verified(
  p_driver_id uuid, p_verified boolean
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Administrator access only.');
  end if;
  update public.drivers set is_verified = p_verified where id = p_driver_id;
  update public.profiles set is_verified = p_verified
    where id = (select user_id from public.drivers where id = p_driver_id);
  perform public.log_admin_action('driver.verify', 'driver', p_driver_id::text,
    jsonb_build_object('verified', p_verified));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_fares(p_fares jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Administrator access only.');
  end if;
  insert into public.app_settings (key, value, updated_by)
  values ('fares', p_fares, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_admin_action('settings.fares', 'app_settings', 'fares', p_fares);
  return jsonb_build_object('ok', true);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7.  STORAGE
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('driver-documents', 'driver-documents', false)
on conflict (id) do update set public = false;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);

-- driver documents are private: the owner and admins only
drop policy if exists driver_documents_read on storage.objects;
create policy driver_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists driver_documents_write on storage.objects;
create policy driver_documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists driver_documents_delete on storage.objects;
create policy driver_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'driver-documents' and owner_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8.  REALTIME — the live ride board
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rides'
  ) then
    alter publication supabase_realtime add table public.rides;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9.  GRANTS
-- ═══════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;

-- The RPCs are for signed-in users only.
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;

grant all on all tables in schema public to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. THE FIRST ADMIN
--     The admin account is created in the Supabase dashboard
--     (Authentication → Users → Add user → Auto Confirm), then:
--
--       update public.profiles set role = 'admin'
--        where email = 'your-admin@example.com';
--
--     Until then nobody can reach /admin.
-- ═══════════════════════════════════════════════════════════════════════════
