-- ═══════════════════════════════════════════════════════════════════════════
-- THE PUBLIC TRIP-SHARE LINK
-- ═══════════════════════════════════════════════════════════════════════════
-- The "follow my ride" link is meant for people who are NOT signed in —
-- the family member the passenger sends it to. The function that reads the
-- ride by its share token is SECURITY DEFINER (so it can read the rows the
-- visitor may not read), but the migration only granted EXECUTE on the
-- functions to "authenticated" and "service_role":
--
--     grant execute on all functions in schema public to authenticated, service_role;
--
-- So an anonymous visitor got
--
--     401  permission denied for function get_ride_by_share_token
--
-- and the share link never worked for anybody who was not signed in.
--
-- The fix is one line: the share-token reader may be called by anon.
-- The token itself is the permission — it is 128 bits of randomness
-- (a uuid without its dashes) and it is only known to the people it was
-- sent to.
--
-- Run this in the Supabase SQL editor. It is idempotent.

grant execute on function public.get_ride_by_share_token(text)
  to anon, authenticated, service_role;

-- check it:
--   select has_function_privilege('anon', 'public.get_ride_by_share_token(text)', 'execute');
--   → t means the public trip link works again
