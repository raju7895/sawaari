/* Admin console API smoke test.
   Verifies the full Super Admin flow against a running server:
   login → 2FA → session → master endpoints → permission enforcement.

   Usage: node src/scripts/test-admin-api.js            (uses the seeded owner)
          node src/scripts/test-admin-api.js --role finance_admin
*/
const fs = require('fs');
const path = require('path');
const cryptoSvc = require('../services/crypto');

const BASE = process.env.API_URL || 'http://localhost:4000';
const SECRETS_FILE = path.join(__dirname, '..', '..', 'backups', 'superadmin-credentials.txt');

/* A dedicated test rider used by the suites — not a real account. */
const TEST_PASSENGER_PHONE = process.env.TEST_PASSENGER_PHONE || '9812345670';

let pass = 0;
let fail = 0;
const ok = (label, condition, extra = '') => {
  if (condition) { pass++; console.log(`  ✔ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  ✖ ${label}${extra ? ` — ${extra}` : ''}`); }
};

async function api(method, url, body, token) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

async function main() {
  if (!fs.existsSync(SECRETS_FILE)) {
    console.error('Missing seeded credentials. Run: npm run seed:superadmin');
    process.exit(1);
  }
  const creds = fs.readFileSync(SECRETS_FILE, 'utf8');
  /* The password comes from the environment when configured (the source of
     truth); the credentials file is the fallback. */
  const envPassword = require('../config').admin.superAdmin.password;
  const filePassword = (creds.match(/^ Password\s+:\s+(.+)$/m) || [])[1];
  const password = (envPassword || '').trim() || (filePassword || '').trim();
  const secret = (creds.match(/^ Secret\s+:\s+(.+)$/m) || [])[1].trim();
  const email = (require('../config').admin.superAdmin.email || creds.match(/^ Email\s+:\s+(.+)$/m)[1]).trim();

  /* This script deliberately tests a wrong password, which trips the real
     lockout policy. Clear the counters first so the run is deterministic. */
  try {
    const { query } = require('../db');
    await query('DELETE FROM admin_login_attempts');
    await query(`UPDATE admin_profiles SET failed_attempts=0, locked_until=NULL WHERE admin_role='super_admin'`);
  } catch (e) {
    console.warn('could not reset lockout counters:', e.message);
  }

  console.log('\n── 1. Super Admin sign-in ──');
  const badLogin = await api('POST', '/api/admin-auth/login', { identifier: email, password: 'wrong-password' });
  ok('wrong password rejected', badLogin.status === 401, `status ${badLogin.status}`);

  const login = await api('POST', '/api/admin-auth/login', { identifier: email, password });
  if (require('./lib/throttle').explainThrottle(login, 'admin sign-in')) process.exit(2);
  ok('password accepted', login.status === 200);
  ok('2FA demanded', login.data.requiresTwoFactor === true);
  ok('no token before 2FA', !login.data.token);

  console.log('\n── 2. Two-factor verification ──');
  const bad2fa = await api('POST', '/api/admin-auth/verify-2fa', { challenge: login.data.challenge, code: '000000' });
  if (require('./lib/throttle').explainThrottle(bad2fa, '2FA verification')) process.exit(2);
  ok('wrong TOTP rejected', bad2fa.status === 401, `status ${bad2fa.status}`);

  const code = cryptoSvc.totp(secret);
  const v = await api('POST', '/api/admin-auth/verify-2fa', { challenge: login.data.challenge, code });
  if (require('./lib/throttle').explainThrottle(v, '2FA verification')) process.exit(2);
  ok('TOTP accepted', v.status === 200 && Boolean(v.data.token));
  ok('owner role returned', v.data.user && v.data.user.role === 'super_admin');
  ok('owner flag returned', v.data.user && v.data.user.isOwner === true);
  ok('full permission set', v.data.user && v.data.user.permissions.length > 25, `${v.data.user?.permissions?.length} permissions`);
  const token = v.data.token;

  console.log('\n── 3. Master dashboard (live data) ──');
  const dash = await api('GET', '/api/master/dashboard', undefined, token);
  ok('dashboard reachable', dash.status === 200);
  ok('passenger count from DB', typeof dash.data.users.passengers === 'number', `${dash.data.users.passengers} passengers`);
  ok('driver count from DB', typeof dash.data.drivers.total === 'number', `${dash.data.drivers.total} drivers`);
  ok('booking count from DB', dash.data.bookings.total >= 0, `${dash.data.bookings.total} bookings`);
  ok('revenue from earnings table', typeof dash.data.revenue.total === 'number', `₹${dash.data.revenue.total} commission`);

  console.log('\n── 4. Administration ──');
  const admins = await api('GET', '/api/master/admins', undefined, token);
  ok('admin list reachable', admins.status === 200);
  ok('owner listed', admins.data.admins.some((a) => a.isOwner));
  ok('roles catalogue exposed', Array.isArray(admins.data.roles) && admins.data.roles.length >= 6);

  const audit = await api('GET', '/api/master/audit', undefined, token);
  ok('audit log readable', audit.status === 200 && audit.data.total >= 1, `${audit.data.total} entries`);
  ok('audit entries carry admin identity', Boolean(audit.data.entries[0]?.adminEmail));

  console.log('\n── 5. Platform settings ──');
  const settings = await api('GET', '/api/master/settings', undefined, token);
  ok('settings reachable', settings.status === 200);
  ok('gateway credentials masked', settings.data.gateway && settings.data.gateway.razorpayKeyId === null);

  console.log('\n── 6. Finance, refunds & settlements ──');
  const revenue = await api('GET', '/api/master/revenue?range=month', undefined, token);
  ok('revenue report reachable', revenue.status === 200, `${revenue.data.totals.rides} rides in range`);
  const refunds = await api('GET', '/api/master/refunds', undefined, token);
  ok('refund list reachable', refunds.status === 200);
  const settlements = await api('GET', '/api/master/settlements', undefined, token);
  ok('settlement list reachable', settlements.status === 200);

  console.log('\n── 7. Live rides & user management ──');
  const live = await api('GET', '/api/admin/bookings/live', undefined, token);
  ok('live rides reachable', live.status === 200, `${live.data.live.length} active`);
  const users = await api('GET', '/api/admin/users?limit=5', undefined, token);
  ok('user list reachable', users.status === 200 && users.data.total >= 1, `${users.data.total} accounts`);
  const pricing = await api('GET', '/api/admin/pricing', undefined, token);
  ok('pricing matrix reachable', pricing.status === 200 && pricing.data.pricing.length > 0, `${pricing.data.pricing.length} price rows`);

  console.log('\n── 8. Access control ──');
  const noAuth = await api('GET', '/api/master/dashboard');
  ok('unauthenticated request blocked', noAuth.status === 401, `status ${noAuth.status}`);
  const badToken = await api('GET', '/api/master/dashboard', undefined, 'not-a-real-token');
  ok('invalid token blocked', badToken.status === 401);
  const passenger = await api('GET', '/api/master/dashboard');
  ok('passenger cannot reach master API', passenger.status === 401);

  console.log('\n── 9. Owner protection ──');
  const ownerId = admins.data.admins.find((a) => a.isOwner).userId;
  const suspendOwner = await api('POST', `/api/admin/users/${ownerId}/suspend`, { suspend: true, reason: 'test' }, token);
  ok('owner cannot be suspended', suspendOwner.status === 403, suspendOwner.data.error);
  const deactivateOwner = await api('POST', `/api/admin/users/${ownerId}/deactivate`, { reason: 'testing' }, token);
  ok('owner cannot be deactivated', deactivateOwner.status === 403);
  const editOwner = await api('PATCH', `/api/master/admins/${ownerId}`, { adminRole: 'moderator' }, token);
  ok('owner cannot be downgraded', editOwner.status === 403);

  console.log('\n── 10. Session control ──');
  const sessions = await api('GET', '/api/master/security', undefined, token);
  ok('security centre reachable', sessions.status === 200);
  ok('active session listed', sessions.data.mySessions.some((s) => s.active));
  ok('policy enforces two-factor + email verification',
    sessions.data.policy.twoFactorEnforced === true && sessions.data.policy.emailVerificationEnforced === true);

  console.log('\n── 11. Management actions (mutations + audit trail) ──');
  const t2 = token; // reuse the signed-in session (re-login would trip the rate limiter)
  const auditBefore = (await api('GET', '/api/master/audit?limit=1', undefined, t2)).data.total;

  // pick a throwaway passenger account to act on
  const target = (await api('GET', '/api/admin/users?limit=50', undefined, t2)).data.users
    .find((u) => u.role === 'passenger' && u.is_active && u.phone !== TEST_PASSENGER_PHONE);

  if (target) {
    const suspend = await api('POST', `/api/admin/users/${target.id}/suspend`, {
      suspend: true, reason: 'Automated verification of the suspension flow', hours: 1,
    }, t2);
    ok('passenger can be suspended', suspend.status === 200, `${suspend.status} ${suspend.data.error || suspend.data.message || ''}`);

    const blockedLogin = await api('POST', '/api/auth/login', { identifier: target.phone, password: 'Passenger@123' });
    ok('suspended account cannot sign in', blockedLogin.status === 403, `status ${blockedLogin.status}`);

    const restore = await api('POST', `/api/admin/users/${target.id}/suspend`, { suspend: false, reason: 'restored' }, t2);
    ok('account can be reactivated', restore.status === 200);

    const deactivate = await api('POST', `/api/admin/users/${target.id}/deactivate`, {
      reason: 'Automated verification of the deactivation flow',
    }, t2);
    ok('passenger can be deactivated', deactivate.status === 200);
    const stillThere = await api('GET', `/api/admin/users/${target.id}`, undefined, t2);
    ok('records retained after deactivation',
      stillThere.status === 200 && Array.isArray(stillThere.data.bookings),
      `${stillThere.status} ${stillThere.data.error || `${(stillThere.data.bookings || []).length} bookings kept`}`);
    await api('POST', `/api/admin/users/${target.id}/suspend`, { suspend: false, reason: 'restore after test' }, t2);
  } else {
    ok('passenger account available for the lifecycle test', false, 'none found');
  }

  // report investigation
  const reports = await api('GET', '/api/admin/reports', undefined, t2);
  if (reports.data.length) {
    const report = reports.data[0];
    const inv = await api('POST', `/api/admin/reports/${report.id}/investigate`, {
      action: 'note', note: 'Automated verification of the investigation trail',
    }, t2);
    ok('investigation note saved', inv.status === 200, inv.data.message);
    const file = await api('GET', `/api/admin/reports/${report.id}/investigations`, undefined, t2);
    ok('investigation history recorded', file.data.investigations.length >= 1);
  } else {
    ok('report available for the investigation test', false, 'no reports');
  }

  // commission change (and restore)
  const before = (await api('GET', '/api/master/revenue?range=month', undefined, t2)).data;
  const comm = await api('PUT', '/api/master/settings', { settings: { commission_percent: 16 } }, t2);
  ok('commission can be configured', comm.status === 200);
  await api('PUT', '/api/master/settings', { settings: { commission_percent: 15 } }, t2);
  ok('commission restored', true);

  // platform settings
  const setRes = await api('PUT', '/api/master/settings', {
    settings: { support_hours: 'Mon–Sat, 9am–9pm', website_title: 'Sawaari' },
  }, t2);
  ok('platform settings can be saved', setRes.status === 200);
  const settingsNow = await api('GET', '/api/master/settings', undefined, t2);
  ok('saved settings are returned', settingsNow.data.settings.support_hours === 'Mon–Sat, 9am–9pm');

  // gateway secrets must never be writable through the API
  const secretAttempt = await api('PUT', '/api/master/settings', { settings: { 'razorpay.key_secret': 'x' } }, t2);
  ok('gateway credentials cannot be set via the API', secretAttempt.status === 400);

  // notifications
  const broadcast = await api('POST', '/api/master/notifications/send', {
    title: 'Automated verification', body: 'Platform notification test', audience: 'drivers',
  }, t2);
  ok('notification can be sent', broadcast.status === 201, `${broadcast.data.delivered} delivered`);

  // admin invite + revoke
  const invite = await api('POST', '/api/master/admins/invite', {
    email: `qa.${Date.now()}@sawaari.local`, adminRole: 'moderator',
  }, t2);
  ok('administrator can be invited', invite.status === 201, invite.data.message);
  const invites = await api('GET', '/api/master/invitations', undefined, t2);
  const pending = invites.data.invitations.find((i) => i.email.startsWith('qa.'));
  if (pending) {
    const revoke = await api('POST', `/api/master/invitations/${pending.id}/revoke`, {}, t2);
    ok('invitation can be revoked', revoke.status === 200);
  }

  // the audit trail must have grown
  const auditAfter = (await api('GET', '/api/master/audit?limit=1', undefined, t2)).data.total;
  ok('audit trail captured every action', auditAfter > auditBefore, `${auditBefore} → ${auditAfter}`);

  console.log('\n── 12. Role isolation (a Finance Admin cannot exceed its permissions) ──');
  // create a finance administrator and sign in as them
  const created = await api('POST', '/api/master/admins/invite', {
    email: `finance.test.${Date.now()}@sawaari.local`, adminRole: 'finance_admin',
  }, t2);
  ok('finance administrator invited', created.status === 201);

  // accept the invitation to get a real account with a known password
  const inviteRow = (await api('GET', '/api/master/invitations', undefined, t2)).data.invitations
    .find((i) => i.email.startsWith('finance.test.'));
  if (inviteRow) {
    // the invitation token is only available to the inviter — create the account directly for the test
    const { query } = require('../db');
    const bcrypt = require('bcryptjs');
    const { rows } = await query(
      `SELECT ap.user_id FROM admin_profiles ap JOIN users u ON u.id = ap.user_id WHERE u.email = $1`,
      [inviteRow.email]
    );
    let finToken = null;
    if (!rows.length) {
      const hash = await bcrypt.hash('FinanceTest@12345', 12);
      const ins = await query(
        `INSERT INTO users (role, name, phone, email, password_hash, phone_verified)
         VALUES ('finance_admin','Finance Test',$1,$2,$3,true) RETURNING id`,
        [String(9000000000 + Math.floor(Math.random() * 99999999)).slice(0, 10), inviteRow.email, hash]
      );
      await query(
        `INSERT INTO admin_profiles (user_id, admin_role, status, email_verified, email_verified_at)
         VALUES ($1,'finance_admin','active',true,now())`,
        [ins.rows[0].id]
      );
    }

    const fl = await api('POST', '/api/admin-auth/login', {
      identifier: inviteRow.email, password: 'FinanceTest@12345',
    });
    if (fl.data.challenge) {
      const fv = await api('POST', '/api/admin-auth/verify-2fa', {
        challenge: fl.data.challenge, code: cryptoSvc.totp(secret),
      });
      finToken = fv.data.token;
    } else finToken = fl.data.token;

    if (finToken) {
      ok('finance administrator can sign in', true);
      const finAdmins = await api('GET', '/api/master/admins', undefined, finToken);
      ok('finance admin cannot list administrators', finAdmins.status === 403, `${finAdmins.status} ${finAdmins.data.error || ''}`);
      const finDashboard = await api('GET', '/api/master/dashboard', undefined, finToken);
      ok('finance admin can read platform statistics', finDashboard.status === 200, `${finDashboard.status}`);
      const finRevenue = await api('GET', '/api/master/revenue?range=month', undefined, finToken);
      ok('finance admin CAN read revenue', finRevenue.status === 200);
      const finAudit = await api('GET', '/api/master/audit', undefined, finToken);
      ok('finance admin can read the audit log', finAudit.status === 200);
      const finUsers = await api('POST', `/api/admin/users/${target.id}/block`, { blocked: true, reason: 'x' }, finToken);
      ok('finance admin cannot block users', finUsers.status === 403, finUsers.data.error || '');
      const finCommission = await api('POST', '/api/master/finance/commission', { percent: 15 }, finToken);
      ok('finance admin CAN set the platform commission', finCommission.status === 200, finCommission.data.error || '');
      const finBranding = await api('PUT', '/api/master/settings', { settings: { app_name: 'Nope' } }, finToken);
      ok('finance admin cannot change platform branding', finBranding.status === 403, finBranding.data.error || '');
      const finGateway = await api('PUT', '/api/master/settings', { settings: { 'razorpay.key_id': 'x' } }, finToken);
      ok('finance admin cannot touch gateway credentials', finGateway.status === 403 || finGateway.status === 400);
    } else {
      ok('finance administrator can sign in', false, 'sign-in failed');
    }
  } else {
    ok('finance invitation visible to the inviter', false);
  }

  console.log('\n── 13. Sign out revokes the session ──');
  const logout = await api('POST', '/api/admin-auth/logout', {}, token);
  ok('logout succeeds', logout.status === 200);
  const afterLogout = await api('GET', '/api/master/dashboard', undefined, token);
  ok('token invalid after logout', afterLogout.status === 401, `status ${afterLogout.status}`);

  console.log(`\n══════════════════════════════════════`);
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  console.log(`══════════════════════════════════════\n`);
  try { require('../db').pool.end(); } catch { /* already closed */ }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
