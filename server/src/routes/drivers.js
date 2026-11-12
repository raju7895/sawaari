const express = require('express');
const { z } = require('zod');
const { query, one, many } = require('../db');
const { requireAuth, role, requireDriverProfile } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, httpError, round2 } = require('../utils');
const { upload } = require('../middleware/upload');
const rides = require('../services/rides');
const { notify } = require('../services/notify');
const { getSettings } = require('../services/settings');
const { isValidVpa } = require('../services/upi');

const router = express.Router();
router.use(requireAuth, role('driver'), requireDriverProfile);

/** GET /api/driver/me — profile, vehicle, docs, stats */
router.get('/me', asyncHandler(async (req, res) => {
  const dp = await one(
    `SELECT dp.*, u.name, u.phone, u.email, u.avatar_url FROM driver_profiles dp
     JOIN users u ON u.id = dp.user_id WHERE dp.id = $1`, [req.driverProfile.id]
  );
  const vehicle = await one(
    `SELECT * FROM vehicles WHERE driver_profile_id=$1 ORDER BY created_at LIMIT 1`, [req.driverProfile.id]
  );
  const docs = await many(
    `SELECT id, doc_type, file_url, doc_number, status, review_note, created_at
     FROM driver_documents WHERE driver_profile_id=$1 ORDER BY created_at`, [req.driverProfile.id]
  );
  const today = (await one(
    `SELECT COALESCE(SUM(net),0)::numeric AS net, COUNT(*)::int AS rides
       FROM driver_earnings de JOIN bookings b ON b.id = de.booking_id
      WHERE de.driver_profile_id=$1 AND b.completed_at::date = CURRENT_DATE`,
    [req.driverProfile.id]
  ));
  const lastLoc = await one(
    `SELECT lat, lng, heading, accuracy_m, updated_at FROM driver_locations WHERE driver_profile_id=$1`,
    [req.driverProfile.id]
  );
  res.json({
    id: dp.id, userId: dp.user_id, name: dp.name, phone: dp.phone, email: dp.email, avatarUrl: dp.avatar_url,
    verificationStatus: dp.verification_status, rejectionReason: dp.rejection_reason,
    isOnline: dp.is_online, onRide: Boolean(dp.current_booking_id),
    upiId: dp.upi_id, upiVerified: dp.upi_verified,
    rating: { avg: parseFloat(dp.rating_avg), count: dp.rating_count },
    ridesCompleted: dp.rides_completed, ridesCancelled: dp.rides_cancelled,
    totalEarnings: parseFloat(dp.total_earnings),
    todayEarnings: parseFloat(today.net), todayRides: today.rides,
    lastLocation: lastLoc
      ? { lat: parseFloat(lastLoc.lat), lng: parseFloat(lastLoc.lng), heading: lastLoc.heading, updatedAt: lastLoc.updated_at }
      : null,
    vehicle: vehicle ? {
      id: vehicle.id, registrationNumber: vehicle.registration_number,
      vehicleType: vehicle.vehicle_type, model: vehicle.model,
      capacity: vehicle.capacity, photoUrl: vehicle.photo_url,
    } : null,
    documents: docs,
  });
}));

/** POST /api/driver/vehicle — add/update primary vehicle */
router.post('/vehicle', validate(z.object({
  registrationNumber: z.string().trim().regex(/^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{0,3}\s?[0-9]{4}$/i, 'Enter a valid Indian registration number (e.g. KA 05 AB 1234)'),
  vehicleType: z.enum(['auto', 'e_rickshaw']),
  model: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().min(1).max(8).default(3),
})), asyncHandler(async (req, res) => {
  const reg = req.body.registrationNumber.toUpperCase().replace(/\s+/g, ' ');
  const dup = await one(`SELECT id FROM vehicles WHERE registration_number=$1`, [reg]);
  if (dup) {
    const owner = await one(`SELECT driver_profile_id FROM vehicles WHERE id=$1`, [dup.id]);
    if (owner.driver_profile_id !== req.driverProfile.id)
      throw httpError(409, 'This vehicle registration number is already registered.');
  }
  await query(
    `INSERT INTO vehicles (driver_profile_id, registration_number, vehicle_type, model, capacity)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (registration_number) DO UPDATE SET
       vehicle_type=EXCLUDED.vehicle_type, model=EXCLUDED.model, capacity=EXCLUDED.capacity`,
    [req.driverProfile.id, reg, req.body.vehicleType, req.body.model || null, req.body.capacity]
  );
  res.status(201).json({ ok: true });
}));

/** POST /api/driver/vehicle/photo */
router.post('/vehicle/photo',
  (req, _res, next) => { req.uploadKind = 'vehicles'; next(); },
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, 'Attach an image');
    const url = `/uploads/vehicles/${req.file.filename}`;
    await query(`UPDATE vehicles SET photo_url=$2 WHERE driver_profile_id=$1 AND is_primary`,
      [req.driverProfile.id, url]);
    res.json({ ok: true, photoUrl: url });
  }));

/** POST /api/driver/documents — upload verification doc */
router.post('/documents',
  (req, _res, next) => { req.uploadKind = 'documents'; next(); },
  upload.single('file'),
  validate(z.object({
    docType: z.enum(['license', 'aadhaar', 'vehicle_rc', 'insurance', 'profile_photo']),
    docNumber: z.string().trim().max(40).optional(),
  })),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, 'Attach the scanned document');
    const url = `/uploads/documents/${req.file.filename}`;
    const { rows } = await query(
      `INSERT INTO driver_documents (driver_profile_id, doc_type, file_url, doc_number)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.driverProfile.id, req.body.docType, url, req.body.docNumber || null]
    );
    // reset verification status to pending so admins re-review
    await query(
      `UPDATE driver_profiles SET verification_status='pending', rejection_reason=NULL, updated_at=now()
       WHERE id=$1 AND verification_status='rejected'`, [req.driverProfile.id]);
    const { notifyAdmins } = require('../services/notify');
    await notifyAdmins({
      type: 'driver_docs', title: 'Driver document uploaded',
      body: `${req.user.name} uploaded ${req.body.docType.replace('_', ' ')} for verification.`,
      data: { url: '/admin/drivers' },
    });
    res.status(201).json(rows[0]);
  }));

/** POST /api/driver/online — availability toggle */
router.post('/online', validate(z.object({ online: z.boolean() })), asyncHandler(async (req, res) => {
  if (req.body.online) {
    if (req.driverProfile.verification_status !== 'approved')
      throw httpError(403, 'Your account must be verified and approved before going online.');
    if (req.driverProfile.current_booking_id)
      throw httpError(409, 'Finish your active ride first.');
  }
  await query(`UPDATE driver_profiles SET is_online=$2, updated_at=now() WHERE id=$1`,
    [req.driverProfile.id, req.body.online]);
  if (req.body.online) {
    const loc = await one(`SELECT lat, lng FROM driver_locations WHERE driver_profile_id=$1`, [req.driverProfile.id]);
    if (!loc) {
      const city = await one(`SELECT center_lat, center_lng FROM cities WHERE is_active ORDER BY name LIMIT 1`);
      if (city) await query(
        `INSERT INTO driver_locations (driver_profile_id, lat, lng) VALUES ($1,$2,$3)`,
        [req.driverProfile.id, city.center_lat, city.center_lng]);
    }
  }
  res.json({ ok: true, online: req.body.online });
}));

/** POST /api/driver/location — REST heartbeat (socket is preferred) */
router.post('/location', validate(z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  heading: z.number().optional(), accuracy: z.number().optional(),
})), asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO driver_locations (driver_profile_id, lat, lng, heading, accuracy_m)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (driver_profile_id) DO UPDATE
       SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, heading=EXCLUDED.heading,
           accuracy_m=EXCLUDED.accuracy_m, updated_at=now()`,
    [req.driverProfile.id, req.body.lat, req.body.lng, req.body.heading ?? null, req.body.accuracy ?? null]
  );
  if (req.driverProfile.current_booking_id) {
    const socket = require('../socket');
    socket.emitToBooking(req.driverProfile.current_booking_id, 'ride:driver-location', {
      lat: req.body.lat, lng: req.body.lng, heading: req.body.heading ?? null, at: Date.now(),
    });
  }
  res.json({ ok: true });
}));

/** GET /api/driver/requests — open requests this driver can accept right now.
 *  Mirrors the `ride:request` socket payload so both paths behave the same. */
router.get('/requests', asyncHandler(async (req, res) => {
  res.json({ requests: await rides.availableRequests(req.driverProfile) });
}));

/** POST /api/driver/rides/:id/accept */
router.post('/rides/:id/accept', asyncHandler(async (req, res) => {
  res.json(await rides.acceptRide(req.driverProfile, req.params.id));
}));

/** POST /api/driver/rides/:id/reject */
router.post('/rides/:id/reject', asyncHandler(async (req, res) => {
  const b = await rides.getBooking(req.params.id);
  if (!b || b.driver_profile_id) return res.json({ ok: true });
  // reject = simply don't accept; the request disappears client-side.
  res.json({ ok: true });
}));

/** POST /api/driver/rides/:id/:action(arriving|arrived|start|complete|cancel) */
router.post('/rides/:id/:action', validate(z.object({
  rideOtp: z.string().regex(/^\d{4}$/).optional(),
})), asyncHandler(async (req, res) => {
  const action = req.params.action;
  if (!['arriving', 'arrived', 'start', 'complete', 'cancel'].includes(action))
    throw httpError(400, 'Unknown action');
  res.json(await rides.driverAction(req.driverProfile, req.params.id, action, { rideOtp: req.body.rideOtp }));
}));

/** GET /api/driver/rides?status= */
router.get('/rides', asyncHandler(async (req, res) => {
  const status = req.query.status;
  const rows = await many(
    `SELECT b.*, dp.user_id AS driver_user_id FROM bookings b
     JOIN driver_profiles dp ON dp.id = b.driver_profile_id
     WHERE b.driver_profile_id = $1 ${status ? 'AND b.status=$2' : ''}
     ORDER BY b.created_at DESC LIMIT 50`,
    status ? [req.driverProfile.id, status] : [req.driverProfile.id]
  );
  res.json({ bookings: await Promise.all(rows.map((b) => rides.serializeBooking(b, req.user))) });
}));

/** GET /api/driver/earnings?range=day|week|month */
router.get('/earnings', asyncHandler(async (req, res) => {
  const range = ['day', 'week', 'month'].includes(req.query.range) ? req.query.range : 'week';
  const interval = range === 'day' ? '1 day' : range === 'week' ? '7 days' : '30 days';
  const rows = await many(
    `SELECT de.*, b.ref, b.final_fare, b.pickup_address, b.drop_address, b.completed_at
       FROM driver_earnings de JOIN bookings b ON b.id = de.booking_id
      WHERE de.driver_profile_id = $1 AND de.created_at > now() - interval '${interval}'
      ORDER BY de.created_at DESC`, [req.driverProfile.id]
  );
  const summary = await one(
    `SELECT COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(commission),0) AS commission,
            COALESCE(SUM(net),0) AS net, COUNT(*)::int AS rides
       FROM driver_earnings de
      WHERE de.driver_profile_id = $1 AND de.created_at > now() - interval '${interval}'`,
    [req.driverProfile.id]
  );
  const daily = await many(
    `SELECT date_trunc('day', de.created_at)::date AS day,
            SUM(de.net)::numeric AS net, COUNT(*)::int AS rides
       FROM driver_earnings de
      WHERE de.driver_profile_id=$1 AND de.created_at > now() - interval '30 days'
      GROUP BY 1 ORDER BY 1`, [req.driverProfile.id]
  );
  res.json({
    range,
    summary: {
      gross: round2(parseFloat(summary.gross)), commission: round2(parseFloat(summary.commission)),
      net: round2(parseFloat(summary.net)), rides: summary.rides,
    },
    records: rows.map((r) => ({
      id: r.id, ref: r.ref, gross: parseFloat(r.gross), commission: parseFloat(r.commission),
      net: parseFloat(r.net), from: r.pickup_address, to: r.drop_address, completedAt: r.completed_at,
    })),
    daily: daily.map((d) => ({ day: d.day, net: parseFloat(d.net), rides: d.rides })),
  });
}));

/** GET /api/driver/reviews */
router.get('/reviews', asyncHandler(async (req, res) => {
  const rows = await many(
    `SELECT r.rating, r.comment, r.created_at, u.name AS reviewer_name
       FROM reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.reviewee_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [req.user.id]
  );
  res.json(rows);
}));

/** POST /api/driver/upi — set payment VPA */
router.post('/upi', validate(z.object({ upiId: z.string().trim() })), asyncHandler(async (req, res) => {
  if (!isValidVpa(req.body.upiId))
    throw httpError(400, 'Invalid UPI ID format (e.g. name@bank).');
  const upiId = req.body.upiId.toLowerCase();
  const current = await one(`SELECT upi_id, upi_verified FROM driver_profiles WHERE id=$1`, [req.driverProfile.id]);

  /* Re-saving the same VPA must not throw away an existing verification —
     only a *changed* UPI ID has to go back to the admin. */
  if (current && current.upi_id === upiId) {
    return res.json({
      ok: true,
      message: current.upi_verified
        ? 'UPI ID unchanged — it stays verified.'
        : 'UPI ID unchanged — an admin will verify it before QR payments are enabled.',
      upiVerified: current.upi_verified,
    });
  }

  await query(
    `UPDATE driver_profiles SET upi_id=$2, upi_verified=false, updated_at=now() WHERE id=$1`,
    [req.driverProfile.id, upiId]
  );
  const { notifyAdmins } = require('../services/notify');
  await notifyAdmins({
    type: 'upi_verification', title: 'Driver UPI ID added',
    body: `${req.user.name} set UPI ID ${req.body.upiId}. Verify it before passengers can pay them by QR.`,
    data: { url: '/admin/drivers' },
  });
  res.json({ ok: true, message: 'UPI ID saved. An admin will verify it before QR payments are enabled.' });
}));

/** GET /api/driver/nearby-cities — for driver context */
router.get('/cities', asyncHandler(async (_req, res) => {
  res.json(await many(`SELECT id, name, center_lat, center_lng FROM cities WHERE is_active ORDER BY name`));
}));

module.exports = router;
