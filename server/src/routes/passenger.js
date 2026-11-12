const express = require('express');
const { z } = require('zod');
const { query, one, many } = require('../db');
const { requireAuth, role } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, httpError } = require('../utils');

const router = express.Router();
router.use(requireAuth, role('passenger'));

/** GET /api/passenger/saved-locations → /api/saved-locations alias handled below */

/** GET /api/saved-locations (mounted at /api) */
function savedLocationsRouter() {
  const r = express.Router();
  r.use(requireAuth);

  r.get('/', asyncHandler(async (req, res) => {
    res.json(await many(
      `SELECT * FROM saved_locations WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]
    ));
  }));

  r.post('/', validate(z.object({
    label: z.string().trim().min(1).max(60),
    address: z.string().trim().min(2).max(300),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  })), asyncHandler(async (req, res) => {
    const { rows } = await query(
      `INSERT INTO saved_locations (user_id, label, address, lat, lng) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, req.body.label, req.body.address, req.body.lat, req.body.lng]
    );
    res.status(201).json(rows[0]);
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    await query(`DELETE FROM saved_locations WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  return r;
}

module.exports = savedLocationsRouter;
