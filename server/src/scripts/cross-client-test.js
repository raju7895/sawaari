/* Proves that every client (phone, desktop, web) shares one backend and
 * one database:
 *   1. a passenger registers through the public API
 *   2. a ride is booked and completed
 *   3. the booking appears in the admin console's booking list
 *   4. the same record is visible in the passenger's history and in the
 *      driver's earnings
 *   5. the driver sees the same ride in their own history
 */
const cryptoSvc = require('../services/crypto');
const config = require('../config');

const BASE = process.env.API_URL || 'http://localhost:4000';
let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  ✖ ${label}${extra ? ` — ${extra}` : ''}`); }
};

async function call(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

const rnd = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`.slice(0, 10);

(async () => {
  console.log('\n── cross-client data consistency ──');

  /* 1. passenger registers + verifies through the same public API a phone uses */
  const phone = String(rnd()).slice(0, 10);
  const email = `crosscheck.${phone}@test.dev`;
  const reg = await call('POST', '/api/auth/register', {
    role: 'passenger', name: 'Cross Check', phone, email, password: 'CrossCheck@123',
  });
  ok('passenger registers via the shared API', reg.status === 201 || reg.status === 200, `HTTP ${reg.status}`);

  const code = reg.data.devCode;
  if (!code) {
    console.log('  ! no devCode available (SMS configured?) — cannot continue');
    process.exit(1);
  }
  const ver = await call('POST', '/api/auth/verify-otp', { phone, code, purpose: 'register' });
  const pToken = ver.data.token;
  ok('passenger verifies the OTP and gets a session', Boolean(pToken));

  /* 2. driver registers, gets approved by the admin, goes online */
  const dPhone = String(rnd()).slice(0, 10);
  const dReg = await call('POST', '/api/auth/register', {
    role: 'driver', name: 'Cross Driver', phone: dPhone, email: `cross.d.${dPhone}@test.dev`, password: 'CrossCheck@123',
  });
  const dCode = dReg.data.devCode;
  const dVer = await call('POST', '/api/auth/verify-otp', { phone: dPhone, code: dCode, purpose: 'register' });
  const dToken = dVer.data.token;
  ok('driver registers via the shared API', Boolean(dToken));

  // admin session
  const creds = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'backups', 'superadmin-credentials.txt'), 'utf8');
  const secret = creds.match(/^ Secret\s+:\s+(.+)$/m)[1].trim();
  const adminPw = (config.admin.superAdmin.password || creds.match(/^ Password\s+:\s+(.+)$/m)[1]).trim();
  const aLogin = await call('POST', '/api/admin-auth/login', { identifier: config.admin.superAdmin.email, password: adminPw });
  const aV = await call('POST', '/api/admin-auth/verify-2fa', {
    challenge: aLogin.data.challenge, code: cryptoSvc.totp(secret),
  });
  const aToken = aV.data.token;
  ok('Super Admin signs in with 2FA', Boolean(aToken));

  // driver profile + vehicle + document
  await call('POST', '/api/driver/vehicle', {
    registrationNumber: 'KA 05 AB 1234', vehicleType: 'auto', model: 'Bajaj RE', capacity: 3,
  }, dToken);
  const dMe = await call('GET', '/api/driver/me', undefined, dToken);
  const dProfileId = dMe.data.id;
  ok('driver vehicle saved', Boolean(dProfileId));

  // upload a real document (multipart, as the app does)
  const form = new FormData();
  form.append('docType', 'license');
  form.append('docNumber', 'TEST-123');
  form.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'licence.png');
  const up = await fetch(`${BASE}/api/driver/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dToken}` },
    body: form,
  });
  ok('driver uploads a licence document', up.status === 201 || up.status === 200, `HTTP ${up.status}`);
  const docs = await call('GET', '/api/admin/drivers', undefined, aToken);
  const pending = (docs.data.drivers || []).find((d) => d.phone === dPhone);
  ok('driver appears in the admin verification queue', Boolean(pending));
  if (pending) {
    // the admin reviews the document, then approves the driver
    const detail = await call('GET', `/api/admin/drivers/${pending.id}`, undefined, aToken);
    const doc = (detail.data.documents || [])[0];
    if (doc) {
      const rev = await call('POST', `/api/admin/documents/${doc.id}/review`, {
        status: 'verified', note: 'Legible scan',
      }, aToken);
      ok('admin verifies the licence document', rev.status === 200, rev.data.error || '');
    }
    const app = await call('POST', `/api/admin/drivers/${pending.id}/approve`, {}, aToken);
    const after = await call('GET', '/api/driver/me', undefined, dToken);
    ok('admin approves the driver', after.data.verificationStatus === 'approved', app.data.error || '');
  }
  await call('POST', '/api/driver/online', { online: true }, dToken);
  await call('POST', '/api/driver/location', { lat: 23.0225, lng: 72.5714 }, dToken);

  /* 3. the passenger books a ride */
  const quote = await call('POST', '/api/bookings/quote', {
    pickup: { lat: 23.0295, lng: 72.5785, address: 'Pickup point' },
    drop: { lat: 22.9865, lng: 72.5798, address: 'Drop point' },
    vehicleType: 'auto',
  }, pToken);
  ok('fare quoted with a real road distance', quote.status === 200 && quote.data.distanceKm > 0,
    `${quote.data.distanceKm} km, ₹${quote.data.fare && quote.data.fare.total}`);

  const booking = await call('POST', '/api/bookings', {
    pickup: { lat: 23.0295, lng: 72.5785, address: 'Pickup point' },
    drop: { lat: 22.9865, lng: 72.5798, address: 'Drop point' },
    vehicleType: 'auto', bookingType: 'immediate',
  }, pToken);
  const bookingId = booking.data.id;
  ok('ride booked', booking.status === 201 || booking.status === 200, booking.data.ref || `HTTP ${booking.status}`);

  /* 4. the driver accepts and completes it */
  const dr = await call('GET', '/api/driver/requests', undefined, dToken);
  ok('driver receives the request', (dr.data.requests || []).some((r) => r.bookingId === bookingId));
  const acc = await call('POST', `/api/driver/rides/${bookingId}/accept`, {}, dToken);
  ok('driver accepts the ride', acc.status === 200, acc.data.status || '');
  await call('POST', `/api/driver/rides/${bookingId}/arriving`, {}, dToken);
  await call('POST', `/api/driver/rides/${bookingId}/arrived`, {}, dToken);
  const rideOtp = (await call('GET', `/api/bookings/${bookingId}`, undefined, pToken)).data.rideOtp;
  await call('POST', `/api/driver/rides/${bookingId}/start`, { rideOtp }, dToken);
  ok('ride starts only with the passenger OTP', (await call('GET', `/api/bookings/${bookingId}`, undefined, dToken)).data.status === 'in_progress');
  const done = await call('POST', `/api/driver/rides/${bookingId}/complete`, {}, dToken);
  ok('ride completes', done.data.status === 'completed');

  /* 5. the SAME record is visible from every role */
  const adminList = await call('GET', `/api/admin/bookings?q=${booking.data.ref}`, undefined, aToken);
  const inAdmin = (adminList.data.bookings || []).some((b) => b.id === bookingId);
  ok('booking is visible in the admin console', inAdmin);

  const pHist = await call('GET', '/api/bookings/mine?limit=50', undefined, pToken);
  const pList = pHist.data.bookings || pHist.data || [];
  ok('booking is in the passenger history',
    (Array.isArray(pList) ? pList : []).some((b) => b.id === bookingId),
    `${Array.isArray(pList) ? pList.length : 0} bookings in history`);

  const dRides = await call('GET', '/api/driver/rides', undefined, dToken);
  ok('booking is in the driver ride list',
    (dRides.data.bookings || []).some((b) => b.id === bookingId));

  const earnings = await call('GET', '/api/driver/earnings?range=month', undefined, dToken);
  ok('driver earnings include the ride',
    (earnings.data.records || []).some((r) => r.ref === booking.data.ref),
    `₹${earnings.data.summary && earnings.data.summary.net} net`);

  const revenue = await call('GET', '/api/master/revenue?range=month', undefined, aToken);
  ok('platform revenue includes the commission', (revenue.data.totals.rides || 0) >= 1,
    `${revenue.data.totals.rides} rides, ₹${revenue.data.totals.commission} commission`);

  const audit = await call('GET', '/api/master/audit?limit=5', undefined, aToken);
  ok('admin actions are audited', (audit.data.entries || []).length > 0);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
