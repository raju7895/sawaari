/* Razorpay integration (REST API + signature verification, no SDK needed).
   Only active when RAZORPAY_KEY_ID/SECRET are set. Gateway payments are
   verified cryptographically (checkout signature + webhook HMAC) — a ride is
   never marked paid from a client claim alone. */
const crypto = require('crypto');
const config = require('../config');
const { httpError } = require('../utils');

const API = 'https://api.razorpay.com/v1';

async function apiCall(path, { method = 'GET', body } = {}) {
  if (!config.razorpay.enabled) {
    throw httpError(503, 'Online payment gateway is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env, or pay the driver directly via UPI QR / cash.');
  }
  const auth = 'Basic ' + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.description || `Razorpay API error (${res.status})`;
    throw httpError(502, `Payment gateway error: ${msg}`);
  }
  return data;
}

/** amount in rupees (number) → Razorpay order */
function createOrder({ amountRupees, receipt, notes }) {
  return apiCall('/orders', {
    method: 'POST',
    body: {
      amount: Math.round(amountRupees * 100), // paise
      currency: 'INR',
      receipt,
      notes: notes || {},
    },
  });
}

/** Verify checkout callback signature: HMAC(order_id|payment_id, secret) */
function verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  if (!config.razorpay.enabled || !config.razorpay.keySecret) return false;
  const expected = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature || ''));
  } catch {
    return false;
  }
}

/** Verify webhook HMAC (X-Razorpay-Signature) over the raw body */
function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Refund a captured gateway payment */
function refundPayment(razorpayPaymentId, amountRupees) {
  return apiCall(`/payments/${razorpayPaymentId}/refund`, {
    method: 'POST',
    body: amountRupees ? { amount: Math.round(amountRupees * 100) } : {},
  });
}

module.exports = { createOrder, verifyCheckoutSignature, verifyWebhookSignature, refundPayment, enabled: () => config.razorpay.enabled, keyId: () => config.razorpay.keyId };
