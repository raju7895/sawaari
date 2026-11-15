-- ═══════════════════════════════════════════════════════════════════════════
-- 9.  PHONE (SMS) SIGN-IN
-- ═══════════════════════════════════════════════════════════════════════════
-- A rider may sign in with a mobile number and a code instead of an
-- e-mail address. Three things have to be true for that:
--
--   • the number is stored in ONE form everywhere — +919876543210. The
--     database, the Auth service and the app all have to agree on it,
--     otherwise the same person ends up with two profiles;
--
--   • a phone user has no e-mail address, so public.profiles.email has
--     to allow NULL (it does) and the trigger has to take the number
--     from new.phone (it does);
--
--   • public.profiles.phone must NOT be unique. auth.users.phone is
--     already unique — GoTrue refuses a second account with the same
--     number — so a unique index on the profile only breaks the sign-up
--     of somebody who first joined by e-mail and later by phone
--     ("duplicate key value violates unique constraint
--     profiles_phone_key" → "Database error saving new user").
--
-- Everything below is idempotent: running it twice changes nothing.

-- ── one form for a mobile number ─────────────────────────────────────────
-- "9876543210", "0987653210", "+91 98765 43210" and "+919876543210" all
-- become "+919876543210".
create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
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

-- the numbers that are already there are brought into the same form
update public.profiles
   set phone = public.normalize_phone(phone)
 where phone is not null
   and phone <> public.normalize_phone(phone);

-- a lookup index (not a unique one — see the note above)
alter table public.profiles drop constraint if exists profiles_phone_key;
create index if not exists profiles_phone_idx on public.profiles (phone);

-- ── one form, whatever writes to the column ─────────────────────────────
-- The profile page writes the phone itself, without going through the
-- trigger, so the column is put into the international form here as well.
create or replace function public.normalize_profile_phone()
returns trigger language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  return new;
end $$;

drop trigger if exists profiles_normalize_phone on public.profiles;
create trigger profiles_normalize_phone
  before insert or update of phone on public.profiles
  for each row execute function public.normalize_profile_phone();

-- ── the sign-up trigger, now phone-aware ─────────────────────────────────
-- A phone user has no e-mail address, so:
--   • the name falls back to the number when the metadata carries none;
--   • the e-mail column is left NULL (the column allows it);
--   • the phone is written in the +91… form.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role  text := coalesce(new.raw_user_meta_data ->> 'role', 'rider');
  v_phone text;
  v_name  text;
  v_id    uuid;
begin
  if v_role <> 'driver' then v_role := 'rider'; end if;

  v_phone := public.normalize_phone(coalesce(new.raw_user_meta_data ->> 'phone', new.phone));

  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    nullif(split_part(coalesce(v_phone, ''), '+', 2), '')
  );

  insert into public.profiles (id, role, full_name, phone, email)
  values (new.id, v_role, coalesce(nullif(v_name, ''), 'Rider'), v_phone, nullif(new.email, ''))
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
