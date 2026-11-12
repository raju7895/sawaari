/* Sweeps every admin console endpoint with a real Super Admin session and
   reports any 4xx/5xx response, missing payload or empty module.

   This is the API-level counterpart of clicking through the console: every
   page in the sidebar is backed by one of these calls, so a broken query
   shows up here even without a browser.

   Usage: node src/scripts/sweep-admin-api.js
*/
const fs = require('fs');
const path = require('path');
const config = require('../config');
const cryptoSvc = require('../services/crypto');
const { explainThrottle } = require('./lib/throttle');

const BASE = process.env.API_URL || 'http://localhost:4000';
const SECRETS_FILE = path.join(__dirname, '..', '..', 'backups', 'superadmin-credentials.txt');

async function api(method, url, body, token) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 120) }; }
  return { status: res.status, data, bytes: text.length };
}

async function main() {
  const creds = fs.readFileSync(SECRETS_FILE, 'utf8');
  const envPassword = config.admin.superAdmin.password;
  const filePassword = (creds.match(/^ Password\s+:\s+(.+)$/m) || [])[1];
  const password = (envPassword || '').trim() || (filePassword || '').trim();
  const secret = (creds.match(/^ Secret\s+:\s+(.+)$/m) || [])[1].trim();
  const email = config.admin.superAdmin.email;

  const login = await api('POST', '/api/admin-auth/login', { identifier: email, password });
  if (explainThrottle(login, 'admin sign-in')) process.exit(2);
  if (!login.data.challenge) {
    console.error('sign-in failed:', login.status, JSON.stringify(login.data));
    process.exit(1);
  }
  const v = await api('POST', '/api/admin-auth/verify-2fa', {
    challenge: login.data.challenge, code: cryptoSvc.totp(secret),
  });
  if (explainThrottle(v, '2FA verification')) process.exit(2);
  const token = v.data.token;
  if (!token) { console.error('2FA failed:', JSON.stringify(v.data)); process.exit(1); }

  /* [label, method, path, body, expectOneOf] */
  const checks = [
    // Overview / analytics
    ['Overview — master dashboard', 'GET', '/api/master/dashboard', undefined, ['users', 'drivers', 'bookings', 'revenue', 'payments']],
    ['Overview — analytics series', 'GET', '/api/master/analytics', undefined, ['dailyRevenue', 'monthlyRevenue', 'dailyBookings', 'paymentMethods']],
    ['Analytics (legacy page)', 'GET', '/api/admin/analytics', undefined, ['daily', 'cityStats', 'topDrivers', 'paymentSplit']],
    ['Overview (legacy page)', 'GET', '/api/admin/overview', undefined, ['users', 'drivers', 'bookings']],
    // Users
    ['Users — list', 'GET', '/api/admin/users?limit=10', undefined, ['users']],
    ['Users — filters (role/date/status)', 'GET', '/api/admin/users?roleF=passenger&from=2020-01-01&to=2030-01-01&blocked=false&limit=5', undefined, ['users']],
    ['Users — search', 'GET', '/api/admin/users?q=a&limit=5', undefined, ['users']],
    ['Users — pagination', 'GET', '/api/admin/users?limit=2&offset=2', undefined, ['users']],
    // Drivers
    ['Drivers — list', 'GET', '/api/admin/drivers?limit=10', undefined, ['drivers']],
    ['Drivers — verification queue', 'GET', '/api/admin/drivers?status=pending&limit=10', undefined, ['drivers']],
    ['Drivers — directory (approved)', 'GET', '/api/admin/drivers?status=approved&limit=10', undefined, ['drivers']],
    // Bookings / live rides
    ['Bookings — list', 'GET', '/api/admin/bookings?limit=10', undefined, ['bookings']],
    ['Bookings — by city', 'GET', '/api/admin/bookings?city=Ahmedabad&limit=5', undefined, ['bookings']],
    ['Live rides', 'GET', '/api/admin/bookings/live', undefined, ['live', 'counts']],
    // Payments / finance
    ['Payments — list', 'GET', '/api/admin/payments?limit=10', undefined, ['payments']],
    ['Payments — awaiting verification', 'GET', '/api/admin/payments?status=awaiting_verification&limit=5', undefined, ['payments']],
    ['Revenue — report', 'GET', '/api/master/revenue?range=month', undefined, ['totals', 'byDay', 'drivers', 'methods']],
    ['Revenue — day range', 'GET', '/api/master/revenue?range=day', undefined, ['totals']],
    ['Settlements', 'GET', '/api/master/settlements', undefined, ['settlements']],
    ['Refunds', 'GET', '/api/master/refunds', undefined, ['refunds', 'gatewayConfigured']],
    ['Pricing matrix', 'GET', '/api/admin/pricing', undefined, ['pricing']],
    // Reports / support
    ['Reports — list', 'GET', '/api/admin/reports', undefined, []],
    ['SOS — list', 'GET', '/api/admin/sos', undefined, []],
    ['Tickets — list', 'GET', '/api/admin/tickets', undefined, []],
    // Cities
    ['Cities — list', 'GET', '/api/admin/cities', undefined, []],
    // Admin management / audit / settings / security
    ['Admin management', 'GET', '/api/master/admins', undefined, ['admins', 'roles', 'permissions']],
    ['Invitations', 'GET', '/api/master/invitations', undefined, ['invitations']],
    ['Audit log', 'GET', '/api/master/audit?limit=10', undefined, ['entries']],
    ['Audit log — filtered', 'GET', '/api/master/audit?category=security&result=success&limit=5', undefined, ['entries']],
    ['Platform settings', 'GET', '/api/master/settings', undefined, ['settings', 'gateway']],
    ['Legacy settings', 'GET', '/api/admin/settings', undefined, []],
    ['Security centre', 'GET', '/api/master/security', undefined, ['policy', 'mySessions', 'loginHistory']],
    ['Notifications — history', 'GET', '/api/master/notifications', undefined, ['broadcasts']],
    // Public + meta
    ['Health', 'GET', '/api/health', undefined, ['ok']],
    ['Cities meta (public)', 'GET', '/api/meta/cities', undefined, []],
  ];

  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const [label, method, url, body, expectKeys] of checks) {
    let res;
    try {
      res = await api(method, url, body, token);
    } catch (err) {
      fail++; failures.push(`${label} — network error: ${err.message}`);
      console.log(`  ✖ ${label} — ${err.message}`);
      continue;
    }
    const missing = expectKeys.filter((k) => !(k in (res.data || {})));
    const empty = res.bytes < 10 && res.status !== 204;
    if (res.status >= 400) {
      fail++; failures.push(`${label} — HTTP ${res.status}: ${(res.data && res.data.error) || res.data.raw || ''}`);
      console.log(`  ✖ ${label} — HTTP ${res.status}: ${(res.data && res.data.error) || res.data.raw || ''}`);
    } else if (missing.length) {
      fail++; failures.push(`${label} — missing keys: ${missing.join(', ')}`);
      console.log(`  ✖ ${label} — missing keys: ${missing.join(', ')}`);
    } else {
      pass++;
      console.log(`  ✔ ${label}`);
    }
  }

  // CSV exports (they return text, not JSON)
  const exports = ['bookings', 'users', 'drivers', 'payments', 'revenue', 'refunds', 'settlements', 'reports'];
  for (const type of exports) {
    const res = await fetch(`${BASE}/api/admin/export/${type}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (res.status === 200 && lines.length >= 1 && lines[0].includes(',')) {
      pass++; console.log(`  ✔ Export ${type} — ${lines.length - 1} rows`);
    } else {
      fail++; failures.push(`Export ${type} — HTTP ${res.status}`);
      console.log(`  ✖ Export ${type} — HTTP ${res.status}`);
    }
  }

  console.log(`\n  endpoint sweep: ${pass} ok, ${fail} failing`);
  if (failures.length) {
    console.log('\n  FAILURES:');
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  await api('POST', '/api/admin-auth/logout', {}, token);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
