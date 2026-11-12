const express = require('express');
const { z } = require('zod');
const { query, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, httpError } = require('../utils');
const { upload, fileUrl } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

/** GET /api/users/me — full profile for the logged-in user */
router.get('/me', asyncHandler(async (req, res) => {
  const u = await one(
    `SELECT u.id, u.role, u.name, u.phone, u.email, u.avatar_url, u.phone_verified, u.created_at,
            pp.rating_avg, pp.rating_count
       FROM users u LEFT JOIN passenger_profiles pp ON pp.user_id = u.id
      WHERE u.id = $1`, [req.user.id]
  );
  if (!u) throw httpError(404, 'Profile not found');
  res.json({
    id: u.id, role: u.role, name: u.name, phone: u.phone, email: u.email,
    avatarUrl: u.avatar_url, phoneVerified: u.phone_verified, joinedAt: u.created_at,
    rating: u.role === 'passenger' ? { avg: parseFloat(u.rating_avg || 0), count: u.rating_count } : undefined,
  });
}));

/** PATCH /api/users/me — name/email/password */
router.patch('/me', validate(z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(72).optional(),
})), asyncHandler(async (req, res) => {
  const { name, email, currentPassword, newPassword } = req.body;
  if (newPassword) {
    const u = await one(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
    const bcrypt = require('bcryptjs');
    const ok = await bcrypt.compare(currentPassword || '', u.password_hash);
    if (!ok) throw httpError(400, 'Current password is incorrect');
    await query(`UPDATE users SET password_hash=$2 WHERE id=$1`,
      [req.user.id, await bcrypt.hash(newPassword, 10)]);
  }
  if (name || email !== undefined) {
    if (email) {
      const dup = await one(`SELECT id FROM users WHERE email=$1 AND id <> $2`, [email, req.user.id]);
      if (dup) throw httpError(409, 'Email already in use');
    }
    await query(
      `UPDATE users SET name = COALESCE($2, name), email = $3, updated_at=now() WHERE id=$1`,
      [req.user.id, name || null, email || null]
    );
  }
  res.json({ ok: true });
}));

/** POST /api/users/me/avatar */
router.post('/me/avatar',
  (req, _res, next) => { req.uploadKind = 'avatars'; next(); },
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, 'Attach an image file in the "file" field');
    const url = `/uploads/avatars/${req.file.filename}`;
    await query(`UPDATE users SET avatar_url=$2 WHERE id=$1`, [req.user.id, url]);
    res.json({ ok: true, avatarUrl: url });
  }));

module.exports = router;
