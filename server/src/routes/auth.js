const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, one } = require('../db');
const { signToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, httpError, normalizePhone } = require('../utils');
const { issueOtp, verifyOtp } = require('../services/otp');
const { notifyAdmins } = require('../services/notify');

const router = express.Router();

const registerSchema = z.object({
  role: z.enum(['passenger', 'driver']),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  phone: z.string().refine((v) => normalizePhone(v), 'Enter a valid 10-digit Indian mobile number'),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

/** POST /api/auth/register */
router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { role, name, email, password } = req.body;
  const phone = normalizePhone(req.body.phone);

  const existing = await one(
    `SELECT phone, email, phone_verified FROM users WHERE phone=$1 OR ($2 <> '' AND email=$2) LIMIT 1`,
    [phone, email || '']
  );
  if (existing) {
    if (existing.phone === phone && !existing.phone_verified) {
      // re-registration of an unverified account → resend OTP
      const { devCode } = await issueOtp(phone, 'register');
      return res.status(200).json({
        ok: true, message: 'Account exists but is unverified. A fresh OTP has been sent.',
        phone, devCode,
      });
    }
    throw httpError(409, existing.phone === phone
      ? 'This mobile number is already registered. Please log in.'
      : 'This email is already registered.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (role, name, phone, email, password_hash) VALUES ($1,$2,$3,$4,$5)`,
    [role, name.trim(), phone, email || null, passwordHash]
  );
  if (role === 'passenger') {
    // the users_ensure_profile trigger may already have created the row
    await query(`INSERT INTO passenger_profiles (user_id) SELECT id FROM users WHERE phone=$1
                 ON CONFLICT (user_id) DO NOTHING`, [phone]);
  } else {
    await query(`INSERT INTO driver_profiles (user_id) SELECT id FROM users WHERE phone=$1
                 ON CONFLICT (user_id) DO NOTHING`, [phone]);
    await notifyAdmins({
      type: 'driver_signup', title: 'New driver signup',
      body: `${name} registered as a driver and needs document verification.`,
      data: { url: '/admin/drivers' },
    });
  }

  const { devCode } = await issueOtp(phone, 'register');
  res.status(201).json({
    ok: true,
    message: 'Account created. Verify the OTP sent to your mobile.',
    phone, devCode,
  });
}));

/** POST /api/auth/verify-otp — completes registration, returns session token */
router.post('/verify-otp', validate(z.object({
  phone: z.string(),
  code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  purpose: z.enum(['register', 'password_reset']).default('register'),
})), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw httpError(400, 'Invalid phone');
  await verifyOtp(phone, req.body.purpose, req.body.code);
  const user = await one(
    `UPDATE users SET phone_verified=true, updated_at=now() WHERE phone=$1 RETURNING *`, [phone]
  );
  if (!user) throw httpError(404, 'Account not found');
  if (req.body.purpose === 'password_reset') {
    return res.json({ ok: true, resetAllowed: true, message: 'OTP verified. Set a new password.' });
  }
  res.json({
    ok: true, message: 'Phone verified. Welcome to Sawaari!',
    token: signToken(user),
    user: { id: user.id, role: user.role, name: user.name, phone: user.phone, email: user.email, avatarUrl: user.avatar_url },
  });
}));

/** POST /api/auth/resend-otp */
router.post('/resend-otp', validate(z.object({
  phone: z.string(), purpose: z.enum(['register', 'password_reset']).default('register'),
})), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const user = await one(`SELECT id FROM users WHERE phone=$1`, [phone]);
  if (!user) throw httpError(404, 'No account with this number');
  const { devCode } = await issueOtp(phone, req.body.purpose);
  res.json({ ok: true, message: 'OTP sent', devCode });
}));

/** POST /api/auth/login */
router.post('/login', validate(z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
})), asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  const phone = normalizePhone(identifier);
  const user = await one(
    `SELECT * FROM users WHERE ($1 <> '' AND phone=$1) OR (email=$2 AND $2 <> '') LIMIT 1`,
    [phone || '', identifier.trim().toLowerCase()]
  );
  if (!user) throw httpError(401, 'Invalid credentials');
  if (!user.is_active) throw httpError(403, 'Your account has been blocked. Contact support.');
  /* Administrators authenticate through the console (email + password + 2FA)
     so their sessions are tracked, revocable and always two-factor protected. */
  const ADMIN_ROLES = ['super_admin', 'admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator'];
  if (ADMIN_ROLES.includes(user.role)) {
    throw httpError(403, 'Administrator accounts must sign in through the admin console.', {
      adminLogin: true,
    });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw httpError(401, 'Invalid credentials');
  if (!user.phone_verified) {
    const { devCode } = await issueOtp(user.phone, 'register').catch(() => ({ devCode: null }));
    throw httpError(403, 'Phone not verified. A new OTP has been sent to verify your number.', { needOtp: true, phone: user.phone, devCode });
  }
  res.json({
    ok: true,
    token: signToken(user),
    user: { id: user.id, role: user.role, name: user.name, phone: user.phone, email: user.email, avatarUrl: user.avatar_url },
  });
}));

/** POST /api/auth/forgot-password */
router.post('/forgot-password', validate(z.object({ phone: z.string() })), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const user = await one(`SELECT id FROM users WHERE phone=$1`, [phone]);
  // Do not reveal whether the number exists
  if (user) {
    const { devCode } = await issueOtp(phone, 'password_reset').catch(() => ({ devCode: null }));
    return res.json({ ok: true, message: 'If the number is registered, a reset OTP was sent.', devCode });
  }
  res.json({ ok: true, message: 'If the number is registered, a reset OTP was sent.' });
}));

/** POST /api/auth/reset-password */
router.post('/reset-password', validate(z.object({
  phone: z.string(), code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(72),
})), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  await verifyOtp(phone, 'password_reset', req.body.code);
  const hash = await bcrypt.hash(req.body.password, 10);
  await query(`UPDATE users SET password_hash=$2, updated_at=now() WHERE phone=$1`, [phone, hash]);
  res.json({ ok: true, message: 'Password updated. Please log in.' });
}));

module.exports = router;
