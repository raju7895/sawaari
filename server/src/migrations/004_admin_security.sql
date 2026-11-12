-- ════════════════════════════════════════════════════════════
-- SAWAARI PLATFORM SCHEMA  v4 — ADMIN SECURITY PRIMITIVES
--
-- Short-lived challenges (2FA), single-use verification tokens
-- (email verification, password reset, invitations) and the
-- suspension/notification helpers used by the master console.
-- ════════════════════════════════════════════════════════════

-- ── 2FA challenges (issued after a correct password, before a
--    TOTP / backup code is accepted) ───────────────────────────
CREATE TABLE IF NOT EXISTS admin_2fa_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti           text UNIQUE NOT NULL,
  method        text NOT NULL DEFAULT 'totp' CHECK (method IN ('totp','backup_code','email')),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_2fa_challenge_idx ON admin_2fa_challenges(jti);
CREATE INDEX IF NOT EXISTS admin_2fa_user_idx ON admin_2fa_challenges(admin_user_id, created_at DESC);

-- ── Single-use tokens: email verification, password reset, invites ──
CREATE TABLE IF NOT EXISTS admin_verification_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('email_verify','password_reset','invite')),
  token_hash    text UNIQUE NOT NULL,
  meta          jsonb,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_verification_token_idx ON admin_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS admin_verification_user_idx ON admin_verification_tokens(admin_user_id, kind, created_at DESC);

-- ── Bulk / targeted platform notifications ───────────────────
CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  audience    text NOT NULL CHECK (audience IN ('all','passengers','drivers','admins','city','user')),
  audience_filter jsonb,
  sent_by     uuid REFERENCES users(id),
  recipients  int NOT NULL DEFAULT 0,
  delivered   int NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','scheduled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_broadcasts_created_idx ON admin_broadcasts(created_at DESC);
