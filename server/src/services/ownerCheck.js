/* Startup integrity check for the platform owner credentials.

   Compares SUPER_ADMIN_PASSWORD from the environment with the hash stored in
   the database and reports loudly when they differ. This is the difference
   between "the console shows a login error" and "the operator is told the
   password in .env is not the one that was applied". */
const bcrypt = require('bcryptjs');
const config = require('../config');
const { one } = require('../db');

async function verifyOwnerCredentials() {
  const email = (config.admin.superAdmin.email || '').trim().toLowerCase();
  const configured = (config.admin.superAdmin.password || '').trim();
  const report = { email, configured: Boolean(configured), matches: null, status: 'unknown' };

  if (!email) return report;

  const owner = await one(
    `SELECT u.id, u.password_hash, ap.status, ap.is_owner, ap.twofa_enabled, ap.locked_until
       FROM users u LEFT JOIN admin_profiles ap ON ap.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );

  if (!owner) {
    report.status = 'missing';
    console.warn(`  ⚠ Super admin account not found for ${email} — run: npm run seed:superadmin`);
    return report;
  }

  if (!owner.is_owner || owner.status !== 'active') {
    report.status = 'inactive';
    console.warn(`  ⚠ Super admin account ${email} is not an active owner — run: npm run seed:superadmin`);
    return report;
  }

  if (owner.locked_until && new Date(owner.locked_until) > new Date()) {
    report.status = 'locked';
    console.warn(`  ⚠ Super admin account ${email} is temporarily locked until ${owner.locked_until.toISOString()}`);
  }

  if (!configured) {
    report.status = report.status === 'unknown' ? 'no_env_password' : report.status;
    console.warn('  ⚠ SUPER_ADMIN_PASSWORD is not set in server/.env');
    console.warn('    The password in use is the one written to server/backups/superadmin-credentials.txt');
    return report;
  }

  report.matches = await bcrypt.compare(configured, owner.password_hash);
  if (!report.matches) {
    report.status = 'password_mismatch';
    console.warn(`  ⚠ SUPER_ADMIN_PASSWORD does not match the stored password for ${email}`);
    console.warn('    The .env value was probably truncated by a "#" or a quote. Fix it and run:');
    console.warn('      npm run admin:password');
  }
  return report;
}

module.exports = { verifyOwnerCredentials };
