const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { query, one, many, withTransaction } = require('../db');
const { requireAuth, role } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, httpError } = require('../utils');
const rides = require('../services/rides');
const razorpaySvc = require('../services/razorpay');
const upiSvc = require('../services/upi');
const { notify } = require('../services/notify');
const { getSettings } = require('../services/settings');

const router = express.Router();

async function getPaymentContext(bookingId, user) {
  const b = await rides.getBooking(bookingId);
  if (!b) throw httpError(404, 'Booking not found');
  if (b.passenger_id !== user.id && b.driver_user_id !== user.id && user.role !== 'admin')
    throw httpError(403, 'Not your ride');
  return b;
}

/** GET /api/payments/config — honest capability flags for the UI */
router.get('/config', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  res.json({
    razorpay: { enabled: razorpaySvc.enabled(), keyId: razorpaySvc.keyId() || null },
    currency: settings.currency || 'INR',
  });
}));

/** GET /api/payments/booking/:bookingId — payments for a ride */
router.get('/booking/:bookingId', requireAuth, asyncHandler(async (req, res) => {
  const b = await getPaymentContext(req.params.bookingId, req.user);
  const rows = await many(
    `SELECT p.*, u.name AS verifier_name FROM payments p
     LEFT JOIN users u ON u.id = p.verified_by WHERE p.booking_id=$1 ORDER BY p.created_at DESC`,
    [b.id]
  );
  res.json(rows.map((p) => ({
    id: p.id, method: p.method, amount: parseFloat(p.amount), status: p.status,
    upiIntentUrl: p.upi_intent_url, upiTxnRef: p.upi_txn_ref, upiVpa: p.upi_vpa,
    passengerUtr: p.passenger_utr, rzpPaymentId: p.rzp_payment_id, rzpRefundId: p.rzp_refund_id,
    refundedAmount: parseFloat(p.refunded_amount), failureReason: p.failure_reason,
    verifiedAt: p.verified_at, verifiedBy: p.verifier_name, createdAt: p.created_at,
  })));
}));

/** POST /api/payments/booking/:bookingId/online — create Razorpay order */
router.post('/booking/:bookingId/online', requireAuth, role('passenger'), asyncHandler(async (req, res) => {
  const b = await getPaymentContext(req.params.bookingId, req.user);
  if (b.status !== 'completed') throw httpError(409, 'Pay after the ride is completed.');
  const amount = parseFloat(b.final_fare ?? b.estimated_fare);
  const existingPaid = await one(
    `SELECT id FROM payments WHERE booking_id=$1 AND status='paid'`, [b.id]
  );
  if (existingPaid) throw httpError(409, 'This ride is already paid.');

  const order = await razorpaySvc.createOrder({
    amountRupees: amount, receipt: b.ref,
    notes: { bookingId: b.id, bookingRef: b.ref, passengerId: b.passenger_id },
  });
  const { rows } = await query(
    `INSERT INTO payments (booking_id, passenger_id, method, amount, status, rzp_order_id)
     VALUES ($1,$2,'online',$3,'pending',$4)
     ON CONFLICT (rzp_order_id) DO UPDATE SET updated_at=now() RETURNING *`,
    [b.id, b.passenger_id, amount, order.id]
  );
  res.status(201).json({
    paymentId: rows[0].id, orderId: order.id, amountRupees: amount,
    currency: order.currency, keyId: razorpaySvc.keyId(),
  });
}));

/** POST /api/payments/razorpay/verify — verify checkout signature (real verification) */
router.post('/razorpay/verify', requireAuth, validate(z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
})), asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const payment = await one(`SELECT * FROM payments WHERE rzp_order_id=$1`, [razorpay_order_id]);
  if (!payment) throw httpError(404, 'Payment record not found');
  if (payment.passenger_id !== req.user.id) throw httpError(403, 'Not your payment');
  if (payment.status === 'paid') return res.json({ ok: true, alreadyVerified: true });

  const valid = razorpaySvc.verifyCheckoutSignature(req.body);
  if (!valid) {
    await query(`UPDATE payments SET status='failed', failure_reason='signature mismatch', updated_at=now() WHERE id=$1`, [payment.id]);
    throw httpError(400, 'Payment verification failed. If money was deducted it will be auto-refunded by the gateway.');
  }
  const b = await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE payments SET status='paid', rzp_payment_id=$2, rzp_signature=$3,
              verified_at=now(), verified_by=$4, updated_at=now() WHERE id=$1`,
      [payment.id, razorpay_payment_id, razorpay_signature, req.user.id]
    );
    const r = await tx.query(
      `UPDATE bookings SET payment_status='paid', updated_at=now() WHERE id=$1 RETURNING *`, [payment.booking_id]
    );
    return r.rows[0];
  });
  const driverUserId = b.driver_user_id;
  await notify(b.passenger_id, {
    type: 'payment_verified', title: 'Payment successful',
    body: `₹${payment.amount} paid for ride ${b.ref}.`,
    data: { bookingId: b.id, url: `/app/ride/${b.id}` },
  });
  if (driverUserId) await notify(driverUserId, {
    type: 'payment_received', title: 'Payment received',
    body: `₹${payment.amount} received for ride ${b.ref} (online payment).`,
    data: { bookingId: b.id, url: '/driver' },
  });
  res.json({ ok: true, verified: true });
}));

/** POST /api/payments/webhooks/razorpay — server-to-server verification (raw body, HMAC-checked) */
router.post('/webhooks/razorpay', asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.body.toString('utf8');
  if (!razorpaySvc.verifyWebhookSignature(raw, signature)) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }
  const event = JSON.parse(raw);
  if (event.event === 'payment.captured') {
    const paymentEntity = event.payload.payment.entity;
    const order = await one(`SELECT * FROM payments WHERE rzp_order_id=$1`, [paymentEntity.order_id]);
    if (order && order.status !== 'paid') {
      await query(
        `UPDATE payments SET status='paid', rzp_payment_id=$2, verified_at=now(),
                meta = meta || $3::jsonb, updated_at=now() WHERE id=$1`,
        [order.id, paymentEntity.id, JSON.stringify({ webhook: 'payment.captured' })]
      );
      const b = await one(`UPDATE bookings SET payment_status='paid' WHERE id=$1 RETURNING *`, [order.booking_id]);
      if (b) {
        await notify(b.passenger_id, {
          type: 'payment_verified', title: 'Payment successful',
          body: `₹${order.amount} for ride ${b.ref} was confirmed by the payment gateway.`,
          data: { bookingId: b.id, url: `/app/ride/${b.id}` },
        });
        if (b.driver_user_id) await notify(b.driver_user_id, {
          type: 'payment_received', title: 'Payment received',
          body: `₹${order.amount} received for ride ${b.ref} (online payment).`,
          data: { bookingId: b.id, url: '/driver' },
        });
      }
    }
  }
  if (event.event === 'refund.processed') {
    const paymentEntity = event.payload.payment.entity;
    await query(
      `UPDATE payments SET status='refunded', refunded_amount=$2, updated_at=now()
        WHERE rzp_payment_id=$1 AND status='paid'`,
      [paymentEntity.id, paymentEntity.amount / 100]
    );
  }
  res.json({ received: true });
}));

/** POST /api/payments/booking/:bookingId/upi — direct driver UPI intent + QR */
router.post('/booking/:bookingId/upi', requireAuth, role('passenger'), asyncHandler(async (req, res) => {
  const b = await getPaymentContext(req.params.bookingId, req.user);
  if (b.status !== 'completed') throw httpError(409, 'Pay after the ride is completed.');
  const alreadyPaid = await one(`SELECT id FROM payments WHERE booking_id=$1 AND status='paid'`, [b.id]);
  if (alreadyPaid) throw httpError(409, 'This ride is already paid.');

  const dp = await one(
    `SELECT dp.upi_id, dp.upi_verified, u.name FROM driver_profiles dp JOIN users u ON u.id=dp.user_id WHERE dp.id=$1`,
    [b.driver_profile_id]
  );
  if (!dp || !dp.upi_id) throw httpError(409, 'This driver has not added a UPI ID yet. Use online payment or cash.');
  if (!dp.upi_verified) throw httpError(409, 'The driver\'s UPI ID is pending verification by Sawaari. Use online payment or cash.');

  const amount = parseFloat(b.final_fare ?? b.estimated_fare);
  const txnRef = `SW${b.ref.replace('-', '')}`;

  // reuse existing pending record for this booking+method if present
  let payment = await one(
    `SELECT * FROM payments WHERE booking_id=$1 AND method='upi_qr' AND status IN ('pending','awaiting_verification') ORDER BY created_at DESC LIMIT 1`,
    [b.id]
  );
  if (!payment) {
    const { rows } = await query(
      `INSERT INTO payments (booking_id, passenger_id, method, amount, status, upi_txn_ref, upi_vpa)
       VALUES ($1,$2,'upi_qr',$3,'pending',$4,$5) RETURNING *`,
      [b.id, b.passenger_id, amount, txnRef, dp.upi_id]
    );
    payment = rows[0];
  }
  const intentUrl = upiSvc.buildIntent({
    payeeVpa: dp.upi_id, payeeName: dp.name, amountRupees: amount,
    txnRef: payment.upi_txn_ref, note: `Sawaari ride ${b.ref}`,
  });
  const qrDataUrl = await upiSvc.buildQrDataUrl(intentUrl);
  await query(`UPDATE payments SET upi_intent_url=$2 WHERE id=$1`, [payment.id, intentUrl]);
  res.json({
    paymentId: payment.id, amount, upiVpa: dp.upi_id, driverName: dp.name,
    intentUrl, qrDataUrl, txnRef: payment.upi_txn_ref,
    note: 'Scan with any UPI app (GPay/PhonePe/Paytm/BHIM). After paying, submit the 12-digit UTR so we can verify it.',
  });
}));

/** POST /api/payments/booking/:bookingId/utr — passenger submits UTR (stays pending until verified) */
router.post('/booking/:bookingId/utr', requireAuth, role('passenger'), validate(z.object({
  utr: z.string().regex(/^\d{12}$/, 'UTR is the 12-digit reference number in your UPI app'),
})), asyncHandler(async (req, res) => {
  const b = await getPaymentContext(req.params.bookingId, req.user);
  const payment = await one(
    `SELECT * FROM payments WHERE booking_id=$1 AND method='upi_qr' AND status IN ('pending','awaiting_verification')
     ORDER BY created_at DESC LIMIT 1`, [b.id]
  );
  if (!payment) throw httpError(404, 'No UPI payment in progress. Generate the QR first.');
  await query(
    `UPDATE payments SET passenger_utr=$2, status='awaiting_verification', updated_at=now() WHERE id=$1`,
    [payment.id, req.body.utr]
  );
  const { notifyAdmins } = require('../services/notify');
  await notifyAdmins({
    type: 'payment_verification', title: 'UPI payment to verify',
    body: `Ride ${b.ref}: passenger submitted UTR ${req.body.utr} for ₹${payment.amount}. Verify against the driver's UPI statement.`,
    data: { bookingId: b.id, url: '/admin/payments', paymentId: payment.id },
  });
  res.json({
    ok: true, status: 'awaiting_verification',
    message: 'Thanks! Your payment is being verified — it will be confirmed shortly.',
  });
}));

/** POST /api/payments/booking/:bookingId/cash — driver confirms cash collected */
router.post('/booking/:bookingId/cash', requireAuth, role('driver'), asyncHandler(async (req, res) => {
  const b = await getPaymentContext(req.params.bookingId, req.user);
  if (b.driver_user_id !== req.user.id) throw httpError(403, 'Not your ride');
  if (b.status !== 'completed') throw httpError(409, 'Ride not completed yet');
  const alreadyPaid = await one(`SELECT id FROM payments WHERE booking_id=$1 AND status='paid'`, [b.id]);
  if (alreadyPaid) throw httpError(409, 'Already marked paid');
  const amount = parseFloat(b.final_fare ?? b.estimated_fare);
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO payments (booking_id, passenger_id, method, amount, status, verified_at)
       VALUES ($1,$2,'cash',$3,'paid',now())`,
      [b.id, b.passenger_id, amount]
    );
    await tx.query(`UPDATE bookings SET payment_status='paid' WHERE id=$1`, [b.id]);
  });
  await notify(b.passenger_id, {
    type: 'payment_recorded', title: 'Cash payment recorded',
    body: `Driver recorded cash payment of ₹${amount} for ride ${b.ref}.`,
    data: { bookingId: b.id, url: `/app/ride/${b.id}` },
  });
  res.json({ ok: true, method: 'cash' });
}));

/** GET /api/payments/mine — my payment history */
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const driverProfile = req.user.role === 'driver'
    ? await one(`SELECT id FROM driver_profiles WHERE user_id=$1`, [req.user.id]) : null;
  const rows = await many(
    `SELECT p.id, p.booking_id, p.method, p.amount, p.status, p.created_at, p.verified_at,
            b.ref AS booking_ref, b.pickup_address, b.drop_address, b.final_fare
       FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.passenger_id = $1 ${driverProfile ? `OR EXISTS (
            SELECT 1 FROM bookings b2 WHERE b2.id = p.booking_id AND b2.driver_profile_id = $2)` : ''}
      ORDER BY p.created_at DESC LIMIT 100`,
    driverProfile ? [req.user.id, driverProfile.id] : [req.user.id]
  );
  res.json(rows.map((r) => ({
    id: r.id, bookingId: r.booking_id, method: r.method, amount: parseFloat(r.amount),
    status: r.status, createdAt: r.created_at, verifiedAt: r.verified_at,
    bookingRef: r.booking_ref, pickupAddress: r.pickup_address, dropAddress: r.drop_address,
    finalFare: r.final_fare ? parseFloat(r.final_fare) : null,
  })));
}));

module.exports = router;
