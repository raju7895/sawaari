const express = require('express');
const { z } = require('zod');
const { query, one, many, withTransaction } = require('../db');
const { requireAuth, role } = require('../middleware/auth');
const { validate, validateQuery } = require('../middleware/validate');
const { asyncHandler, httpError, round2, rowsToCsv } = require('../utils');
const settingsSvc = require('../services/settings');
const ridesSvc = require('../services/rides');
const razorpaySvc = require('../services/razorpay');
const { notify } = require('../services/notify');
const rbac = require('../services/rbac');
const auditSvc = require('../services/audit');

const router = express.Router();
router.use(requireAuth, role(...rbac.ADMIN_ROLES));

/* Every administrative action lands in the append-only audit log
   (admin_audit_log refuses UPDATE/DELETE at the database level).
   The legacy admin_actions table is kept in sync for older tooling. */
const audit = async (req, action, target, details = {}) => {
  const ctx = auditSvc.ctxFrom(req);
  await auditSvc.record(ctx, action, {
    targetType: target ? target.split(':')[0] : null,
    targetId: target ? target.split(':').slice(1).join(':') : null,
    targetLabel: target || null,
    newValue: details,
  });
  await query(`INSERT INTO admin_actions (admin_id, action, target, details) VALUES ($1,$2,$3,$4)`,
    [ctx.adminId, action, target, JSON.stringify(details)]).catch(() => {});
};

/* ── OVERVIEW ─────────────────────────────────────────────── */
router.get('/overview', rbac.requirePermission('analytics.view'), asyncHandler(async (_req, res) => {
  const [users, drivers, pendingDrivers, bookings, activeRides, today, revenue, paymentsPending, openSos, openTickets, byCity] =
    await Promise.all([
      one(`SELECT count(*) FILTER (WHERE role='passenger')::int AS passengers,
                 count(*) FILTER (WHERE role='driver')::int AS drivers,
                 count(*)::int AS total FROM users WHERE is_active`),
      one(`SELECT count(*) FILTER (WHERE verification_status='approved')::int AS approved,
                 count(*) FILTER (WHERE is_online AND current_booking_id IS NULL)::int AS online
          FROM driver_profiles`),
      one(`SELECT count(*)::int AS c FROM driver_profiles WHERE verification_status='pending'`),
      one(`SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
                 count(*) FILTER (WHERE status='completed')::int AS completed FROM bookings`),
      one(`SELECT count(*)::int AS c FROM bookings
           WHERE status IN ('searching','assigned','arriving','arrived','in_progress','scheduled')`),
      one(`SELECT count(*)::int AS bookings FROM bookings WHERE created_at::date = CURRENT_DATE`),
      one(`SELECT COALESCE(SUM(commission),0)::numeric AS c FROM driver_earnings`),
      one(`SELECT count(*)::int AS c FROM payments WHERE status IN ('pending','awaiting_verification')`),
      one(`SELECT count(*)::int AS c FROM sos_alerts WHERE status='open'`),
      one(`SELECT count(*)::int AS c FROM support_tickets WHERE status IN ('open','in_progress')`),
      many(`SELECT ci.name, count(b.id)::int AS bookings FROM cities ci
            LEFT JOIN bookings b ON b.city_id = ci.id GROUP BY ci.name ORDER BY bookings DESC`),
    ]);
  res.json({
    users: { passengers: users.passengers, drivers: users.drivers, total: users.total },
    drivers: { approved: drivers.approved, online: drivers.online, pendingVerification: pendingDrivers.c },
    bookings: { total: bookings.total, completed: bookings.completed, cancelled: bookings.cancelled, active: activeRides.c, today: today.bookings },
    revenue: { totalCommission: round2(parseFloat(revenue.c)) },
    payments: { pendingVerification: paymentsPending.c },
    sos: { open: openSos.c },
    tickets: { open: openTickets.c },
    byCity,
  });
}));

/* ── USERS ────────────────────────────────────────────────── */
router.get('/users', rbac.requirePermission('users.view'), validateQuery(z.object({
  q: z.string().optional(), roleF: z.enum(['passenger', 'driver', 'admin']).optional(),
  blocked: z.enum(['true', 'false']).optional(),
  from: z.string().optional(), to: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25), offset: z.coerce.number().min(0).default(0),
})), asyncHandler(async (req, res) => {
  const { q, roleF, blocked, from, to, limit, offset } = req.query;
  const rows = await many(
    `SELECT u.id, u.role, u.name, u.phone, u.email, u.is_active, u.blocked_reason, u.created_at,
            u.deactivated_at, u.email_verified_at, u.phone_verified,
            (SELECT count(*)::int FROM bookings b WHERE b.passenger_id = u.id) AS rides
       FROM users u
      WHERE ($1 = '' OR u.name ILIKE '%'||$1||'%' OR u.phone ILIKE '%'||$1||'%' OR COALESCE(u.email,'') ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR u.role = $2)
        AND ($3::text IS NULL OR u.is_active::text = $3)
        AND ($6::timestamptz IS NULL OR u.created_at >= $6::timestamptz)
        AND ($7::timestamptz IS NULL OR u.created_at <= $7::timestamptz)
      ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
    [q || '', roleF || null, blocked || null, limit, offset, from || null, to || null]
  );
  const total = (await one(
    `SELECT count(*)::int AS c FROM users u
      WHERE ($1 = '' OR u.name ILIKE '%'||$1||'%' OR u.phone ILIKE '%'||$1||'%' OR COALESCE(u.email,'') ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR u.role = $2)
        AND ($3::text IS NULL OR u.is_active::text = $3)
        AND ($4::timestamptz IS NULL OR u.created_at >= $4::timestamptz)
        AND ($5::timestamptz IS NULL OR u.created_at <= $5::timestamptz)`,
    [q || '', roleF || null, blocked || null, from || null, to || null]
  )).c;
  res.json({ users: rows, total });
}));

/* PATCH /api/admin/users/:id — edit the legally editable fields only */
router.patch('/users/:id', rbac.requirePermission('users.edit'), validate(z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
})), asyncHandler(async (req, res) => {
  const target = await one(`SELECT id, name, email, role FROM users WHERE id=$1`, [req.params.id]);
  if (!target) throw httpError(404, 'User not found');
  if (target.role === 'admin') throw httpError(403, 'Administrator accounts are managed from Admin Management.');

  const before = { name: target.name, email: target.email };
  const name = req.body.name ? req.body.name.trim() : target.name;
  const email = req.body.email === undefined ? target.email : (req.body.email.trim() || null);
  if (email && email !== target.email) {
    const clash = await one(`SELECT id FROM users WHERE email=$1 AND id <> $2`, [email, target.id]);
    if (clash) throw httpError(409, 'That email address is already in use.');
  }
  await query(`UPDATE users SET name=$2, email=$3, updated_at=now() WHERE id=$1`, [target.id, name, email]);
  await audit(req, 'user.updated', `user:${target.id}`, {
    previousValue: before, newValue: { name, email },
  });
  res.json({ ok: true, message: 'User details updated.' });
}));

router.post('/users/:id/block', rbac.requirePermission('users.block'), validate(z.object({
  blocked: z.boolean(), reason: z.string().trim().max(300).optional(),
})), asyncHandler(async (req, res) => {
  const target = await one(`SELECT id, role, name FROM users WHERE id=$1`, [req.params.id]);
  if (!target) throw httpError(404, 'User not found');
  if (rbac.ADMIN_ROLES.includes(target.role)) throw httpError(400, 'Cannot block an administrator account');
  const isOwner = await one(`SELECT is_owner FROM admin_profiles WHERE user_id=$1`, [req.params.id]);
  if (isOwner && isOwner.is_owner) throw httpError(403, 'The platform owner account cannot be blocked.');
  await query(`UPDATE users SET is_active=$2, blocked_reason=$3 WHERE id=$1`,
    [req.params.id, !req.body.blocked, req.body.blocked ? (req.body.reason || 'Blocked by admin') : null]);
  if (req.body.blocked) {
    await query(`UPDATE driver_profiles SET is_online=false WHERE user_id=$1`, [req.params.id]);
  }
  await audit(req, req.body.blocked ? 'block_user' : 'unblock_user', req.params.id, { reason: req.body.reason });
  await notify(req.params.id, {
    type: 'account_status', title: req.body.blocked ? 'Account blocked' : 'Account unblocked',
    body: req.body.blocked ? (req.body.reason || 'Your account was blocked by Sawaari support.') : 'Your account has been restored.',
  });
  res.json({ ok: true });
}));

/* ── DRIVERS & VERIFICATION ───────────────────────────────── */
router.get('/drivers', rbac.requirePermission('drivers.view'), validateQuery(z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25), offset: z.coerce.number().min(0).default(0),
})), asyncHandler(async (req, res) => {
  const { status, q, limit, offset } = req.query;
  const rows = await many(
    `SELECT dp.id, dp.verification_status, dp.rejection_reason, dp.is_online, dp.upi_id, dp.upi_verified,
            dp.rating_avg, dp.rides_completed, dp.rides_cancelled, dp.total_earnings, dp.reviewed_at,
            u.id AS user_id, u.name, u.phone, u.email, u.avatar_url, u.is_active, u.created_at,
            (SELECT count(*)::int FROM driver_documents dd WHERE dd.driver_profile_id = dp.id) AS doc_count,
            (SELECT count(*)::int FROM driver_documents dd WHERE dd.driver_profile_id = dp.id AND dd.status='verified') AS doc_verified,
            (SELECT json_build_object('registrationNumber', v.registration_number, 'vehicleType', v.vehicle_type, 'model', v.model)
              FROM vehicles v WHERE v.driver_profile_id = dp.id AND v.is_primary) AS vehicle
       FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
      WHERE ($1::text IS NULL OR dp.verification_status = $1)
        AND ($2 = '' OR u.name ILIKE '%'||$2||'%' OR u.phone ILIKE '%'||$2||'%')
      ORDER BY (dp.verification_status = 'pending') DESC, u.created_at DESC
      LIMIT $3 OFFSET $4`,
    [status || null, q || '', limit, offset]
  );
  const total = (await one(
    `SELECT count(*)::int AS c FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
      WHERE ($1::text IS NULL OR dp.verification_status = $1)
        AND ($2 = '' OR u.name ILIKE '%'||$2||'%' OR u.phone ILIKE '%'||$2||'%')`,
    [status || null, q || '']
  )).c;
  res.json({
    drivers: rows.map((d) => ({
      ...d, ratingAvg: parseFloat(d.rating_avg), totalEarnings: parseFloat(d.total_earnings),
      rating_avg: undefined, total_earnings: undefined,
    })), total,
  });
}));

router.get('/drivers/:id', rbac.requirePermission('drivers.view'), asyncHandler(async (req, res) => {
  const dp = await one(
    `SELECT dp.*, u.name, u.phone, u.email, u.avatar_url, u.is_active
       FROM driver_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.id = $1`, [req.params.id]
  );
  if (!dp) throw httpError(404, 'Driver not found');
  const docs = await many(
    `SELECT id, doc_type, file_url, doc_number, status, review_note, created_at
     FROM driver_documents WHERE driver_profile_id=$1`, [dp.id]
  );
  const vehicle = await one(`SELECT * FROM vehicles WHERE driver_profile_id=$1 AND is_primary`, [dp.id]);
  const earnings = await one(
    `SELECT COALESCE(SUM(net),0)::numeric AS net, COALESCE(SUM(commission),0)::numeric AS commission, COUNT(*)::int AS rides
       FROM driver_earnings WHERE driver_profile_id=$1`, [dp.id]
  );
  const recent = await many(
    `SELECT b.ref, b.status, b.final_fare, b.created_at FROM bookings b
      WHERE b.driver_profile_id=$1 ORDER BY b.created_at DESC LIMIT 10`, [dp.id]
  );
  res.json({
    id: dp.id, userId: dp.user_id, name: dp.name, phone: dp.phone, email: dp.email, avatarUrl: dp.avatar_url,
    isActive: dp.is_active, verificationStatus: dp.verification_status, rejectionReason: dp.rejection_reason,
    reviewedAt: dp.reviewed_at, isOnline: dp.is_online,
    upiId: dp.upi_id, upiVerified: dp.upi_verified,
    rating: { avg: parseFloat(dp.rating_avg), count: dp.rating_count },
    ridesCompleted: dp.rides_completed, ridesCancelled: dp.rides_cancelled,
    earnings: { net: parseFloat(earnings.net), commission: parseFloat(earnings.commission), rides: earnings.rides },
    vehicle: vehicle ? {
      registrationNumber: vehicle.registration_number, vehicleType: vehicle.vehicle_type,
      model: vehicle.model, capacity: vehicle.capacity, photoUrl: vehicle.photo_url,
    } : null,
    documents: docs, recentRides: recent.map((r) => ({ ...r, finalFare: r.final_fare ? parseFloat(r.final_fare) : null })),
  });
}));

/* PUT /api/admin/drivers/:id/vehicle — correct vehicle record (typos, wrong model) */
router.put('/drivers/:id/vehicle', rbac.requirePermission('drivers.manage'), validate(z.object({
  registrationNumber: z.string().trim().regex(/^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{0,3}\s?[0-9]{4}$/i, 'Enter a valid Indian registration number (e.g. KA 05 AB 1234)'),
  vehicleType: z.enum(['auto', 'e_rickshaw']),
  model: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().min(1).max(8).default(3),
})), asyncHandler(async (req, res) => {
  const dp = await one(
    `SELECT dp.id, dp.user_id, u.name FROM driver_profiles dp JOIN users u ON u.id=dp.user_id WHERE dp.id=$1`,
    [req.params.id]
  );
  if (!dp) throw httpError(404, 'Driver not found');
  const reg = req.body.registrationNumber.toUpperCase().replace(/\s+/g, ' ');
  const clash = await one(
    `SELECT id FROM vehicles WHERE registration_number=$1 AND driver_profile_id <> $2`, [reg, dp.id]
  );
  if (clash) throw httpError(409, 'That registration number belongs to another driver.');

  const before = await one(
    `SELECT registration_number, vehicle_type, model, capacity FROM vehicles WHERE driver_profile_id=$1 AND is_primary`,
    [dp.id]
  );
  const updated = await one(
    `UPDATE vehicles SET registration_number=$2, vehicle_type=$3, model=$4, capacity=$5, updated_at=now()
      WHERE driver_profile_id=$1 AND is_primary RETURNING *`,
    [dp.id, reg, req.body.vehicleType, req.body.model || null, req.body.capacity]
  );
  if (!updated) {
    await query(
      `INSERT INTO vehicles (driver_profile_id, registration_number, vehicle_type, model, capacity, is_primary)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [dp.id, reg, req.body.vehicleType, req.body.model || null, req.body.capacity]
    );
  }
  await audit(req, 'driver.vehicle_updated', `driver:${dp.id}`, {
    previousValue: before ? {
      registrationNumber: before.registration_number, vehicleType: before.vehicle_type,
      model: before.model, capacity: before.capacity,
    } : null,
    newValue: { registrationNumber: reg, vehicleType: req.body.vehicleType, model: req.body.model || null, capacity: req.body.capacity },
  });
  await notify(dp.user_id, {
    type: 'vehicle_updated', title: 'Vehicle details updated',
    body: `Your vehicle is now registered as ${reg}.`,
  });
  res.json({ ok: true, vehicle: updated, message: 'Vehicle details updated.' });
}));

router.post('/drivers/:id/approve', rbac.requirePermission('drivers.verify'), asyncHandler(async (req, res) => {
  const dp = await one(`SELECT dp.*, u.name FROM driver_profiles dp JOIN users u ON u.id=dp.user_id WHERE dp.id=$1`, [req.params.id]);
  if (!dp) throw httpError(404, 'Driver not found');
  const docs = await many(`SELECT status FROM driver_documents WHERE driver_profile_id=$1`, [dp.id]);
  const verified = docs.filter((d) => d.status === 'verified').length;
  if (docs.length === 0) throw httpError(400, 'Driver has not uploaded any documents yet.');
  if (verified < Math.ceil(docs.length / 2)) {
    throw httpError(400, `Verify the driver's documents first (${verified}/${docs.length} verified).`);
  }
  await query(
    `UPDATE driver_profiles SET verification_status='approved', rejection_reason=NULL,
            reviewed_by=$2, reviewed_at=now(), updated_at=now() WHERE id=$1`,
    [dp.id, req.user.id]
  );
  await audit(req, 'approve_driver', dp.id, {});
  await notify(dp.user_id, {
    type: 'driver_approved', title: 'You are approved! 🎉',
    body: 'Your driver account is verified. You can go online and start accepting rides.',
    data: { url: '/driver' },
  });
  res.json({ ok: true });
}));

router.post('/drivers/:id/reject', rbac.requirePermission('drivers.verify'), validate(z.object({
  reason: z.string().trim().min(5).max(500),
})), asyncHandler(async (req, res) => {
  const dp = await one(`SELECT * FROM driver_profiles WHERE id=$1`, [req.params.id]);
  if (!dp) throw httpError(404, 'Driver not found');
  await query(
    `UPDATE driver_profiles SET verification_status='rejected', rejection_reason=$3,
            is_online=false, reviewed_by=$2, reviewed_at=now(), updated_at=now() WHERE id=$1`,
    [dp.id, req.user.id, req.body.reason]
  );
  await audit(req, 'reject_driver', dp.id, { reason: req.body.reason });
  await notify(dp.user_id, {
    type: 'driver_rejected', title: 'Verification unsuccessful',
    body: `Reason: ${req.body.reason}. You can fix the issues and re-upload documents.`,
    data: { url: '/driver/profile' },
  });
  res.json({ ok: true });
}));

router.post('/drivers/:id/verify-upi', rbac.requirePermission('drivers.verify'), validate(z.object({ verified: z.boolean() })), asyncHandler(async (req, res) => {
  const dp = await one(`SELECT * FROM driver_profiles WHERE id=$1`, [req.params.id]);
  if (!dp) throw httpError(404, 'Driver not found');
  if (req.body.verified && !dp.upi_id) throw httpError(400, 'Driver has no UPI ID set');
  await query(`UPDATE driver_profiles SET upi_verified=$2 WHERE id=$1`, [dp.id, req.body.verified]);
  await audit(req, 'verify_driver_upi', dp.id, { upiId: dp.upi_id, verified: req.body.verified });
  await notify(dp.user_id, {
    type: 'upi_status', title: req.body.verified ? 'UPI ID verified' : 'UPI verification revoked',
    body: req.body.verified
      ? 'Your UPI ID is verified. Passengers can now pay you by scanning your QR.'
      : 'Your UPI ID needs re-verification. Please check it and set it again if needed.',
  });
  res.json({ ok: true });
}));

router.post('/documents/:id/review', rbac.requirePermission('drivers.verify'), validate(z.object({
  status: z.enum(['verified', 'rejected']), note: z.string().trim().max(300).optional(),
})), asyncHandler(async (req, res) => {
  const doc = await one(`SELECT * FROM driver_documents WHERE id=$1`, [req.params.id]);
  if (!doc) throw httpError(404, 'Document not found');
  await query(
    `UPDATE driver_documents SET status=$2, review_note=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1`,
    [doc.id, req.body.status, req.body.note || null, req.user.id]
  );
  const dp = await one(`SELECT user_id FROM driver_profiles WHERE id=$1`, [doc.driver_profile_id]);
  if (dp) await notify(dp.user_id, {
    type: 'doc_review', title: `Document ${req.body.status}`,
    body: `Your ${doc.doc_type.replace('_', ' ')} was ${req.body.status}. ${req.body.note || ''}`,
    data: { url: '/driver/profile' },
  });
  await audit(req, `document_${req.body.status}`, doc.id, { docType: doc.doc_type });
  res.json({ ok: true });
}));

/* ── BOOKINGS ─────────────────────────────────────────────── */
router.get('/bookings', rbac.requirePermission('bookings.view'), validateQuery(z.object({
  status: z.string().optional(), cityId: z.string().uuid().optional(),
  from: z.string().optional(), to: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25), offset: z.coerce.number().min(0).default(0),
})), asyncHandler(async (req, res) => {
  const { status, cityId, from, to, q, limit, offset } = req.query;
  const rows = await many(
    `SELECT b.*, pu.name AS passenger_name, pu.phone AS passenger_phone,
            du.name AS driver_name, du.phone AS driver_phone, ci.name AS city_name
       FROM bookings b
       LEFT JOIN users pu ON pu.id = b.passenger_id
       LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id
       LEFT JOIN users du ON du.id = dp.user_id
       LEFT JOIN cities ci ON ci.id = b.city_id
      WHERE ($1::text IS NULL OR b.status = $1)
        AND ($2::uuid IS NULL OR b.city_id = $2)
        AND ($3 = '' OR b.created_at >= $3::timestamptz)
        AND ($4 = '' OR b.created_at <= $4::timestamptz)
        AND ($5 = '' OR b.ref ILIKE '%'||$5||'%' OR b.pickup_address ILIKE '%'||$5||'%' OR b.drop_address ILIKE '%'||$5||'%'
             OR pu.phone ILIKE '%'||$5||'%' OR du.phone ILIKE '%'||$5||'%')
      ORDER BY b.created_at DESC LIMIT $6 OFFSET $7`,
    [status || null, cityId || null, from || '', to || '', q || '', limit, offset]
  );
  const total = (await one(
    `SELECT count(*)::int AS c
       FROM bookings b
       LEFT JOIN users pu ON pu.id = b.passenger_id
       LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id
       LEFT JOIN users du ON du.id = dp.user_id
      WHERE ($1::text IS NULL OR b.status = $1)
        AND ($2::uuid IS NULL OR b.city_id = $2)
        AND ($3 = '' OR b.created_at >= $3::timestamptz)
        AND ($4 = '' OR b.created_at <= $4::timestamptz)
        AND ($5 = '' OR b.ref ILIKE '%'||$5||'%' OR b.pickup_address ILIKE '%'||$5||'%' OR b.drop_address ILIKE '%'||$5||'%'
             OR pu.phone ILIKE '%'||$5||'%' OR du.phone ILIKE '%'||$5||'%')`,
    [status || null, cityId || null, from || '', to || '', q || '']
  )).c;
  res.json({
    bookings: rows.map((b) => ({
      id: b.id, ref: b.ref, status: b.status, bookingType: b.booking_type, city: b.city_name,
      passenger: { name: b.passenger_name, phone: b.passenger_phone },
      driver: b.driver_name ? { name: b.driver_name, phone: b.driver_phone } : null,
      pickupAddress: b.pickup_address, dropAddress: b.drop_address,
      distanceKm: parseFloat(b.distance_km), estimatedFare: parseFloat(b.estimated_fare),
      finalFare: b.final_fare ? parseFloat(b.final_fare) : null,
      paymentStatus: b.payment_status, cancellationReason: b.cancellation_reason,
      createdAt: b.created_at, completedAt: b.completed_at,
    })), total,
  });
}));

router.post('/bookings/:id/cancel', rbac.requirePermission('bookings.cancel'), validate(z.object({ reason: z.string().trim().min(3).max(300) })),
  asyncHandler(async (req, res) => {
    const b = await ridesSvc.getBooking(req.params.id);
    if (!b) throw httpError(404, 'Booking not found');
    res.json(await ridesSvc.cancelRide(b, { byUserId: req.user.id, byRole: 'admin', reason: req.body.reason }));
  }));

/* ── PAYMENTS & REFUNDS ───────────────────────────────────── */
router.get('/payments', rbac.requirePermission('payments.view'), validateQuery(z.object({
  status: z.string().optional(), method: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25), offset: z.coerce.number().min(0).default(0),
})), asyncHandler(async (req, res) => {
  const { status, method, q, limit, offset } = req.query;
  const rows = await many(
    `SELECT p.*, b.ref AS booking_ref, b.pickup_address, b.drop_address,
            pu.name AS passenger_name, du.name AS driver_name
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN users pu ON pu.id = p.passenger_id
       LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id
       LEFT JOIN users du ON du.id = dp.user_id
      WHERE ($1::text IS NULL OR p.status = $1)
        AND ($2::text IS NULL OR p.method = $2)
        AND ($3 = '' OR b.ref ILIKE '%'||$3||'%' OR COALESCE(p.passenger_utr,'') LIKE '%'||$3||'%'
             OR COALESCE(p.rzp_payment_id,'') ILIKE '%'||$3||'%')
      ORDER BY p.created_at DESC LIMIT $4 OFFSET $5`,
    [status || null, method || null, q || '', limit, offset]
  );
  const total = (await one(
    `SELECT count(*)::int AS c FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.method = $2)
        AND ($3 = '' OR b.ref ILIKE '%'||$3||'%' OR COALESCE(p.passenger_utr,'') LIKE '%'||$3||'%')`,
    [status || null, method || null, q || '']
  )).c;
  const sums = await one(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status='paid'),0)::numeric AS collected,
            COALESCE(SUM(refunded_amount),0)::numeric AS refunded
       FROM payments`
  );
  res.json({
    payments: rows.map((p) => ({
      id: p.id, bookingId: p.booking_id, bookingRef: p.booking_ref, method: p.method,
      amount: parseFloat(p.amount), status: p.status,
      passenger: { name: p.passenger_name }, driver: p.driver_name ? { name: p.driver_name } : null,
      utr: p.passenger_utr, rzpPaymentId: p.rzp_payment_id, rzpRefundId: p.rzp_refund_id,
      refundedAmount: parseFloat(p.refunded_amount), failureReason: p.failure_reason,
      verifiedAt: p.verified_at, createdAt: p.created_at,
      pickupAddress: p.pickup_address, dropAddress: p.drop_address,
    })),
    total,
    totals: { collected: round2(parseFloat(sums.collected)), refunded: round2(parseFloat(sums.refunded)) },
  });
}));

router.post('/payments/:id/verify', rbac.requirePermission('payments.verify'), asyncHandler(async (req, res) => {
  const p = await one(`SELECT * FROM payments WHERE id=$1`, [req.params.id]);
  if (!p) throw httpError(404, 'Payment not found');
  if (p.status === 'paid') return res.json({ ok: true, already: true });
  if (!['awaiting_verification', 'pending'].includes(p.status))
    throw httpError(409, `Cannot verify a payment in status "${p.status}".`);
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE payments SET status='paid', verified_at=now(), verified_by=$2 WHERE id=$1`, [p.id, req.user.id]);
    await tx.query(`UPDATE bookings SET payment_status='paid' WHERE id=$1`, [p.booking_id]);
  });
  await audit(req, 'verify_payment', p.id, { utr: p.passenger_utr });
  await notify(p.passenger_id, {
    type: 'payment_verified', title: 'Payment confirmed',
    body: `Your UPI payment for ride was verified. Thank you!`,
    data: { bookingId: p.booking_id, url: `/app/ride/${p.booking_id}` },
  });
  const b = await one(`SELECT dp.user_id AS driver_user_id FROM bookings b LEFT JOIN driver_profiles dp ON dp.id=b.driver_profile_id WHERE b.id=$1`, [p.booking_id]);
  if (b?.driver_user_id) await notify(b.driver_user_id, {
    type: 'payment_received', title: 'Payment received',
    body: `₹${p.amount} was verified for your ride.`,
    data: { bookingId: p.booking_id, url: '/driver' },
  });
  res.json({ ok: true });
}));

router.post('/payments/:id/reject', rbac.requirePermission('payments.verify'), validate(z.object({ reason: z.string().trim().min(3).max(300) })), asyncHandler(async (req, res) => {
  const p = await one(`SELECT * FROM payments WHERE id=$1`, [req.params.id]);
  if (!p) throw httpError(404, 'Payment not found');
  await query(`UPDATE payments SET status='failed', failure_reason=$3, updated_at=now() WHERE id=$1 AND status='awaiting_verification'`, [p.id, req.user.id, req.body.reason]);
  await audit(req, 'reject_payment', p.id, { reason: req.body.reason });
  await notify(p.passenger_id, {
    type: 'payment_rejected', title: 'Payment could not be verified',
    body: `${req.body.reason}. Please check the UTR or pay again.`,
    data: { bookingId: p.booking_id, url: `/app/ride/${p.booking_id}` },
  });
  res.json({ ok: true });
}));

router.post('/payments/:id/refund', rbac.requirePermission('payments.refund'), validate(z.object({
  amount: z.coerce.number().positive().optional(), reason: z.string().trim().min(3).max(300),
})), asyncHandler(async (req, res) => {
  const p = await one(`SELECT * FROM payments WHERE id=$1`, [req.params.id]);
  if (!p) throw httpError(404, 'Payment not found');
  if (p.status !== 'paid') throw httpError(409, 'Only verified payments can be refunded.');
  const amount = req.body.amount || parseFloat(p.amount);
  if (amount > parseFloat(p.amount)) throw httpError(400, 'Refund amount exceeds payment.');
  let refundId = null;
  if (p.method === 'online' && p.rzp_payment_id) {
    const refund = await razorpaySvc.refundPayment(p.rzp_payment_id, amount);
    refundId = refund.id;
  }
  await query(
    `UPDATE payments SET status='refunded', refunded_amount=$2, rzp_refund_id=COALESCE($3, rzp_refund_id),
            failure_reason=$4, updated_at=now() WHERE id=$1`,
    [p.id, amount, refundId, req.body.reason]
  );
  await query(`UPDATE bookings SET payment_status='refunded' WHERE id=$1`, [p.booking_id]);
  await audit(req, 'refund_payment', p.id, { amount, reason: req.body.reason, gateway: Boolean(refundId) });
  await notify(p.passenger_id, {
    type: 'payment_refunded', title: 'Refund processed',
    body: `₹${amount} refunded${refundId ? ' via the payment gateway' : ' (manual refund by Sawaari)'}. Reason: ${req.body.reason}`,
    data: { bookingId: p.booking_id, url: `/app/ride/${p.booking_id}` },
  });
  res.json({ ok: true, refundId, amount });
}));

/* ── CITIES & PRICING ─────────────────────────────────────── */

router.get('/cities', rbac.requirePermission('cities.view'), asyncHandler(async (_req, res) => {
  res.json(await many(
    `SELECT c.*, (SELECT json_agg(json_build_object(
        'id', p.id, 'vehicleType', p.vehicle_type, 'baseFare', p.base_fare, 'perKm', p.per_km,
        'perMinute', p.per_minute, 'minFare', p.min_fare, 'bookingFee', p.booking_fee,
        'waitingPerMin', p.waiting_per_min, 'freeWaitMin', p.free_wait_min,
        'nightMultiplier', p.night_multiplier, 'nightFromHour', p.night_from_hour,
        'nightToHour', p.night_to_hour, 'active', p.is_active
      ) ORDER BY p.vehicle_type) FROM pricing_configs p WHERE p.city_id = c.id) AS pricing
     FROM cities c ORDER BY c.name`
  ));
}));

router.post('/cities', rbac.requirePermission('cities.manage'), validate(z.object({
  name: z.string().trim().min(2).max(60),
  state: z.string().trim().max(60).optional(),
  centerLat: z.coerce.number().min(-90).max(90),
  centerLng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().int().min(5).max(200).default(25),
})), asyncHandler(async (req, res) => {
  const dup = await one(`SELECT id FROM cities WHERE name ILIKE $1`, [req.body.name]);
  if (dup) throw httpError(409, 'A city with this name already exists');
  const { rows } = await query(
    `INSERT INTO cities (name, state, center_lat, center_lng, radius_km) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.body.name, req.body.state || null, req.body.centerLat, req.body.centerLng, req.body.radiusKm]
  );
  // copy default pricing for the new city
  const template = await many(`SELECT * FROM pricing_configs WHERE city_id = (SELECT id FROM cities WHERE name='Bengaluru')`);
  for (const t of template) {
    await query(
      `INSERT INTO pricing_configs (city_id, vehicle_type, base_fare, per_km, per_minute, min_fare, booking_fee, waiting_per_min, free_wait_min, night_multiplier, night_from_hour, night_to_hour)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [rows[0].id, t.vehicle_type, t.base_fare, t.per_km, t.per_minute, t.min_fare, t.booking_fee,
       t.waiting_per_min, t.free_wait_min, t.night_multiplier, t.night_from_hour, t.night_to_hour]
    );
  }
  await audit(req, 'create_city', rows[0].id, { name: req.body.name });
  res.status(201).json(rows[0]);
}));

router.patch('/cities/:id', rbac.requirePermission('cities.manage'), validate(z.object({
  isActive: z.boolean().optional(),
  radiusKm: z.coerce.number().int().min(5).max(200).optional(),
})), asyncHandler(async (req, res) => {
  const city = await one(`SELECT * FROM cities WHERE id=$1`, [req.params.id]);
  if (!city) throw httpError(404, 'City not found');
  await query(
    `UPDATE cities SET is_active = COALESCE($2, is_active), radius_km = COALESCE($3, radius_km) WHERE id=$1`,
    [req.params.id, req.body.isActive ?? null, req.body.radiusKm ?? null]
  );
  await audit(req, 'update_city', req.params.id, req.body);
  res.json({ ok: true });
}));

router.put('/pricing/:id', rbac.requirePermission('finance.settings'), validate(z.object({
  baseFare: z.coerce.number().min(0).max(1000),
  perKm: z.coerce.number().min(0).max(500),
  perMinute: z.coerce.number().min(0).max(100).default(0),
  minFare: z.coerce.number().min(0).max(2000),
  bookingFee: z.coerce.number().min(0).max(500).default(0),
  waitingPerMin: z.coerce.number().min(0).max(100).default(0),
  freeWaitMin: z.coerce.number().int().min(0).max(60).default(5),
  nightMultiplier: z.coerce.number().min(1).max(3).default(1),
  nightFromHour: z.coerce.number().int().min(0).max(23).default(23),
  nightToHour: z.coerce.number().int().min(0).max(23).default(5),
  active: z.boolean().default(true),
})), asyncHandler(async (req, res) => {
  const p = await one(`SELECT * FROM pricing_configs WHERE id=$1`, [req.params.id]);
  if (!p) throw httpError(404, 'Pricing config not found');
  await query(
    `UPDATE pricing_configs SET
        base_fare=$2, per_km=$3, per_minute=$4, min_fare=$5, booking_fee=$6,
        waiting_per_min=$7, free_wait_min=$8, night_multiplier=$9,
        night_from_hour=$10, night_to_hour=$11, is_active=$12, updated_at=now()
      WHERE id=$1`,
    [req.params.id, req.body.baseFare, req.body.perKm, req.body.perMinute, req.body.minFare,
     req.body.bookingFee, req.body.waitingPerMin, req.body.freeWaitMin, req.body.nightMultiplier,
     req.body.nightFromHour, req.body.nightToHour, req.body.active]
  );
  await audit(req, 'update_pricing', req.params.id, req.body);
  res.json({ ok: true });
}));

/* ── SETTINGS ─────────────────────────────────────────────── */
router.get('/settings', rbac.requirePermission('settings.view'), asyncHandler(async (_req, res) => {
  res.json(await settingsSvc.getSettings());
}));

router.put('/settings', rbac.requirePermission('settings.edit'), validate(z.object({
  commission_percent: z.coerce.number().min(0).max(50).optional(),
  driver_request_timeout_sec: z.coerce.number().int().min(30).max(900).optional(),
  search_radius_km: z.coerce.number().min(1).max(50).optional(),
  cancellation_fee_after_accept: z.coerce.number().min(0).max(500).optional(),
  support_phone: z.string().trim().max(20).optional(),
  sos_number: z.string().trim().max(6).optional(),
})), asyncHandler(async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    await query(
      `INSERT INTO platform_settings (key, value) VALUES ($1,$2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=now()`, [k, JSON.stringify(v)]
    );
  }
  settingsSvc.invalidate();
  await audit(req, 'update_settings', null, req.body);
  res.json(await settingsSvc.getSettings());
}));

/* ── ANALYTICS ────────────────────────────────────────────── */
router.get('/analytics', rbac.requirePermission('analytics.view'), asyncHandler(async (_req, res) => {
  const daily = await many(
    `SELECT date_trunc('day', created_at)::date AS day,
            count(*)::int AS bookings,
            count(*) FILTER (WHERE status='completed')::int AS completed,
            count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
            COALESCE(SUM(final_fare) FILTER (WHERE status='completed'),0)::numeric AS revenue
       FROM bookings WHERE created_at > now() - interval '30 days'
      GROUP BY 1 ORDER BY 1`
  );
  const cityStats = await many(
    `SELECT ci.name, count(b.id)::int AS bookings,
            COALESCE(SUM(b.final_fare) FILTER (WHERE b.status='completed'),0)::numeric AS revenue
       FROM cities ci LEFT JOIN bookings b ON b.city_id = ci.id
      WHERE b.created_at > now() - interval '30 days' OR b.id IS NULL
      GROUP BY ci.name HAVING count(b.id) > 0 ORDER BY bookings DESC`
  );
  const topDrivers = await many(
    `SELECT u.name, dp.rides_completed, dp.rating_avg, dp.total_earnings
       FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
      WHERE dp.rides_completed > 0 ORDER BY dp.total_earnings DESC LIMIT 10`
  );
  const paymentSplit = await many(
    `SELECT method, count(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount
       FROM payments WHERE status='paid' GROUP BY method`
  );
  res.json({
    daily: daily.map((d) => ({ ...d, revenue: round2(parseFloat(d.revenue)) })),
    cityStats: cityStats.map((c) => ({ ...c, revenue: round2(parseFloat(c.revenue)) })),
    topDrivers: topDrivers.map((d) => ({
      name: d.name, rides: d.rides_completed, rating: parseFloat(d.rating_avg), earnings: parseFloat(d.total_earnings),
    })),
    paymentSplit: paymentSplit.map((p) => ({ method: p.method, count: p.count, amount: round2(parseFloat(p.amount)) })),
  });
}));

/* ── SUPPORT TICKETS ──────────────────────────────────────── */
router.get('/tickets', rbac.requirePermission('tickets.view'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT t.*, u.name AS user_name, u.phone AS user_phone,
            (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t JOIN users u ON u.id = t.user_id
      ORDER BY (t.status IN ('open','in_progress')) DESC, t.created_at DESC LIMIT 100`
  );
  res.json(rows);
}));

router.get('/tickets/:id', rbac.requirePermission('tickets.view'), asyncHandler(async (req, res) => {
  const t = await one(
    `SELECT t.*, u.name AS user_name, u.phone AS user_phone FROM support_tickets t
       JOIN users u ON u.id = t.user_id WHERE t.id=$1`, [req.params.id]
  );
  if (!t) throw httpError(404, 'Ticket not found');
  const messages = await many(
    `SELECT m.body, m.sender_id, m.created_at, u.name AS sender_name, u.role AS sender_role
       FROM ticket_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.ticket_id=$1 ORDER BY m.created_at`, [t.id]
  );
  res.json({ ...t, messages });
}));

router.post('/tickets/:id/reply', rbac.requirePermission('tickets.reply'), validate(z.object({
  body: z.string().trim().min(1).max(2000),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
})), asyncHandler(async (req, res) => {
  const t = await one(`SELECT * FROM support_tickets WHERE id=$1`, [req.params.id]);
  if (!t) throw httpError(404, 'Ticket not found');
  await withTransaction(async (tx) => {
    await tx.query(`INSERT INTO ticket_messages (ticket_id, sender_id, body) VALUES ($1,$2,$3)`,
      [t.id, req.user.id, req.body.body]);
    await tx.query(
      `UPDATE support_tickets SET status = COALESCE($2, CASE WHEN status='open' THEN 'in_progress' ELSE status END),
              assigned_to=$3, updated_at=now() WHERE id=$1`,
      [t.id, req.body.status || null, req.user.id]
    );
  });
  await notify(t.user_id, {
    type: 'support_reply', title: 'Support replied to your ticket',
    body: req.body.body.slice(0, 120),
    data: { ticketId: t.id, url: '/app/support' },
  });
  res.json({ ok: true });
}));

/* ── REPORTS & SOS ────────────────────────────────────────── */
router.get('/reports', rbac.requirePermission('reports.view'), asyncHandler(async (_req, res) => {
  res.json(await many(
    `SELECT r.*, ru.name AS reporter_name, au.name AS against_name, au.phone AS against_phone,
            b.ref AS booking_ref
       FROM user_reports r
       JOIN users ru ON ru.id = r.reporter_id
       JOIN users au ON au.id = r.against_user_id
       LEFT JOIN bookings b ON b.id = r.booking_id
      ORDER BY (r.status='open') DESC, r.created_at DESC LIMIT 100`
  ));
}));

router.post('/reports/:id/resolve', rbac.requirePermission('reports.investigate'), validate(z.object({
  status: z.enum(['reviewing', 'resolved', 'dismissed']),
  note: z.string().trim().max(500).optional(),
})), asyncHandler(async (req, res) => {
  const r = await one(`SELECT * FROM user_reports WHERE id=$1`, [req.params.id]);
  if (!r) throw httpError(404, 'Report not found');
  await query(
    `UPDATE user_reports SET status=$2, resolution_note=$3, resolved_by=$4 WHERE id=$1`,
    [r.id, req.body.status, req.body.note || null, req.user.id]
  );
  await notify(r.reporter_id, {
    type: 'report_update', title: 'Your report was updated',
    body: `Status: ${req.body.status}. ${req.body.note || ''}`,
  });
  res.json({ ok: true });
}));

router.get('/sos', rbac.requirePermission('reports.view'), asyncHandler(async (_req, res) => {
  res.json(await many(
    `SELECT s.*, u.name AS user_name, u.phone AS user_phone, b.ref AS booking_ref,
            au.name AS acknowledged_by_name
       FROM sos_alerts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN bookings b ON b.id = s.booking_id
       LEFT JOIN users au ON au.id = s.acknowledged_by
      ORDER BY (s.status='open') DESC, s.created_at DESC LIMIT 100`
  ));
}));

router.post('/sos/:id/ack', rbac.requirePermission('reports.investigate'), asyncHandler(async (req, res) => {
  const s = await one(`SELECT * FROM sos_alerts WHERE id=$1`, [req.params.id]);
  if (!s) throw httpError(404, 'SOS alert not found');
  await query(`UPDATE sos_alerts SET status='acknowledged', acknowledged_by=$2 WHERE id=$1`, [s.id, req.user.id]);
  await notify(s.user_id, {
    type: 'sos_ack', title: 'Help is on the way',
    body: 'Sawaari safety team acknowledged your SOS alert.',
  });
  res.json({ ok: true });
}));

router.post('/sos/:id/resolve', rbac.requirePermission('reports.investigate'), asyncHandler(async (req, res) => {
  await query(`UPDATE sos_alerts SET status='resolved' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

/* ── CSV EXPORTS ──────────────────────────────────────────── */
router.get('/export/:type', asyncHandler(async (req, res) => {
  const type = req.params.type;
  const exportPerm = {
    bookings: 'bookings.view', users: 'users.view', drivers: 'drivers.view',
    payments: 'payments.view', revenue: 'finance.view', refunds: 'payments.view',
    settlements: 'finance.view', reports: 'reports.view',
  }[type];
  if (!exportPerm) throw httpError(404, 'Unknown export type');
  /* The export type decides the permission, so the admin profile is loaded
     here rather than by a fixed requirePermission() middleware. */
  const profile = req.adminProfile || await rbac.loadProfile(req.user.id);
  if (!profile) throw httpError(403, 'This account is not an administrator.');
  if (!rbac.hasPermission(profile, exportPerm)) {
    throw httpError(403, 'You are not allowed to export this data.');
  }
  const queries = {
    bookings: `SELECT b.ref, b.status, b.booking_type, pu.name AS passenger, pu.phone AS passenger_phone,
                       COALESCE(du.name,'') AS driver, b.pickup_address, b.drop_address, b.distance_km,
                       b.estimated_fare, b.final_fare, b.payment_status, b.created_at, b.completed_at
                  FROM bookings b LEFT JOIN users pu ON pu.id=b.passenger_id
                  LEFT JOIN driver_profiles dp ON dp.id=b.driver_profile_id
                  LEFT JOIN users du ON du.id=dp.user_id ORDER BY b.created_at DESC`,
    users: `SELECT name, role, phone, email, is_active, phone_verified, created_at
              FROM users ORDER BY created_at DESC`,
    drivers: `SELECT u.name, u.phone, u.email, dp.verification_status, dp.is_online, dp.rides_completed,
                     dp.rides_cancelled, dp.rating_avg, dp.total_earnings, dp.upi_id, dp.upi_verified, u.created_at
                FROM driver_profiles dp JOIN users u ON u.id=dp.user_id ORDER BY u.created_at DESC`,
    payments: `SELECT b.ref AS booking_ref, p.method, p.amount, p.status, p.passenger_utr,
                      p.rzp_payment_id, p.refunded_amount, p.created_at, p.verified_at
                 FROM payments p JOIN bookings b ON b.id=p.booking_id ORDER BY p.created_at DESC`,
    revenue: `SELECT u.name AS driver, u.phone, de.booking_id, b.ref AS booking_ref, de.gross, de.commission,
                     de.net, de.created_at
                FROM driver_earnings de JOIN driver_profiles dp ON dp.id=de.driver_profile_id
                JOIN users u ON u.id=dp.user_id JOIN bookings b ON b.id=de.booking_id
               ORDER BY de.created_at DESC`,
    refunds: `SELECT r.id, b.ref AS booking_ref, r.amount, r.reason, r.method, r.status,
                     r.gateway_ref, r.created_at, r.completed_at
                FROM refunds r LEFT JOIN bookings b ON b.id=r.booking_id ORDER BY r.created_at DESC`,
    settlements: `SELECT u.name AS driver, s.period_start, s.period_end, s.gross, s.commission, s.net,
                          s.rides, s.status, s.reference, s.paid_at
                     FROM settlements s JOIN driver_profiles dp ON dp.id=s.driver_profile_id
                     JOIN users u ON u.id=dp.user_id ORDER BY s.created_at DESC`,
    reports: `SELECT ur.id, ru.name AS reporter, au.name AS against_user, ur.reason, ur.details,
                     ur.status, ur.resolution_note, ur.created_at
                FROM user_reports ur JOIN users ru ON ru.id=ur.reporter_id
                JOIN users au ON au.id=ur.against_user_id ORDER BY ur.created_at DESC`,
  };
  const exportColumns = {
    bookings: ['ref', 'status', 'booking_type', 'passenger', 'passenger_phone', 'driver',
      'pickup_address', 'drop_address', 'distance_km', 'estimated_fare', 'final_fare',
      'payment_status', 'created_at', 'completed_at'],
    users: ['name', 'role', 'phone', 'email', 'is_active', 'phone_verified', 'created_at'],
    drivers: ['name', 'phone', 'email', 'verification_status', 'is_online', 'rides_completed',
      'rides_cancelled', 'rating_avg', 'total_earnings', 'upi_id', 'upi_verified', 'created_at'],
    payments: ['booking_ref', 'method', 'amount', 'status', 'passenger_utr', 'rzp_payment_id',
      'refunded_amount', 'created_at', 'verified_at'],
    revenue: ['driver', 'phone', 'booking_id', 'booking_ref', 'gross', 'commission', 'net', 'created_at'],
    refunds: ['id', 'booking_ref', 'amount', 'reason', 'method', 'status', 'gateway_ref',
      'created_at', 'completed_at'],
    settlements: ['driver', 'period_start', 'period_end', 'gross', 'commission', 'net', 'rides',
      'status', 'reference', 'paid_at'],
    reports: ['id', 'reporter', 'against_user', 'reason', 'details', 'status', 'resolution_note', 'created_at'],
  };
  const rows = await many(queries[type]);
  await audit(req, 'export.csv', `export:${type}`, { type, rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sawaari-${type}-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(rowsToCsv(rows, exportColumns[type]));
}));

/* ══════════════════════════════════════════════════════════════
   MASTER CONTROL — user lifecycle, live rides, report investigation
   ══════════════════════════════════════════════════════════════ */

/* GET /api/admin/users/:id — full profile + history (no password data) */
router.get('/users/:id', rbac.requirePermission('users.view'), asyncHandler(async (req, res) => {
  const user = await one(
    `SELECT u.id, u.role, u.name, u.phone, u.email, u.avatar_url, u.is_active, u.blocked_reason,
            u.phone_verified, u.email_verified_at, u.deactivated_at, u.created_at, u.updated_at,
            dp.verification_status, dp.is_online, dp.rides_completed, dp.rides_cancelled,
            dp.total_earnings, dp.rating_avg, dp.rating_count, dp.upi_id, dp.upi_verified,
            pp.rating_avg AS passenger_rating, pp.rating_count AS passenger_reviews
       FROM users u
       LEFT JOIN driver_profiles dp ON dp.user_id = u.id
       LEFT JOIN passenger_profiles pp ON pp.user_id = u.id
      WHERE u.id = $1`, [req.params.id]
  );
  if (!user) throw httpError(404, 'User not found');

  const [bookings, payments, reports, against, suspensions, notifications, reviews] = await Promise.all([
    many(`SELECT id, ref, status, booking_type, vehicle_type, pickup_address, drop_address,
                 distance_km, final_fare, estimated_fare, payment_status, created_at, completed_at
            FROM bookings WHERE passenger_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]),
    many(`SELECT p.id, p.method, p.amount, p.status, p.passenger_utr, p.created_at, p.verified_at, b.ref AS booking_ref
            FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
           WHERE p.passenger_id = $1 ORDER BY p.created_at DESC LIMIT 50`, [req.params.id]),
    many(`SELECT id, reason, details, status, resolution_note, created_at FROM user_reports
           WHERE reporter_id = $1 OR against_user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]),
    many(`SELECT ur.id, ur.reason, ur.status, ur.created_at, ru.name AS reporter
            FROM user_reports ur JOIN users ru ON ru.id = ur.reporter_id
           WHERE ur.against_user_id = $1 ORDER BY ur.created_at DESC LIMIT 50`, [req.params.id]),
    many(`SELECT id, kind, reason, starts_at, ends_at, lifted_at, created_at FROM user_suspensions
           WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]),
    many(`SELECT id, type, title, body, created_at, read_at FROM notifications
           WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.params.id]),
    many(`SELECT r.id, r.rating, r.comment, r.created_at, b.ref AS booking_ref
            FROM reviews r JOIN bookings b ON b.id = r.booking_id
           WHERE b.passenger_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [req.params.id]),
  ]);

  res.json({
    user: {
      id: user.id, role: user.role, name: user.name, phone: user.phone, email: user.email,
      avatarUrl: user.avatar_url, isActive: user.is_active, blockedReason: user.blocked_reason,
      phoneVerified: user.phone_verified, emailVerifiedAt: user.email_verified_at,
      deactivatedAt: user.deactivated_at, createdAt: user.created_at, updatedAt: user.updated_at,
      verificationStatus: user.verification_status, isOnline: user.is_online,
      ridesCompleted: user.rides_completed, ridesCancelled: user.rides_cancelled,
      totalEarnings: user.total_earnings ? parseFloat(user.total_earnings) : 0,
      rating: user.rating_avg !== null ? parseFloat(user.rating_avg) : (user.passenger_rating ? parseFloat(user.passenger_rating) : 0),
      ratingCount: user.rating_count !== null ? user.rating_count : (user.passenger_reviews || 0),
      upiId: user.upi_id, upiVerified: user.upi_verified,
    },
    bookings, payments, reports, reportsAgainst: against, suspensions, notifications, reviews,
  });
}));

/* POST /api/admin/users/:id/suspend — temporary suspension */
router.post('/users/:id/suspend', rbac.requirePermission('users.suspend'), validate(z.object({
  suspend: z.boolean(),
  reason: z.string().trim().min(3).max(300),
  hours: z.coerce.number().int().min(1).max(24 * 90).optional(),
})), asyncHandler(async (req, res) => {
  const target = await one(`SELECT id, name, phone, role FROM users WHERE id=$1`, [req.params.id]);
  if (!target) throw httpError(404, 'User not found');
  const isAdmin = (await one(`SELECT admin_role, is_owner FROM admin_profiles WHERE user_id=$1`, [target.id]));
  if (isAdmin && (isAdmin.is_owner || isAdmin.admin_role === 'super_admin')) {
    throw httpError(403, 'The platform owner account cannot be suspended.');
  }
  if (target.id === req.user.id) throw httpError(400, 'You cannot suspend your own account.');

  if (req.body.suspend) {
    const endsAt = req.body.hours ? new Date(Date.now() + req.body.hours * 3600 * 1000) : null;
    await query(`UPDATE users SET is_active=false, blocked_reason=$2, updated_at=now() WHERE id=$1`,
      [target.id, `Suspended: ${req.body.reason}`]);
    await query(`UPDATE driver_profiles SET is_online=false WHERE user_id=$1`, [target.id]);
    await query(
      `INSERT INTO user_suspensions (user_id, kind, reason, ends_at, created_by) VALUES ($1,'suspend',$2,$3,$4)`,
      [target.id, req.body.reason, endsAt, req.user.id]
    );
    await audit(req, 'user.suspended', `user:${target.id}`, {
      reason: req.body.reason, hours: req.body.hours || null, name: target.name,
    });
    await notify(target.id, {
      type: 'account_status', title: 'Account suspended',
      body: req.body.hours
        ? `Your account is suspended for ${req.body.hours} hours: ${req.body.reason}`
        : `Your account is suspended: ${req.body.reason}`,
    });
    return res.json({ ok: true, message: `Account suspended${req.body.hours ? ` for ${req.body.hours} hours` : ''}.` });
  }

  await query(`UPDATE users SET is_active=true, blocked_reason=NULL, updated_at=now() WHERE id=$1`, [target.id]);
  await query(`UPDATE user_suspensions SET lifted_at=now(), lifted_by=$2 WHERE user_id=$1 AND lifted_at IS NULL`, [target.id, req.user.id]);
  await audit(req, 'user.reactivated', `user:${target.id}`, { name: target.name });
  await notify(target.id, { type: 'account_status', title: 'Account restored', body: 'Your Sawaari account has been reactivated.' });
  res.json({ ok: true, message: 'Account reactivated.' });
}));

/* POST /api/admin/users/:id/deactivate — permanent, records are retained */
router.post('/users/:id/deactivate', rbac.requirePermission('users.deactivate'), validate(z.object({
  reason: z.string().trim().min(5).max(300),
})), asyncHandler(async (req, res) => {
  const target = await one(`SELECT id, name, role FROM users WHERE id=$1`, [req.params.id]);
  if (!target) throw httpError(404, 'User not found');
  const isAdmin = (await one(`SELECT admin_role, is_owner FROM admin_profiles WHERE user_id=$1`, [target.id]));
  if (isAdmin && (isAdmin.is_owner || isAdmin.admin_role === 'super_admin')) {
    throw httpError(403, 'The platform owner account cannot be deactivated.');
  }
  if (target.id === req.user.id) throw httpError(400, 'You cannot deactivate your own account.');
  if (target.role === 'passenger' || target.role === 'driver') {
    const active = await one(
      `SELECT count(*)::int AS c FROM bookings
        WHERE (passenger_id=$1 OR driver_profile_id IN (SELECT id FROM driver_profiles WHERE user_id=$1))
          AND status IN ('searching','assigned','arriving','arrived','in_progress','scheduled')`,
      [target.id]
    );
    if (active.c > 0) throw httpError(409, 'This account has an active ride. Complete or cancel it first.');
  }
  await query(`UPDATE users SET is_active=false, deactivated_at=now(), blocked_reason=$2, updated_at=now() WHERE id=$1`,
    [target.id, `Deactivated: ${req.body.reason}`]);
  await query(`UPDATE driver_profiles SET is_online=false WHERE user_id=$1`, [target.id]);
  await query(`INSERT INTO user_suspensions (user_id, kind, reason, created_by) VALUES ($1,'deactivate',$2,$3)`,
    [target.id, req.body.reason, req.user.id]);
  await audit(req, 'user.deactivated', `user:${target.id}`, { reason: req.body.reason, name: target.name });
  await notify(target.id, {
    type: 'account_status', title: 'Account deactivated',
    body: `Your Sawaari account has been permanently deactivated: ${req.body.reason}. Financial and ride records are retained.`,
  });
  res.json({ ok: true, message: 'Account deactivated. Ride, payment and report records are retained.' });
}));

/* POST /api/admin/users/bulk — bulk account operations */
router.post('/users/bulk', rbac.requirePermission('users.bulk'), validate(z.object({
  userIds: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['block', 'unblock', 'suspend', 'reactivate']),
  reason: z.string().trim().min(3).max(300),
  hours: z.coerce.number().int().min(1).max(24 * 90).optional(),
})), asyncHandler(async (req, res) => {
  const adminIds = (await many(
    `SELECT user_id, admin_role, is_owner FROM admin_profiles WHERE user_id = ANY($1::uuid[])`,
    [req.body.userIds]
  )).filter((a) => a.is_owner || a.admin_role === 'super_admin').map((a) => a.user_id);
  if (adminIds.length) throw httpError(403, 'The selection includes the platform owner account — remove it and try again.');

  const ids = req.body.userIds.filter((id) => !adminIds.includes(id));
  if (!ids.length) throw httpError(403, 'None of the selected accounts may be modified.');
  let applied = 0;
  for (const id of ids) {
    if (id === req.user.id) continue;
    if (req.body.action === 'block' || req.body.action === 'suspend') {
      await query(`UPDATE users SET is_active=false, blocked_reason=$2, updated_at=now() WHERE id=$1`,
        [id, `${req.body.action === 'block' ? 'Blocked' : 'Suspended'}: ${req.body.reason}`]);
      await query(`UPDATE driver_profiles SET is_online=false WHERE user_id=$1`, [id]);
      await query(
        `INSERT INTO user_suspensions (user_id, kind, reason, ends_at, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, req.body.action === 'block' ? 'block' : 'suspend', req.body.reason,
          req.body.action === 'suspend' && req.body.hours ? new Date(Date.now() + req.body.hours * 3600 * 1000) : null,
          req.user.id]
      );
    } else {
      await query(`UPDATE users SET is_active=true, blocked_reason=NULL, updated_at=now() WHERE id=$1`, [id]);
      await query(`UPDATE user_suspensions SET lifted_at=now(), lifted_by=$2 WHERE user_id=$1 AND lifted_at IS NULL`, [id, req.user.id]);
    }
    applied += 1;
  }
  await audit(req, `user.bulk_${req.body.action}`, `users:${applied}`, {
    reason: req.body.reason, count: applied, requested: req.body.userIds.length,
  });
  res.json({ ok: true, applied, message: `${req.body.action} applied to ${applied} account(s).` });
}));

/* GET /api/admin/bookings/live — rides in progress */
router.get('/bookings/live', rbac.requirePermission('bookings.view'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT b.id, b.ref, b.status, b.vehicle_type, b.pickup_address, b.drop_address,
            b.distance_km, b.duration_min, b.estimated_fare, b.final_fare, b.payment_status,
            b.created_at, b.assigned_at, b.arrived_at, b.started_at, b.completed_at,
            pu.name AS passenger, pu.phone AS passenger_phone,
            du.name AS driver, du.phone AS driver_phone, dp.is_online AS driver_online,
            dp.rating_avg AS driver_rating
       FROM bookings b
       JOIN users pu ON pu.id = b.passenger_id
       LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id
       LEFT JOIN users du ON du.id = dp.user_id
      WHERE b.status IN ('searching','assigned','arriving','arrived','in_progress','scheduled')
      ORDER BY b.created_at DESC LIMIT 200`
  );
  res.json({
    live: rows.map((b) => ({
      id: b.id, ref: b.ref, status: b.status, vehicleType: b.vehicle_type,
      pickup: b.pickup_address, drop: b.drop_address, distanceKm: b.distance_km,
      durationMin: b.duration_min, fare: b.final_fare || b.estimated_fare,
      paymentStatus: b.payment_status, createdAt: b.created_at, assignedAt: b.assigned_at,
      arrivedAt: b.arrived_at, startedAt: b.started_at, completedAt: b.completed_at,
      passenger: b.passenger, passengerPhone: b.passenger_phone,
      driver: b.driver, driverPhone: b.driver_phone, driverOnline: b.driver_online,
      driverRating: b.driver_rating ? parseFloat(b.driver_rating) : 0,
    })),
    counts: {
      searching: rows.filter((r) => r.status === 'searching').length,
      assigned: rows.filter((r) => r.status === 'assigned').length,
      arriving: rows.filter((r) => r.status === 'arriving').length,
      arrived: rows.filter((r) => r.status === 'arrived').length,
      inProgress: rows.filter((r) => r.status === 'in_progress').length,
      scheduled: rows.filter((r) => r.status === 'scheduled').length,
    },
  });
}));

/* POST /api/admin/drivers/:id/suspend — suspend / reinstate a driver */
router.post('/drivers/:id/suspend', rbac.requirePermission('drivers.manage'), validate(z.object({
  suspend: z.boolean(),
  reason: z.string().trim().min(3).max(300),
  hours: z.coerce.number().int().min(1).max(24 * 90).optional(),
})), asyncHandler(async (req, res) => {
  const dp = await one(
    `SELECT dp.id, dp.user_id, dp.verification_status, u.name, u.phone FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id WHERE dp.id = $1`, [req.params.id]
  );
  if (!dp) throw httpError(404, 'Driver not found');
  if (dp.verification_status !== 'approved') {
    throw httpError(409, 'Only approved drivers can be suspended. Reject the verification instead.');
  }
  const active = await one(
    `SELECT count(*)::int AS c FROM bookings WHERE driver_profile_id=$1 AND status IN ('assigned','arriving','arrived','in_progress')`,
    [dp.id]
  );
  if (active.c > 0) throw httpError(409, 'This driver has an active ride. Finish it first.');

  if (req.body.suspend) {
    const endsAt = req.body.hours ? new Date(Date.now() + req.body.hours * 3600 * 1000) : null;
    await query(`UPDATE driver_profiles SET is_online=false, updated_at=now() WHERE id=$1`, [dp.id]);
    await query(`UPDATE users SET is_active=false, blocked_reason=$2, updated_at=now() WHERE id=$1`,
      [dp.user_id, `Suspended: ${req.body.reason}`]);
    await query(
      `INSERT INTO user_suspensions (user_id, kind, reason, ends_at, created_by) VALUES ($1,'suspend',$2,$3,$4)`,
      [dp.user_id, req.body.reason, endsAt, req.user.id]
    );
    await audit(req, 'driver.suspended', `driver:${dp.id}`, { reason: req.body.reason, hours: req.body.hours || null, name: dp.name });
    await notify(dp.user_id, {
      type: 'account_status', title: 'Driver account suspended',
      body: `Your driver account has been suspended: ${req.body.reason}`,
    });
    return res.json({ ok: true, message: 'Driver suspended and taken offline.' });
  }
  await query(`UPDATE users SET is_active=true, blocked_reason=NULL, updated_at=now() WHERE id=$1`, [dp.user_id]);
  await query(`UPDATE user_suspensions SET lifted_at=now(), lifted_by=$2 WHERE user_id=$1 AND lifted_at IS NULL`, [dp.user_id, req.user.id]);
  await audit(req, 'driver.reinstated', `driver:${dp.id}`, { name: dp.name });
  res.json({ ok: true, message: 'Driver reinstated.' });
}));

/* GET /api/admin/pricing — full pricing matrix */
router.get('/pricing', rbac.requirePermission('finance.settings'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT p.id, p.city_id, p.vehicle_type, p.base_fare, p.per_km, p.per_minute, p.min_fare,
            p.booking_fee, p.waiting_per_min, p.free_wait_min, p.night_multiplier,
            p.night_from_hour, p.night_to_hour, p.is_active, c.name AS city
       FROM pricing_configs p JOIN cities c ON c.id = p.city_id
      ORDER BY c.name, p.vehicle_type`
  );
  res.json({
    pricing: rows.map((p) => ({
      id: p.id, cityId: p.city_id, city: p.city, vehicleType: p.vehicle_type,
      baseFare: parseFloat(p.base_fare), perKm: parseFloat(p.per_km),
      perMinute: parseFloat(p.per_minute), minFare: parseFloat(p.min_fare),
      bookingFee: parseFloat(p.booking_fee), waitingPerMin: parseFloat(p.waiting_per_min),
      freeWaitMin: p.free_wait_min, nightMultiplier: parseFloat(p.night_multiplier),
      nightFromHour: p.night_from_hour, nightToHour: p.night_to_hour, isActive: p.is_active,
    })),
    commissionPercent: await settingsSvc.getSetting('commission_percent'),
  });
}));

/* ── Report investigation ─────────────────────────────────── */
router.get('/reports/:id/investigations', rbac.requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const report = await one(
    `SELECT r.*, ru.name AS reporter_name, ru.phone AS reporter_phone, ru.email AS reporter_email,
            au.name AS against_name, au.phone AS against_phone, b.ref AS booking_ref
       FROM user_reports r JOIN users ru ON ru.id = r.reporter_id
       JOIN users au ON au.id = r.against_user_id
       LEFT JOIN bookings b ON b.id = r.booking_id WHERE r.id = $1`, [req.params.id]
  );
  if (!report) throw httpError(404, 'Report not found');
  const history = await many(
    `SELECT ri.*, u.name AS admin_name FROM report_investigations ri
       LEFT JOIN users u ON u.id = ri.admin_id
      WHERE ri.report_id = $1 ORDER BY ri.created_at DESC`, [req.params.id]
  );
  res.json({
    report: {
      id: report.id, reason: report.reason, details: report.details, status: report.status,
      resolutionNote: report.resolution_note, createdAt: report.created_at,
      reporter: { id: report.reporter_id, name: report.reporter_name, phone: report.reporter_phone, email: report.reporter_email },
      against: { id: report.against_user_id, name: report.against_name, phone: report.against_phone },
      bookingRef: report.booking_ref,
    },
    investigations: history.map((h) => ({
      id: h.id, action: h.action, note: h.note, evidence: h.evidence,
      adminName: h.admin_name, adminEmail: h.admin_email, createdAt: h.created_at,
    })),
  });
}));

router.post('/reports/:id/investigate', rbac.requirePermission('reports.investigate'), validate(z.object({
  action: z.enum(['note', 'assign', 'pending', 'investigate', 'action_taken']),
  note: z.string().trim().max(1000).optional(),
  assignTo: z.string().uuid().optional(),
  evidence: z.record(z.any()).optional(),
})), asyncHandler(async (req, res) => {
  const report = await one(`SELECT * FROM user_reports WHERE id=$1`, [req.params.id]);
  if (!report) throw httpError(404, 'Report not found');
  if (req.body.action === 'assign' && !req.body.assignTo) throw httpError(400, 'Choose an administrator to assign this report to.');
  if (req.body.action === 'note' && !req.body.note) throw httpError(400, 'Write a note before saving.');

  await query(
    `INSERT INTO report_investigations (report_id, admin_id, admin_email, action, note, evidence)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [report.id, req.user.id, req.user.email, req.body.action, req.body.note || null,
      req.body.evidence ? JSON.stringify(req.body.evidence) : null]
  );
  const statusMap = { pending: 'open', investigate: 'reviewing', action_taken: 'reviewing' };
  if (statusMap[req.body.action]) {
    await query(`UPDATE user_reports SET status=$2 WHERE id=$1`, [report.id, statusMap[req.body.action]]);
  }
  await audit(req, `report.${req.body.action}`, `report:${report.id}`, {
    note: req.body.note || null, assignTo: req.body.assignTo || null,
  });
  if (req.body.action === 'action_taken' && req.body.assignTo) {
    await notify(req.body.assignTo, {
      type: 'report_assigned', title: 'A report was assigned to you',
      body: `Report ${report.id.slice(0, 8)} — ${report.reason.replace(/_/g, ' ')}. ${req.body.note || ''}`.slice(0, 200),
      data: { url: '/admin/reports' },
    });
  }
  res.json({ ok: true, message: 'Investigation note saved.' });
}));

module.exports = router;
