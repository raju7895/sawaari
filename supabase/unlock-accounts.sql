-- ═══════════════════════════════════════════════════════════════════════════
-- UNLOCK THE ACCOUNTS THAT CANNOT SIGN IN
-- ═══════════════════════════════════════════════════════════════════════════
-- Somebody who signed up while the e-mail quota was used up never got a
-- code, so the address was never confirmed and every sign-in was refused
-- with "e-mail not confirmed".
--
-- Run this in the Supabase SQL editor. It only touches accounts that are
-- stuck; it never deletes anything.
--
-- If you would rather not run it: Authentication → Sign In / Providers →
-- Email → turn OFF "Confirm email" and new sign-ups are confirmed as
-- they happen (the database already does this — see section 12 of the
-- migration).

-- 1. confirm the accounts that never got a code
update auth.users
   set email_confirmed_at = now()
 where email_confirmed_at is null
   and email is not null;

-- 2. give every account the profile row it is missing
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
  left join public.profiles p on p.id = u.id
 where p.id is null
   and u.email is not null
on conflict (id) do nothing;

-- 3. the owner is the administrator
--    put YOUR own e-mail address in here (the one you sign in with) and
--    run this script again
update public.profiles
   set role = 'admin'
 where email = 'your-admin@example.com';

-- 4. what is left
select u.email,
       (u.email_confirmed_at is not null)  as confirmed,
       (p.id is not null)                 as has_profile,
       p.role,
       (p.id = u.id)                      as same_id
  from auth.users u
  left join public.profiles p on p.id = u.id
 order by u.created_at desc
 limit 20;
