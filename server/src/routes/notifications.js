const express = require('express');
const { z } = require('zod');
const { query, one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../utils');
const { pushToUser, enabled } = require('../services/push');

const router = express.Router();
router.use(requireAuth);

/** GET /api/notifications?unread=true */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await many(
    `SELECT * FROM notifications WHERE user_id=$1
       ${req.query.unread === 'true' ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC LIMIT 50`, [req.user.id]
  );
  const unread = (await one(
    `SELECT count(*)::int AS c FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [req.user.id]
  )).c;
  res.json({ notifications: rows, unread });
}));

/** POST /api/notifications/read-all */
router.post('/read-all', asyncHandler(async (req, res) => {
  await query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, [req.user.id]);
  res.json({ ok: true });
}));

/** POST /api/notifications/:id/read */
router.post('/:id/read', asyncHandler(async (req, res) => {
  await query(`UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

/** POST /api/notifications/subscribe — web push registration */
router.post('/subscribe', validate(z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(4) }),
})), asyncHandler(async (req, res) => {
  if (!enabled) return res.status(503).json({ error: 'Web push is not configured on this server (set VAPID keys).' });
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth`,
    [req.user.id, req.body.endpoint, req.body.keys.p256dh, req.body.keys.auth]
  );
  res.json({ ok: true });
}));

/** POST /api/notifications/test — send self test push */
router.post('/test', asyncHandler(async (req, res) => {
  const result = await pushToUser(req.user.id, {
    title: 'Sawaari notifications are on ✅',
    body: 'You will receive ride and payment updates here.',
    url: '/app',
  });
  res.json(result);
}));

module.exports = router;
