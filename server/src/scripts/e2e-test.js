/* ════════════════════════════════════════════════════════════
   SAWAARI END-TO-END WORKFLOW TEST
   Exercises the full journey against a running API (localhost:4000):
   register → OTP → approve driver → go online → nearby search →
   quote (real OSRM road distance) → book → accept → track →
   arrive/start(OTP)/complete → UPI payment + UTR + admin verify →
   review → dashboards.
   Run: node src/scripts/e2e-test.js
   ════════════════════════════════════════════════════════════ */
const BASE = process.env.API_URL || 'http://localhost:4000';
/* A dedicated test rider used by the suites — not a real account. */
const TEST_PASSENGER_PHONE = process.env.TEST_PASSENGER_PHONE || '9812345670';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || require('../config').admin.email;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || require('../config').admin.password;

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✖ ${name} ${extra}`); }
};

async function call(method, path, body, token, expectFail = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!expectFail && !res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${data.error || JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

const rand = () => Math.floor(1000000000 + Math.random() * 8999999999);
// Bengaluru coordinates (real city, covered by seeded service area)
const PICKUP = { lat: 12.9716, lng: 77.5946, address: 'MG Road, Bengaluru' };
const DROP = { lat: 12.9352, lng: 77.6245, address: 'Koramangala, Bengaluru' };

async function main() {
  console.log('\n── 1. Passenger registration + OTP ──');
  const pPhone = String(rand());
  const p1 = await call('POST', '/api/auth/register', {
    role: 'passenger', name: 'Priya Test', phone: pPhone, email: `priya${pPhone}@test.dev`, password: 'Passenger@1',
  });
  ok('passenger account created', p1.status === 201);
  ok('OTP issued (dev mode)', Boolean(p1.data.devCode));
  const pv = await call('POST', '/api/auth/verify-otp', { phone: pPhone, code: p1.data.devCode });
  ok('OTP verified, session issued', Boolean(pv.data.token));
  const passengerToken = pv.data.token;

  // wrong OTP rejected
  const badOtp = await call('POST', '/api/auth/verify-otp', { phone: pPhone, code: '000000' }, null, true);
  ok('wrong OTP rejected', badOtp.status === 400);
  const badLogin = await call('POST', '/api/auth/login', { identifier: pPhone, password: 'WrongPass1' }, null, true);
  ok('wrong password rejected', badLogin.status === 401);

  console.log('\n── 2. Driver registration + documents ──');
  const dPhone = String(rand());
  const d1 = await call('POST', '/api/auth/register', {
    role: 'driver', name: 'Ravi Test', phone: dPhone, email: `ravi${dPhone}@test.dev`, password: 'Driver@123',
  });
  const dv = await call('POST', '/api/auth/verify-otp', { phone: dPhone, code: d1.data.devCode });
  const driverToken = dv.data.token;
  ok('driver account created + verified', Boolean(driverToken));

  // driver cannot go online before approval
  const earlyOnline = await call('POST', '/api/driver/online', { online: true }, driverToken, true);
  ok('driver blocked from going online before approval', earlyOnline.status === 403);

  await call('POST', '/api/driver/vehicle', {
    registrationNumber: `KA 05 AB ${String(rand() % 10000).padStart(4, '0')}`, vehicleType: 'auto', model: 'Bajaj RE', capacity: 3,
  }, driverToken);
  ok('vehicle registered', true);

  // upload a document (small png)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'licence.png');
  fd.append('docType', 'license');
  fd.append('docNumber', 'KA0120190001234');
  const upDoc = await fetch(`${BASE}/api/driver/documents`, {
    method: 'POST', headers: { Authorization: `Bearer ${driverToken}` }, body: fd,
  });
  const docData = await upDoc.json();
  ok('licence document uploaded', upDoc.status === 201);

  await call('POST', '/api/driver/upi', { upiId: `ravi${rand()}@okhdfcbank` }, driverToken);
  ok('driver UPI ID saved (unverified)', true);

  console.log('\n── 3. Admin approves driver ──');
  /* Administrators sign in through the console (email + password + 2FA).
     The seeded staff account has 2FA switched on only when it was enrolled —
     in that case the console returns a challenge instead of a token. */
  const al = await call('POST', '/api/admin-auth/login', { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  let adminToken = al.data.token;
  if (!adminToken && al.data.requiresTwoFactor) {
    console.log('  ! this administrator has 2FA enabled — set ADMIN_TOTP_CODE in the environment');
    process.exit(1);
  }
  ok('admin login', Boolean(adminToken));

  const drivers = await call('GET', '/api/admin/drivers?status=pending', null, adminToken);
  const me = await call('GET', '/api/driver/me', null, driverToken);
  const myProfile = drivers.data.drivers.find((d) => d.id === me.data.id);
  ok('driver appears in pending queue', Boolean(myProfile));

  // verify the uploaded document first (approval requires verified docs)
  const docVerify = await call('POST', `/api/admin/documents/${docData.id}/review`, { status: 'verified', note: 'Legible scan' }, adminToken);
  ok('admin verified licence document', docVerify.data.ok);

  const approve = await call('POST', `/api/admin/drivers/${me.data.id}/approve`, {}, adminToken);
  ok('admin approved driver', approve.data.ok);

  const upiVerify = await call('POST', `/api/admin/drivers/${me.data.id}/verify-upi`, { verified: true }, adminToken);
  ok('admin verified driver UPI ID', upiVerify.data.ok);

  console.log('\n── 4. Driver goes online + shares location ──');
  const online = await call('POST', '/api/driver/online', { online: true }, driverToken);
  ok('driver online', online.data.online === true);
  await call('POST', '/api/driver/location', { lat: PICKUP.lat + 0.004, lng: PICKUP.lng + 0.004 }, driverToken);
  ok('driver location shared (heartbeat)', true);

  console.log('\n── 5. Passenger finds nearby autos ──');
  const nearby = await call('GET', `/api/bookings/nearby-drivers?lat=${PICKUP.lat}&lng=${PICKUP.lng}`, null, passengerToken);
  ok('nearby drivers returned', nearby.data.count >= 1, `got ${nearby.data.count}`);
  ok('driver location not stale', nearby.data.drivers[0].distanceKm < 2, `${nearby.data.drivers[0]?.distanceKm} km`);

  console.log('\n── 6. Real road distance + fare quote ──');
  const quote = await call('POST', '/api/bookings/quote', {
    pickup: PICKUP, drop: DROP, vehicleType: 'auto',
  }, passengerToken);
  ok('road distance computed (OSRM)', quote.data.distanceKm > 1, `${quote.data.distanceKm} km`);
  ok('duration estimated', quote.data.durationMin > 0, `${quote.data.durationMin} min`);
  ok('fare breakdown present', (quote.data.fare.breakdown || []).length >= 2);
  ok('fare total is sane', quote.data.fare.total >= quote.data.fare.breakdown.find((i) => i.key === 'base').amount);
  console.log(`     → ${quote.data.distanceKm} km, ${quote.data.durationMin} min, ₹${quote.data.fare.total} (${quote.data.city.name})`);

  console.log('\n── 7. Passenger books the ride ──');
  const booking = await call('POST', '/api/bookings', {
    pickup: PICKUP, drop: DROP, vehicleType: 'auto', bookingType: 'immediate',
  }, passengerToken);
  ok('booking created (searching)', booking.data.status === 'searching');
  ok('ride OTP assigned to passenger', /^\d{4}$/.test(booking.data.rideOtp));
  const bookingId = booking.data.id;
  const rideOtp = booking.data.rideOtp;

  // passenger cannot double-book while active
  const double = await call('POST', '/api/bookings', { pickup: PICKUP, drop: DROP, vehicleType: 'auto' }, passengerToken, true);
  ok('passenger blocked from double active booking', double.status === 409);

  console.log('\n── 8. Driver receives + accepts the request ──');
  const driverNotifs = await call('GET', '/api/notifications', null, driverToken);
  ok('driver notified of new ride request', driverNotifs.data.notifications.some((n) => n.type === 'ride_request'));

  const accept = await call('POST', `/api/driver/rides/${bookingId}/accept`, {}, driverToken);
  ok('driver accepted ride', accept.data.status === 'assigned');
  ok('driver sees passenger contact', Boolean(accept.data.passenger?.phone));
  ok('passenger sees driver + vehicle', Boolean(accept.data.driver?.name) && Boolean(accept.data.vehicle?.registrationNumber));

  // driver is busy; second accept attempt fails (no double booking)
  const reAccept = await call('POST', `/api/driver/rides/${bookingId}/accept`, {}, driverToken, true);
  ok('driver cannot accept while busy', reAccept.status === 409);

  console.log('\n── 9. Ride progression ──');
  await call('POST', `/api/driver/location`, { lat: PICKUP.lat + 0.002, lng: PICKUP.lng + 0.002 }, driverToken);
  const arriving = await call('POST', `/api/driver/rides/${bookingId}/arriving`, {}, driverToken);
  ok('driver en route (arriving)', arriving.data.status === 'arriving');
  const arrived = await call('POST', `/api/driver/rides/${bookingId}/arrived`, {}, driverToken);
  ok('driver arrived', arrived.data.status === 'arrived');

  const wrongOtp = await call('POST', `/api/driver/rides/${bookingId}/start`, { rideOtp: '9999' }, driverToken, true);
  ok('ride start blocked with wrong OTP', wrongOtp.status === 400);
  const started = await call('POST', `/api/driver/rides/${bookingId}/start`, { rideOtp }, driverToken);
  ok('ride started with correct OTP', started.data.status === 'in_progress');

  const completed = await call('POST', `/api/driver/rides/${bookingId}/complete`, {}, driverToken);
  ok('ride completed', completed.data.status === 'completed');
  ok('final fare computed with route', completed.data.finalFare > 0, `₹${completed.data.finalFare}`);
  ok('payment status unpaid until paid', completed.data.paymentStatus === 'unpaid');

  console.log('\n── 10. UPI payment flow (QR + UTR + admin verification) ──');
  const upiRes = await call('POST', `/api/payments/booking/${bookingId}/upi`, {}, passengerToken);
  ok('UPI intent generated for driver VPA', upiRes.data.intentUrl.startsWith('upi://pay?'));
  ok('UPI intent carries exact amount', upiRes.data.intentUrl.includes(`am=${upiRes.data.amount.toFixed(2)}`));
  ok('QR code rendered', upiRes.data.qrDataUrl.startsWith('data:image/png'));
  const utrRes = await call('POST', `/api/payments/booking/${bookingId}/utr`, { utr: String(Math.floor(1e11 + Math.random() * 9e11)) }, passengerToken);
  ok('passenger submitted UTR → pending verification', utrRes.data.status === 'awaiting_verification');

  // ride must NOT be marked paid by the passenger claim alone
  const midBooking = await call('GET', `/api/bookings/${bookingId}`, null, passengerToken);
  ok('booking still unpaid after UTR claim', midBooking.data.paymentStatus === 'unpaid');

  const payList = await call('GET', '/api/admin/payments?status=awaiting_verification', null, adminToken);
  const pendingPay = payList.data.payments.find((p) => p.bookingId === bookingId);
  ok('payment appears in admin verification queue', Boolean(pendingPay));
  const verify = await call('POST', `/api/admin/payments/${pendingPay.id}/verify`, {}, adminToken);
  ok('admin verified the payment', verify.data.ok);
  const afterPay = await call('GET', `/api/bookings/${bookingId}`, null, passengerToken);
  ok('booking now marked paid (verified)', afterPay.data.paymentStatus === 'paid');

  console.log('\n── 11. Reviews ──');
  const review = await call('POST', `/api/bookings/${bookingId}/review`, { rating: 5, comment: 'Great ride' }, passengerToken);
  ok('passenger reviewed driver', review.status === 201);
  const dupReview = await call('POST', `/api/bookings/${bookingId}/review`, { rating: 4 }, passengerToken, true);
  ok('duplicate review rejected', dupReview.status === 409);

  console.log('\n── 12. Dashboards reflect everything ──');
  const myRides = await call('GET', '/api/bookings/mine', null, passengerToken);
  ok('passenger history shows the ride', myRides.data.bookings.some((b) => b.id === bookingId && b.status === 'completed'));
  const driverRides = await call('GET', '/api/driver/rides?status=completed', null, driverToken);
  ok('driver history shows the ride', driverRides.data.bookings.some((b) => b.id === bookingId));
  const earnings = await call('GET', '/api/driver/earnings?range=week', null, driverToken);
  ok('driver earnings recorded (net = fare − commission)', earnings.data.summary.net > 0 && earnings.data.summary.rides >= 1);
  const payHistory = await call('GET', '/api/payments/mine', null, passengerToken);
  ok('passenger payment history recorded', payHistory.data.some((p) => p.bookingId === bookingId && p.status === 'paid'));
  const drvMe = await call('GET', '/api/driver/me', null, driverToken);
  ok('driver rating updated', drvMe.data.rating.avg >= 5 && drvMe.data.rating.count === 1);
  ok('driver rides counter incremented', drvMe.data.ridesCompleted === 1);
  const overview = await call('GET', '/api/admin/overview', null, adminToken);
  ok('admin overview counts ride', overview.data.bookings.completed >= 1);
  ok('admin revenue tracks commission', overview.data.revenue.totalCommission > 0);

  console.log('\n── 13. Cancellation policy (second ride) ──');
  const b2 = await call('POST', '/api/bookings', { pickup: PICKUP, drop: DROP, vehicleType: 'auto' }, passengerToken);
  const cancelRes = await call('POST', `/api/bookings/${b2.data.id}/cancel`, { reason: 'Changed my mind' }, passengerToken);
  ok('passenger cancelled unmatched ride', cancelRes.data.status === 'cancelled');

  console.log('\n── 14. Security checks ──');
  const noAuth = await call('GET', '/api/bookings/mine', null, null, true);
  ok('endpoints require auth', noAuth.status === 401);
  const wrongRole = await call('GET', '/api/admin/overview', null, passengerToken, true);
  ok('passenger cannot access admin API', wrongRole.status === 403);
  const driverAsAdmin = await call('POST', '/api/admin/drivers/' + me.data.id + '/approve', {}, driverToken, true);
  ok('driver cannot access admin API', driverAsAdmin.status === 403);
  const foreignRide = await call('GET', `/api/bookings/${bookingId}`, null, driverToken);
  ok('driver can view own completed ride', foreignRide.status === 200);

  console.log(`\n══════════════════════════════════════`);
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\n✖ E2E FAILED:', e.message);
  process.exit(1);
});
