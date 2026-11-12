/* Root-cause probe for the Super Admin sign-in failure.
   Verifies the stored hash, the bcrypt comparison, and the full
   admin-auth login path (password -> 2FA -> session) without printing
   any secret material. */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { one } = require('../db');
const cryptoSvc = require('../services/crypto');
const { explainThrottle } = require('./lib/throttle');

const EMAIL = require('../config').admin.superAdmin.email; // from the environment

(async () => {
  const user = await one(
    `SELECT u.id, u.password_hash, u.role, u.is_active, ap.admin_role, ap.status AS admin_status,
            ap.email_verified, ap.twofa_enabled, ap.failed_attempts, ap.locked_until
       FROM users u JOIN admin_profiles ap ON ap.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [EMAIL]
  );

  console.log('── Account record ──');
  if (!user) { console.log('  ✖ account NOT FOUND'); process.exit(1); }
  console.log(`  ✓ found: ${user.role} / ${user.admin_role} (${user.admin_status})`);
  console.log(`  ✓ is_active=${user.is_active} email_verified=${user.email_verified} 2fa=${user.twofa_enabled}`);
  console.log(`  ✓ failed_attempts=${user.failed_attempts} locked=${Boolean(user.locked_until)}`);

  console.log('\n── Password hash ──');
  console.log(`  ✓ algorithm: bcrypt (${user.password_hash.slice(0, 7)}…, ${user.password_hash.length} chars)`);
  const cost = parseInt(user.password_hash.split('$')[2], 10);
  console.log(`  ✓ cost factor: ${cost}`);

  const credFile = path.join(__dirname, '..', '..', 'backups', 'superadmin-credentials.txt');
  const creds = fs.existsSync(credFile) ? fs.readFileSync(credFile, 'utf8') : '';
  // the password lives in the environment (SUPER_ADMIN_PASSWORD); the file is
  // the fallback for accounts seeded before it was configured
  const envPassword = require('../config').admin.superAdmin.password;
  const filePassword = (creds.match(/^ Password\s+:\s+(.+)$/m) || [])[1];
  const password = (envPassword || '').trim() || (filePassword || '').trim();
  const passwordSource = envPassword ? 'SUPER_ADMIN_PASSWORD (server/.env)' : 'backups/superadmin-credentials.txt';
  const fileSecret = (creds.match(/^ Secret\s+:\s+(.+)$/m) || [])[1];

  console.log('\n── bcrypt comparison ──');
  if (password) {
    const matches = await bcrypt.compare(password, user.password_hash);
    console.log(`  ${matches ? '✓' : '✖'} stored hash matches the password from ${passwordSource}`);
    const wrong = await bcrypt.compare('definitely-not-the-password', user.password_hash);
    console.log(`  ${!wrong ? '✓' : '✖'} wrong password correctly rejected`);
  } else {
    console.log('  ✖ no password available from the environment or the credentials file');
  }

  console.log('\n── Full login path (password → 2FA → session) ──');
  const base = process.env.API_URL || 'http://localhost:4000';
  const post = async (p, body) => {
    const r = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };

  if (password) {
    const bad = await post('/api/admin-auth/login', { identifier: EMAIL, password: 'wrong-password' });
    console.log(`  ${bad.status === 401 ? '✓' : '✖'} wrong password → HTTP ${bad.status} (${bad.data.error || ''})`);

    const good = await post('/api/admin-auth/login', { identifier: EMAIL, password });
    if (good.status === 429) {
      console.log('  ! sign-in is currently rate-limited from this address — restart the API or wait');
      console.log('    15 minutes before running this diagnostic again.');
    } else {
      console.log(`  ${good.status === 200 ? '✓' : '✖'} correct password → HTTP ${good.status}`);
    }
    console.log(`  ${good.data.requiresTwoFactor ? '✓' : '✖'} 2FA required: ${good.data.requiresTwoFactor}`);
    console.log(`  ${!good.data.token ? '✓' : '✖'} no token issued before 2FA`);

    if (good.data.challenge && fileSecret) {
      const v = await post('/api/admin-auth/verify-2fa', {
        challenge: good.data.challenge, code: cryptoSvc.totp(fileSecret.trim()),
      });
      console.log(`  ${v.status === 200 && v.data.token ? '✓' : '✖'} TOTP accepted → session issued`);
      console.log(`  ${v.data.user && v.data.user.role === 'super_admin' ? '✓' : '✖'} role returned: ${v.data.user && v.data.user.role}`);
      console.log(`  ${v.data.user && v.data.user.isOwner ? '✓' : '✖'} owner flag returned`);
      const dash = await fetch(base + '/api/master/dashboard', { headers: { Authorization: `Bearer ${v.data.token}` } });
      console.log(`  ${dash.status === 200 ? '✓' : '✖'} master dashboard reachable with that session (HTTP ${dash.status})`);
    }
  }

  await require('../db').pool.end();
})();

