-- ═══════════════════════════════════════════════════════════════════════════
-- SAWAARI · Supabase RLS + trigger behaviour suite
--
-- Every check prints "PASS: …" or "FAIL: …". Run it with
--   powershell -ExecutionPolicy Bypass -File scripts\test-migration.ps1
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

\echo '=== 1. signing up creates the profile from the signup metadata ==='

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alpha@example.com',
   '{"full_name":"Alpha Rider","phone":"9999999999","role":"passenger"}'),
  ('22222222-2222-2222-2222-222222222222', 'beta@example.com',
   '{"full_name":"Beta Rider","phone":"9990000001","role":"passenger"}'),
  ('33333333-3333-3333-3333-333333333333', 'gamma@example.com',
   '{"full_name":"Gamma Driver","phone":"9000000000","role":"driver"}'),
  ('44444444-4444-4444-4444-444444444444', 'rogue@example.com',
   '{"full_name":"Rogue","phone":"8999999999","role":"super_admin"}');

do $$
declare n int; r text;
begin
  select count(*) into n from public.profiles
   where id in ('11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222',
                '33333333-3333-3333-3333-333333333333',
                '44444444-4444-4444-4444-444444444444');
  if n = 4 then raise notice 'PASS: a profile row is created for every signup';
  else raise notice 'FAIL: expected 4 profiles, got %', n; end if;

  select role into r from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  if r = 'passenger' then raise notice 'PASS: the role comes from the signup metadata';
  else raise notice 'FAIL: expected passenger, got %', r; end if;

  select name into r from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  if r = 'Alpha Rider' then raise notice 'PASS: the full name comes from the signup metadata';
  else raise notice 'FAIL: expected "Alpha Rider", got %', r; end if;

  select role into r from public.profiles where id = '44444444-4444-4444-4444-444444444444';
  if r = 'passenger' then raise notice 'PASS: a user cannot claim an admin role at signup';
  else raise notice 'FAIL: a user claimed the role %', r; end if;

  select count(*) into n from public.passenger_profiles pp
    join public.profiles p on p.id = pp.user_id where p.role = 'passenger';
  if n >= 3 then raise notice 'PASS: passenger_profiles rows exist for every passenger';
  else raise notice 'FAIL: expected 3 passenger_profiles rows, got %', n; end if;

  select count(*) into n from public.driver_profiles dp
    join public.profiles p on p.id = dp.user_id where p.role = 'driver';
  if n = 1 then raise notice 'PASS: a driver_profiles row exists for every driver';
  else raise notice 'FAIL: expected 1 driver_profiles row, got %', n; end if;
end $$;

\echo '=== 2. fixtures ==='
insert into public.cities (id, name, state, center_lat, center_lng)
values ('55555555-5555-5555-5555-555555555555', 'Testville', 'TS', 12.9716, 77.5946);
insert into public.pricing_configs
  (id, city_id, vehicle_type, base_fare, per_km, per_minute, min_fare)
values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555',
        'auto', 30, 12, 1, 50);
insert into public.platform_settings (key, value, category)
values ('finance', '{"commissionPercent":10}', 'finance');

\echo '=== 3. user A creates a ride ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', false);

do $$
declare r jsonb;
begin
  r := public.create_booking(12.9716, 77.5946, 'Pickup', 12.9800, 77.6000, 'Drop',
                             3.5, 12, '55555555-5555-5555-5555-555555555555', 'auto', 'immediate');
  if (r ->> 'ok') = 'true' then raise notice 'PASS: a passenger can create a booking';
  else raise notice 'FAIL: create_booking said %', r ->> 'error'; end if;
end $$;

\echo '=== 4. user B must not see user A''s data ==='
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', false);

do $$
declare n int;
begin
  select count(*) into n from public.bookings;
  if n = 0 then raise notice 'PASS: user B cannot read user A''s bookings';
  else raise notice 'FAIL: user B can read % bookings', n; end if;

  select count(*) into n from public.profiles
   where id <> '22222222-2222-2222-2222-222222222222';
  if n = 0 then raise notice 'PASS: user B cannot read user A''s profile';
  else raise notice 'FAIL: user B can read % other profiles', n; end if;

  select count(*) into n from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';
  if n = 1 then raise notice 'PASS: user B can read their own profile';
  else raise notice 'FAIL: user B cannot read their own profile'; end if;

  select count(*) into n from public.saved_locations;
  if n = 0 then raise notice 'PASS: user B cannot read user A''s saved locations';
  else raise notice 'FAIL: user B can read % saved locations', n; end if;

  select count(*) into n from public.notifications;
  if n = 0 then raise notice 'PASS: user B cannot read user A''s notifications';
  else raise notice 'FAIL: user B can read % notifications', n; end if;
end $$;

\echo '=== 5. user B cannot write into user A''s rows ==='
do $$
declare n int;
begin
  insert into public.saved_locations (user_id, label, address, lat, lng)
  values ('11111111-1111-1111-1111-111111111111', 'Home', 'x', 1, 1);
  raise notice 'FAIL: user B inserted a saved location for user A';
exception when others then
  raise notice 'PASS: user B cannot insert into user A''s saved locations (%)', sqlerrm;
end $$;

\echo '=== 6. a user cannot change their own role ==='
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', false);

do $$
begin
  update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'FAIL: a user changed their own role';
exception when others then
  raise notice 'PASS: a user cannot change their own role (%)', sqlerrm;
end $$;

\echo '=== 7. the anonymous visitor sees only the public list ==='
set local role anon;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{}', false);

do $$
declare n int;
begin
  select count(*) into n from public.cities;
  if n = 1 then raise notice 'PASS: an anonymous visitor can read the public city list';
  else raise notice 'FAIL: expected 1 city, got %', n; end if;

  select count(*) into n from public.bookings;
  if n = 0 then raise notice 'PASS: an anonymous visitor cannot read the bookings';
  else raise notice 'FAIL: an anonymous visitor read % bookings', n; end if;
end $$;

\echo '=== 8. the platform owner cannot be downgraded ==='
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', 'owner@example.com',
   '{"full_name":"Platform Owner","role":"admin"}');
insert into public.admin_profiles (user_id, admin_role, is_owner, status, email_verified)
values ('77777777-7777-7777-7777-777777777777', 'super_admin', true, 'active', true);

do $$
begin
  update public.admin_profiles set admin_role = 'admin'
   where user_id = '77777777-7777-7777-7777-777777777777';
  raise notice 'FAIL: the owner account was downgraded';
exception when others then
  raise notice 'PASS: the owner account cannot be downgraded (%)', sqlerrm;
end $$;

\echo '=== 9. the audit log is append-only ==='
insert into public.admin_audit_log (admin_id, action) values (null, 'test.action');
do $$
begin
  update public.admin_audit_log set action = 'tampered' where id = 1;
  raise notice 'FAIL: the audit log was modified';
exception when others then
  raise notice 'PASS: the audit log cannot be updated (%)', sqlerrm;
end $$;

\echo '=== 10. the permission helper mirrors the old RBAC service ==='
do $$
declare ok boolean;
begin
  insert into public.admin_profiles (user_id, admin_role, is_owner, status, email_verified)
  values ('22222222-2222-2222-2222-222222222222', 'moderator', false, 'active', true);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false);

  select public.has_permission('users.view') into ok;
  if ok then raise notice 'PASS: a moderator holds users.view';
  else raise notice 'FAIL: a moderator should hold users.view'; end if;

  select public.has_permission('payments.refund') into ok;
  if not ok then raise notice 'PASS: a moderator does NOT hold payments.refund';
  else raise notice 'FAIL: a moderator should not hold payments.refund'; end if;

  select public.has_permission('audit.view') into ok;
  if not ok then raise notice 'PASS: a moderator does NOT hold audit.view';
  else raise notice 'FAIL: a moderator should not hold audit.view'; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
  perform set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false);
  select public.has_permission('payments.refund') into ok;
  if ok then raise notice 'PASS: the super admin holds every permission';
  else raise notice 'FAIL: the super admin should hold every permission'; end if;
end $$;

\echo '=== done ==='
