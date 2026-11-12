/* MASTER CONTROL — the Super Admin's command centre.

   Every route here is permission-checked server-side and every mutation
   is written to the append-only audit log. Nothing in this file edits a
   payment record to "make revenue" appear: refunds are recorded as new
   refund rows referencing the original payment. */
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, one, many, withTransaction } = require('../db');
const { requireAuth, role } = require('../middleware/auth');
const { validate, validateQuery } = require('../middleware/validate');
const { asyncHandler, httpError, round2, rowsToCsv } = require('../utils');
const audit = require('../services/audit');
const rbac = require('../services/rbac');
const cryptoSvc = require('../services/crypto');
const sessions = require('../services/adminSession');
const settingsSvc = require('../services/settings');
const razorpaySvc = require('../services/razorpay');
const { notify, notifyAdmins } = require('../services/notify');
const config = require('../config');

const router = express.Router();

/* Any signed-in administrator may reach this router; individual
   actions are gated by requirePermission(). */
router.use(requireAuth, role(...rbac.ADMIN_ROLES));

const ctx = (req) => audit.ctxFrom(req);
const hashToken = (t) => require('crypto').createHash('sha256').update(String(t)).digest('hex');

/* ══════════════════════════════════════════════════════════════
   MASTER DASHBOARD — every figure comes from the live database
   ══════════════════════════════════════════════════════════════ */
router.get('/dashboard', rbac.requirePermission('analytics.view'), asyncHandler(async (_req, res) => {
  const [users, drivers, bookings, payments, revenue, reports, suspensions, sessions] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE role='passenger')::int AS passengers,
                count(*) FILTER (WHERE role='driver')::int AS drivers,
                count(*) FILTER (WHERE role IN ('admin','super_admin','finance_admin','support_admin','driver_manager','moderator'))::int AS admins,
                count(*) FILTER (WHERE NOT is_active)::int AS blocked,
                count(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today
           FROM users`),
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE verification_status='approved')::int AS verified,
                count(*) FILTER (WHERE verification_status='pending')::int AS pending,
                count(*) FILTER (WHERE verification_status='rejected')::int AS rejected,
                count(*) FILTER (WHERE is_online)::int AS online,
                count(*) FILTER (WHERE NOT is_online)::int AS offline
           FROM driver_profiles`),
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status='completed')::int AS completed,
                count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
                count(*) FILTER (WHERE status IN ('searching','assigned','arriving','arrived','in_progress','scheduled'))::int AS active,
                count(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today
           FROM bookings`),
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status='paid')::int AS paid,
                count(*) FILTER (WHERE status IN ('pending','awaiting_verification'))::int AS pending,
                count(*) FILTER (WHERE status='failed')::int AS failed,
                count(*) FILTER (WHERE status='refunded')::int AS refunded,
                COALESCE(SUM(amount) FILTER (WHERE status='paid'),0)::numeric AS collected
           FROM payments`),
    one(`SELECT COALESCE(SUM(commission),0)::numeric AS total,
                COALESCE(SUM(commission) FILTER (WHERE created_at::date = CURRENT_DATE),0)::numeric AS today,
                COALESCE(SUM(commission) FILTER (WHERE date_trunc('month', created_at) = date_trunc('month', now())),0)::numeric AS month,
                COALESCE(SUM(net),0)::numeric AS driver_payout,
                COALESCE(SUM(gross),0)::numeric AS gross_fares
           FROM driver_earnings`),
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('open','reviewing'))::int AS active
           FROM user_reports`),
    one(`SELECT count(*)::int AS c FROM user_suspensions WHERE lifted_at IS NULL`),
    one(`SELECT count(*)::int AS c FROM admin_sessions WHERE revoked_at IS NULL AND expires_at > now()`),
  ]);

  res.json({
    users: {
      total: users.total, passengers: users.passengers, drivers: users.drivers,
      admins: users.admins, blocked: users.blocked, registeredToday: users.today,
    },
    drivers: {
      total: drivers.total, verified: drivers.verified, pending: drivers.pending,
      rejected: drivers.rejected, online: drivers.online, offline: drivers.offline,
    },
    bookings: {
      total: bookings.total, completed: bookings.completed, cancelled: bookings.cancelled,
      active: bookings.active, today: bookings.today,
    },
    revenue: {
      total: round2(parseFloat(revenue.total)), today: round2(parseFloat(revenue.today)),
      month: round2(parseFloat(revenue.month)),
      grossFares: round2(parseFloat(revenue.gross_fares)),
      driverPayout: round2(parseFloat(revenue.driver_payout)),
    },
    payments: {
      total: payments.total, paid: payments.paid, pending: payments.pending,
      failed: payments.failed, refunded: payments.refunded,
      collected: round2(parseFloat(payments.collected)),
    },
    reports: { total: reports.total, active: reports.active },
    suspensions: { active: suspensions.c },
    sessions: { active: sessions.c },
    generatedAt: new Date().toISOString(),
  });
}));

/* ══════════════════════════════════════════════════════════════
   ANALYTICS — every series is computed from real rows
   ══════════════════════════════════════════════════════════════ */
router.get('/analytics', rbac.requirePermission('analytics.view'), asyncHandler(async (_req, res) => {
  const [dailyRevenue, monthlyRevenue, dailyBookings, dailyDrivers, dailyPassengers, cityBookings, paymentMethods, rating, driverRanking] = await Promise.all([
    one(`SELECT COALESCE(SUM(commission),0)::numeric AS revenue, COALESCE(SUM(net),0)::numeric AS payouts,
                COALESCE(SUM(gross),0)::numeric AS gross
           FROM driver_earnings WHERE created_at > now() - interval '30 days'`),
    many(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
                 COALESCE(SUM(commission),0)::numeric AS revenue, count(*)::int AS rides
            FROM driver_earnings WHERE created_at > now() - interval '12 months'
           GROUP BY 1 ORDER BY 1`),
    many(`SELECT to_char(d.created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS bookings,
                 count(*) FILTER (WHERE d.status='completed')::int AS completed,
                 count(*) FILTER (WHERE d.status='cancelled')::int AS cancelled,
                 COALESCE(SUM(d.final_fare),0)::numeric AS revenue
            FROM bookings d WHERE d.created_at > now() - interval '30 days'
           GROUP BY 1 ORDER BY 1`),
    many(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS signups
            FROM users WHERE role='driver' AND created_at > now() - interval '30 days'
           GROUP BY 1 ORDER BY 1`),
    many(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS signups
            FROM users WHERE role='passenger' AND created_at > now() - interval '30 days'
           GROUP BY 1 ORDER BY 1`),
    many(`SELECT ci.name AS city, count(b.id)::int AS bookings,
                 COALESCE(SUM(b.final_fare),0)::numeric AS revenue
            FROM bookings b JOIN cities ci ON ci.id = b.city_id
           GROUP BY ci.name ORDER BY bookings DESC`),
    many(`SELECT method, count(*)::int AS payments, COALESCE(SUM(amount),0)::numeric AS amount
            FROM payments GROUP BY method ORDER BY payments DESC`),
    one(`SELECT COALESCE(AVG(rating),0)::numeric AS avg, count(*)::int AS total FROM reviews`),
    many(`SELECT u.name, u.phone, dp.rating_avg, dp.rating_count, dp.rides_completed,
                 dp.total_earnings, dp.rides_cancelled
            FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
           ORDER BY dp.rides_completed DESC, dp.total_earnings DESC LIMIT 10`),
  ]);

  res.json({
    dailyRevenue: {
      total: round2(parseFloat(dailyRevenue.revenue)),
      gross: round2(parseFloat(dailyRevenue.gross)),
      payouts: round2(parseFloat(dailyRevenue.payouts)),
    },
    monthlyRevenue: monthlyRevenue.map((m) => ({
      month: m.month, revenue: round2(parseFloat(m.revenue)), rides: m.rides,
    })),
    dailyBookings: dailyBookings.map((b) => ({
      day: b.day, bookings: b.bookings, completed: b.completed,
      cancelled: b.cancelled, revenue: round2(parseFloat(b.revenue)),
    })),
    driverSignups: dailyDrivers.map((d) => ({ day: d.day, signups: d.signups })),
    passengerSignups: dailyPassengers.map((d) => ({ day: d.day, signups: d.signups })),
    cityBookings: cityBookings.map((c) => ({
      city: c.city, bookings: c.bookings, revenue: round2(parseFloat(c.revenue)),
    })),
    paymentMethods: paymentMethods.map((p) => ({
      method: p.method, payments: p.payments, amount: round2(parseFloat(p.amount)),
    })),
    ratings: { average: round2(parseFloat(rating.avg)), total: rating.total },
    topDrivers: driverRanking.map((d) => ({
      name: d.name, phone: d.phone, rating: parseFloat(d.rating_avg),
      reviews: d.rating_count, rides: d.rides_completed,
      earnings: round2(parseFloat(d.total_earnings)), cancelled: d.rides_cancelled,
    })),
  });
}));

/* ══════════════════════════════════════════════════════════════
   ADMIN & STAFF MANAGEMENT
   ══════════════════════════════════════════════════════════════ */
router.get('/admins', rbac.requirePermission('admins.view'), asyncHandler(async (_req, res) => {
  res.json({
    admins: await rbac.listAdmins(),
    roles: rbac.ADMIN_ROLES.map((r) => ({
      key: r, label: rbac.ROLE_LABELS[r], protected: rbac.PROTECTED_ROLES.includes(r),
      permissions: rbac.ROLE_DEFAULTS[r],
    })),
    permissions: rbac.PERMISSIONS,
  });
}));

router.post('/admins/invite', rbac.requirePermission('admins.create'), validate(z.object({
  email: z.string().email(),
  adminRole: z.enum(['admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator']),
  name: z.string().trim().max(80).optional(),
  message: z.string().trim().max(500).optional(),
  permissions: z.object({ grant: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).optional(),
})), asyncHandler(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const existing = await one(
    `SELECT u.id, ap.admin_role FROM users u LEFT JOIN admin_profiles ap ON ap.user_id=u.id WHERE u.email=$1`, [email]
  );
  if (existing && existing.admin_role) throw httpError(409, 'That email already belongs to an administrator.');
  if (existing) throw httpError(409, 'That email is already registered on the platform.');

  const raw = cryptoSvc.randomToken(24);
  await query(
    `INSERT INTO admin_verification_tokens (admin_user_id, kind, token_hash, meta, expires_at)
     VALUES (NULL,'invite',$1,$2,$3)`,
    [hashToken(raw), JSON.stringify({
      email, admin_role: req.body.adminRole, permissions: req.body.permissions || null,
      invited_by: req.user.id, name: req.body.name || null,
    }), new Date(Date.now() + config.admin.security.inviteExpiryHours * 3600 * 1000)]
  );
  await query(
    `INSERT INTO admin_invitations (email, admin_role, permissions, token_hash, invited_by, message, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [email, req.body.adminRole, req.body.permissions ? JSON.stringify(req.body.permissions) : null,
      hashToken(raw), req.user.id, req.body.message || null,
      new Date(Date.now() + config.admin.security.inviteExpiryHours * 3600 * 1000)]
  );

  const link = `${config.appUrl}/admin-invite?token=${raw}`;
  let delivered = false;
  if (config.smtp.enabled) {
    try {
      const { sendMail } = require('../services/mailer');
      await sendMail({
        to: email,
        subject: 'You have been invited to the Sawaari admin console',
        text: `You have been invited as ${rbac.ROLE_LABELS[req.body.adminRole]}.\nAccept the invitation here:\n\n${link}\n\nThis link expires in ${config.admin.security.inviteExpiryHours} hours.`,
      });
      delivered = true;
    } catch (err) { console.error('[super] invite email failed:', err.message); }
  }
  await audit.record(ctx(req), 'admin.invited', {
    targetType: 'admin', targetLabel: email,
    newValue: { adminRole: req.body.adminRole, delivered },
  });
  await notifyAdmins({
    type: 'admin_invite', title: 'New administrator invited',
    body: `${req.user.name} invited ${email} as ${rbac.ROLE_LABELS[req.body.adminRole]}.`,
    data: { url: '/admin/admins' },
  });
  res.status(201).json({
    ok: true,
    message: delivered
      ? `Invitation sent to ${email}.`
      : `Invitation created for ${email}. Email delivery is not configured — share this one-time link securely.`,
    invitationLink: delivered ? undefined : link,
    devLink: delivered ? undefined : link,
  });
}));

router.get('/invitations', rbac.requirePermission('admins.view'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT id, email, admin_role, message, expires_at, accepted_at, revoked_at, created_at
       FROM admin_invitations ORDER BY created_at DESC LIMIT 100`
  );
  res.json({
    invitations: rows.map((i) => ({
      id: i.id, email: i.email, adminRole: i.admin_role, roleLabel: rbac.ROLE_LABELS[i.admin_role],
      message: i.message, expiresAt: i.expires_at, acceptedAt: i.accepted_at,
      revokedAt: i.revoked_at, createdAt: i.created_at,
      status: i.accepted_at ? 'accepted' : i.revoked_at ? 'revoked' : new Date(i.expires_at) < new Date() ? 'expired' : 'pending',
    })),
  });
}));

router.post('/invitations/:id/revoke', rbac.requirePermission('admins.create'), asyncHandler(async (req, res) => {
  const inv = await one(`SELECT * FROM admin_invitations WHERE id=$1`, [req.params.id]);
  if (!inv) throw httpError(404, 'Invitation not found');
  await query(`UPDATE admin_invitations SET revoked_at=now() WHERE id=$1`, [req.params.id]);
  await query(
    `UPDATE admin_verification_tokens SET consumed_at=now() WHERE token_hash=$1 AND kind='invite'`, [inv.token_hash]
  );
  await audit.record(ctx(req), 'admin.invitation_revoked', {
    targetType: 'admin_invitation', targetId: inv.id, targetLabel: inv.email,
  });
  res.json({ ok: true });
}));

router.patch('/admins/:userId', rbac.requirePermission('admins.edit'), validate(z.object({
  adminRole: z.enum(['admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator']).optional(),
  permissions: z.object({ grant: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).optional(),
  name: z.string().trim().min(2).max(80).optional(),
})), asyncHandler(async (req, res) => {
  const target = await one(
    `SELECT ap.*, u.name, u.email FROM admin_profiles ap JOIN users u ON u.id=ap.user_id WHERE ap.user_id=$1`,
    [req.params.userId]
  );
  if (!target) throw httpError(404, 'Administrator not found');
  if (target.is_owner || target.admin_role === 'super_admin') {
    throw httpError(403, 'The platform owner account cannot be modified here.');
  }
  if (req.body.adminRole && rbac.PROTECTED_ROLES.includes(req.body.adminRole)) {
    throw httpError(403, 'That role cannot be assigned.');
  }
  const before = { adminRole: target.admin_role, permissions: target.permissions, name: target.name };
  if (req.body.adminRole) {
    await query(`UPDATE admin_profiles SET admin_role=$2, updated_at=now() WHERE user_id=$1`, [target.user_id, req.body.adminRole]);
    await query(`UPDATE users SET role=$2, updated_at=now() WHERE id=$1`, [target.user_id, req.body.adminRole]);
  }
  if (req.body.permissions) {
    await query(`UPDATE admin_profiles SET permissions=$2, updated_at=now() WHERE user_id=$1`,
      [target.user_id, JSON.stringify(req.body.permissions)]);
  }
  if (req.body.name) {
    await query(`UPDATE users SET name=$2, updated_at=now() WHERE id=$1`, [target.user_id, req.body.name]);
  }
  await audit.record(ctx(req), 'admin.updated', {
    targetType: 'admin', targetId: target.user_id, targetLabel: target.email,
    previousValue: before,
    newValue: { adminRole: req.body.adminRole || target.admin_role, permissions: req.body.permissions || target.permissions, name: req.body.name || target.name },
  });
  res.json({ ok: true, message: 'Administrator updated.' });
}));

router.post('/admins/:userId/suspend', rbac.requirePermission('admins.suspend'), validate(z.object({
  suspend: z.boolean(), reason: z.string().trim().min(3).max(300),
})), asyncHandler(async (req, res) => {
  const target = await one(
    `SELECT ap.*, u.email, u.name FROM admin_profiles ap JOIN users u ON u.id=ap.user_id WHERE ap.user_id=$1`,
    [req.params.userId]
  );
  if (!target) throw httpError(404, 'Administrator not found');
  if (target.is_owner || target.admin_role === 'super_admin') {
    throw httpError(403, 'The platform owner account cannot be suspended.');
  }
  if (target.user_id === req.user.id) throw httpError(400, 'You cannot suspend your own account.');
  await query(`UPDATE admin_profiles SET status=$2, updated_at=now() WHERE user_id=$1`,
    [target.user_id, req.body.suspend ? 'suspended' : 'active']);
  if (req.body.suspend) {
    await sessions.revoke(target.user_id, null, 'account_suspended');
  }
  await audit.record(ctx(req), req.body.suspend ? 'admin.suspended' : 'admin.reactivated', {
    targetType: 'admin', targetId: target.user_id, targetLabel: target.email,
    previousValue: { status: target.status }, newValue: { status: req.body.suspend ? 'suspended' : 'active', reason: req.body.reason },
  });
  res.json({ ok: true, message: req.body.suspend ? 'Administrator suspended and signed out everywhere.' : 'Administrator reactivated.' });
}));

router.delete('/admins/:userId', rbac.requirePermission('admins.remove'), asyncHandler(async (req, res) => {
  const target = await one(
    `SELECT ap.*, u.email FROM admin_profiles ap JOIN users u ON u.id=ap.user_id WHERE ap.user_id=$1`,
    [req.params.userId]
  );
  if (!target) throw httpError(404, 'Administrator not found');
  if (target.is_owner || target.admin_role === 'super_admin') {
    throw httpError(403, 'The platform owner account cannot be removed.');
  }
  if (target.user_id === req.user.id) throw httpError(400, 'You cannot remove your own account.');
  await sessions.revoke(target.user_id, null, 'account_removed');
  // Deactivate rather than delete — audit trails and financial records stay intact.
  await query(`UPDATE admin_profiles SET status='disabled', updated_at=now() WHERE user_id=$1`, [target.user_id]);
  await query(`UPDATE users SET is_active=false, blocked_reason='Administrator access removed', updated_at=now() WHERE id=$1`, [target.user_id]);
  await audit.record(ctx(req), 'admin.removed', {
    targetType: 'admin', targetId: target.user_id, targetLabel: target.email,
    previousValue: { status: target.status },
  });
  res.json({ ok: true, message: 'Administrator access removed. The account and its history are retained.' });
}));

/* ── 2FA management for administrators ─────────────────────── */
router.post('/admins/:userId/2fa/reset', rbac.requirePermission('admins.edit'), asyncHandler(async (req, res) => {
  const target = await one(
    `SELECT ap.*, u.email FROM admin_profiles ap JOIN users u ON u.id=ap.user_id WHERE ap.user_id=$1`,
    [req.params.userId]
  );
  if (!target) throw httpError(404, 'Administrator not found');
  if (target.is_owner) throw httpError(403, 'The platform owner must manage their own two-factor authentication.');
  await query(
    `UPDATE admin_profiles SET twofa_enabled=false, twofa_secret=NULL, twofa_backup_codes=NULL,
        twofa_confirmed_at=NULL, updated_at=now() WHERE user_id=$1`, [target.user_id]
  );
  await sessions.revoke(target.user_id, null, '2fa_reset');
  await audit.record(ctx(req), 'admin.2fa_reset', {
    targetType: 'admin', targetId: target.user_id, targetLabel: target.email,
  });
  res.json({ ok: true, message: 'Two-factor authentication reset. They must enrol again at next sign-in.' });
}));

/* ══════════════════════════════════════════════════════════════
   AUDIT LOG — read only, append-only at the database level
   ══════════════════════════════════════════════════════════════ */
router.get('/audit', rbac.requirePermission('audit.view'), validateQuery(z.object({
  q: z.string().optional(),
  action: z.string().optional(),
  category: z.string().optional(),
  adminId: z.string().uuid().optional(),
  result: z.enum(['success', 'failure', 'denied']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50), offset: z.coerce.number().min(0).default(0),
})), asyncHandler(async (req, res) => {
  const { q, action, category, adminId, result, from, to, limit, offset } = req.query;
  const where = `
    ($1 = '' OR a.action ILIKE '%'||$1||'%' OR COALESCE(a.target_label,'') ILIKE '%'||$1||'%'
                  OR COALESCE(a.admin_email,'') ILIKE '%'||$1||'%')
    AND ($2 = '' OR a.action ILIKE $2||'%')
    AND ($3 = '' OR a.category = $3)
    AND ($4::uuid IS NULL OR a.admin_id = $4)
    AND ($5 = '' OR a.result = $5)
    AND ($6::timestamptz IS NULL OR a.created_at >= $6::timestamptz)
    AND ($7::timestamptz IS NULL OR a.created_at <= $7::timestamptz)`;
  const params = [q || '', action || '', category || '', adminId || null, result || '', from || null, to || null];
  const rows = await many(
    `SELECT a.id, a.admin_id, a.admin_email, a.admin_role, a.action, a.category, a.target_type,
            a.target_id, a.target_label, a.previous_value, a.new_value, a.ip_address, a.user_agent,
            a.result, a.created_at
       FROM admin_audit_log a WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC LIMIT $8 OFFSET $9`,
    [...params, limit, offset]
  );
  const total = (await one(`SELECT count(*)::int AS c FROM admin_audit_log a WHERE ${where}`, params)).c;
  res.json({
    entries: rows.map((r) => ({
      id: r.id, adminId: r.admin_id, adminEmail: r.admin_email, adminRole: r.admin_role,
      action: r.action, category: r.category, targetType: r.target_type, targetId: r.target_id,
      targetLabel: r.target_label, previousValue: r.previous_value, newValue: r.new_value,
      ip: r.ip_address, userAgent: r.user_agent, result: r.result, createdAt: r.created_at,
    })),
    total,
  });
}));

router.get('/audit/export', rbac.requirePermission('audit.view'), validateQuery(z.object({
  action: z.string().optional(), category: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(),
})), asyncHandler(async (req, res) => {
  const { action, category, from, to } = req.query;
  const rows = await many(
    `SELECT created_at AS "Date/Time", admin_email AS "Admin Email", admin_role AS "Role",
            action AS "Action", category AS "Category", target_type AS "Target Type",
            target_label AS "Target", result AS "Result", ip_address AS "IP Address",
            previous_value::text AS "Previous Value", new_value::text AS "New Value"
       FROM admin_audit_log
      WHERE ($1 = '' OR action ILIKE $1||'%')
        AND ($2 = '' OR category = $2)
        AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)
        AND ($4::timestamptz IS NULL OR created_at <= $4::timestamptz)
      ORDER BY created_at DESC LIMIT 5000`,
    [action || '', category || '', from || null, to || null]
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sawaari-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(rowsToCsv(rows));
}));

/* ══════════════════════════════════════════════════════════════
   PLATFORM SETTINGS
   ══════════════════════════════════════════════════════════════ */
const SETTING_CATEGORIES = ['branding', 'contact', 'rules', 'policy', 'promotions', 'notifications', 'otp', 'gateway'];

router.get('/settings', rbac.requirePermission('settings.view'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT key, value, category, label, is_secret, updated_at FROM platform_settings ORDER BY category, key`
  );
  const out = {};
  for (const r of rows) {
    if (r.is_secret) continue;                 // never expose secrets to the client
    out[r.key] = r.value;
  }
  res.json({
    settings: out,
    meta: rows.map((r) => ({
      key: r.key, category: r.category, label: r.label,
      isSecret: r.is_secret, updatedAt: r.updated_at,
    })),
    categories: SETTING_CATEGORIES,
    // gateway credentials are configured through environment variables only
    gateway: {
      razorpayConfigured: config.razorpay.enabled,
      razorpayKeyId: config.razorpay.enabled ? `${config.razorpay.keyId.slice(0, 4)}••••${config.razorpay.keyId.slice(-4)}` : null,
      webhookConfigured: Boolean(config.razorpay.webhookSecret),
      smtpConfigured: config.smtp.enabled,
      pushConfigured: config.vapid.enabled,
      smsConfigured: config.sms.configured,
      note: 'Payment gateway and messaging credentials are read from environment variables and are never stored in the database.',
    },
  });
}));

router.put('/settings', rbac.requirePermission('settings.edit'), validate(z.object({
  settings: z.record(z.any()),
})), asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body.settings || {});
  const applied = [];
  for (const [key, value] of entries) {
    if (key.startsWith('razorpay.') || key.startsWith('smtp.') || key.startsWith('vapid.') || key.startsWith('jwt.')) {
      throw httpError(400, `"${key}" is configured through environment variables and cannot be changed here.`);
    }
    const existing = await one(`SELECT key FROM platform_settings WHERE key=$1`, [key]);
    if (existing) {
      await query(`UPDATE platform_settings SET value=$2, updated_by=$3, updated_at=now() WHERE key=$1`,
        [key, JSON.stringify(value), req.user.id]);
    } else {
      await query(`INSERT INTO platform_settings (key, value, updated_by, category) VALUES ($1,$2,$3,$4)
                   ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [key, JSON.stringify(value), req.user.id, key.startsWith('commission') ? 'rules' : 'general']);
    }
    applied.push(key);
  }
  settingsSvc.invalidate();
  await audit.record(ctx(req), 'setting.updated', {
    targetType: 'settings', targetLabel: applied.join(', '), newValue: req.body.settings,
  });
  res.json({ ok: true, message: `${applied.length} setting(s) saved.` });
}));

/* ══════════════════════════════════════════════════════════════
   REVENUE, EARNINGS & SETTLEMENTS
   ══════════════════════════════════════════════════════════════ */
router.get('/revenue', rbac.requirePermission('finance.view'), validateQuery(z.object({
  range: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('month'),
  city: z.string().optional(),
  driverId: z.string().uuid().optional(),
})), asyncHandler(async (req, res) => {
  const ranges = { day: '1 day', week: '7 days', month: '30 days', quarter: '90 days', year: '365 days' };
  const interval = ranges[req.query.range] || ranges.month;
  const [totals, byDay, byCity, drivers, methods, cashRecords, pending] = await Promise.all([
    one(`SELECT COALESCE(SUM(gross),0)::numeric AS gross, COALESCE(SUM(commission),0)::numeric AS commission,
                COALESCE(SUM(net),0)::numeric AS net, count(*)::int AS rides
           FROM driver_earnings WHERE created_at > now() - interval '${interval}'`),
    many(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS rides,
                 COALESCE(SUM(gross),0)::numeric AS gross, COALESCE(SUM(commission),0)::numeric AS commission,
                 COALESCE(SUM(net),0)::numeric AS net
            FROM driver_earnings WHERE created_at > now() - interval '${interval}'
           GROUP BY 1 ORDER BY 1`),
    many(`SELECT ci.name AS city, count(b.id)::int AS rides, COALESCE(SUM(b.final_fare),0)::numeric AS gross
            FROM bookings b JOIN cities ci ON ci.id=b.city_id
           WHERE b.created_at > now() - interval '${interval}' GROUP BY ci.name ORDER BY gross DESC`),
    many(`SELECT u.name, u.phone, dp.id AS driver_profile_id, count(de.id)::int AS rides,
                 COALESCE(SUM(de.gross),0)::numeric AS gross, COALESCE(SUM(de.commission),0)::numeric AS commission,
                 COALESCE(SUM(de.net),0)::numeric AS net
            FROM driver_earnings de JOIN driver_profiles dp ON dp.id=de.driver_profile_id
            JOIN users u ON u.id=dp.user_id
           WHERE de.created_at > now() - interval '${interval}'
           GROUP BY u.name, u.phone, dp.id ORDER BY gross DESC LIMIT 200`),
    many(`SELECT method, count(*)::int AS payments, COALESCE(SUM(amount),0)::numeric AS amount,
                 count(*) FILTER (WHERE status='paid')::int AS paid
            FROM payments WHERE created_at > now() - interval '${interval}' GROUP BY method`),
    many(`SELECT p.id, b.ref AS booking_ref, p.amount, p.status, p.created_at,
                 u.name AS passenger, du.name AS driver
            FROM payments p JOIN bookings b ON b.id=p.booking_id
            JOIN users u ON u.id=p.passenger_id
            LEFT JOIN driver_profiles dp ON dp.id=b.driver_profile_id
            LEFT JOIN users du ON du.id=dp.user_id
           WHERE p.method='cash' AND p.created_at > now() - interval '${interval}'
           ORDER BY p.created_at DESC LIMIT 100`),
    one(`SELECT count(*)::int AS c, COALESCE(SUM(amount),0)::numeric AS amount
           FROM payments WHERE status IN ('pending','awaiting_verification')`),
  ]);

  res.json({
    range: req.query.range,
    totals: {
      gross: round2(parseFloat(totals.gross)), commission: round2(parseFloat(totals.commission)),
      net: round2(parseFloat(totals.net)), rides: totals.rides,
    },
    byDay: byDay.map((d) => ({
      day: d.day, rides: d.rides, gross: round2(parseFloat(d.gross)),
      commission: round2(parseFloat(d.commission)), net: round2(parseFloat(d.net)),
    })),
    byCity: byCity.map((c) => ({ city: c.city, rides: c.rides, gross: round2(parseFloat(c.gross)) })),
    drivers: drivers.map((d) => ({
      name: d.name, phone: d.phone, driverProfileId: d.driver_profile_id, rides: d.rides,
      gross: round2(parseFloat(d.gross)), commission: round2(parseFloat(d.commission)),
      net: round2(parseFloat(d.net)),
    })),
    methods: methods.map((m) => ({
      method: m.method, payments: m.payments, paid: m.paid, amount: round2(parseFloat(m.amount)),
    })),
    cashRecords: cashRecords.map((c) => ({
      id: c.id, bookingRef: c.booking_ref, amount: parseFloat(c.amount), status: c.status,
      passenger: c.passenger, driver: c.driver, createdAt: c.created_at,
    })),
    pendingPayments: { count: pending.c, amount: round2(parseFloat(pending.amount)) },
  });
}));

router.get('/settlements', rbac.requirePermission('finance.view'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT s.id, s.period_start, s.period_end, s.gross, s.commission, s.net, s.rides,
            s.status, s.reference, s.paid_at, s.created_at, u.name AS driver_name, u.phone AS driver_phone
       FROM settlements s JOIN driver_profiles dp ON dp.id=s.driver_profile_id
       JOIN users u ON u.id=dp.user_id
      ORDER BY s.created_at DESC LIMIT 200`
  );
  res.json({
    settlements: rows.map((s) => ({
      id: s.id, driverName: s.driver_name, driverPhone: s.driver_phone,
      periodStart: s.period_start, periodEnd: s.period_end,
      gross: round2(parseFloat(s.gross)), commission: round2(parseFloat(s.commission)),
      net: round2(parseFloat(s.net)), rides: s.rides, status: s.status,
      reference: s.reference, paidAt: s.paid_at, createdAt: s.created_at,
    })),
  });
}));

router.post('/settlements', rbac.requirePermission('finance.view'), validate(z.object({
  driverProfileId: z.string().uuid(),
  periodStart: z.string(), periodEnd: z.string(),
  reference: z.string().trim().max(80).optional(),
})), asyncHandler(async (req, res) => {
  const start = new Date(req.body.periodStart);
  const end = new Date(req.body.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw httpError(400, 'Invalid settlement period');
  }
  const agg = await one(
    `SELECT COALESCE(SUM(gross),0)::numeric AS gross, COALESCE(SUM(commission),0)::numeric AS commission,
            COALESCE(SUM(net),0)::numeric AS net, count(*)::int AS rides
       FROM driver_earnings
      WHERE driver_profile_id=$1 AND created_at >= $2 AND created_at < ($3::date + interval '1 day')`,
    [req.body.driverProfileId, start, end]
  );
  if (!agg || agg.rides === 0) throw httpError(422, 'No driver earnings in that period.');
  const { rows } = await query(
    `INSERT INTO settlements (driver_profile_id, period_start, period_end, gross, commission, net, rides, reference, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.body.driverProfileId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10),
      agg.gross, agg.commission, agg.net, agg.rides, req.body.reference || null, req.user.id]
  );
  await audit.record(ctx(req), 'settlement.created', {
    targetType: 'settlement', targetId: rows[0].id, targetLabel: req.body.driverProfileId,
    newValue: { gross: round2(parseFloat(agg.gross)), net: round2(parseFloat(agg.net)), rides: agg.rides },
  });
  res.status(201).json({ ok: true, settlement: rows[0], message: 'Settlement recorded.' });
}));

router.post('/settlements/:id/paid', rbac.requirePermission('finance.view'), validate(z.object({
  reference: z.string().trim().min(2).max(80),
})), asyncHandler(async (req, res) => {
  const s = await one(`SELECT * FROM settlements WHERE id=$1`, [req.params.id]);
  if (!s) throw httpError(404, 'Settlement not found');
  if (s.status === 'paid') throw httpError(409, 'This settlement is already marked paid.');
  await query(`UPDATE settlements SET status='paid', reference=$2, paid_at=now() WHERE id=$1`, [s.id, req.body.reference]);
  await audit.record(ctx(req), 'settlement.paid', {
    targetType: 'settlement', targetId: s.id, targetLabel: req.body.reference,
    previousValue: { status: s.status }, newValue: { status: 'paid', reference: req.body.reference },
  });
  res.json({ ok: true, message: 'Settlement marked as paid.' });
}));

/* ══════════════════════════════════════════════════════════════
   REFUNDS — recorded as new rows; payment records are never edited
   ══════════════════════════════════════════════════════════════ */
router.get('/refunds', rbac.requirePermission('payments.view'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT r.*, b.ref AS booking_ref, p.method AS payment_method, p.status AS payment_status,
            p.amount AS payment_amount, u.name AS passenger, du.name AS driver
       FROM refunds r JOIN payments p ON p.id=r.payment_id
       LEFT JOIN bookings b ON b.id=r.booking_id
       JOIN users u ON u.id=p.passenger_id
       LEFT JOIN driver_profiles dp ON dp.id=b.driver_profile_id
       LEFT JOIN users du ON du.id=dp.user_id
      ORDER BY r.created_at DESC LIMIT 200`
  );
  res.json({
    refunds: rows.map((r) => ({
      id: r.id, paymentId: r.payment_id, bookingRef: r.booking_ref, amount: parseFloat(r.amount),
      reason: r.reason, method: r.method, status: r.status, gatewayRef: r.gateway_ref,
      notes: r.notes, passenger: r.passenger, driver: r.driver,
      paymentMethod: r.payment_method, paymentStatus: r.payment_status,
      paymentAmount: parseFloat(r.payment_amount),
      createdAt: r.created_at, completedAt: r.completed_at,
    })),
    gatewayConfigured: config.razorpay.enabled,
  });
}));

router.post('/refunds', rbac.requirePermission('payments.refund'), validate(z.object({
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().trim().min(5).max(300),
  method: z.enum(['razorpay', 'upi', 'cash', 'manual']),
  notes: z.string().trim().max(500).optional(),
})), asyncHandler(async (req, res) => {
  const payment = await one(
    `SELECT p.*, b.ref AS booking_ref FROM payments p LEFT JOIN bookings b ON b.id=p.booking_id WHERE p.id=$1`,
    [req.body.paymentId]
  );
  if (!payment) throw httpError(404, 'Payment not found');
  if (payment.status !== 'paid') throw httpError(409, 'Only settled payments can be refunded.');
  const already = await one(
    `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM refunds WHERE payment_id=$1 AND status IN ('pending','processing','completed')`,
    [payment.id]
  );
  const refundedSoFar = parseFloat(already.total);
  const paymentAmount = parseFloat(payment.amount);
  if (refundedSoFar + req.body.amount > paymentAmount + 0.009) {
    throw httpError(409, `Refund exceeds the remaining refundable amount (₹${(paymentAmount - refundedSoFar).toFixed(2)}).`);
  }

  let gatewayRef = null;
  let gatewayResponse = null;
  if (req.body.method === 'razorpay') {
    if (!config.razorpay.enabled) {
      throw httpError(503, 'The payment gateway is not configured on this server. Record the refund with method "manual" and settle it through your bank/UPI provider.');
    }
    if (!payment.rzp_payment_id) {
      throw httpError(422, 'This payment has no gateway reference, so it cannot be refunded through the gateway.');
    }
    const result = await razorpaySvc.refundPayment(payment.rzp_payment_id, req.body.amount);
    gatewayRef = result.refund ? result.refund.id : (result.id || null);
    gatewayResponse = { refundId: gatewayRef, status: result.refund ? result.refund.status : (result.status || 'processed') };
  }

  const { rows } = await query(
    `INSERT INTO refunds (payment_id, booking_id, amount, reason, method, status, gateway_ref, gateway_response, notes, initiated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [payment.id, payment.booking_id, req.body.amount, req.body.reason, req.body.method,
      req.body.method === 'razorpay' ? 'processing' : 'pending', gatewayRef,
      gatewayResponse ? JSON.stringify(gatewayResponse) : null, req.body.notes || null, req.user.id]
  );

  await audit.record(ctx(req), 'refund.created', {
    targetType: 'payment', targetId: payment.id, targetLabel: payment.booking_ref || payment.id,
    newValue: { amount: req.body.amount, method: req.body.method, reason: req.body.reason, gatewayRef },
  });
  res.status(201).json({
    ok: true,
    refund: rows[0],
    message: req.body.method === 'razorpay'
      ? 'Refund sent to the gateway and recorded. It will show as paid once the provider confirms.'
      : 'Refund recorded. Settle it through the original payment method and mark it paid.',
  });
}));

router.post('/refunds/:id/complete', rbac.requirePermission('payments.refund'), validate(z.object({
  notes: z.string().trim().max(500).optional(),
})), asyncHandler(async (req, res) => {
  const refund = await one(`SELECT * FROM refunds WHERE id=$1`, [req.params.id]);
  if (!refund) throw httpError(404, 'Refund not found');
  if (refund.status === 'completed') throw httpError(409, 'This refund is already complete.');
  await query(`UPDATE refunds SET status='completed', completed_at=now(), notes=COALESCE($2, notes) WHERE id=$1`,
    [refund.id, req.body.notes || null]);
  await audit.record(ctx(req), 'refund.completed', {
    targetType: 'refund', targetId: refund.id, targetLabel: refund.gateway_ref,
    previousValue: { status: refund.status }, newValue: { status: 'completed' },
  });
  res.json({ ok: true, message: 'Refund marked as completed.' });
}));

/* ══════════════════════════════════════════════════════════════
   NOTIFICATIONS / BROADCASTS
   ══════════════════════════════════════════════════════════════ */
router.get('/notifications', rbac.requirePermission('settings.view'), asyncHandler(async (_req, res) => {
  const rows = await many(
    `SELECT id, title, body, audience, audience_filter, recipients, delivered, status, created_at
       FROM admin_broadcasts ORDER BY created_at DESC LIMIT 100`
  );
  res.json({
    broadcasts: rows.map((b) => ({
      id: b.id, title: b.title, body: b.body, audience: b.audience,
      recipients: b.recipients, delivered: b.delivered, status: b.status, createdAt: b.created_at,
    })),
  });
}));

router.post('/notifications/send', rbac.requirePermission('notifications.send'), validate(z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1000),
  audience: z.enum(['all', 'passengers', 'drivers', 'admins', 'city', 'user']),
  audienceFilter: z.record(z.any()).optional(),
})), asyncHandler(async (req, res) => {
  const { audience, audienceFilter } = req.body;
  let targets = [];
  if (audience === 'all') {
    targets = (await many(`SELECT id FROM users WHERE is_active`)).map((u) => u.id);
  } else if (audience === 'passengers') {
    targets = (await many(`SELECT id FROM users WHERE role='passenger' AND is_active`)).map((u) => u.id);
  } else if (audience === 'drivers') {
    targets = (await many(
      `SELECT u.id FROM users u JOIN driver_profiles dp ON dp.user_id=u.id
        WHERE u.role='driver' AND u.is_active AND dp.verification_status='approved'`
    )).map((u) => u.id);
  } else if (audience === 'admins') {
    targets = (await many(
      `SELECT u.id FROM users u JOIN admin_profiles ap ON ap.user_id=u.id WHERE ap.status='active'`
    )).map((u) => u.id);
  } else if (audience === 'city') {
    const city = audienceFilter && audienceFilter.cityId;
    if (!city) throw httpError(400, 'Choose a city for this notification.');
    targets = (await many(
      `SELECT DISTINCT u.id FROM users u JOIN bookings b ON b.passenger_id=u.id WHERE b.city_id=$1 AND u.is_active`,
      [city]
    )).map((u) => u.id);
  } else if (audience === 'user') {
    const userId = audienceFilter && audienceFilter.userId;
    if (!userId) throw httpError(400, 'Choose a user for this notification.');
    targets = [userId];
  }

  let delivered = 0;
  for (const userId of targets) {
    try {
      await notify(userId, {
        type: 'admin_broadcast', title: req.body.title, body: req.body.body,
        data: { url: audienceFilter && audienceFilter.url ? audienceFilter.url : '/app' },
      });
      delivered += 1;
    } catch { /* individual delivery failure is tolerated */ }
  }
  const { rows } = await query(
    `INSERT INTO admin_broadcasts (title, body, audience, audience_filter, sent_by, recipients, delivered, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'sent') RETURNING *`,
    [req.body.title, req.body.body, audience, audienceFilter ? JSON.stringify(audienceFilter) : null,
      req.user.id, targets.length, delivered]
  );
  await audit.record(ctx(req), 'notification.sent', {
    targetType: 'broadcast', targetId: rows[0].id, targetLabel: audience,
    newValue: { title: req.body.title, audience, recipients: targets.length, delivered },
  });
  res.status(201).json({ ok: true, recipients: targets.length, delivered, message: `Notification delivered to ${delivered} of ${targets.length} recipient(s).` });
}));

/* ══════════════════════════════════════════════════════════════
   SECURITY CENTER
   ══════════════════════════════════════════════════════════════ */
router.get('/security', rbac.requirePermission('settings.view'), asyncHandler(async (req, res) => {
  const [logins, failures, lockouts, sessionsNow, policies] = await Promise.all([
    many(`SELECT id, email, ip_address, success, reason, created_at FROM admin_login_attempts
           ORDER BY created_at DESC LIMIT 100`),
    many(`SELECT email, count(*)::int AS failures, max(created_at) AS last_attempt
            FROM admin_login_attempts WHERE success=false AND created_at > now() - interval '7 days'
           GROUP BY email ORDER BY failures DESC LIMIT 50`),
    many(`SELECT u.name, u.email, ap.failed_attempts, ap.locked_until, ap.last_login_at, ap.last_login_ip
            FROM admin_profiles ap JOIN users u ON u.id=ap.user_id
           WHERE ap.locked_until IS NOT NULL OR ap.failed_attempts > 0
           ORDER BY ap.locked_until DESC NULLS LAST LIMIT 50`),
    sessions.listSessions(req.user.id),
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int AS active
           FROM admin_sessions`),
  ]);
  res.json({
    policy: {
      maxLoginAttempts: config.admin.security.maxLoginAttempts,
      lockoutMinutes: config.admin.security.lockoutMinutes,
      maxFailedAttempts: config.admin.security.maxFailedAttempts,
      accountLockMinutes: config.admin.security.accountLockMinutes,
      sessionHours: sessions.ABSOLUTE_TTL_HOURS,
      idleHours: sessions.IDLE_TTL_HOURS,
      twoFactorEnforced: true,
      emailVerificationEnforced: true,
    },
    mySessions: sessionsNow,
    sessionTotals: policies,
    loginHistory: logins.map((l) => ({
      id: l.id, email: l.email, ip: l.ip_address, success: l.success, reason: l.reason, at: l.created_at,
    })),
    failedByEmail: failures.map((f) => ({
      email: f.email, failures: f.failures, lastAttempt: f.last_attempt,
    })),
    lockedAccounts: lockouts.map((l) => ({
      name: l.name, email: l.email, failedAttempts: l.failed_attempts,
      lockedUntil: l.locked_until, lastLoginAt: l.last_login_at, lastLoginIp: l.last_login_ip,
    })),
  });
}));

router.post('/security/sessions/:id/revoke', rbac.requirePermission('settings.security'), asyncHandler(async (req, res) => {
  const s = await one(`SELECT * FROM admin_sessions WHERE id=$1`, [req.params.id]);
  if (!s) throw httpError(404, 'Session not found');
  await sessions.revoke(s.admin_user_id, s.id, 'revoked_by_admin');
  await audit.record(ctx(req), 'session.revoked', {
    targetType: 'admin_session', targetId: s.id, targetLabel: s.ip_address,
  });
  res.json({ ok: true, message: 'Session revoked.' });
}));

router.post('/security/sessions/revoke-all', rbac.requirePermission('settings.security'), asyncHandler(async (req, res) => {
  const body = await one(`SELECT * FROM admin_profiles WHERE user_id=$1`, [req.user.id]);
  const targetId = req.body && req.body.userId ? req.body.userId : req.user.id;
  if (targetId !== req.user.id && !req.adminProfile || (targetId !== req.user.id && req.adminProfile.admin_role !== 'super_admin')) {
    throw httpError(403, 'Only the Super Admin can sign other administrators out everywhere.');
  }
  await sessions.revoke(targetId, null, 'revoke_all');
  await audit.record(ctx(req), 'session.revoked_all', {
    targetType: 'admin', targetId: targetId,
  });
  res.json({ ok: true, message: 'All sessions signed out.' });
}));

router.post('/security/change-password', validate(z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Use at least 12 characters').max(72),
})), asyncHandler(async (req, res) => {
  const user = await one(`SELECT id, email, password_hash FROM users WHERE id=$1`, [req.user.id]);
  const ok = await bcrypt.compare(req.body.currentPassword, user.password_hash);
  if (!ok) throw httpError(401, 'Your current password is incorrect.');
  const hash = await bcrypt.hash(req.body.newPassword, 12);
  await query(`UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, [user.id, hash]);
  await sessions.revoke(user.id, null, 'password_changed');
  await audit.record(ctx(req), 'admin.password_changed', { targetType: 'admin', targetId: user.id, targetLabel: user.email });
  res.json({ ok: true, message: 'Password changed. Every session was signed out — sign in again.' });
}));

/* ══════════════════════════════════════════════════════════════
   COMMISSION — owned by the finance role
   ══════════════════════════════════════════════════════════════ */
router.post('/finance/commission', rbac.requirePermission('finance.settings'), validate(z.object({
  percent: z.number().min(0).max(50),
})), asyncHandler(async (req, res) => {
  const before = await settingsSvc.getSetting('commission_percent');
  await query(
    `INSERT INTO platform_settings (key, value, updated_by, category, label)
     VALUES ('commission_percent', $1::jsonb, $2, 'rules', 'Platform commission percent')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [JSON.stringify(req.body.percent), req.user.id]
  );
  settingsSvc.invalidate();
  await audit.record(ctx(req), 'setting.commission_updated', {
    targetType: 'settings', targetLabel: 'commission_percent',
    previousValue: { commission_percent: before }, newValue: { commission_percent: req.body.percent },
  });
  res.json({ ok: true, commissionPercent: req.body.percent, message: `Platform commission set to ${req.body.percent}%.` });
}));

module.exports = router;
