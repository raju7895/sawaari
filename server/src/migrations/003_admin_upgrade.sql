-- ════════════════════════════════════════════════════════════
-- SAWAARI PLATFORM SCHEMA  v2 — SUPER ADMIN / MASTER CONTROL
--
-- Adds: admin identities + granular permissions, admin sessions,
-- login attempts + lockouts, invitations, an append-only audit
-- log, platform settings, report investigation history, refunds,
-- driver settlements and a suspension ledger.
--
-- Everything is additive: existing users, bookings, payments and
-- driver records are preserved untouched.
-- ════════════════════════════════════════════════════════════

-- ── Widen the users.role vocabulary (existing rows keep 'admin') ──
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('passenger','driver','admin','super_admin','finance_admin',
                  'support_admin','driver_manager','moderator'));

-- Email verification timestamp (mandatory for admin identities)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- OTP purposes used by the admin flows
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('register','password_reset','email_verify','admin_2fa','admin_invite'));

-- ── ADMIN IDENTITIES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  admin_role          text NOT NULL CHECK (admin_role IN (
                        'super_admin','admin','finance_admin','support_admin',
                        'driver_manager','moderator')),
  is_owner            boolean NOT NULL DEFAULT false,   -- the permanent platform owner
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','invited','disabled')),
  permissions         jsonb,                            -- NULL = inherit role defaults
  email_verified      boolean NOT NULL DEFAULT false,
  email_verified_at   timestamptz,
  twofa_enabled       boolean NOT NULL DEFAULT false,
  twofa_secret        text,                             -- AES-256-GCM ciphertext
  twofa_confirmed_at  timestamptz,
  twofa_backup_codes  text[],                           -- bcrypt hashes
  failed_attempts     int NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  last_login_ip       inet,
  invited_by          uuid REFERENCES users(id),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_profiles_role_idx ON admin_profiles(admin_role);
CREATE INDEX IF NOT EXISTS admin_profiles_status_idx ON admin_profiles(status);

-- ── ADMIN SESSIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_jti     text UNIQUE NOT NULL,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoked_reason text
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_sessions_active_idx ON admin_sessions(admin_user_id) WHERE revoked_at IS NULL;

-- ── LOGIN ATTEMPTS (rate limiting + lockout evidence) ───────
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id          bigserial PRIMARY KEY,
  email       text,
  ip_address  inet,
  success     boolean NOT NULL DEFAULT false,
  reason      text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_login_attempts_email_idx ON admin_login_attempts(email, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_login_attempts_ip_idx ON admin_login_attempts(ip_address, created_at DESC);

-- ── ADMIN INVITATIONS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  admin_role  text NOT NULL CHECK (admin_role IN (
                'admin','finance_admin','support_admin','driver_manager','moderator')),
  permissions jsonb,
  token_hash  text NOT NULL,
  invited_by  uuid REFERENCES users(id),
  message     text,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_invitations_email_idx ON admin_invitations(email, created_at DESC);

-- ── APPEND-ONLY AUDIT LOG ──────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             bigserial PRIMARY KEY,
  admin_id       uuid REFERENCES users(id),
  admin_email    text,
  admin_role     text,
  action         text NOT NULL,
  category       text NOT NULL DEFAULT 'general',
  target_type    text,
  target_id      text,
  target_label   text,
  previous_value jsonb,
  new_value      jsonb,
  ip_address     inet,
  user_agent     text,
  result         text NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure','denied')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_admin_idx ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit_log(target_type, target_id);

-- The audit log is append-only for everyone, including the super admin.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_no_update ON admin_audit_log;
CREATE TRIGGER admin_audit_no_update
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- ── PLATFORM SETTINGS (extends the v1 key/value table) ─────
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS is_secret boolean NOT NULL DEFAULT false;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS platform_settings_category_idx ON platform_settings(category);

-- ── REPORT INVESTIGATION HISTORY ───────────────────────────
CREATE TABLE IF NOT EXISTS report_investigations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES user_reports(id) ON DELETE CASCADE,
  admin_id    uuid REFERENCES users(id),
  admin_email text,
  action      text NOT NULL,
  note        text,
  evidence    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_investigation_report_idx ON report_investigations(report_id, created_at DESC);

-- ── REFUNDS (never mutate the original payment row) ────────
CREATE TABLE IF NOT EXISTS refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  booking_id   uuid REFERENCES bookings(id) ON DELETE SET NULL,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  reason       text NOT NULL,
  method       text NOT NULL CHECK (method IN ('razorpay','upi','cash','manual')),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','completed','failed','rejected')),
  gateway_ref  text,                             -- provider reference (never credentials)
  gateway_response jsonb,
  notes        text,
  initiated_by uuid REFERENCES users(id),
  approved_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_status_idx ON refunds(status, created_at DESC);

-- ── DRIVER SETTLEMENTS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id) ON DELETE RESTRICT,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  gross            numeric(12,2) NOT NULL DEFAULT 0,
  commission       numeric(12,2) NOT NULL DEFAULT 0,
  net              numeric(12,2) NOT NULL DEFAULT 0,
  rides            int NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  reference        text,
  paid_at          timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlements_driver_idx ON settlements(driver_profile_id, created_at DESC);

-- ── SUSPENSION LEDGER ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_suspensions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('suspend','block','deactivate')),
  reason      text,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,                          -- NULL = permanent
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  lifted_at   timestamptz,
  lifted_by   uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS user_suspensions_user_idx ON user_suspensions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_suspensions_active_idx ON user_suspensions(user_id) WHERE lifted_at IS NULL;

-- ── The owner account cannot be downgraded or removed ──────
CREATE OR REPLACE FUNCTION protect_owner_account() RETURNS trigger AS $$
DECLARE
  was_owner boolean;
  is_owner_now boolean;
BEGIN
  SELECT is_owner INTO was_owner FROM admin_profiles WHERE user_id = OLD.user_id;
  IF COALESCE(was_owner, false) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'The platform owner account cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT is_owner INTO is_owner_now FROM admin_profiles WHERE user_id = NEW.user_id;
    IF NOT COALESCE(is_owner_now, false)
       OR NEW.admin_role <> 'super_admin'
       OR NEW.status <> 'active' THEN
      RAISE EXCEPTION 'The platform owner account cannot be downgraded, suspended or demoted'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_owner_protect ON admin_profiles;
CREATE TRIGGER admin_owner_protect
  BEFORE UPDATE OR DELETE ON admin_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_owner_account();

-- Block deleting the owner's user row outright
CREATE OR REPLACE FUNCTION prevent_owner_user_delete() RETURNS trigger AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM admin_profiles WHERE is_owner = true LIMIT 1;
  IF owner_id IS NOT NULL AND owner_id = OLD.id THEN
    RAISE EXCEPTION 'The platform owner user account cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_owner_no_delete ON users;
CREATE TRIGGER users_owner_no_delete
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_owner_user_delete();

-- ── Indexes that keep the master dashboard fast ────────────
CREATE INDEX IF NOT EXISTS bookings_created_idx ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status);
CREATE INDEX IF NOT EXISTS bookings_passenger_idx ON bookings(passenger_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_driver_idx ON bookings(driver_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status);
CREATE INDEX IF NOT EXISTS payments_created_idx ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS driver_earnings_created_idx ON driver_earnings(created_at DESC);
CREATE INDEX IF NOT EXISTS users_created_idx ON users(created_at DESC);
