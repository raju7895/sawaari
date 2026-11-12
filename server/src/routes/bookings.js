const express = require('express');
const { z } = require('zod');
const { query, one, many } = require('../db');
const { requireAuth, role } = require('../middleware/auth');
const { validate, validateQuery } = require('../middleware/validate');
const { asyncHandler, httpError } = require('../utils');
const rides = require('../services/rides');
const { notifyAdmins, notify } = require('../services/notify');
const { getSettings } = require('../services/settings');

const router = express.Router();

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(2).max(300),
});

/** GET /api/bookings/nearby-drivers?lat=&lng=&radiusKm=&vehicleType= */
router.get('/nearby-drivers', requireAuth, validateQuery(z.object({
  lat: z.coerce.number(), lng: z.coerce.number(),
  radiusKm: z.coerce.number().min(0.5).max(50).optional(),
  vehicleType: z.enum(['auto', 'e_rickshaw']).optional(),
})), asyncHandler(async (req, res) => {
  const drivers = await rides.nearbyDrivers(
    req.query.lat, req.query.lng, req.query.radiusKm, req.query.vehicleType
  );
  res.json({ drivers, count: drivers.length });
}));

/** POST /api/bookings/quote — road distance + fare breakdown */
router.post('/quote', requireAuth, validate(z.object({
  pickup: pointSchema, drop: pointSchema,
  vehicleType: z.enum(['auto', 'e_rickshaw']).default('auto'),
  scheduledAt: z.string().datetime().optional(),
})), asyncHandler(async (req, res) => {
  const q = await rides.quote({
    pickupLat: req.body.pickup.lat, pickupLng: req.body.pickup.lng,
    dropLat: req.body.drop.lat, dropLng: req.body.drop.lng,
    vehicleType: req.body.vehicleType, scheduledAt: req.body.scheduledAt,
  });
  res.json({
    city: { id: q.city.id, name: q.city.name, state: q.city.state },
    distanceKm: q.route.distanceKm, durationMin: q.route.durationMin,
    geometry: q.route.geometry, fare: q.fare,
    routeSource: q.route.source || 'road',
  });
}));

/** POST /api/bookings — create booking (immediate / scheduled / custom) */
router.post('/', requireAuth, role('passenger'), validate(z.object({
  pickup: pointSchema, drop: pointSchema,
  vehicleType: z.enum(['auto', 'e_rickshaw']).default('auto'),
  bookingType: z.enum(['immediate', 'scheduled', 'custom']).default('immediate'),
  scheduledAt: z.string().datetime().optional(),
})), asyncHandler(async (req, res) => {
  if (req.body.bookingType === 'scheduled' && !req.body.scheduledAt)
    throw httpError(400, 'scheduledAt is required for scheduled bookings');
  if (req.body.bookingType === 'scheduled' && new Date(req.body.scheduledAt) < new Date())
    throw httpError(400, 'Scheduled time must be in the future');

  const active = await one(
    `SELECT id FROM bookings WHERE passenger_id=$1 AND status IN ('scheduled','searching','assigned','arriving','arrived','in_progress')`,
    [req.user.id]
  );
  if (active) throw httpError(409, 'You already have an active ride.', { bookingId: active.id });

  const booking = await rides.createBooking(req.user, {
    pickupLat: req.body.pickup.lat, pickupLng: req.body.pickup.lng,
    pickupAddress: req.body.pickup.address,
    dropLat: req.body.drop.lat, dropLng: req.body.drop.lng,
    dropAddress: req.body.drop.address,
    vehicleType: req.body.vehicleType, bookingType: req.body.bookingType,
    scheduledAt: req.body.scheduledAt,
  });
  res.status(201).json(await rides.serializeBooking(booking, req.user));
}));

/** GET /api/bookings/mine — list my bookings (role-aware) */
router.get('/mine', requireAuth, validateQuery(z.object({
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
})), asyncHandler(async (req, res) => {
  const driverProfile = req.user.role === 'driver'
    ? await one(`SELECT id FROM driver_profiles WHERE user_id=$1`, [req.user.id]) : null;
  const cond = req.query.status ? `AND b.status = $3` : '';
  const params = req.query.status
    ? [req.user.id, driverProfile?.id, req.query.status, req.query.limit, req.query.offset]
    : [req.user.id, driverProfile?.id, req.query.limit, req.query.offset];
  const rows = await many(
    `SELECT b.*, dp.user_id AS driver_user_id FROM bookings b
     LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id
     WHERE (b.passenger_id = $1 OR ($2::uuid IS NOT NULL AND b.driver_profile_id = $2))
       ${cond}
     ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = (await one(
    `SELECT count(*)::int AS c FROM bookings b
     WHERE (b.passenger_id = $1 OR ($2::uuid IS NOT NULL AND b.driver_profile_id = $2))
       ${req.query.status ? 'AND b.status = $3' : ''}`,
    req.query.status ? [req.user.id, driverProfile?.id, req.query.status] : [req.user.id, driverProfile?.id]
  )).c;
  res.json({
    bookings: await Promise.all(rows.map((b) => rides.serializeBooking(b, req.user))),
    total,
  });
}));

/** GET /api/bookings/active — current active ride */
router.get('/active', requireAuth, asyncHandler(async (req, res) => {
  const driverProfile = req.user.role === 'driver'
    ? await one(`SELECT id FROM driver_profiles WHERE user_id=$1`, [req.user.id]) : null;
  const b = await one(
    `SELECT b.*, dp.user_id AS driver_user_id FROM bookings b
     LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id
     WHERE (b.passenger_id=$1 OR ($2::uuid IS NOT NULL AND b.driver_profile_id=$2))
       AND b.status IN ('scheduled','searching','assigned','arriving','arrived','in_progress')
     ORDER BY b.created_at DESC LIMIT 1`,
    [req.user.id, driverProfile?.id]
  );
  res.json({ booking: b ? await rides.serializeBooking(b, req.user) : null });
}));

/** GET /api/bookings/:id */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const b = await rides.getBooking(req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  const isDriver = b.driver_user_id === req.user.id;
  if (b.passenger_id !== req.user.id && !isDriver && req.user.role !== 'admin')
    throw httpError(403, 'You cannot view this booking');
  res.json(await rides.serializeBooking(b, req.user));
}));

/** POST /api/bookings/:id/cancel */
router.post('/:id/cancel', requireAuth, validate(z.object({
  reason: z.string().trim().min(3).max(300),
})), asyncHandler(async (req, res) => {
  const b = await rides.getBooking(req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  const isDriver = b.driver_user_id === req.user.id;
  if (b.passenger_id !== req.user.id && !isDriver && req.user.role !== 'admin')
    throw httpError(403, 'You cannot cancel this booking');
  const byRole = isDriver ? 'driver' : (b.passenger_id === req.user.id ? 'passenger' : 'admin');
  res.json(await rides.cancelRide(b, { byUserId: req.user.id, byRole, reason: req.body.reason }));
}));

/** GET /api/bookings/:id/events — status timeline */
router.get('/:id/events', requireAuth, asyncHandler(async (req, res) => {
  const b = await rides.getBooking(req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  const isDriver = b.driver_user_id === req.user.id;
  if (b.passenger_id !== req.user.id && !isDriver && req.user.role !== 'admin')
    throw httpError(403, 'You cannot view this booking');
  const events = await many(
    `SELECT e.status, e.note, e.created_at, u.name AS actor_name FROM ride_events e
     LEFT JOIN users u ON u.id = e.actor_id WHERE e.booking_id=$1 ORDER BY e.created_at`, [b.id]
  );
  res.json(events);
}));

/** GET /api/bookings/:id/chat */
router.get('/:id/chat', requireAuth, asyncHandler(async (req, res) => {
  const b = await rides.getBooking(req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  const isDriver = b.driver_user_id === req.user.id;
  if (b.passenger_id !== req.user.id && !isDriver && req.user.role !== 'admin')
    throw httpError(403, 'Not allowed');
  const messages = await many(
    `SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name, u.avatar_url
     FROM booking_messages m JOIN users u ON u.id = m.sender_id
     WHERE m.booking_id=$1 ORDER BY m.created_at LIMIT 200`, [b.id]
  );
  res.json(messages);
}));

/** POST /api/bookings/:id/chat — REST fallback for socket chat */
router.post('/:id/chat', requireAuth, validate(z.object({ body: z.string().trim().min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const b = await rides.getBooking(req.params.id);
    if (!b) throw httpError(404, 'Booking not found');
    const isDriver = b.driver_user_id === req.user.id;
    if (b.passenger_id !== req.user.id && !isDriver)
      throw httpError(403, 'Not allowed');
    const { rows } = await query(
      `INSERT INTO booking_messages (booking_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *`,
      [b.id, req.user.id, req.body.body]
    );
    const socket = require('../socket');
    socket.emitToBooking(b.id, 'chat:message', rows[0]);
    res.status(201).json(rows[0]);
  }));

/** POST /api/bookings/:id/review — rate the other party */
router.post('/:id/review', requireAuth, validate(z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
})), asyncHandler(async (req, res) => {
  const b = await rides.getBooking(req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  const isDriver = b.driver_user_id === req.user.id;
  if (b.passenger_id !== req.user.id && !isDriver)
    throw httpError(403, 'Only ride participants can review');
  if (b.status !== 'completed') throw httpError(409, 'You can review after the ride is completed');
  const existing = await one(`SELECT id FROM reviews WHERE booking_id=$1`, [b.id]);
  if (existing) throw httpError(409, 'This ride has already been reviewed');

  const revieweeId = isDriver ? b.passenger_id : b.driver_user_id;
  const { rows } = await query(
    `INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, rating, comment)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [b.id, req.user.id, revieweeId, req.body.rating, req.body.comment || null]
  );
  // update aggregates
  if (isDriver) {
    await query(
      `UPDATE passenger_profiles pp SET
         rating_avg = ((pp.rating_avg * pp.rating_count) + $2) / (pp.rating_count + 1),
         rating_count = pp.rating_count + 1
       WHERE pp.user_id = $1`, [revieweeId, req.body.rating]);
  } else {
    await query(
      `UPDATE driver_profiles dp SET
         rating_avg = ((dp.rating_avg * dp.rating_count) + $2) / (dp.rating_count + 1),
         rating_count = dp.rating_count + 1
       WHERE dp.id = $1`, [b.driver_profile_id, req.body.rating]);
  }
  await notify(revieweeId, {
    type: 'new_review', title: 'New review received',
    body: `You received a ${req.body.rating}★ rating${req.body.comment ? `: “${req.body.comment}”` : ''}.`,
    data: { bookingId: b.id },
  });
  res.status(201).json(rows[0]);
}));

/** POST /api/bookings/:id/sos — emergency alert */
router.post('/:id/sos', requireAuth, asyncHandler(async (req, res) => {
  const b = await rides.getBooking(req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  const isDriver = b.driver_user_id === req.user.id;
  if (b.passenger_id !== req.user.id && !isDriver)
    throw httpError(403, 'Only ride participants can raise SOS');
  const settings = await getSettings();
  const { rows } = await query(
    `INSERT INTO sos_alerts (booking_id, user_id, lat, lng)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [b.id, req.user.id, req.body?.lat ?? b.pickup_lat, req.body?.lng ?? b.pickup_lng]
  );
  await notifyAdmins({
    type: 'sos', title: '🚨 SOS ALERT',
    body: `SOS raised on ride ${b.ref} by ${req.user.name} (${req.user.phone}). Location on the alert.`,
    data: { bookingId: b.id, url: `/admin/sos`, sosId: rows[0].id },
  });
  res.status(201).json({
    alert: rows[0],
    emergencyNumber: settings.sos_number || '112',
    message: 'Alert sent to Sawaari safety team. Call emergency services if you are in danger.',
  });
}));

/** GET /api/bookings/share/:token — public live trip view (minimal data) */
router.get('/share/:token', asyncHandler(async (req, res) => {
  const b = await one(
    `SELECT b.*, dp.user_id AS driver_user_id FROM bookings b
     LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id
     WHERE b.share_token = $1`, [req.params.token]
  );
  if (!b) throw httpError(404, 'Trip not found');
  let driverName = null, vehicle = null, driverPhone = null, driverLoc = null;
  if (b.driver_profile_id) {
    const d = await one(
      `SELECT u.name, u.phone, v.registration_number, v.vehicle_type FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
       LEFT JOIN vehicles v ON v.driver_profile_id = dp.id AND v.is_primary
       WHERE dp.id = $1`, [b.driver_profile_id]
    );
    driverName = d ? d.name.split(' ')[0] : null;
    driverPhone = d?.phone;
    vehicle = d ? { registrationNumber: d.registration_number, vehicleType: d.vehicle_type } : null;
    const loc = await one(
      `SELECT lat, lng, heading FROM driver_locations WHERE driver_profile_id=$1
        AND updated_at > now() - interval '2 minutes'`, [b.driver_profile_id]
    );
    if (loc) driverLoc = { lat: parseFloat(loc.lat), lng: parseFloat(loc.lng), heading: loc.heading ? parseFloat(loc.heading) : null };
  }
  res.json({
    ref: b.ref, status: b.status,
    pickup: { lat: parseFloat(b.pickup_lat), lng: parseFloat(b.pickup_lng), address: b.pickup_address },
    drop: { lat: parseFloat(b.drop_lat), lng: parseFloat(b.drop_lng), address: b.drop_address },
    distanceKm: parseFloat(b.distance_km),
    startedAt: b.started_at, completedAt: b.completed_at,
    driverFirstName: driverName, driverPhone, vehicle, driverLoc,
  });
}));

module.exports = router;
