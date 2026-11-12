const express = require('express');
const { z } = require('zod');
const { query, one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, httpError } = require('../utils');
const { notify, notifyAdmins } = require('../services/notify');

const router = express.Router();

/** POST /api/support/tickets */
router.post('/tickets', requireAuth, validate(z.object({
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(5).max(3000),
  bookingId: z.string().uuid().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
})), asyncHandler(async (req, res) => {
  if (req.body.bookingId) {
    const b = await one(`SELECT id, passenger_id FROM bookings WHERE id=$1`, [req.body.bookingId]);
    if (!b) throw httpError(404, 'Booking not found');
  }
  const { rows } = await query(
    `INSERT INTO support_tickets (user_id, booking_id, subject, priority)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, req.body.bookingId || null, req.body.subject, req.body.priority]
  );
  await query(`INSERT INTO ticket_messages (ticket_id, sender_id, body) VALUES ($1,$2,$3)`,
    [rows[0].id, req.user.id, req.body.message]);
  await notifyAdmins({
    type: 'support_ticket', title: 'New support ticket',
    body: `${req.body.subject} (${req.body.priority}) — from ${req.user.name}`,
    data: { url: '/admin/tickets', ticketId: rows[0].id },
  });
  res.status(201).json(rows[0]);
}));

/** GET /api/support/tickets — my tickets with messages */
router.get('/tickets', requireAuth, asyncHandler(async (req, res) => {
  const tickets = await many(
    `SELECT t.*, (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id=t.id) AS message_count
       FROM support_tickets t WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 50`, [req.user.id]
  );
  const withMessages = await Promise.all(tickets.map(async (t) => {
    const messages = await many(
      `SELECT m.body, m.sender_id, m.created_at, u.name AS sender_name, u.role AS sender_role
         FROM ticket_messages m JOIN users u ON u.id=m.sender_id
        WHERE m.ticket_id=$1 ORDER BY m.created_at`, [t.id]
    );
    return { ...t, messages };
  }));
  res.json(withMessages);
}));

/** POST /api/support/tickets/:id/reply — ticket owner appends a message */
router.post('/tickets/:id/reply', requireAuth, validate(z.object({
  body: z.string().trim().min(1).max(2000),
})), asyncHandler(async (req, res) => {
  const t = await one(`SELECT * FROM support_tickets WHERE id=$1`, [req.params.id]);
  if (!t) throw httpError(404, 'Ticket not found');
  if (t.user_id !== req.user.id) throw httpError(403, 'This is not your ticket');
  if (['resolved', 'closed'].includes(t.status))
    throw httpError(409, 'This ticket is closed. Please open a new one.');
  const { rows } = await query(
    `INSERT INTO ticket_messages (ticket_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *`,
    [t.id, req.user.id, req.body.body]
  );
  await query(`UPDATE support_tickets SET updated_at=now() WHERE id=$1`, [t.id]);
  res.status(201).json(rows[0]);
}));

/** POST /api/support/reports — report a user (driver/passenger) */
router.post('/reports', requireAuth, validate(z.object({
  againstUserId: z.string().uuid(),
  bookingId: z.string().uuid().optional(),
  reason: z.enum(['rude_behaviour', 'unsafe_driving', 'overcharged', 'no_show', 'harassment', 'other']),
  details: z.string().trim().max(2000).optional(),
})), asyncHandler(async (req, res) => {
  const target = await one(`SELECT id FROM users WHERE id=$1 AND is_active`, [req.body.againstUserId]);
  if (!target) throw httpError(404, 'Reported user not found');
  if (target.id === req.user.id) throw httpError(400, 'You cannot report yourself');
  const { rows } = await query(
    `INSERT INTO user_reports (reporter_id, against_user_id, booking_id, reason, details)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, req.body.againstUserId, req.body.bookingId || null, req.body.reason, req.body.details || null]
  );
  await notifyAdmins({
    type: 'user_report', title: 'New user report',
    body: `${req.user.name} reported a ${req.body.reason.replace('_', ' ')} incident.`,
    data: { url: '/admin/reports', reportId: rows[0].id },
  });
  res.status(201).json(rows[0]);
}));

module.exports = router;
