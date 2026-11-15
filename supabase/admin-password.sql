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
