-- ═══════════════════════════════════════════════════════════════════════════
-- 12.  SIGN-UP THAT WORKS WITHOUT AN E-MAIL
-- ═══════════════════════════════════════════════════════════════════════════
-- The Auth service writes the new user AND sends the confirmation e-mail
-- in ONE transaction:
--
--     if params.Provider == EmailProvider && !user.IsConfirmed() {
--         ... a.sendConfirmation(...)      ← the e-mail
--     }
--
-- So while the e-mail quota is used up (or no SMTP provider is set up),
-- every sign-up is rolled back whole: no account, and the visitor is
-- told "email rate limit exceeded". Nobody can create an account, and
-- nobody who did create one can sign in, because the address was never
-- confirmed.
--
-- GoTrue reloads the user right after the insert — its own comment says
-- "there may be triggers or generated column values in the database that
-- will modify the user data as it is being inserted" — and afterwards:
--
--     if config.Mailer.Autoconfirm || user.IsConfirmed() {
--         ... issue a refresh token ...     ← a session, the person is in
--     }
--
-- So a trigger that confirms the row while it is inserted makes the
-- Auth service skip the e-mail and hand out a session instead. That is
-- exactly what turning "Confirm email" off in the dashboard does — only
-- this one can be done from the database, and it keeps working whether
-- or not the dashboard setting is flipped.
--
-- To go back to e-mail confirmation: drop the trigger below and turn
-- "Confirm email" on in the dashboard.
--
-- Everything here is idempotent.

create or replace function public.autoconfirm_email_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  /* only fill the gap — an account that is already confirmed is left alone */
  if new.email is not null and new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists autoconfirm_email_user on auth.users;
create trigger autoconfirm_email_user
  before insert on auth.users
  for each row execute function public.autoconfirm_email_user();

-- ── the accounts that are already stuck ──────────────────────────────────
-- Somebody who signed up while the quota was used up and never got the
-- code can sign in right away with this.
update auth.users
   set email_confirmed_at = now()
 where email_confirmed_at is null
   and email is not null;

-- ── the profiles that are missing ────────────────────────────────────────
-- Every account has a profile row: the trigger below creates one for
-- each new user, and this puts back the ones that were lost.
insert into public.profiles (id, role, full_name, phone, email)
select u.id,
       case when u.raw_user_meta_data ->> 'role' = 'driver' then 'driver' else 'rider' end,
       coalesce(
         nullif(u.raw_user_meta_data ->> 'full_name', ''),
         nullif(u.raw_user_meta_data ->> 'name', ''),
         nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
         'Rider'
       ),
       public.normalize_phone(coalesce(u.raw_user_meta_data ->> 'phone', u.phone)),
       u.email
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

-- a driver needs a row in public.drivers as well
insert into public.drivers (user_id)
select p.id
  from public.profiles p
 where p.role = 'driver'
   and not exists (select 1 from public.drivers d where d.user_id = p.id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 14.  THE ADMINISTRATOR CAN SET A PASSWORD
-- ═══════════════════════════════════════════════════════════════════════════
-- The reset link needs a mail provider. Until one is set up nobody can
-- get that link, and a person who has forgotten their password is stuck.
-- An administrator can set a new password from the console instead: the
-- password never travels by e-mail, the old sessions die with it, and the
-- action is written into admin_actions like every other one.
--
-- Only an administrator can call it, and anon cannot call it at all.
create or replace function public.admin_set_user_password(p_user_id uuid, p_new_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can do that.' using errcode = 'insufficient_privilege';
  end if;

  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'The password needs at least 8 characters.' using errcode = 'invalid_parameter_value';
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null and not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'That account does not exist.' using errcode = 'no_data_found';
  end if;

  -- extensions.crypt / extensions.gen_salt: pgcrypto lives in the
  -- extensions schema, not in public
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now(),
         email_confirmed_at = coalesce(email_confirmed_at, now())
   where id = p_user_id;

  -- the old sessions must not survive a password change
  -- (auth.refresh_tokens.user_id is text in this project)
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;

  perform public.log_admin_action('user.set_password', 'profile', p_user_id::text,
    jsonb_build_object('email', v_email));

  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

revoke execute on function public.admin_set_user_password(uuid, text) from public, anon;
grant execute on function public.admin_set_user_password(uuid, text) to authenticated, service_role;
