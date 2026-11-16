-- ═══════════════════════════════════════════════════════════════════════════
-- REMOVE THE TEST ACCOUNTS
-- ═══════════════════════════════════════════════════════════════════════════
-- Every account created while the sign-up flow was being tested uses the
-- @sawaari-demo.co domain. The real accounts are gmail addresses, so the
-- pattern below cannot touch them.
--
-- Deleting the Auth user removes its profile, its driver row, its rides,
-- its payments and its ratings with it (they all cascade).
--
-- Run this in the Supabase SQL editor. It is safe to run twice.

delete from auth.users where email like '%@sawaari-demo.co';

-- a profile whose Auth user is gone (should be none — they cascade)
delete from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id);

-- a driver row without a profile
delete from public.drivers d
 where not exists (select 1 from public.profiles p where p.id = d.user_id);

-- what is left
select
  (select count(*) from auth.users)                              as auth_users,
  (select count(*) from public.profiles)                         as profiles,
  (select count(*) from public.drivers)                          as drivers,
  (select count(*) from public.rides)                            as rides,
  (select count(*) from public.payments)                         as payments,
  (select count(*) from auth.users where email like '%@sawaari-demo.co') as test_accounts_left,
  (select string_agg(email, ' | ') from auth.users)              as emails;
