-- ═══════════════════════════════════════════════════════════════════════════
-- 13.  WHAT THE ADVISORS FOUND
-- ═══════════════════════════════════════════════════════════════════════════
-- Supabase → Dashboard → Advisors → Security / Performance. Four things
-- came up; all of them are fixed here. Idempotent.

-- ── 1. the search path of the two helpers was mutable ───────────────────
-- A function without a fixed search_path can be tricked into running
-- somebody else's code.
create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with d as (
    select regexp_replace(coalesce(p, ''), '\D', '', 'g') as digits
  )
  select nullif(
    case
      when p is null or btrim(p) = '' then null
      when d.digits = '' then null
      when p like '+%' then '+' || d.digits
      when length(d.digits) = 10 then '+91' || d.digits
      when length(d.digits) = 11 and d.digits like '0%' then '+91' || substr(d.digits, 2)
      when length(d.digits) = 12 and d.digits like '91%' then '+' || d.digits
      else '+' || d.digits
    end,
    ''
  )
  from d;
$$;

create or replace function public.normalize_profile_phone()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.phone := public.normalize_phone(new.phone);
  return new;
end $$;

-- ── 2. the trigger functions are not for anybody to call ─────────────────
-- They are SECURITY DEFINER, and PostgREST would happily run them for
-- anybody who asks /rest/v1/rpc/autoconfirm_email_user.
revoke execute on function public.autoconfirm_email_user() from public, anon, authenticated;
revoke execute on function public.normalize_profile_phone() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.normalize_phone(text) from public, anon, authenticated;

-- ── 3. the indexes the foreign keys need ────────────────────────────────
create index if not exists app_settings_updated_by_idx
  on public.app_settings (updated_by);
create index if not exists driver_documents_reviewed_by_idx
  on public.driver_documents (reviewed_by);
create index if not exists payments_driver_id_idx
  on public.payments (driver_id);
create index if not exists ratings_from_user_idx
  on public.ratings (from_user);
create index if not exists rides_cancelled_by_idx
  on public.rides (cancelled_by);

-- ── 4. the RLS policies asked for auth.uid() once per row ───────────────
-- The Supabase way: (select auth.uid()) asks the database for the id
-- once and uses the answer for every row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists drivers_select on public.drivers;
create policy drivers_select on public.drivers for select to authenticated
  using (user_id = (select auth.uid())
      or (select public.is_admin())
      or (is_verified and is_online));

drop policy if exists drivers_update on public.drivers;
create policy drivers_update on public.drivers for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
  using (driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()));

drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid())));

drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update to authenticated
  using (driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()))
  with check (driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()));

drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides for select to authenticated
  using (rider_id = (select auth.uid())
      or driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()));

drop policy if exists rides_update on public.rides;
create policy rides_update on public.rides for update to authenticated
  using (rider_id = (select auth.uid())
      or driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()))
  with check (rider_id = (select auth.uid())
      or driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (rider_id = (select auth.uid())
      or driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists ratings_select on public.ratings;
create policy ratings_select on public.ratings for select to authenticated
  using (from_user = (select auth.uid())
      or to_user = (select auth.uid())
      or (select public.is_admin()));

drop policy if exists ratings_insert on public.ratings;
create policy ratings_insert on public.ratings for insert to authenticated
  with check (from_user = (select auth.uid()));

drop policy if exists ratings_delete on public.ratings;
create policy ratings_delete on public.ratings for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists driver_documents_select on public.driver_documents;
create policy driver_documents_select on public.driver_documents for select to authenticated
  using (driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid()))
      or (select public.is_admin()));

drop policy if exists driver_documents_insert on public.driver_documents;
create policy driver_documents_insert on public.driver_documents for insert to authenticated
  with check (driver_id in (select d.id from public.drivers d where d.user_id = (select auth.uid())));

drop policy if exists driver_documents_update on public.driver_documents;
create policy driver_documents_update on public.driver_documents for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists saved_places_all on public.saved_places;
create policy saved_places_all on public.saved_places for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists admin_actions_select on public.admin_actions;
create policy admin_actions_select on public.admin_actions for select to authenticated
  using ((select public.is_admin()));

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using (true);

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
