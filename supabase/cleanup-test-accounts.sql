-- ═══════════════════════════════════════════════════════════════════════════
-- REMOVE THE TEST ACCOUNTS
-- ═══════════════════════════════════════════════════════════════════════════
-- The accounts that were created while the sign-up flow was being tested.
-- Deleting the Auth user removes its profile, its driver row, its rides,
-- its payments and its ratings with it (they all cascade).
--
-- Run this in the Supabase SQL editor. It is safe to run twice.

delete from auth.users
 where email in (
   'qa.rider@sawaari-demo.co',
   'e2e.rider@sawaari-demo.co',
   'e2e.rider2@sawaari-demo.co',
   'e2e.rider3@sawaari-demo.co',
   'e2e.driver@sawaari-demo.co',
   'live.rider@sawaari-demo.co',
   'live.driver@sawaari-demo.co',
   'final.rider@sawaari-demo.co',
   'final.driver@sawaari-demo.co',
   'ui.rider@sawaari-demo.co',
   'ui.driver@sawaari-demo.co',
   'proof.rider@sawaari-demo.co',
   'proof.driver@sawaari-demo.co',
   'deploy.check@sawaari-demo.co',
   'raw.check@sawaari-demo.co',
   'rate.probe@sawaari-demo.co',
   'trialone@sawaari-demo.co',
   'trialtwo@sawaari-demo.co',
   'otptest@sawaari-demo.co',
   'otptest@sawaari-demo.co'
 );

-- a profile whose Auth user is gone (should be none — they cascade)
delete from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id);

-- what is left
select
  (select count(*) from auth.users)                                as auth_users,
  (select count(*) from public.profiles)                           as profiles,
  (select count(*) from public.drivers)                            as drivers,
  (select count(*) from public.rides)                              as rides,
  (select count(*) from public.payments)                           as payments,
  (select string_agg(email, ' | ') from auth.users)                as emails;
