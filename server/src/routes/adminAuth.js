/* Admin authentication: login with lockout + 2FA, email verification,
   password reset, invitation acceptance and session control.
   These endpoints are public — everything else in the console requires
   an authenticated admin session with the right permissions. */
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const config = require('../config');
const { query, one } = require('../db');
const { validate } = require('../middleware/validate');
const { asyncHandler, httpError, normalizePhone } = require('../utils');
const audit = require('../services/audit');
const cryptoSvc = require('../services/crypto');
const sessions = require('../services/adminSession');
const mailer = require('../services/mailer');
const rbac = require('../services/rbac');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.admin.security.maxLoginAttempts * 4,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
});

const clientIp = (req) => (req.ip || (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null);
const auditCtx = (req) => ({
  adminId: null,
  adminEmail: (req.body && req.body.identifier ? String(req.body.identifier).trim().toLowerCase() : null),
  adminRole: null,
  ip: clientIp(req),
  userAgent: (req.headers['user-agent'] || '').slice(0, 300),
});

async function logAttempt(req, email, success, reason) {
  try {
    await query(
      `INSERT INTO admin_login_attempts (email, ip_address, success, reason, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [email || null, clientIp(req), success, reason || null, (req.headers['user-agent'] || '').slice(0, 300)]
    );
  } catch { /* never block login on logging errors */ }
}

/**
 * Recent authentication failures.
 *
 * Only *genuine credential failures* count towards the lockout:
 *   • 'bad_password'   → counts per account AND per IP
 *   • 'bad_2fa_code'   → counts per account only (the challenge has its own
 *                         attempt limit; a shared IP must not be punished for
 *                         one person mistyping an authenticator code)
 *   • 'awaiting_2fa'   → NOT a failure: the password was correct, the second
 *                         factor is simply still pending
 * A correct password is never blocked by these counters — see the login route.
 */
async function failureCounts(email, ip) {
  const byEmail = await one(
    `SELECT count(*)::int AS c FROM admin_login_attempts
      WHERE success = false AND reason IN ('bad_password','bad_2fa_code')
        AND email = $1 AND created_at > now() - interval '15 minutes'`,
    [email || '']
  );
  const byIp = await one(
    `SELECT count(*)::int AS c FROM admin_login_attempts
      WHERE success = false AND reason = 'bad_password'
        AND ip_address = $1::inet AND created_at > now() - interval '15 minutes'`,
    [ip || null]
  );
  return { email: byEmail ? byEmail.c : 0, ip: byIp ? byIp.c : 0 };
}

const hashToken = (token) => require('crypto').createHash('sha256').update(String(token)).digest('hex');

/* ── LOGIN ─────────────────────────────────────────────────── */
router.post('/login', loginLimiter, validate(z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
})), asyncHandler(async (req, res) => {
  const identifier = req.body.identifier.trim();
  const email = identifier.includes('@') ? identifier.toLowerCase() : null;
  const phone = email ? null : normalizePhone(identifier);
  const ip = clientIp(req);

  const user = await one(
    `SELECT u.*, ap.admin_role, ap.status AS admin_status, ap.is_owner, ap.twofa_enabled,
            ap.twofa_secret, ap.twofa_backup_codes, ap.email_verified, ap.failed_attempts,
            ap.locked_until
       FROM users u JOIN admin_profiles ap ON ap.user_id = u.id
      WHERE ($1 <> '' AND lower(u.email) = lower($1)) OR ($2 <> '' AND u.phone = $2)
      LIMIT 1`,
    [email || '', phone || '']
  );

  if (!user) {
    await logAttempt(req, email || phone, false, 'no_such_account');
    await audit.record(auditCtx(req), 'login.failure', { result: 'failure', targetType: 'admin', targetLabel: email || phone });
    throw httpError(401, 'Invalid credentials');
  }
  if (!user.is_active || user.admin_status !== 'active') {
    await logAttempt(req, user.email, false, 'account_not_active');
    await audit.record({ ...auditCtx(req), adminId: user.id, adminEmail: user.email, adminRole: user.admin_role }, 'login.blocked', {
      result: 'denied', targetType: 'admin', targetId: user.id, targetLabel: user.email,
    });
    throw httpError(403, 'This administrator account is suspended. Contact the platform owner.');
  }
  /* The per-account lock is authoritative and survives a restart. */
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutes = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    await logAttempt(req, user.email, false, 'account_locked');
    throw httpError(423, `Account temporarily locked after repeated failed sign-ins. Try again in ${minutes} minute(s).`);
  }

  const failures = await failureCounts(email || phone, ip);
  const ipLimit = config.admin.security.maxLoginAttempts * 3;

  const ok = await bcrypt.compare(req.body.password, user.password_hash);
  if (!ok) {
    /* Only a *wrong* password is throttled — a valid credential is never
       refused because of the shared counters. */
    if (failures.email >= config.admin.security.maxLoginAttempts || failures.ip >= ipLimit) {
      await logAttempt(req, user.email, false, 'bad_password');
      await audit.record({ ...auditCtx(req), adminId: user.id, adminEmail: user.email, adminRole: user.admin_role }, 'login.failure', {
        result: 'failure', targetType: 'admin', targetId: user.id, targetLabel: user.email,
        newValue: { attempt: failures.email + 1, throttled: true },
      });
      throw httpError(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
    }
    const attempts = (user.failed_attempts || 0) + 1;
    const lock = attempts >= config.admin.security.maxFailedAttempts;
    await query(
      `UPDATE admin_profiles SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1`,
      [user.id, lock ? 0 : attempts, lock ? new Date(Date.now() + config.admin.security.accountLockMinutes * 60000) : null]
    );
    await logAttempt(req, user.email, false, 'bad_password');
    await audit.record({ ...auditCtx(req), adminId: user.id, adminEmail: user.email, adminRole: user.admin_role }, 'login.failure', {
      result: 'failure', targetType: 'admin', targetId: user.id, targetLabel: user.email,
      newValue: { attempt: attempts, locked: lock },
    });
    throw httpError(401, lock
      ? `Too many failed attempts. This account is locked for ${config.admin.security.accountLockMinutes} minutes.`
      : 'Invalid credentials');
  }

  // Password OK — reset the failure counter
  await query(
    `UPDATE admin_profiles SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`,
    [user.id]
  );

  const ctx = { adminId: user.id, adminEmail: user.email, adminRole: user.admin_role, ip, userAgent: (req.headers['user-agent'] || '').slice(0, 300) };

  // Email verification is mandatory before the console can be used.
  if (!user.email_verified) {
    await logAttempt(req, user.email, false, 'email_unverified');
    await audit.record(ctx, 'login.blocked', { result: 'denied', targetType: 'admin', targetId: user.id, targetLabel: user.email, newValue: { reason: 'email_unverified' } });
    throw httpError(403, 'Verify your email address before signing in to the console.', {
      needEmailVerification: true, email: user.email,
    });
  }

  // Two-factor authentication is mandatory for every admin account.
  if (user.twofa_enabled) {
    const jti = require('crypto').randomUUID();
    await query(
      `INSERT INTO admin_2fa_challenges (admin_user_id, jti, method, expires_at, ip_address)
       VALUES ($1,$2,'totp',$3,$4)`,
      [user.id, jti, new Date(Date.now() + 5 * 60000), ip]
    );
    const challenge = jwt.sign({ sub: user.id, jti, scope: 'admin-2fa' }, config.jwtSecret, { expiresIn: '5m' });
    /* The password was correct — this is NOT a failed attempt. Logging it as
       one used to inflate the lockout counter and lock out valid users. */
    await logAttempt(req, user.email, true, 'password_verified');
    await audit.record(ctx, 'login.2fa_required', { targetType: 'admin', targetId: user.id, targetLabel: user.email });
    return res.json({
      ok: true,
      requiresTwoFactor: true,
      challenge,
      method: 'totp',
      email: user.email,
      message: 'Enter the 6-digit code from your authenticator app.',
    });
  }

  // No 2FA on file (e.g. freshly invited admin) — force enrolment instead.
  const { token, expiresAt } = await sessions.createSession({
    adminUserId: user.id, ip, userAgent: req.headers['user-agent'], role: user.admin_role,
  });
  await query(
    `UPDATE admin_profiles SET last_login_at=now(), last_login_ip=$2, updated_at=now() WHERE user_id=$1`,
    [user.id, ip]
  );
  await logAttempt(req, user.email, true, 'login');
  await audit.record(ctx, 'login.success', { targetType: 'admin', targetId: user.id, targetLabel: user.email, newValue: { twofa: false } });

  return res.json({
    ok: true,
    token,
    expiresAt,
    requireTwoFactorSetup: !user.twofa_enabled,
    user: {
      id: user.id, name: user.name, email: user.email, phone: user.phone,
      role: user.admin_role, isOwner: user.is_owner,
      permissions: rbac.permissionsFor({ admin_role: user.admin_role, permissions: null, status: 'active' }),
    },
  });
}));

/* ── 2FA VERIFICATION ──────────────────────────────────────── */
router.post('/verify-2fa', loginLimiter, validate(z.object({
  challenge: z.string().min(10),
  code: z.string().min(6).max(20),
})), asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.body.challenge, config.jwtSecret);
  } catch {
    throw httpError(401, 'This sign-in attempt expired. Please log in again.');
  }
  if (payload.scope !== 'admin-2fa') throw httpError(401, 'Invalid challenge');

  const challenge = await one(`SELECT * FROM admin_2fa_challenges WHERE jti=$1`, [payload.jti]);
  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) < new Date()) {
    throw httpError(401, 'This sign-in attempt expired. Please log in again.');
  }
  if (challenge.attempts >= challenge.max_attempts) {
    await query(`UPDATE admin_2fa_challenges SET consumed_at=now() WHERE id=$1`, [challenge.id]);
    await audit.record(auditCtx(req), 'login.2fa_locked', { result: 'denied', targetType: 'admin', targetId: challenge.admin_user_id });
    throw httpError(429, 'Too many invalid codes. Please log in again.');
  }

  const user = await one(
    `SELECT u.*, ap.admin_role, ap.status AS admin_status, ap.is_owner, ap.twofa_secret,
            ap.twofa_backup_codes, ap.email_verified
       FROM users u JOIN admin_profiles ap ON ap.user_id = u.id WHERE u.id = $1`,
    [challenge.admin_user_id]
  );
  if (!user || !user.is_active || user.admin_status !== 'active') {
    throw httpError(403, 'This administrator account is suspended.');
  }

  const code = String(req.body.code).trim();
  const secret = cryptoSvc.decrypt(user.twofa_secret);
  let method = 'totp';
  let valid = secret ? cryptoSvc.verifyTotp(secret, code) : false;

  if (!valid && user.twofa_backup_codes && user.twofa_backup_codes.length) {
    const normalised = code.toUpperCase();
    for (const hashed of user.twofa_backup_codes) {
      if (await bcrypt.compare(normalised, hashed)) {
        valid = true;
        method = 'backup_code';
        // single-use backup code
        await query(`UPDATE admin_profiles SET twofa_backup_codes = array_remove(twofa_backup_codes, $2) WHERE user_id=$1`, [user.id, hashed]);
        break;
      }
    }
  }

  if (!valid) {
    await query(`UPDATE admin_2fa_challenges SET attempts=attempts+1 WHERE id=$1`, [challenge.id]);
    await logAttempt(req, user.email, false, 'bad_2fa_code');
    await audit.record({ ...auditCtx(req), adminId: user.id, adminEmail: user.email, adminRole: user.admin_role }, 'login.2fa_failure', {
      result: 'failure', targetType: 'admin', targetId: user.id, targetLabel: user.email,
    });
    throw httpError(401, 'That code is not valid. Check your authenticator app.');
  }

  await query(`UPDATE admin_2fa_challenges SET consumed_at=now() WHERE id=$1`, [challenge.id]);
  const { token, expiresAt } = await sessions.createSession({
    adminUserId: user.id, ip: clientIp(req), userAgent: req.headers['user-agent'], role: user.admin_role,
  });
  await query(
    `UPDATE admin_profiles SET last_login_at=now(), last_login_ip=$2, updated_at=now() WHERE user_id=$1`,
    [user.id, clientIp(req)]
  );
  await logAttempt(req, user.email, true, 'login_2fa');
  await audit.record({ adminId: user.id, adminEmail: user.email, adminRole: user.admin_role, ip: clientIp(req), userAgent: req.headers['user-agent'] }, 'login.success', {
    targetType: 'admin', targetId: user.id, targetLabel: user.email, newValue: { twofa: true, method },
  });

  return res.json({
    ok: true,
    token,
    expiresAt,
    user: {
      id: user.id, name: user.name, email: user.email, phone: user.phone,
      role: user.admin_role, isOwner: user.is_owner,
      permissions: rbac.permissionsFor({ admin_role: user.admin_role, permissions: null, status: 'active' }),
    },
  });
}));

/* ── EMAIL VERIFICATION ────────────────────────────────────── */
router.post('/request-email-verification', loginLimiter, validate(z.object({
  email: z.string().email(),
})), asyncHandler(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const user = await one(
    `SELECT u.id, u.email, u.name, ap.admin_role FROM users u
       JOIN admin_profiles ap ON ap.user_id = u.id WHERE u.email = $1`, [email]
  );
  // Do not reveal whether the address belongs to an administrator.
  if (!user) {
    return res.json({ ok: true, message: 'If the address belongs to an administrator, a verification link has been sent.' });
  }
  const raw = cryptoSvc.randomToken(24);
  await query(
    `INSERT INTO admin_verification_tokens (admin_user_id, kind, token_hash, expires_at)
     VALUES ($1,'email_verify',$2,$3)`,
    [user.id, hashToken(raw), new Date(Date.now() + 24 * 3600 * 1000)]
  );
  const link = `${config.appUrl}/verify-admin-email?token=${raw}`;
  let delivered = false;
  if (config.smtp.enabled) {
    try {
      const result = await mailer.sendMail({
        to: user.email,
        subject: 'Verify your Sawaari administrator email',
        text: `Hello ${user.name}, verify your administrator email by opening this link (valid 24 hours):\n\n${link}\n\nIf you did not request this, ignore this email.`,
      });
      delivered = Boolean(result && result.delivered);
    } catch (err) {
      console.error('[admin-auth] verification email failed:', err.message);
    }
  }
  await audit.record({ adminId: user.id, adminEmail: user.email, adminRole: user.admin_role, ip: clientIp(req) }, 'admin.email_verification_sent', {
    targetType: 'admin', targetId: user.id, targetLabel: user.email, newValue: { delivered },
  });
  return res.json({
    ok: true,
    message: 'If the address belongs to an administrator, a verification link has been sent.',
    devToken: delivered ? undefined : raw, // only surfaced when email is not configured
  });
}));

router.post('/verify-email', validate(z.object({ token: z.string().min(20) })), asyncHandler(async (req, res) => {
  const row = await one(
    `SELECT * FROM admin_verification_tokens WHERE token_hash=$1 AND kind='email_verify'`,
    [hashToken(req.body.token)]
  );
  if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) {
    throw httpError(400, 'This verification link is invalid or has expired.');
  }
  await query(`UPDATE admin_verification_tokens SET consumed_at=now() WHERE id=$1`, [row.id]);
  await query(`UPDATE admin_profiles SET email_verified=true, email_verified_at=now(), updated_at=now() WHERE user_id=$1`, [row.admin_user_id]);
  await query(`UPDATE users SET email_verified_at=now(), updated_at=now() WHERE id=$1`, [row.admin_user_id]);
  const user = await one(`SELECT email, admin_role FROM users u JOIN admin_profiles ap ON ap.user_id=u.id WHERE u.id=$1`, [row.admin_user_id]);
  await audit.record({ adminId: row.admin_user_id, adminEmail: user ? user.email : null, adminRole: user ? user.admin_role : null, ip: clientIp(req) }, 'admin.email_verified', {
    targetType: 'admin', targetId: row.admin_user_id, targetLabel: user ? user.email : null,
  });
  res.json({ ok: true, message: 'Email verified. You can now sign in to the console.' });
}));

/* ── PASSWORD RESET ────────────────────────────────────────── */
router.post('/forgot-password', loginLimiter, validate(z.object({ email: z.string().email() })), asyncHandler(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const user = await one(
    `SELECT u.id, u.email, u.name, ap.admin_role FROM users u
       JOIN admin_profiles ap ON ap.user_id = u.id WHERE u.email = $1`, [email]
  );
  if (user) {
    const raw = cryptoSvc.randomToken(24);
    await query(
      `INSERT INTO admin_verification_tokens (admin_user_id, kind, token_hash, expires_at)
       VALUES ($1,'password_reset',$2,$3)`,
      [user.id, hashToken(raw), new Date(Date.now() + 60 * 60 * 1000)]
    );
    const link = `${config.appUrl}/admin-reset-password?token=${raw}`;
    if (config.smtp.enabled) {
      try {
        await mailer.sendMail({
          to: user.email,
          subject: 'Reset your Sawaari administrator password',
          text: `Hello ${user.name}, use this link within 60 minutes to choose a new password:\n\n${link}\n\nIf you did not request this, ignore this email.`,
        });
      } catch (err) { console.error('[admin-auth] reset email failed:', err.message); }
    }
    await audit.record({ adminId: user.id, adminEmail: user.email, adminRole: user.admin_role, ip: clientIp(req) }, 'admin.password_reset_requested', {
      targetType: 'admin', targetId: user.id, targetLabel: user.email,
    });
  }
  res.json({
    ok: true,
    message: 'If the address belongs to an administrator, a reset link has been sent.',
    devToken: user && !config.smtp.enabled ? undefined : undefined,
  });
}));

router.post('/reset-password', validate(z.object({
  token: z.string().min(20),
  password: z.string().min(12, 'Use at least 12 characters for administrator passwords').max(72),
})), asyncHandler(async (req, res) => {
  const row = await one(
    `SELECT * FROM admin_verification_tokens WHERE token_hash=$1 AND kind='password_reset'`,
    [hashToken(req.body.token)]
  );
  if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) {
    throw httpError(400, 'This reset link is invalid or has expired.');
  }
  const hash = await bcrypt.hash(req.body.password, 12);
  await query(`UPDATE admin_verification_tokens SET consumed_at=now() WHERE id=$1`, [row.id]);
  await query(`UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, [row.admin_user_id, hash]);
  await query(`UPDATE admin_profiles SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, [row.admin_user_id]);
  // every existing session is invalidated by a password change
  await sessions.revoke(row.admin_user_id, null, 'password_reset');
  const user = await one(`SELECT email, admin_role FROM users u JOIN admin_profiles ap ON ap.user_id=u.id WHERE u.id=$1`, [row.admin_user_id]);
  await audit.record({ adminId: row.admin_user_id, adminEmail: user ? user.email : null, adminRole: user ? user.admin_role : null, ip: clientIp(req) }, 'admin.password_reset', {
    targetType: 'admin', targetId: row.admin_user_id, targetLabel: user ? user.email : null,
  });
  res.json({ ok: true, message: 'Password updated. All sessions were signed out — please sign in again.' });
}));

/* ── INVITATION ACCEPTANCE ─────────────────────────────────── */
router.post('/accept-invite', validate(z.object({
  token: z.string().min(20),
  name: z.string().trim().min(2).max(80),
  phone: z.string(),
  password: z.string().min(12, 'Use at least 12 characters for administrator passwords').max(72),
})), asyncHandler(async (req, res) => {
  const row = await one(
    `SELECT * FROM admin_verification_tokens WHERE token_hash=$1 AND kind='invite'`,
    [hashToken(req.body.token)]
  );
  if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) {
    throw httpError(400, 'This invitation is invalid or has expired. Ask the Super Admin for a new one.');
  }
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw httpError(400, 'Enter a valid 10-digit mobile number');
  const existing = await one(`SELECT id FROM users WHERE phone=$1 OR email=$2`, [phone, row.meta && row.meta.email]);
  if (existing) throw httpError(409, 'An account already exists with that mobile number or email.');

  const hash = await bcrypt.hash(req.body.password, 12);
  const { rows } = await query(
    `INSERT INTO users (role, name, phone, email, password_hash, phone_verified)
     VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
    [row.meta.admin_role, req.body.name.trim(), phone, row.meta.email, hash]
  );
  const userId = rows[0].id;
  await query(
    `INSERT INTO admin_profiles (user_id, admin_role, status, permissions, email_verified, invited_by)
     VALUES ($1,$2,'active',$3,true,$4)`,
    [userId, row.meta.admin_role, row.meta.permissions ? JSON.stringify(row.meta.permissions) : null, row.meta.invited_by || null]
  );
  await query(`UPDATE admin_verification_tokens SET consumed_at=now() WHERE id=$1`, [row.id]);
  await audit.record({ adminId: row.meta.invited_by || null, adminEmail: row.meta.email, adminRole: row.meta.admin_role, ip: clientIp(req) }, 'admin.invite_accepted', {
    targetType: 'admin', targetId: userId, targetLabel: row.meta.email,
  });
  res.json({ ok: true, message: 'Administrator account created. Set up two-factor authentication to finish.' });
}));

/* ── SESSION CONTROL (authenticated admin) ──────────────────── */

/** Require a live administrator session (Bearer token with admin scope). */
async function requireAdminSession(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw httpError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw httpError(401, 'Session expired or invalid. Please sign in again.');
    }
    if (payload.scope !== 'admin') throw httpError(403, 'Administrator session required.');
    const active = await sessions.isActive(payload.jti);
    if (!active) throw httpError(401, 'Your administrator session has expired or was signed out.');
    const user = await one(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active FROM users u WHERE u.id = $1`, [payload.sub]
    );
    if (!user) throw httpError(401, 'Account not found');
    if (!user.is_active) throw httpError(403, 'This account is suspended.');
    req.user = user;
    req.adminSessionJti = payload.jti;
    return next();
  } catch (err) { return next(err); }
}

/* ── Two-factor enrolment (authenticated admin) ─────────────── */
router.post('/2fa/setup', requireAdminSession, asyncHandler(async (req, res) => {
  const profile = await one(
    `SELECT ap.*, u.email FROM admin_profiles ap JOIN users u ON u.id=ap.user_id WHERE ap.user_id=$1`,
    [req.user.id]
  );
  if (!profile) throw httpError(403, 'This account is not an administrator.');
  if (profile.twofa_enabled && profile.twofa_confirmed_at) {
    throw httpError(409, 'Two-factor authentication is already active on this account.');
  }
  const secret = cryptoSvc.generateTotpSecret();
  const backupCodes = cryptoSvc.generateBackupCodes(8);
  // stored encrypted, but not active until the code is confirmed
  await query(
    `UPDATE admin_profiles SET twofa_secret=$2, twofa_backup_codes=NULL, twofa_confirmed_at=NULL, updated_at=now()
      WHERE user_id=$1`, [req.user.id, cryptoSvc.encrypt(secret)]
  );
  await audit.record({
    adminId: req.user.id, adminEmail: req.user.email, adminRole: profile.admin_role, ip: clientIp(req),
  }, 'admin.2fa_setup_started', { targetType: 'admin', targetId: req.user.id, targetLabel: req.user.email });
  res.json({
    ok: true,
    secret,
    uri: cryptoSvc.totpUri({ secret, email: req.user.email, issuer: 'Sawaari Admin' }),
    backupCodes,
    message: 'Scan the code, then confirm with a 6-digit code from your app.',
  });
}));

router.post('/2fa/confirm', requireAdminSession, validate(z.object({ code: z.string().regex(/^\d{6}$/) })), asyncHandler(async (req, res) => {
  const profile = await one(
    `SELECT ap.*, u.email FROM admin_profiles ap JOIN users u ON u.id=ap.user_id WHERE ap.user_id=$1`,
    [req.user.id]
  );
  if (!profile) throw httpError(403, 'This account is not an administrator.');
  const secret = cryptoSvc.decrypt(profile.twofa_secret);
  if (!secret) throw httpError(400, 'Start the setup again to get a fresh secret.');
  if (!cryptoSvc.verifyTotp(secret, req.body.code)) {
    throw httpError(400, 'That code is not valid. Check your authenticator app and try again.');
  }
  // backup codes are stored hashed and shown to the operator only once
  const raw = cryptoSvc.generateBackupCodes(8);
  const hashed = [];
  for (const code of raw) hashed.push(await bcrypt.hash(code, 10));
  await query(
    `UPDATE admin_profiles SET twofa_enabled=true, twofa_confirmed_at=now(), twofa_backup_codes=$2, updated_at=now()
      WHERE user_id=$1`, [req.user.id, hashed]
  );
  await audit.record({
    adminId: req.user.id, adminEmail: req.user.email, adminRole: profile.admin_role, ip: clientIp(req),
  }, 'admin.2fa_enabled', { targetType: 'admin', targetId: req.user.id, targetLabel: req.user.email });
  res.json({ ok: true, backupCodes: raw, message: 'Two-factor authentication is now active. Store the backup codes somewhere safe.' });
}));

router.post('/2fa/disable', requireAdminSession, validate(z.object({ password: z.string().min(1) })), asyncHandler(async (req, res) => {
  const user = await one(`SELECT id, email, password_hash FROM users WHERE id=$1`, [req.user.id]);
  const ok = await bcrypt.compare(req.body.password, user.password_hash);
  if (!ok) throw httpError(401, 'Your password is incorrect.');
  const profile = await one(`SELECT is_owner, admin_role FROM admin_profiles WHERE user_id=$1`, [req.user.id]);
  if (profile && profile.is_owner) {
    throw httpError(403, 'The platform owner account must keep two-factor authentication enabled.');
  }
  await query(
    `UPDATE admin_profiles SET twofa_enabled=false, twofa_secret=NULL, twofa_backup_codes=NULL,
       twofa_confirmed_at=NULL, updated_at=now() WHERE user_id=$1`, [req.user.id]
  );
  await sessions.revoke(req.user.id, null, '2fa_disabled');
  await audit.record({
    adminId: req.user.id, adminEmail: user.email, adminRole: profile ? profile.admin_role : null, ip: clientIp(req),
  }, 'admin.2fa_disabled', { targetType: 'admin', targetId: req.user.id, targetLabel: user.email });
  res.json({ ok: true, message: 'Two-factor authentication disabled. All sessions were signed out.' });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      if (payload.jti) await sessions.revoke(payload.sub, null, 'logout');
      await audit.record({ adminId: payload.sub, ip: clientIp(req) }, 'session.logout', {
        targetType: 'admin', targetId: payload.sub,
      });
    } catch { /* token already invalid */ }
  }
  res.json({ ok: true });
}));

module.exports = router;
