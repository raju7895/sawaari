-- ═══════════════════════════════════════════════════════════════════════════
-- SAWAARI → SUPABASE  ·  INIT  ·  2026-11-14
-- ═══════════════════════════════════════════════════════════════════════════
-- One idempotent migration that turns the Sawaari platform into a complete
-- Supabase backend: Postgres + Auth + Storage + Realtime.
--
-- Run it in the Supabase SQL Editor. It is safe to run again — every
-- statement is guarded (IF NOT EXISTS / OR REPLACE / DROP+CREATE POLICY).
--
-- ── What moves where ──────────────────────────────────────────────────────
--   Express `users` table          → auth.users (identity) + public.profiles
--   bcrypt password_hash           → auth.users.encrypted_password
--   own JWT + localStorage token   → Supabase session (JWT from GoTrue)
--   otp_codes                      → Supabase Auth email/phone OTP
--   admin_verification_tokens      → Supabase Auth email templates + invites
--   admin_2fa_challenges           → Supabase Auth MFA (TOTP)
--   server/uploads/*               → Supabase Storage buckets
--   socket.io rooms                → Supabase Realtime (postgres_changes + broadcast)
--   Express RBAC middleware        → RLS policies + has_permission()
--   admin_audit_log                → kept, append-only trigger, written by RPC
--
-- ── Roles ─────────────────────────────────────────────────────────────────
--   passenger · driver · admin · super_admin · finance_admin ·
--   support_admin · driver_manager · moderator
--   The role lives in profiles.role AND is mirrored into
--   auth.users.raw_app_meta_data.role so RLS can read it from the JWT
--   without a join.
--
-- ── Security model ────────────────────────────────────────────────────────
--   • RLS is enabled on EVERY table in public.
--   • Users can only read/write their own rows.
--   • Role and admin fields are protected by COLUMN-LEVEL GRANTS: a user
--     physically cannot UPDATE profiles.role — only the SECURITY DEFINER
--     RPCs (which the admin policies gate) can.
--   • The platform owner can never be downgraded, suspended or deleted.
--   • The audit log is append-only for everybody, including the owner.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0.  EXTENSIONS + SHARED HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- Everyone who talks to the API is one of these roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sawaari_api') then
    create role sawaari_api nologin;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ── updated_at maintenance ────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── The role / permission helpers live in section 7b, AFTER the tables:
--    a function body is validated when it is created, so they may only
--    reference tables that already exist. ────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- 1.  IDENTITY — profiles replaces the old `users` table
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  role            text not null default 'passenger'
                    check (role in ('passenger','driver','admin','super_admin',
                                    'finance_admin','support_admin','driver_manager','moderator')),
  name            text not null default '',
  phone           text unique,
  email           text,
  avatar_path     text,                                   -- storage path in `avatars`
  is_active       boolean not null default true,          -- false = blocked
  blocked_reason  text,
  phone_verified  boolean not null default false,
  email_verified_at timestamptz,
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists profiles_role_idx   on public.profiles(role);
create index if not exists profiles_active_idx on public.profiles(is_active);
create index if not exists profiles_created_idx on public.profiles(created_at desc);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── Create the profile the moment a user signs up ────────────────────────
-- The name and phone come from the signup metadata the frontend passes to
-- supabase.auth.signUp({ options: { data: { full_name, phone, role } } }).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role  text := coalesce(new.raw_user_meta_data ->> 'role', 'passenger');
  v_name  text := coalesce(new.raw_user_meta_data ->> 'full_name',
                            new.raw_user_meta_data ->> 'name',
                            split_part(coalesce(new.email, ''), '@', 1));
  v_phone text := coalesce(new.raw_user_meta_data ->> 'phone', new.phone);
begin
  if v_role not in ('passenger','driver') then v_role := 'passenger'; end if;

  insert into public.profiles (id, role, name, phone, email, phone_verified)
  values (
    new.id,
    v_role,
    coalesce(nullif(v_name, ''), 'Rider'),
    nullif(v_phone, ''),
    new.email,
    -- to_jsonb() keeps this working on every Supabase version: the phone
    -- confirmation column is called phone_verified or phone_confirmed_at
    coalesce((to_jsonb(new) ->> 'phone_verified')::boolean, false)
  )
  on conflict (id) do update
    set name  = excluded.name,
        phone = coalesce(excluded.phone, public.profiles.phone),
        email = coalesce(excluded.email, public.profiles.email);

  -- NOTE: the role is NOT written back into auth.users.raw_app_meta_data
  -- here. The claims column of auth.users cannot be updated from inside a
  -- PL/pgSQL function in every environment (the relation's columns are not
  -- visible to the function's plan), and it does not have to be: RLS reads
  -- the role from profiles, which is server-controlled and always current.
  -- A deployment that wants the claim in the JWT can set it server-side
  -- (Edge Function with the service role) right after the signup.

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Keep the role claim in sync with profiles.role ──────────────────────
-- The role is read straight from profiles by public.current_role(), so no
-- back-write into auth.users is needed (and none is possible from inside a
-- PL/pgSQL function — see the note in handle_new_user).
drop trigger if exists profiles_sync_role_claims on public.profiles;
drop function if exists public.sync_role_claims();

-- A user may never change their own role
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role is distinct from old.role
     and not (public.is_super_admin() or public.is_owner()) then
    raise exception 'You cannot change your own role.' using errcode = 'insufficient_privilege';
  end if;
  if new.is_active is distinct from old.is_active
     and not (public.has_permission('users.block') or public.has_permission('users.suspend')
              or public.is_super_admin() or public.is_owner()) then
    raise exception 'Only an administrator can block or unblock an account.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.  PROFILE SUB-TABLES
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.passenger_profiles (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  rating_avg   numeric(3,2) not null default 0,
  rating_count int not null default 0,
  default_city uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.driver_profiles (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references public.profiles(id) on delete cascade,
  verification_status text not null default 'pending'
                       check (verification_status in ('pending','approved','rejected')),
  rejection_reason   text,
  reviewed_by        uuid references public.profiles(id),
  reviewed_at        timestamptz,
  is_online          boolean not null default false,
  current_booking_id uuid,
  upi_id             text,
  upi_verified       boolean not null default false,
  rating_avg         numeric(3,2) not null default 0,
  rating_count       int not null default 0,
  rides_completed    int not null default 0,
  rides_cancelled    int not null default 0,
  total_earnings     numeric(12,2) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists driver_online_idx on public.driver_profiles(is_online, verification_status)
  where current_booking_id is null;

create table if not exists public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  driver_profile_id   uuid not null references public.driver_profiles(id) on delete cascade,
  registration_number text not null unique,
  vehicle_type        text not null check (vehicle_type in ('auto','e_rickshaw')),
  model               text,
  capacity            int not null default 3,
  photo_path          text,
  is_primary          boolean not null default true,
  created_at          timestamptz not null default now()
);
create index if not exists vehicles_driver_idx on public.vehicles(driver_profile_id);

create table if not exists public.driver_documents (
  id                uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete cascade,
  doc_type          text not null check (doc_type in ('license','aadhaar','vehicle_rc','insurance','profile_photo')),
  file_path         text not null,                        -- storage path in `documents`
  doc_number        text,
  status            text not null default 'pending' check (status in ('pending','verified','rejected')),
  review_note       text,
  reviewed_by       uuid references public.profiles(id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists driver_docs_driver_idx on public.driver_documents(driver_profile_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3.  PLATFORM CONFIGURATION
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  state       text,
  center_lat  double precision not null,
  center_lng  double precision not null,
  radius_km   int not null default 25,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.pricing_configs (
  id               uuid primary key default gen_random_uuid(),
  city_id          uuid not null references public.cities(id) on delete cascade,
  vehicle_type     text not null check (vehicle_type in ('auto','e_rickshaw')),
  base_fare        numeric(8,2) not null,
  per_km           numeric(8,2) not null,
  per_minute       numeric(8,2) not null default 0,
  min_fare         numeric(8,2) not null,
  booking_fee      numeric(8,2) not null default 0,
  waiting_per_min  numeric(8,2) not null default 0,
  free_wait_min    int not null default 5,
  night_multiplier numeric(4,2) not null default 1,
  night_from_hour  int not null default 23,
  night_to_hour    int not null default 5,
  is_active        boolean not null default true,
  updated_at       timestamptz not null default now(),
  unique (city_id, vehicle_type)
);

create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  category   text not null default 'general',
  label      text,
  is_secret  boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists platform_settings_category_idx on public.platform_settings(category);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4.  RIDES
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.saved_locations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  label      text not null,
  address    text not null,
  lat        double precision not null,
  lng        double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists saved_loc_user_idx on public.saved_locations(user_id);

create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique,
  passenger_id      uuid not null references public.profiles(id),
  driver_profile_id uuid references public.driver_profiles(id),
  city_id           uuid references public.cities(id),
  booking_type      text not null check (booking_type in ('immediate','scheduled','custom')),
  scheduled_at      timestamptz,
  vehicle_type      text not null default 'auto',
  pickup_lat        double precision not null,
  pickup_lng        double precision not null,
  pickup_address    text not null,
  drop_lat          double precision not null,
  drop_lng          double precision not null,
  drop_address      text not null,
  distance_km       numeric(8,2) not null,
  duration_min      int not null,
  route_geometry    jsonb,
  fare_breakdown    jsonb not null,
  estimated_fare    numeric(10,2) not null,
  final_fare        numeric(10,2),
  waiting_minutes   int not null default 0,
  status            text not null default 'searching' check (status in
                      ('scheduled','searching','assigned','arriving','arrived',
                       'in_progress','completed','cancelled','expired')),
  ride_otp          text not null,
  share_token       text not null unique,
  cancellation_reason text,
  cancelled_by      uuid references public.profiles(id),
  cancellation_fee  numeric(8,2) not null default 0,
  payment_status    text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  created_at        timestamptz not null default now(),
  assigned_at       timestamptz,
  arrived_at        timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists bookings_passenger_idx on public.bookings(passenger_id, created_at desc);
create index if not exists bookings_driver_idx    on public.bookings(driver_profile_id, created_at desc);
create index if not exists bookings_status_idx    on public.bookings(status);
create index if not exists bookings_city_idx      on public.bookings(city_id);
create index if not exists bookings_created_idx   on public.bookings(created_at desc);

create table if not exists public.ride_events (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status     text not null,
  actor_id   uuid references public.profiles(id),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists ride_events_booking_idx on public.ride_events(booking_id, created_at);

create table if not exists public.booking_messages (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists bmsg_booking_idx on public.booking_messages(booking_id, created_at);

create table if not exists public.driver_locations (
  driver_profile_id uuid primary key references public.driver_profiles(id) on delete cascade,
  lat            double precision not null,
  lng            double precision not null,
  heading        numeric(6,2),
  accuracy_m     numeric(8,2),
  updated_at     timestamptz not null default now()
);
create index if not exists driver_loc_updated_idx on public.driver_locations(updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5.  MONEY
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references public.bookings(id),
  passenger_id      uuid not null references public.profiles(id),
  method            text not null check (method in ('online','upi_qr','cash')),
  amount            numeric(10,2) not null,
  currency          text not null default 'INR',
  status            text not null default 'pending' check (status in
                      ('pending','awaiting_verification','paid','failed','refunded')),
  rzp_order_id      text,
  rzp_payment_id    text,
  rzp_signature     text,
  rzp_refund_id     text,
  upi_intent_url    text,
  upi_txn_ref       text,
  upi_vpa           text,
  passenger_utr     text,
  verified_by       uuid references public.profiles(id),
  verified_at       timestamptz,
  failure_reason    text,
  refunded_amount   numeric(10,2) not null default 0,
  meta              jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payments_booking_idx on public.payments(booking_id);
create index if not exists payments_status_idx  on public.payments(status);
create index if not exists payments_created_idx on public.payments(created_at desc);
create unique index if not exists payments_rzp_order_idx on public.payments(rzp_order_id)
  where rzp_order_id is not null;

create table if not exists public.driver_earnings (
  id                uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id),
  booking_id        uuid not null unique references public.bookings(id),
  gross             numeric(10,2) not null,
  commission        numeric(10,2) not null,
  net               numeric(10,2) not null,
  created_at        timestamptz not null default now()
);
create index if not exists earnings_driver_idx  on public.driver_earnings(driver_profile_id, created_at desc);
create index if not exists earnings_created_idx on public.driver_earnings(created_at desc);

create table if not exists public.refunds (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references public.payments(id) on delete restrict,
  booking_id   uuid references public.bookings(id) on delete set null,
  amount       numeric(12,2) not null check (amount > 0),
  reason       text not null,
  method       text not null check (method in ('razorpay','upi','cash','manual')),
  status       text not null default 'pending'
                check (status in ('pending','processing','completed','failed','rejected')),
  gateway_ref  text,
  gateway_response jsonb,
  notes        text,
  initiated_by uuid references public.profiles(id),
  approved_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists refunds_payment_idx on public.refunds(payment_id, created_at desc);
create index if not exists refunds_status_idx  on public.refunds(status, created_at desc);

create table if not exists public.settlements (
  id               uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  period_start     date not null,
  period_end       date not null,
  gross            numeric(12,2) not null default 0,
  commission       numeric(12,2) not null default 0,
  net              numeric(12,2) not null default 0,
  rides            int not null default 0,
  status           text not null default 'pending' check (status in ('pending','paid','cancelled')),
  reference        text,
  paid_at          timestamptz,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);
create index if not exists settlements_driver_idx on public.settlements(driver_profile_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6.  COMMUNICATION + TRUST
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null unique references public.bookings(id),
  reviewer_id uuid not null references public.profiles(id),
  reviewee_id uuid not null references public.profiles(id),
  rating      int not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now()
);
create index if not exists reviews_reviewee_idx on public.reviews(reviewee_id);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notif_user_idx on public.notifications(user_id, created_at desc);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_user_idx on public.push_subscriptions(user_id);

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id),
  booking_id  uuid references public.bookings(id),
  subject     text not null,
  status      text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority    text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tickets_status_idx on public.support_tickets(status, created_at desc);

create table if not exists public.ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_msg_idx on public.ticket_messages(ticket_id, created_at);

create table if not exists public.user_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.profiles(id),
  against_user_id uuid not null references public.profiles(id),
  booking_id      uuid references public.bookings(id),
  reason          text not null,
  details         text,
  status          text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  resolved_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists reports_status_idx on public.user_reports(status, created_at desc);

create table if not exists public.report_investigations (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.user_reports(id) on delete cascade,
  admin_id    uuid references public.profiles(id),
  admin_email text,
  action      text not null,
  note        text,
  evidence    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists report_investigation_report_idx on public.report_investigations(report_id, created_at desc);

create table if not exists public.sos_alerts (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid references public.bookings(id),
  user_id         uuid not null references public.profiles(id),
  lat             double precision,
  lng             double precision,
  status          text not null default 'open' check (status in ('open','acknowledged','resolved')),
  acknowledged_by uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists sos_status_idx on public.sos_alerts(status, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7.  ADMIN CONTROL PLANE
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_profiles (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  admin_role         text not null check (admin_role in
                       ('super_admin','admin','finance_admin','support_admin',
                        'driver_manager','moderator')),
  is_owner           boolean not null default false,
  status             text not null default 'active'
                       check (status in ('active','suspended','invited','disabled')),
  permissions        jsonb,
  email_verified     boolean not null default false,
  twofa_enabled      boolean not null default false,      -- Supabase MFA state
  failed_attempts    int not null default 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  last_login_ip      inet,
  invited_by         uuid references public.profiles(id),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists admin_profiles_role_idx   on public.admin_profiles(admin_role);
create index if not exists admin_profiles_status_idx on public.admin_profiles(status);

create table if not exists public.admin_login_attempts (
  id          bigserial primary key,
  email       text,
  ip_address  inet,
  success     boolean not null default false,
  reason      text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists admin_login_attempts_email_idx on public.admin_login_attempts(email, created_at desc);
create index if not exists admin_login_attempts_ip_idx    on public.admin_login_attempts(ip_address, created_at desc);

create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  admin_id       uuid references public.profiles(id),
  admin_email    text,
  admin_role     text,
  action         text not null,
  category       text not null default 'general',
  target_type    text,
  target_id      text,
  target_label   text,
  previous_value jsonb,
  new_value      jsonb,
  ip_address     inet,
  user_agent     text,
  result         text not null default 'success' check (result in ('success','failure','denied')),
  created_at     timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_admin_idx   on public.admin_audit_log(admin_id, created_at desc);
create index if not exists admin_audit_action_idx  on public.admin_audit_log(action, created_at desc);
create index if not exists admin_audit_target_idx  on public.admin_audit_log(target_type, target_id);

-- append-only, for everybody
create or replace function public.audit_log_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists admin_audit_no_update on public.admin_audit_log;
create trigger admin_audit_no_update
  before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_is_append_only();

create table if not exists public.admin_broadcasts (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  body             text not null,
  audience         text not null check (audience in ('all','passengers','drivers','admins','city','user')),
  audience_filter  jsonb,
  sent_by          uuid references public.profiles(id),
  recipients       int not null default 0,
  delivered        int not null default 0,
  status           text not null default 'sent' check (status in ('sent','failed','scheduled')),
  created_at       timestamptz not null default now()
);
create index if not exists admin_broadcasts_created_idx on public.admin_broadcasts(created_at desc);

create table if not exists public.user_suspensions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('suspend','block','deactivate')),
  reason      text,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  lifted_at   timestamptz,
  lifted_by   uuid references public.profiles(id)
);
create index if not exists user_suspensions_user_idx  on public.user_suspensions(user_id, created_at desc);
create index if not exists user_suspensions_active_idx on public.user_suspensions(user_id)
  where lifted_at is null;

-- The owner can never be downgraded, suspended or deleted.
create or replace function public.protect_owner_account()
returns trigger language plpgsql as $$
declare
  v_was_owner boolean;
begin
  select is_owner into v_was_owner from public.admin_profiles where user_id = old.user_id;
  if coalesce(v_was_owner, false) then
    if tg_op = 'DELETE' then
      raise exception 'The platform owner account cannot be deleted' using errcode = 'restrict_violation';
    end if;
    if new.admin_role <> 'super_admin' or new.status <> 'active' or not new.is_owner then
      raise exception 'The platform owner account cannot be downgraded or suspended'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists admin_owner_protect on public.admin_profiles;
create trigger admin_owner_protect
  before update or delete on public.admin_profiles
  for each row execute function public.protect_owner_account();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7b.  ROLE + PERMISSION HELPERS
--     Defined here because a function body is validated when it is created,
--     so it may only reference tables that already exist.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Every passenger needs a passenger_profiles row, every driver a
--    driver_profiles row (they carry the rating). Carried over from the
--    old migration 005. ───────────────────────────────────────────────────
create or replace function public.ensure_user_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'passenger' then
    insert into public.passenger_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  elsif new.role = 'driver' then
    insert into public.driver_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists profiles_ensure_profile on public.profiles;
create trigger profiles_ensure_profile
  after insert on public.profiles
  for each row execute function public.ensure_user_profile();

-- ── The role of the caller ───────────────────────────────────────────────
-- SECURITY DEFINER so it can read profiles without re-entering the
-- profiles SELECT policy (which calls is_admin() → current_role()).
-- The JWT claim is only a fast path; profiles.role is the source of
-- truth and is server-controlled (a user can never change their own
-- role — see the trigger and the column grants below).
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role'),
    (select p.role from public.profiles p where p.id = auth.uid())
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$ select public.current_role() in (
  'admin','super_admin','finance_admin','support_admin','driver_manager','moderator'
); $$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$ select public.current_role() = 'super_admin'; $$;

-- ── The platform owner ────────────────────────────────────────────────────
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid() and ap.is_owner and ap.status = 'active'
  );
$$;

-- ── Granular permissions (the 35 of the old RBAC service) ─────────────────
-- Mirrors server/src/services/rbac.js: role defaults + grant/deny overrides.
-- SECURITY DEFINER so it can read admin_profiles while RLS is on.
create or replace function public.has_permission(perm text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.admin_profiles%rowtype;
  v_base   text[];
  v_grant  text[] := '{}';
  v_deny   text[] := '{}';
begin
  if auth.uid() is null then return false; end if;

  select * into v_profile from public.admin_profiles where user_id = auth.uid();
  if not found then return false; end if;
  if v_profile.status <> 'active' then return false; end if;
  if v_profile.admin_role = 'super_admin' then return true; end if;

  v_base := case v_profile.admin_role
    when 'admin' then array['users.view','users.edit','users.block','users.suspend',
      'drivers.view','drivers.verify','drivers.manage','bookings.view','bookings.cancel',
      'bookings.dispute','payments.view','payments.verify','reports.view','reports.investigate',
      'tickets.view','tickets.reply','notifications.send','analytics.view','cities.view',
      'cities.manage','settings.view','admins.view','audit.view']
    when 'finance_admin' then array['users.view','bookings.view','payments.view','payments.verify',
      'payments.refund','finance.view','finance.reports','finance.settings','analytics.view','audit.view']
    when 'support_admin' then array['users.view','users.block','drivers.view','bookings.view',
      'reports.view','reports.investigate','tickets.view','tickets.reply','notifications.send',
      'analytics.view','cities.view','settings.view']
    when 'driver_manager' then array['users.view','users.block','users.suspend','drivers.view',
      'drivers.verify','drivers.manage','bookings.view','reports.view','reports.investigate',
      'notifications.send','analytics.view','cities.view']
    when 'moderator' then array['users.view','users.block','users.suspend','drivers.view',
      'bookings.view','reports.view','reports.investigate','tickets.view','analytics.view']
    else '{}'::text[]
  end;

  if v_profile.permissions is not null and jsonb_typeof(v_profile.permissions) = 'object' then
    if jsonb_typeof(v_profile.permissions -> 'grant') = 'array' then
      select coalesce(array_agg(value::text), '{}') into v_grant
      from jsonb_array_elements_text(v_profile.permissions -> 'grant');
    end if;
    if jsonb_typeof(v_profile.permissions -> 'deny') = 'array' then
      select coalesce(array_agg(value::text), '{}') into v_deny
      from jsonb_array_elements_text(v_profile.permissions -> 'deny');
    end if;
  end if;

  return (perm = any(v_base || v_grant))
     and not (perm = any(v_deny));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8.  ROW LEVEL SECURITY — EVERY TABLE
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles            enable row level security;
alter table public.passenger_profiles  enable row level security;
alter table public.driver_profiles     enable row level security;
alter table public.vehicles            enable row level security;
alter table public.driver_documents    enable row level security;
alter table public.cities              enable row level security;
alter table public.pricing_configs     enable row level security;
alter table public.platform_settings   enable row level security;
alter table public.saved_locations     enable row level security;
alter table public.bookings            enable row level security;
alter table public.ride_events         enable row level security;
alter table public.booking_messages    enable row level security;
alter table public.driver_locations    enable row level security;
alter table public.payments            enable row level security;
alter table public.driver_earnings     enable row level security;
alter table public.refunds             enable row level security;
alter table public.settlements         enable row level security;
alter table public.reviews             enable row level security;
alter table public.notifications       enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.support_tickets     enable row level security;
alter table public.ticket_messages     enable row level security;
alter table public.user_reports        enable row level security;
alter table public.report_investigations enable row level security;
alter table public.sos_alerts          enable row level security;
alter table public.admin_profiles      enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.admin_audit_log     enable row level security;
alter table public.admin_broadcasts    enable row level security;
alter table public.user_suspensions    enable row level security;

-- ── helper: the caller's driver profile id ────────────────────────────────
create or replace function public.current_driver_profile_id()
returns uuid language sql stable as $$
  select dp.id from public.driver_profiles dp where dp.user_id = auth.uid();
$$;

-- ── profiles ──────────────────────────────────────────────────────────────
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- The role column is protected by a column grant (below) — a user cannot
-- even try to set it.
revoke update on public.profiles from authenticated;
grant update (name, phone, email, avatar_path) on public.profiles to authenticated;
grant update (role, is_active, blocked_reason, phone_verified, email_verified_at, deactivated_at)
  on public.profiles to service_role;

-- ── passenger_profiles / driver_profiles ──────────────────────────────────
drop policy if exists passenger_profiles_all on public.passenger_profiles;
create policy passenger_profiles_all on public.passenger_profiles for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists driver_profiles_select on public.driver_profiles;
create policy driver_profiles_select on public.driver_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or (verification_status = 'approved' and is_online));

drop policy if exists driver_profiles_update_self on public.driver_profiles;
create policy driver_profiles_update_self on public.driver_profiles for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

revoke update on public.driver_profiles from authenticated;
grant update (upi_id, is_online, current_booking_id) on public.driver_profiles to authenticated;
grant update (verification_status, rejection_reason, reviewed_by, reviewed_at,
              upi_verified, rating_avg, rating_count, rides_completed,
              rides_cancelled, total_earnings) on public.driver_profiles to service_role;

-- ── vehicles / driver_documents ───────────────────────────────────────────
drop policy if exists vehicles_all on public.vehicles;
create policy vehicles_all on public.vehicles for all to authenticated
  using (driver_profile_id in (select id from public.driver_profiles where user_id = auth.uid())
         or public.has_permission('drivers.view') or public.has_permission('drivers.manage'))
  with check (driver_profile_id in (select id from public.driver_profiles where user_id = auth.uid())
         or public.has_permission('drivers.manage'));

drop policy if exists driver_documents_select on public.driver_documents;
create policy driver_documents_select on public.driver_documents for select to authenticated
  using (driver_profile_id in (select id from public.driver_profiles where user_id = auth.uid())
         or public.has_permission('drivers.verify'));

drop policy if exists driver_documents_insert on public.driver_documents;
create policy driver_documents_insert on public.driver_documents for insert to authenticated
  with check (driver_profile_id in (select id from public.driver_profiles where user_id = auth.uid()));

drop policy if exists driver_documents_update on public.driver_documents;
create policy driver_documents_update on public.driver_documents for update to authenticated
  using (driver_profile_id in (select id from public.driver_profiles where user_id = auth.uid())
         or public.has_permission('drivers.verify'))
  with check (driver_profile_id in (select id from public.driver_profiles where user_id = auth.uid())
         or public.has_permission('drivers.verify'));

revoke update on public.driver_documents from authenticated;
grant update (status, review_note, reviewed_by, reviewed_at) on public.driver_documents to service_role;

-- ── cities / pricing (public read, admin write) ───────────────────────────
drop policy if exists cities_read on public.cities;
create policy cities_read on public.cities for select to anon, authenticated using (true);

drop policy if exists cities_write on public.cities;
create policy cities_write on public.cities for all to authenticated
  using (public.has_permission('cities.manage'))
  with check (public.has_permission('cities.manage'));

drop policy if exists pricing_read on public.pricing_configs;
create policy pricing_read on public.pricing_configs for select to anon, authenticated using (true);

drop policy if exists pricing_write on public.pricing_configs;
create policy pricing_write on public.pricing_configs for all to authenticated
  using (public.has_permission('finance.settings') or public.has_permission('cities.manage'))
  with check (public.has_permission('finance.settings') or public.has_permission('cities.manage'));

-- ── platform_settings ─────────────────────────────────────────────────────
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings for select to authenticated
  using (public.has_permission('settings.view') or public.has_permission('finance.settings'));

drop policy if exists platform_settings_write on public.platform_settings;
create policy platform_settings_write on public.platform_settings for all to authenticated
  using (public.has_permission('settings.edit'))
  with check (public.has_permission('settings.edit'));

-- ── saved_locations ───────────────────────────────────────────────────────
drop policy if exists saved_locations_all on public.saved_locations;
create policy saved_locations_all on public.saved_locations for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── bookings ──────────────────────────────────────────────────────────────
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select to authenticated
  using (passenger_id = auth.uid()
         or driver_profile_id = public.current_driver_profile_id()
         or public.has_permission('bookings.view'));

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings for insert to authenticated
  with check (passenger_id = auth.uid());

drop policy if exists bookings_update_participant on public.bookings;
create policy bookings_update_participant on public.bookings for update to authenticated
  using (passenger_id = auth.uid()
         or driver_profile_id = public.current_driver_profile_id()
         or public.has_permission('bookings.cancel'))
  with check (passenger_id = auth.uid()
         or driver_profile_id = public.current_driver_profile_id()
         or public.has_permission('bookings.cancel'));

-- ── ride_events / booking_messages ────────────────────────────────────────
drop policy if exists ride_events_select on public.ride_events;
create policy ride_events_select on public.ride_events for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = ride_events.booking_id
      and (b.passenger_id = auth.uid()
           or b.driver_profile_id = public.current_driver_profile_id()
           or public.has_permission('bookings.view'))
  ));

drop policy if exists ride_events_insert on public.ride_events;
create policy ride_events_insert on public.ride_events for insert to authenticated
  with check (actor_id = auth.uid() or public.has_permission('bookings.view'));

drop policy if exists booking_messages_select on public.booking_messages;
create policy booking_messages_select on public.booking_messages for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_messages.booking_id
      and (b.passenger_id = auth.uid()
           or b.driver_profile_id = public.current_driver_profile_id()
           or public.has_permission('bookings.view'))
  ));

drop policy if exists booking_messages_insert on public.booking_messages;
create policy booking_messages_insert on public.booking_messages for insert to authenticated
  with check (sender_id = auth.uid());

-- ── driver_locations ──────────────────────────────────────────────────────
drop policy if exists driver_locations_select on public.driver_locations;
create policy driver_locations_select on public.driver_locations for select to authenticated
  using (driver_profile_id = public.current_driver_profile_id()
         or exists (select 1 from public.bookings b
                     where b.driver_profile_id = driver_locations.driver_profile_id
                       and b.passenger_id = auth.uid())
         or public.has_permission('drivers.view'));

drop policy if exists driver_locations_write on public.driver_locations;
create policy driver_locations_write on public.driver_locations for all to authenticated
  using (driver_profile_id = public.current_driver_profile_id())
  with check (driver_profile_id = public.current_driver_profile_id());

-- ── payments ──────────────────────────────────────────────────────────────
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (passenger_id = auth.uid()
         or exists (select 1 from public.bookings b
                     where b.id = payments.booking_id
                       and b.driver_profile_id = public.current_driver_profile_id())
         or public.has_permission('payments.view'));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert to authenticated
  with check (passenger_id = auth.uid() or public.has_permission('payments.verify'));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update to authenticated
  using (public.has_permission('payments.verify') or public.has_permission('payments.refund'))
  with check (public.has_permission('payments.verify') or public.has_permission('payments.refund'));

-- ── earnings / settlements ───────────────────────────────────────────────
drop policy if exists driver_earnings_select on public.driver_earnings;
create policy driver_earnings_select on public.driver_earnings for select to authenticated
  using (driver_profile_id = public.current_driver_profile_id() or public.has_permission('finance.view'));

drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select to authenticated
  using (driver_profile_id = public.current_driver_profile_id() or public.has_permission('finance.view'));

drop policy if exists settlements_write on public.settlements;
create policy settlements_write on public.settlements for all to authenticated
  using (public.has_permission('finance.settings'))
  with check (public.has_permission('finance.settings'));

-- ── refunds ───────────────────────────────────────────────────────────────
drop policy if exists refunds_select on public.refunds;
create policy refunds_select on public.refunds for select to authenticated
  using (public.has_permission('payments.refund') or public.has_permission('finance.view'));

drop policy if exists refunds_insert on public.refunds;
create policy refunds_insert on public.refunds for insert to authenticated
  with check (public.has_permission('payments.refund'));

drop policy if exists refunds_update on public.refunds;
create policy refunds_update on public.refunds for update to authenticated
  using (public.has_permission('payments.refund'))
  with check (public.has_permission('payments.refund'));

-- ── reviews / notifications / push ────────────────────────────────────────
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to authenticated
  using (reviewee_id = auth.uid() or reviewer_id = auth.uid() or public.has_permission('users.view'));

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated
  with check (reviewer_id = auth.uid());

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (user_id = auth.uid() or public.has_permission('notifications.send'));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() or public.has_permission('notifications.send'))
  with check (user_id = auth.uid() or public.has_permission('notifications.send'));

drop policy if exists push_subscriptions_all on public.push_subscriptions;
create policy push_subscriptions_all on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── support ───────────────────────────────────────────────────────────────
drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.has_permission('tickets.view'));

drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists support_tickets_update on public.support_tickets;
create policy support_tickets_update on public.support_tickets for update to authenticated
  using (user_id = auth.uid() or public.has_permission('tickets.reply'))
  with check (user_id = auth.uid() or public.has_permission('tickets.reply'));

drop policy if exists ticket_messages_select on public.ticket_messages;
create policy ticket_messages_select on public.ticket_messages for select to authenticated
  using (sender_id = auth.uid()
         or exists (select 1 from public.support_tickets t
                     where t.id = ticket_messages.ticket_id
                       and (t.user_id = auth.uid() or public.has_permission('tickets.view'))));

drop policy if exists ticket_messages_insert on public.ticket_messages;
create policy ticket_messages_insert on public.ticket_messages for insert to authenticated
  with check (sender_id = auth.uid() or public.has_permission('tickets.reply'));

-- ── reports / SOS ─────────────────────────────────────────────────────────
drop policy if exists user_reports_select on public.user_reports;
create policy user_reports_select on public.user_reports for select to authenticated
  using (reporter_id = auth.uid() or against_user_id = auth.uid() or public.has_permission('reports.view'));

drop policy if exists user_reports_insert on public.user_reports;
create policy user_reports_insert on public.user_reports for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists user_reports_update on public.user_reports;
create policy user_reports_update on public.user_reports for update to authenticated
  using (public.has_permission('reports.investigate'))
  with check (public.has_permission('reports.investigate'));

drop policy if exists report_investigations_select on public.report_investigations;
create policy report_investigations_select on public.report_investigations for select to authenticated
  using (public.has_permission('reports.investigate') or admin_id = auth.uid());

drop policy if exists report_investigations_insert on public.report_investigations;
create policy report_investigations_insert on public.report_investigations for insert to authenticated
  with check (admin_id = auth.uid() and public.has_permission('reports.investigate'));

drop policy if exists sos_alerts_select on public.sos_alerts;
create policy sos_alerts_select on public.sos_alerts for select to authenticated
  using (user_id = auth.uid() or public.has_permission('reports.view'));

drop policy if exists sos_alerts_insert on public.sos_alerts;
create policy sos_alerts_insert on public.sos_alerts for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists sos_alerts_update on public.sos_alerts;
create policy sos_alerts_update on public.sos_alerts for update to authenticated
  using (public.has_permission('reports.investigate'))
  with check (public.has_permission('reports.investigate'));

-- ── admin control plane ───────────────────────────────────────────────────
drop policy if exists admin_profiles_select on public.admin_profiles;
create policy admin_profiles_select on public.admin_profiles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('admins.view'));

drop policy if exists admin_profiles_insert on public.admin_profiles;
create policy admin_profiles_insert on public.admin_profiles for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists admin_profiles_update on public.admin_profiles;
create policy admin_profiles_update on public.admin_profiles for update to authenticated
  using (public.has_permission('admins.edit') or public.has_permission('admins.suspend'))
  with check (public.has_permission('admins.edit') or public.has_permission('admins.suspend'));

drop policy if exists admin_profiles_delete on public.admin_profiles;
create policy admin_profiles_delete on public.admin_profiles for delete to authenticated
  using (public.has_permission('admins.remove'));

revoke update on public.admin_profiles from authenticated;
grant update (admin_role, status, permissions, notes, twofa_enabled,
              failed_attempts, locked_until, last_login_at, last_login_ip)
  on public.admin_profiles to service_role;

-- the audit log: admins read it, only the RPC writes it
drop policy if exists admin_audit_select on public.admin_audit_log;
create policy admin_audit_select on public.admin_audit_log for select to authenticated
  using (public.has_permission('audit.view'));

-- login attempts: only admins with the right permission
drop policy if exists admin_login_attempts_select on public.admin_login_attempts;
create policy admin_login_attempts_select on public.admin_login_attempts for select to authenticated
  using (public.has_permission('settings.security'));

drop policy if exists admin_broadcasts_select on public.admin_broadcasts;
create policy admin_broadcasts_select on public.admin_broadcasts for select to authenticated
  using (public.has_permission('notifications.send'));

drop policy if exists admin_broadcasts_insert on public.admin_broadcasts;
create policy admin_broadcasts_insert on public.admin_broadcasts for insert to authenticated
  with check (public.has_permission('notifications.send'));

drop policy if exists user_suspensions_select on public.user_suspensions;
create policy user_suspensions_select on public.user_suspensions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.suspend'));

drop policy if exists user_suspensions_insert on public.user_suspensions;
create policy user_suspensions_insert on public.user_suspensions for insert to authenticated
  with check (public.has_permission('users.suspend') or public.has_permission('users.deactivate'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 9.  STORAGE
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('vehicles', 'vehicles', true)
on conflict (id) do update set public = true;

-- driver documents are PRIVATE: only the driver and admins may see them
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

drop policy if exists storage_avatars_read on storage.objects;
create policy storage_avatars_read on storage.objects for select to public
  using (bucket_id = 'avatars');

drop policy if exists storage_avatars_write on storage.objects;
create policy storage_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists storage_avatars_update on storage.objects;
create policy storage_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);

drop policy if exists storage_avatars_delete on storage.objects;
create policy storage_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);

drop policy if exists storage_vehicles_read on storage.objects;
create policy storage_vehicles_read on storage.objects for select to public
  using (bucket_id = 'vehicles');

drop policy if exists storage_vehicles_write on storage.objects;
create policy storage_vehicles_write on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicles' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists storage_vehicles_update on storage.objects;
create policy storage_vehicles_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicles' and owner_id = auth.uid()::text);

drop policy if exists storage_vehicles_delete on storage.objects;
create policy storage_vehicles_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vehicles' and owner_id = auth.uid()::text);

-- private documents: the owner, or an admin who can verify drivers
drop policy if exists storage_documents_read on storage.objects;
create policy storage_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = auth.uid()::text
              or public.has_permission('drivers.verify')));

drop policy if exists storage_documents_write on storage.objects;
create policy storage_documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists storage_documents_delete on storage.objects;
create policy storage_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and owner_id = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.  REALTIME — only the tables that need live updates
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
begin
  foreach t in array array['bookings','ride_events','booking_messages',
                           'driver_locations','notifications'] loop
    if not exists (
      select 1 from pg_publication_tables p
       where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11.  RPCs — logic that must not run in the browser
-- ═══════════════════════════════════════════════════════════════════════════

-- ── nearby drivers (haversine) ────────────────────────────────────────────
create or replace function public.nearby_drivers(
  p_lat double precision, p_lng double precision,
  p_radius_km double precision default 10,
  p_vehicle_type text default 'auto'
)
returns table (
  driver_profile_id uuid, name text, phone text, vehicle_type text,
  registration_number text, rating numeric, lat double precision, lng double precision, distance_km double precision
)
language sql stable security definer set search_path = public, pg_temp as $$
  select dp.id, p.name, p.phone, v.vehicle_type, v.registration_number, dp.rating_avg,
         dl.lat, dl.lng,
         round((6371 * acos(least(1, cos(radians(p_lat)) * cos(radians(dl.lat))
              + sin(radians(p_lat)) * sin(radians(dl.lat))
              * cos(radians(dl.lng - p_lng)))))::numeric, 2)::double precision
    from public.driver_profiles dp
    join public.profiles p  on p.id = dp.user_id
    join public.vehicles v  on v.driver_profile_id = dp.id and v.is_primary
    left join public.driver_locations dl on dl.driver_profile_id = dp.id
   where dp.verification_status = 'approved'
     and dp.is_online
     and dp.current_booking_id is null
     and p.is_active
     and (p_vehicle_type is null or v.vehicle_type = p_vehicle_type)
     and dl.lat is not null
     and (6371 * acos(least(1, cos(radians(p_lat)) * cos(radians(dl.lat))
          + sin(radians(p_lat)) * sin(radians(dl.lat))
          * cos(radians(dl.lng - p_lng))))) <= p_radius_km
   order by 9 asc
   limit 50;
$$;

-- ── fare quote ────────────────────────────────────────────────────────────
create or replace function public.quote_fare(
  p_pickup_lat double precision, p_pickup_lng double precision,
  p_drop_lat double precision, p_drop_lng double precision,
  p_distance_km numeric, p_duration_min int,
  p_city_id uuid default null, p_vehicle_type text default 'auto',
  p_at timestamptz default now()
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg public.pricing_configs%rowtype;
  v_night boolean := false;
  v_base numeric; v_per_km numeric; v_per_min numeric; v_min numeric;
  v_booking numeric; v_time numeric; v_dist numeric; v_total numeric;
  v_commission numeric := 0;
  v_comm_pct numeric := 0;
begin
  select * into cfg from public.pricing_configs
   where vehicle_type = p_vehicle_type and is_active
     and (p_city_id is null or city_id = p_city_id)
   order by (city_id = p_city_id) desc nulls last limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No pricing configuration for this vehicle type.');
  end if;

  v_night := extract(hour from p_at) >= cfg.night_from_hour or extract(hour from p_at) < cfg.night_to_hour;
  v_base := cfg.base_fare;
  v_per_km := cfg.per_km;
  v_per_min := cfg.per_minute;
  v_min := cfg.min_fare;
  v_booking := cfg.booking_fee;
  v_comm_pct := coalesce((select (value ->> 'commissionPercent')::numeric from public.platform_settings
                           where key = 'finance'), 0);

  v_dist := p_distance_km * v_per_km;
  v_time := p_duration_min * v_per_min;
  v_total := v_base + v_dist + v_time + v_booking;
  if v_night then v_total := v_total * cfg.night_multiplier; end if;
  v_total := greatest(v_total, v_min);
  v_commission := round(v_total * v_comm_pct / 100, 2);

  return jsonb_build_object(
    'ok', true,
    'estimatedFare', v_total,
    'fareBreakdown', jsonb_build_object(
      'baseFare', v_base, 'perKm', v_per_km, 'perMinute', v_per_min,
      'distanceCharge', v_dist, 'timeCharge', v_time, 'bookingFee', v_booking,
      'nightMultiplier', case when v_night then cfg.night_multiplier else 1 end,
      'minFare', v_min, 'commission', v_commission, 'commissionPercent', v_comm_pct,
      'currency', 'INR'),
    'currency', 'INR');
end $$;

-- ── create a booking ──────────────────────────────────────────────────────
create or replace function public.create_booking(
  p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_address text,
  p_drop_lat double precision, p_drop_lng double precision, p_drop_address text,
  p_distance_km numeric, p_duration_min int,
  p_city_id uuid default null, p_vehicle_type text default 'auto',
  p_booking_type text default 'immediate', p_scheduled_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q jsonb;
  v_otp text; v_ref text; v_share text; v_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  q := public.quote_fare(p_pickup_lat, p_pickup_lng, p_drop_lat, p_drop_lng,
                         p_distance_km, p_duration_min, p_city_id, p_vehicle_type);

  v_otp := lpad((floor(random() * 1000000))::text, 6, '0');
  v_ref := 'SW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
  v_share := replace(gen_random_uuid()::text, '-', '');

  insert into public.bookings (
    ref, passenger_id, city_id, booking_type, scheduled_at, vehicle_type,
    pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address,
    distance_km, duration_min, fare_breakdown, estimated_fare, ride_otp, share_token, status
  ) values (
    v_ref, auth.uid(), p_city_id, p_booking_type, p_scheduled_at, p_vehicle_type,
    p_pickup_lat, p_pickup_lng, p_pickup_address, p_drop_lat, p_drop_lng, p_drop_address,
    p_distance_km, p_duration_min, q -> 'fareBreakdown', (q ->> 'estimatedFare')::numeric,
    v_otp, v_share,
    case when p_booking_type = 'scheduled' then 'scheduled' else 'searching' end
  ) returning id into v_id;

  insert into public.ride_events (booking_id, status, actor_id, note)
  values (v_id, case when p_booking_type = 'scheduled' then 'scheduled' else 'searching' end,
          auth.uid(), 'Booking created');

  return jsonb_build_object('ok', true, 'bookingId', v_id, 'ref', v_ref,
                             'rideOtp', v_otp, 'shareToken', v_share,
                             'estimatedFare', q ->> 'estimatedFare',
                             'fareBreakdown', q -> 'fareBreakdown');
end $$;

-- ── the passenger's live ride, without knowing the id ────────────────────
create or replace function public.my_active_booking()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(b) from public.bookings b
   where b.passenger_id = auth.uid()
     and b.status in ('searching','scheduled','assigned','arriving','arrived','in_progress')
   order by b.created_at desc limit 1;
$$;

-- ── open ride requests for a driver ───────────────────────────────────────
create or replace function public.nearby_ride_requests(
  p_lat double precision, p_lng double precision, p_radius_km double precision default 15
)
returns table (
  booking_id uuid, ref text, pickup_address text, drop_address text,
  pickup_lat double precision, pickup_lng double precision,
  estimated_fare numeric, vehicle_type text, distance_km numeric, distance_to_pickup_km double precision
)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.ref, b.pickup_address, b.drop_address, b.pickup_lat, b.pickup_lng,
         b.estimated_fare, b.vehicle_type, b.distance_km,
         round((6371 * acos(least(1, cos(radians(p_lat)) * cos(radians(b.pickup_lat))
              + sin(radians(p_lat)) * sin(radians(b.pickup_lat))
              * cos(radians(b.pickup_lng - p_lng)))))::numeric, 2)::double precision
    from public.bookings b
   where b.status = 'searching'
     and b.driver_profile_id is null
     and (6371 * acos(least(1, cos(radians(p_lat)) * cos(radians(b.pickup_lat))
          + sin(radians(p_lat)) * sin(radians(b.pickup_lat))
          * cos(radians(b.pickup_lng - p_lng))))) <= p_radius_km
   order by 10 asc limit 30;
$$;

-- ── accept / decline a ride request ───────────────────────────────────────
create or replace function public.accept_ride(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_driver uuid := public.current_driver_profile_id();
  v_booking public.bookings%rowtype;
begin
  if v_driver is null then return jsonb_build_object('ok', false, 'error', 'Not a driver.'); end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'searching' or v_booking.driver_profile_id is not null then
    return jsonb_build_object('ok', false, 'error', 'This ride is no longer available.');
  end if;

  update public.bookings
     set driver_profile_id = v_driver, status = 'assigned', assigned_at = now()
   where id = p_booking_id;

  update public.driver_profiles set current_booking_id = p_booking_id where id = v_driver;

  insert into public.ride_events (booking_id, status, actor_id, note)
  values (p_booking_id, 'assigned', auth.uid(), 'Driver accepted the ride');

  insert into public.notifications (user_id, type, title, body, data)
  select v_booking.passenger_id, 'ride.assigned', 'A driver accepted your ride!',
         'Your driver is on the way.', jsonb_build_object('bookingId', p_booking_id);

  return jsonb_build_object('ok', true, 'bookingId', p_booking_id);
end $$;

-- ── the ride state machine ────────────────────────────────────────────────
create or replace function public.transition_ride(
  p_booking_id uuid, p_action text, p_ride_otp text default null, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_booking public.bookings%rowtype;
  v_driver uuid := public.current_driver_profile_id();
  v_new_status text;
  v_fare numeric;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Ride not found.'); end if;

  if v_booking.driver_profile_id is distinct from v_driver
     and v_booking.passenger_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Not your ride.');
  end if;

  v_new_status := case p_action
    when 'arriving' then 'arriving'
    when 'arrived'  then 'arrived'
    when 'start'    then 'in_progress'
    when 'complete' then 'completed'
    when 'cancel'   then 'cancelled'
    else null end;

  if v_new_status is null then
    return jsonb_build_object('ok', false, 'error', 'Unknown action.');
  end if;

  if p_action = 'start' and v_booking.ride_otp <> coalesce(p_ride_otp, '') then
    return jsonb_build_object('ok', false, 'error', 'Wrong ride OTP.');
  end if;

  if p_action = 'complete' then
    v_fare := coalesce(v_booking.final_fare, v_booking.estimated_fare);
    update public.bookings
       set status = v_new_status, completed_at = now(),
           final_fare = v_fare,
           waiting_minutes = greatest(0, round(
             (extract(epoch from (now() - coalesce(v_booking.assigned_at, now()))) / 60.0)
             - v_booking.duration_min)::int)
     where id = p_booking_id;

    -- driver earnings ledger
    insert into public.driver_earnings (driver_profile_id, booking_id, gross, commission, net)
    select v_driver, p_booking_id, v_fare,
           coalesce((select (value ->> 'commissionPercent')::numeric from public.platform_settings where key='finance'), 0) * v_fare / 100,
           v_fare - (coalesce((select (value ->> 'commissionPercent')::numeric from public.platform_settings where key='finance'), 0) * v_fare / 100)
    on conflict (booking_id) do nothing;

    update public.driver_profiles
       set current_booking_id = null, rides_completed = rides_completed + 1,
           total_earnings = total_earnings + v_fare
     where id = v_driver;
  elsif p_action = 'cancel' then
    update public.bookings
       set status = v_new_status, cancelled_at = now(), cancelled_by = auth.uid(),
           cancellation_reason = p_reason
     where id = p_booking_id;
    update public.driver_profiles
       set current_booking_id = null, rides_cancelled = rides_cancelled + 1
     where id = v_driver and v_driver is not null;
  else
    update public.bookings
       set status = v_new_status,
           arrived_at = case when p_action = 'arrived' then now() else arrived_at end,
           started_at = case when p_action = 'start'   then now() else started_at end
     where id = p_booking_id;
  end if;

  insert into public.ride_events (booking_id, status, actor_id, note)
  values (p_booking_id, v_new_status, auth.uid(), p_reason);

  if v_new_status in ('assigned','arriving','arrived','in_progress','completed','cancelled') then
    insert into public.notifications (user_id, type, title, body, data)
    select v_booking.passenger_id, 'ride.' || v_new_status,
           case v_new_status when 'completed' then 'Ride completed'
                             when 'cancelled' then 'Ride cancelled' else 'Ride update' end,
           'Your ride is now ' || replace(v_new_status, '_', ' '),
           jsonb_build_object('bookingId', p_booking_id, 'status', v_new_status);
  end if;

  return jsonb_build_object('ok', true, 'bookingId', p_booking_id, 'status', v_new_status);
end $$;

-- ── cancel a ride (passenger) ─────────────────────────────────────────────
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_booking public.bookings%rowtype;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Ride not found.'); end if;
  if v_booking.passenger_id is distinct from auth.uid() and not public.has_permission('bookings.cancel') then
    return jsonb_build_object('ok', false, 'error', 'Not your ride.');
  end if;
  if v_booking.status in ('completed','cancelled') then
    return jsonb_build_object('ok', false, 'error', 'This ride is already finished.');
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = p_reason
   where id = p_booking_id;

  update public.driver_profiles set current_booking_id = null
   where current_booking_id = p_booking_id;

  insert into public.ride_events (booking_id, status, actor_id, note)
  values (p_booking_id, 'cancelled', auth.uid(), p_reason);

  return jsonb_build_object('ok', true, 'bookingId', p_booking_id);
end $$;

-- ── public ride tracking by share token (no login) ────────────────────────
create or replace function public.get_booking_by_share_token(p_token text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(b) from public.bookings b where b.share_token = p_token;
$$;

-- ── driver location + online flag ─────────────────────────────────────────
create or replace function public.set_driver_location(
  p_lat double precision, p_lng double precision,
  p_heading numeric default null, p_accuracy numeric default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_driver uuid := public.current_driver_profile_id();
begin
  if v_driver is null then return false; end if;
  insert into public.driver_locations (driver_profile_id, lat, lng, heading, accuracy_m, updated_at)
  values (v_driver, p_lat, p_lng, p_heading, p_accuracy, now())
  on conflict (driver_profile_id) do update
    set lat = excluded.lat, lng = excluded.lng, heading = excluded.heading,
        accuracy_m = excluded.accuracy_m, updated_at = now();
  return true;
end $$;

create or replace function public.set_driver_online(p_online boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_driver uuid := public.current_driver_profile_id();
begin
  if v_driver is null then return false; end if;
  update public.driver_profiles
     set is_online = p_online, current_booking_id = case when not p_online then null else current_booking_id end
   where id = v_driver;
  return true;
end $$;

-- ── write an audit entry (append-only) ────────────────────────────────────
create or replace function public.record_audit(
  p_action text, p_category text default 'general',
  p_target_type text default null, p_target_id text default null,
  p_target_label text default null,
  p_previous jsonb default null, p_new jsonb default null,
  p_result text default 'success'
)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  insert into public.admin_audit_log
    (admin_id, admin_email, admin_role, action, category, target_type, target_id,
     target_label, previous_value, new_value, result)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    public.current_role(),
    p_action, p_category, p_target_type, p_target_id, p_target_label,
    p_previous, p_new, p_result
  ) returning id into v_id;
  return v_id;
end $$;

-- ── admin dashboard KPI snapshot ──────────────────────────────────────────
create or replace function public.admin_dashboard()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'users',      (select count(*) from public.profiles),
    'drivers',    (select count(*) from public.driver_profiles),
    'bookings',   (select count(*) from public.bookings),
    'revenue',    (select coalesce(sum(net),0) from public.driver_earnings),
    'payments',   (select count(*) from public.payments),
    'suspensions',(select count(*) from public.user_suspensions where lifted_at is null),
    'reports',    (select count(*) from public.user_reports where status = 'open'),
    'generatedAt',now());
$$;

-- ── send a broadcast ──────────────────────────────────────────────────────
create or replace function public.send_broadcast(
  p_title text, p_body text, p_audience text, p_filter jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_count int := 0;
begin
  if not public.has_permission('notifications.send') then
    return jsonb_build_object('ok', false, 'error', 'Not allowed.');
  end if;

  insert into public.admin_broadcasts (title, body, audience, audience_filter, sent_by)
  values (p_title, p_body, p_audience, p_filter, auth.uid()) returning id into v_id;

  insert into public.notifications (user_id, type, title, body, data)
  select p.id, 'broadcast', p_title, p_body, jsonb_build_object('broadcastId', v_id)
    from public.profiles p
   where case p_audience
           when 'all'       then true
           when 'passengers' then p.role = 'passenger'
           when 'drivers'   then p.role = 'driver'
           when 'admins'    then p.role in ('admin','super_admin','finance_admin',
                                            'support_admin','driver_manager','moderator')
           when 'user'      then p.id = (p_filter ->> 'userId')::uuid
           when 'city'      then exists (select 1 from public.bookings b
                                         where b.passenger_id = p.id
                                           and b.city_id = (p_filter ->> 'cityId')::uuid)
           else false end;

  get diagnostics v_count = row_count;

  update public.admin_broadcasts set recipients = v_count where id = v_id;

  return jsonb_build_object('ok', true, 'broadcastId', v_id, 'recipients', v_count);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11b. ADMINISTRATOR ACTIONS
--      The privileged writes of the master console. Each one checks the
--      permission, performs the change, writes the audit entry and returns
--      a small JSON object — the shape the console already expects.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── users ────────────────────────────────────────────────────────────────
create or replace function public.admin_set_user_blocked(
  p_user_id uuid, p_blocked boolean, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('users.block') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to block accounts.');
  end if;

  update public.profiles
     set is_active = not p_blocked,
         blocked_reason = case when p_blocked then p_reason else null end
   where id = p_user_id;

  if p_blocked then
    insert into public.user_suspensions (user_id, kind, reason, starts_at, ends_at, created_by)
    values (p_user_id, 'block', p_reason, now(), null, auth.uid());
  else
    update public.user_suspensions
       set lifted_at = now(), lifted_by = auth.uid()
     where user_id = p_user_id and lifted_at is null;
  end if;

  perform public.record_audit(
    case when p_blocked then 'user.block' else 'user.unblock' end, 'users',
    'profile', p_user_id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true,
    'message', case when p_blocked then 'Account blocked.' else 'Account unblocked.' end);
end $$;

create or replace function public.admin_set_user_suspended(
  p_user_id uuid, p_suspend boolean, p_reason text default null, p_hours int default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('users.suspend') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to suspend accounts.');
  end if;

  if p_suspend then
    insert into public.user_suspensions (user_id, kind, reason, starts_at, ends_at, created_by)
    values (p_user_id, 'suspend', p_reason, now(),
            case when p_hours is null then null else now() + make_interval(hours => p_hours) end,
            auth.uid());
  else
    update public.user_suspensions
       set lifted_at = now(), lifted_by = auth.uid()
     where user_id = p_user_id and lifted_at is null;
  end if;

  perform public.record_audit(
    case when p_suspend then 'user.suspend' else 'user.reactivate' end, 'users',
    'profile', p_user_id::text, jsonb_build_object('reason', p_reason, 'hours', p_hours));

  return jsonb_build_object('ok', true,
    'message', case when p_suspend then 'Account suspended.' else 'Account reactivated.' end);
end $$;

create or replace function public.admin_deactivate_user(p_user_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('users.deactivate') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to deactivate accounts.');
  end if;

  update public.profiles
     set is_active = false, deactivated_at = now(), blocked_reason = p_reason
   where id = p_user_id;

  insert into public.user_suspensions (user_id, kind, reason, starts_at, created_by)
  values (p_user_id, 'deactivate', p_reason, now(), auth.uid());

  perform public.record_audit('user.deactivate', 'users', 'profile', p_user_id::text,
                              jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'message', 'Account deactivated.');
end $$;

create or replace function public.admin_bulk_user_action(
  p_user_ids uuid[], p_action text, p_reason text default null, p_hours int default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_count int := 0;
begin
  if not public.has_permission('users.bulk') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to bulk-edit accounts.');
  end if;

  foreach v_id in array coalesce(p_user_ids, '{}') loop
    if p_action = 'block' then
      update public.profiles set is_active = false, blocked_reason = p_reason where id = v_id;
      insert into public.user_suspensions (user_id, kind, reason, starts_at, created_by)
      values (v_id, 'block', p_reason, now(), auth.uid());
    elsif p_action = 'unblock' then
      update public.profiles set is_active = true, blocked_reason = null where id = v_id;
      update public.user_suspensions set lifted_at = now(), lifted_by = auth.uid()
       where user_id = v_id and lifted_at is null;
    elsif p_action = 'suspend' then
      insert into public.user_suspensions (user_id, kind, reason, starts_at, ends_at, created_by)
      values (v_id, 'suspend', p_reason, now(),
              case when p_hours is null then null else now() + make_interval(hours => p_hours) end,
              auth.uid());
    elsif p_action = 'reactivate' then
      update public.user_suspensions set lifted_at = now(), lifted_by = auth.uid()
       where user_id = v_id and lifted_at is null;
    end if;
    v_count := v_count + 1;
  end loop;

  perform public.record_audit('user.bulk', 'users', 'profiles', null,
    jsonb_build_object('action', p_action, 'count', v_count, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'count', v_count, 'message', v_count || ' accounts updated.');
end $$;

create or replace function public.admin_edit_user(p_user_id uuid, p_name text default null, p_email text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('users.edit') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to edit accounts.');
  end if;
  update public.profiles
     set name = coalesce(p_name, name), email = coalesce(p_email, email)
   where id = p_user_id;
  perform public.record_audit('user.edit', 'users', 'profile', p_user_id::text,
    jsonb_build_object('name', p_name, 'email', p_email));
  return jsonb_build_object('ok', true, 'message', 'Account updated.');
end $$;

-- ── drivers ──────────────────────────────────────────────────────────────
create or replace function public.admin_review_driver(
  p_driver_id uuid, p_approved boolean, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('drivers.verify') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to verify drivers.');
  end if;

  update public.driver_profiles
     set verification_status = case when p_approved then 'approved' else 'rejected' end,
         rejection_reason = case when p_approved then null else p_reason end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_driver_id;

  perform public.record_audit(
    case when p_approved then 'driver.approve' else 'driver.reject' end, 'drivers',
    'driver_profile', p_driver_id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true,
    'message', case when p_approved then 'Driver approved.' else 'Driver rejected.' end);
end $$;

create or replace function public.admin_review_document(
  p_document_id uuid, p_status text, p_note text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('drivers.verify') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to review documents.');
  end if;
  if p_status not in ('verified', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'Unknown document status.');
  end if;

  update public.driver_documents
     set status = p_status, review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_document_id;

  perform public.record_audit('driver.document_review', 'drivers', 'driver_document',
    p_document_id::text, jsonb_build_object('status', p_status, 'note', p_note));

  return jsonb_build_object('ok', true, 'message', 'Document ' || p_status || '.');
end $$;

create or replace function public.admin_verify_upi(p_driver_id uuid, p_verified boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('drivers.manage') and not public.has_permission('drivers.verify') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to verify UPI ids.');
  end if;
  update public.driver_profiles set upi_verified = p_verified where id = p_driver_id;
  perform public.record_audit('driver.upi_verify', 'drivers', 'driver_profile', p_driver_id::text,
    jsonb_build_object('verified', p_verified));
  return jsonb_build_object('ok', true, 'message',
    case when p_verified then 'UPI verified.' else 'UPI verification removed.' end);
end $$;

create or replace function public.admin_suspend_driver(
  p_driver_id uuid, p_suspend boolean, p_reason text default null, p_hours int default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('drivers.manage') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to suspend drivers.');
  end if;

  update public.driver_profiles
     set is_online = case when p_suspend then false else is_online end
   where id = p_driver_id;

  update public.profiles set is_active = not p_suspend where id =
    (select user_id from public.driver_profiles where id = p_driver_id);

  if p_suspend then
    insert into public.user_suspensions (user_id, kind, reason, starts_at, ends_at, created_by)
    select user_id, 'suspend', p_reason, now(),
           case when p_hours is null then null else now() + make_interval(hours => p_hours) end,
           auth.uid()
      from public.driver_profiles where id = p_driver_id;
  else
    update public.user_suspensions s
       set lifted_at = now(), lifted_by = auth.uid()
      from public.driver_profiles dp
     where s.user_id = dp.user_id and dp.id = p_driver_id and s.lifted_at is null;
  end if;

  perform public.record_audit(
    case when p_suspend then 'driver.suspend' else 'driver.reinstate' end, 'drivers',
    'driver_profile', p_driver_id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true,
    'message', case when p_suspend then 'Driver suspended.' else 'Driver reinstated.' end);
end $$;

create or replace function public.admin_update_vehicle(
  p_vehicle_id uuid, p_registration_number text default null, p_vehicle_type text default null,
  p_model text default null, p_capacity int default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('drivers.manage') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to edit vehicles.');
  end if;
  update public.vehicles
     set registration_number = coalesce(p_registration_number, registration_number),
         vehicle_type = coalesce(p_vehicle_type, vehicle_type),
         model = coalesce(p_model, model),
         capacity = coalesce(p_capacity, capacity)
   where id = p_vehicle_id;
  perform public.record_audit('driver.vehicle_update', 'drivers', 'vehicle', p_vehicle_id::text,
    jsonb_build_object('registrationNumber', p_registration_number, 'model', p_model));
  return jsonb_build_object('ok', true, 'message', 'Vehicle updated.');
end $$;

-- ── payments, refunds, settlements ───────────────────────────────────────
create or replace function public.admin_verify_payment(
  p_payment_id uuid, p_verified boolean, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('payments.verify') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to verify payments.');
  end if;

  update public.payments
     set status = case when p_verified then 'paid' else 'failed' end,
         verified_by = auth.uid(), verified_at = now(),
         failure_reason = case when p_verified then null else p_reason end
   where id = p_payment_id;

  update public.bookings
     set payment_status = case when p_verified then 'paid' else 'unpaid' end
   where id = (select booking_id from public.payments where id = p_payment_id);

  perform public.record_audit(
    case when p_verified then 'payment.verify' else 'payment.reject' end, 'payments',
    'payment', p_payment_id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true,
    'message', case when p_verified then 'Payment verified.' else 'Payment rejected.' end);
end $$;

create or replace function public.admin_refund_payment(
  p_payment_id uuid, p_amount numeric, p_reason text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_payment public.payments%rowtype; v_refund uuid;
begin
  if not public.has_permission('payments.refund') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to issue refunds.');
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Payment not found.'); end if;

  insert into public.refunds (payment_id, booking_id, amount, reason, method, status, initiated_by)
  values (v_payment.id, v_payment.booking_id, p_amount, p_reason,
          case when v_payment.method = 'online' then 'razorpay' else 'manual' end,
          'pending', auth.uid())
  returning id into v_refund;

  update public.payments set status = 'refunded', refunded_amount = p_amount where id = p_payment_id;

  perform public.record_audit('payment.refund', 'payments', 'payment', p_payment_id::text,
    jsonb_build_object('amount', p_amount, 'reason', p_reason, 'refundId', v_refund));

  return jsonb_build_object('ok', true, 'refundId', v_refund, 'message', 'Refund created.');
end $$;

create or replace function public.admin_complete_refund(p_refund_id uuid, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('payments.refund') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to settle refunds.');
  end if;
  update public.refunds
     set status = 'completed', completed_at = now(), notes = coalesce(p_notes, notes),
         approved_by = auth.uid()
   where id = p_refund_id;
  perform public.record_audit('refund.complete', 'payments', 'refund', p_refund_id::text,
    jsonb_build_object('notes', p_notes));
  return jsonb_build_object('ok', true, 'message', 'Refund marked as settled.');
end $$;

create or replace function public.admin_create_settlement(
  p_driver_profile_id uuid, p_period_start date, p_period_end date
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_gross numeric; v_comm numeric; v_net numeric; v_rides int; v_id uuid;
begin
  if not public.has_permission('finance.settings') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to create settlements.');
  end if;

  select coalesce(sum(gross),0), coalesce(sum(commission),0), coalesce(sum(net),0), count(*)
    into v_gross, v_comm, v_net, v_rides
    from public.driver_earnings e
    join public.bookings b on b.id = e.booking_id
   where e.driver_profile_id = p_driver_profile_id
     and b.completed_at::date between p_period_start and p_period_end;

  insert into public.settlements
    (driver_profile_id, period_start, period_end, gross, commission, net, rides, created_by)
  values (p_driver_profile_id, p_period_start, p_period_end, v_gross, v_comm, v_net, v_rides, auth.uid())
  returning id into v_id;

  perform public.record_audit('settlement.create', 'finance', 'settlement', v_id::text,
    jsonb_build_object('driverProfileId', p_driver_profile_id, 'gross', v_gross, 'rides', v_rides));

  return jsonb_build_object('ok', true, 'settlementId', v_id, 'message', 'Settlement created.');
end $$;

create or replace function public.admin_mark_settlement_paid(p_settlement_id uuid, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('finance.settings') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to pay settlements.');
  end if;
  update public.settlements
     set status = 'paid', paid_at = now(), reference = coalesce(p_reference, reference)
   where id = p_settlement_id;
  perform public.record_audit('settlement.paid', 'finance', 'settlement', p_settlement_id::text,
    jsonb_build_object('reference', p_reference));
  return jsonb_build_object('ok', true, 'message', 'Settlement marked as paid.');
end $$;

create or replace function public.admin_set_commission(p_percent numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('finance.settings') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to change the commission.');
  end if;
  insert into public.platform_settings (key, value, category, updated_by)
  values ('finance', jsonb_build_object('commissionPercent', p_percent), 'finance', auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.record_audit('finance.commission', 'finance', 'settings', 'finance',
    jsonb_build_object('commissionPercent', p_percent));
  return jsonb_build_object('ok', true, 'message', 'Commission updated.');
end $$;

-- ── reports, SOS ─────────────────────────────────────────────────────────
create or replace function public.admin_resolve_report(
  p_report_id uuid, p_status text, p_note text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('reports.investigate') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to resolve reports.');
  end if;
  update public.user_reports
     set status = p_status, resolution_note = coalesce(p_note, resolution_note), resolved_by = auth.uid()
   where id = p_report_id;
  perform public.record_audit('report.resolve', 'reports', 'user_report', p_report_id::text,
    jsonb_build_object('status', p_status, 'note', p_note));
  return jsonb_build_object('ok', true, 'message', 'Report ' || p_status || '.');
end $$;

create or replace function public.admin_investigate_report(
  p_report_id uuid, p_action text, p_note text default null,
  p_assign_to uuid default null, p_evidence jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('reports.investigate') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to investigate reports.');
  end if;

  insert into public.report_investigations (report_id, admin_id, admin_email, action, note, evidence)
  values (p_report_id, auth.uid(),
          (select email from public.profiles where id = auth.uid()),
          p_action, p_note, p_evidence);

  if p_action = 'assign' and p_assign_to is not null then
    update public.user_reports set status = 'reviewing' where id = p_report_id;
  end if;

  perform public.record_audit('report.' || p_action, 'reports', 'user_report', p_report_id::text,
    jsonb_build_object('note', p_note, 'assignTo', p_assign_to));

  return jsonb_build_object('ok', true, 'message', 'Investigation note added.');
end $$;

create or replace function public.admin_sos_action(p_alert_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('reports.view') then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to handle SOS alerts.');
  end if;
  if p_action = 'ack' then
    update public.sos_alerts set status = 'acknowledged', acknowledged_by = auth.uid() where id = p_alert_id;
  else
    update public.sos_alerts set status = 'resolved' where id = p_alert_id;
  end if;
  perform public.record_audit('sos.' || p_action, 'reports', 'sos_alert', p_alert_id::text);
  return jsonb_build_object('ok', true, 'message', 'SOS alert updated.');
end $$;

-- ── admin accounts ───────────────────────────────────────────────────────
create or replace function public.admin_suspend_admin(
  p_user_id uuid, p_suspend boolean, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('admins.suspend') and not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to suspend admins.');
  end if;
  update public.admin_profiles
     set status = case when p_suspend then 'suspended' else 'active' end, notes = coalesce(p_reason, notes)
   where user_id = p_user_id;
  perform public.record_audit(
    case when p_suspend then 'admin.suspend' else 'admin.reactivate' end, 'admins',
    'admin_profile', p_user_id::text, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true,
    'message', case when p_suspend then 'Administrator suspended.' else 'Administrator reactivated.' end);
end $$;

create or replace function public.admin_update_admin(
  p_user_id uuid, p_admin_role text default null, p_permissions jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('admins.edit') and not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to change administrators.');
  end if;
  update public.admin_profiles
     set admin_role = coalesce(p_admin_role, admin_role),
         permissions = coalesce(p_permissions, permissions)
   where user_id = p_user_id;
  perform public.record_audit('admin.update', 'admins', 'admin_profile', p_user_id::text,
    jsonb_build_object('adminRole', p_admin_role, 'permissions', p_permissions));
  return jsonb_build_object('ok', true, 'message', 'Administrator updated.');
end $$;

create or replace function public.admin_remove_admin(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('admins.remove') and not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to remove administrators.');
  end if;
  delete from public.admin_profiles where user_id = p_user_id;
  perform public.record_audit('admin.remove', 'admins', 'admin_profile', p_user_id::text);
  return jsonb_build_object('ok', true, 'message', 'Administrator access removed.');
end $$;

create or replace function public.admin_reset_admin_2fa(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission('admins.edit') and not public.is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'Your role is not allowed to reset two-factor authentication.');
  end if;
  update public.admin_profiles set twofa_enabled = false where user_id = p_user_id;
  perform public.record_audit('admin.2fa_reset', 'admins', 'admin_profile', p_user_id::text);
  return jsonb_build_object('ok', true, 'message', 'Two-factor enrolment reset.');
end $$;

-- ── the analytics the master dashboard shows ─────────────────────────────
create or replace function public.admin_analytics(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with days as (
    select generate_series((now() - make_interval(days => p_days))::date, current_date, '1 day')::date as d
  )
  select jsonb_build_object(
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.d,
               'bookings', (select count(*) from public.bookings b where b.created_at::date = d.d),
               'revenue',  (select coalesce(sum(net),0) from public.driver_earnings e where e.created_at::date = d.d),
               'users',     (select count(*) from public.profiles p where p.created_at::date = d.d)
             ) order by d.d)
      from days d
    ), '[]'::jsonb),
    'paymentSplit', coalesce((
      select jsonb_object_agg(p.method, p.total) from (
        select method, count(*) as total from public.payments group by method) p
    ), '{}'::jsonb),
    'cityStats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cityId', c.id, 'city', c.name,
               'bookings', (select count(*) from public.bookings b where b.city_id = c.id)
             ))
      from public.cities c
    ), '[]'::jsonb),
    'topDrivers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'driverProfileId', dp.id, 'name', p.name,
               'rides', dp.rides_completed, 'earnings', dp.total_earnings
             ) order by dp.total_earnings desc)
      from (select * from public.driver_profiles order by total_earnings desc limit 10) dp
      join public.profiles p on p.id = dp.user_id
    ), '[]'::jsonb)
  );
$$;

-- ── the revenue view ─────────────────────────────────────────────────────
create or replace function public.admin_revenue(p_range text default 'month')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with span as (
    select case p_range
             when 'day'   then current_date
             when 'week'  then current_date - 6
             when 'month' then current_date - 29
             else current_date - 89 end as since
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'gross',    (select coalesce(sum(gross),0) from public.driver_earnings, span where created_at::date >= span.since),
      'commission',(select coalesce(sum(commission),0) from public.driver_earnings, span where created_at::date >= span.since),
      'net',      (select coalesce(sum(net),0) from public.driver_earnings, span where created_at::date >= span.since),
      'rides',    (select count(*) from public.driver_earnings, span where created_at::date >= span.since),
      'pendingPayments', (select count(*) from public.payments where status <> 'paid')),
    'byDay', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'net', n.net, 'rides', n.rides) order by d)
      from (
        select created_at::date as d, sum(net) as net, count(*) as rides
          from public.driver_earnings group by 1) n
    ), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'count', total, 'amount', amount))
      from (select method, count(*) as total, coalesce(sum(amount),0) as amount
              from public.payments group by method) m
    ), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'driverProfileId', dp.id, 'name', p.name,
               'rides', dp.rides_completed, 'gross', dp.total_earnings
             ) order by dp.total_earnings desc)
      from public.driver_profiles dp join public.profiles p on p.id = dp.user_id
    ), '[]'::jsonb),
    'cashRecords', coalesce((
      select jsonb_agg(to_jsonb(pay)) from public.payments pay where pay.method = 'cash'
    ), '[]'::jsonb)
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12.  GRANTS
-- ═══════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.nearby_drivers(double precision, double precision, double precision, text) to anon, authenticated;
grant execute on function public.get_booking_by_share_token(text) to anon, authenticated;

-- The service role keeps full access (it bypasses RLS) — it is used by
-- Edge Functions and by the server-side seed, never by the browser.
grant all on all tables in schema public to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE.  Next: create the Super Admin by hand —
--
--   insert into public.profiles (id, role, name, email)
--   select id, 'super_admin', 'Platform Owner', email from auth.users
--    where email = 'your@email.com';
--
--   insert into public.admin_profiles (user_id, admin_role, is_owner, status, email_verified)
--   values ('<that uuid>', 'super_admin', true, 'active', true);
--
-- then the trigger copies the role into the JWT claims on the next login.
-- ═══════════════════════════════════════════════════════════════════════════
