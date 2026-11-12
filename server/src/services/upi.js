/* Direct-to-driver UPI: builds a standards-compliant UPI intent URL
   (upi://pay) and a scannable QR code. Payment goes straight to the
   driver's VPA with the exact amount and a unique transaction reference.
   IMPORTANT: direct UPI cannot be auto-verified without a PSP; payments
   stay "pending verification" until an admin verifies the UTR. */
const QRCode = require('qrcode');
const { httpError } = require('../utils');

const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

function isValidVpa(vpa) { return VPA_RE.test(vpa); }

/** Build upi://pay intent */
function buildIntent({ payeeVpa, payeeName, amountRupees, txnRef, note }) {
  if (!isValidVpa(payeeVpa)) throw httpError(400, 'Driver UPI ID is not valid.');
  const params = new URLSearchParams({
    pa: payeeVpa,
    pn: (payeeName || 'Sawaari Driver').slice(0, 40),
    am: amountRupees.toFixed(2),
    cu: 'INR',
    tn: (note || `Sawaari ${txnRef}`).slice(0, 50),
    tr: txnRef,      // transaction reference shown in the driver's UPI app
  });
  return `upi://pay?${params.toString()}`;
}

/** QR code data URL for the intent */
async function buildQrDataUrl(intentUrl) {
  return QRCode.toDataURL(intentUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
}

module.exports = { isValidVpa, buildIntent, buildQrDataUrl };
