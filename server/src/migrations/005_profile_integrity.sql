-- ════════════════════════════════════════════════════════════
-- SAWAARI PLATFORM SCHEMA  v5 — DATA INTEGRITY BACKFILL
--
-- Every passenger must have a passenger_profiles row (it carries the
-- rating). Accounts created outside the registration route could miss
-- it, so the rows are backfilled here and a trigger keeps the
-- invariant true from now on. No existing data is modified.
-- ════════════════════════════════════════════════════════════

-- ── Backfill missing profiles (insert only, never updates) ──
INSERT INTO passenger_profiles (user_id)
SELECT u.id FROM users u
 WHERE u.role = 'passenger'
   AND NOT EXISTS (SELECT 1 FROM passenger_profiles pp WHERE pp.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO driver_profiles (user_id)
SELECT u.id FROM users u
 WHERE u.role = 'driver'
   AND NOT EXISTS (SELECT 1 FROM driver_profiles dp WHERE dp.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ── Keep the invariant true for future inserts ──────────────
CREATE OR REPLACE FUNCTION ensure_user_profile() RETURNS trigger AS $$
BEGIN
  IF NEW.role = 'passenger' THEN
    INSERT INTO passenger_profiles (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  ELSIF NEW.role = 'driver' THEN
    INSERT INTO driver_profiles (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_ensure_profile ON users;
CREATE TRIGGER users_ensure_profile
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION ensure_user_profile();
