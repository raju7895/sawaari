/* Prints the platform owner's two-factor details so they can be enrolled in
 * an authenticator app after a deployment.
 *
 *   node src/scripts/admin-2fa.js            # show secret + URI + backup codes
 *   node src/scripts/admin-2fa.js --code     # also print a live 6-digit code
 *
 * Run this in the Render Shell (or locally) after the first deploy.
 * It never changes anything.
 */
const { one } = require('../db');
const cryptoSvc = require('../services/crypto');
const config = require('../config');

(async () => {
  const email = config.admin.superAdmin.email;
  const row = await one(
    `SELECT ap.twofa_enabled, ap.twofa_secret, ap.twofa_backup_codes, ap.email_verified,
            u.name, u.email
       FROM admin_profiles ap JOIN users u ON u.id = ap.user_id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );

  if (!row) {
    console.error(`No super admin found for ${email}. Run: npm run seed:superadmin`);
    process.exit(1);
  }
  if (!row.twofa_enabled || !row.twofa_secret) {
    console.error('Two-factor authentication is not set up for the owner yet.');
    console.error('Run: npm run seed:superadmin   (then re-run this script)');
    process.exit(1);
  }

  const secret = cryptoSvc.decrypt(row.twofa_secret);
  console.log('');
  console.log('  Sawaari — Super Admin two-factor authentication');
  console.log('  ------------------------------------------------');
  console.log(`  Account      : ${row.email}`);
  console.log(`  Secret       : ${secret}`);
  console.log(`  Add to app   : ${cryptoSvc.totpUri({ secret, email: row.email, issuer: 'Sawaari Admin' })}`);
  if (row.twofa_backup_codes && row.twofa_backup_codes.length) {
    console.log('');
    console.log('  Single-use backup codes (each works once):');
    console.log('    (already hashed in the database — regenerate with:');
    console.log('     npm run admin:password -- --rotate)');
  }
  if (process.argv.includes('--code')) {
    console.log('');
    console.log(`  Current code : ${cryptoSvc.totp(secret)}`);
  }
  console.log('');
  await require('../db').pool.end();
})();
