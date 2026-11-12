/* Set or rotate the platform owner's password — the operator's tool.

   Why this exists: the password must never live in code or be pasted into a
   database shell. This command takes it from the environment
   (SUPER_ADMIN_PASSWORD) or generates a strong one, hashes it with bcrypt,
   invalidates every active session and writes the result to the git-ignored
   credentials file.

   Usage:
     npm run admin:password            # use SUPER_ADMIN_PASSWORD, else generate
     npm run admin:password -- --rotate   # also reset two-factor authentication
*/
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { query, one } = require('../db');
const cryptoSvc = require('../services/crypto');
const sessions = require('../services/adminSession');

const SECRETS_FILE = path.join(__dirname, '..', '..', 'backups', 'superadmin-credentials.txt');

/* A password alphabet that is safe to store in a .env file.
   `#` starts a comment in dotenv, and quotes/backslashes/spaces break
   parsing — a password containing them would be silently truncated and
   the operator could never sign in. */
const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@%^*-_=+';

function strongPassword() {
  const bytes = require('crypto').randomBytes(64);
  let out = '';
  for (let i = 0; i < 24; i++) out += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  return out;
}

/** True when a value survives a round-trip through the .env parser. */
function envSafe(value) {
  if (!value) return false;
  if (/\s/.test(value)) return false;
  if (/[#"'\\]/.test(value)) return false;
  return true;
}

async function main() {
  const rotate = process.argv.includes('--rotate');
  const email = config.admin.superAdmin.email.trim().toLowerCase();

  const owner = await one(
    `SELECT u.id, u.email, u.name, ap.admin_role, ap.is_owner, ap.twofa_enabled
       FROM users u JOIN admin_profiles ap ON ap.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );
  if (!owner) {
    console.error(`No super admin found for ${email}. Run: npm run seed:superadmin`);
    process.exit(1);
  }
  if (!owner.is_owner) {
    console.error(`${email} is not the platform owner — refusing to change its password.`);
    process.exit(1);
  }

  let password = config.admin.superAdmin.password;
  let generated = false;
  if (!password) {
    password = strongPassword();
    generated = true;
  } else if (!envSafe(password)) {
    console.error('✖ SUPER_ADMIN_PASSWORD contains characters that .env cannot represent');
    console.error('  (# starts a comment, and quotes/backslashes/spaces break parsing — the value');
    console.error('   would be silently truncated and the sign-in would always fail).');
    console.error('  Use letters, digits and !@%^*-_=+ only.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await query(
    `UPDATE users SET password_hash=$2, is_active=true, role='super_admin', updated_at=now() WHERE id=$1`,
    [owner.id, hash]
  );
  await query(
    `UPDATE admin_profiles SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`,
    [owner.id]
  );
  await sessions.revoke(owner.id, null, 'password_rotated');

  /* Verify the value that the .env parser actually produced matches what was
     stored — this catches a silently truncated password before the operator
     discovers it at the login screen. */
  const applied = await one(`SELECT password_hash FROM users WHERE id=$1`, [owner.id]);
  const roundTripOk = await bcrypt.compare(password, applied.password_hash);
  if (!roundTripOk) {
    console.error('✖ the password stored does not match the environment value — refusing to continue');
    process.exit(1);
  }

  let secret = null;
  let backupCodes = [];
  if (rotate || !owner.twofa_enabled) {
    secret = cryptoSvc.generateTotpSecret();
    backupCodes = cryptoSvc.generateBackupCodes(8);
    const hashed = [];
    for (const c of backupCodes) hashed.push(await bcrypt.hash(c, 10));
    await query(
      `UPDATE admin_profiles SET twofa_enabled=true, twofa_secret=$2, twofa_backup_codes=$3,
              twofa_confirmed_at=now(), updated_at=now() WHERE user_id=$1`,
      [owner.id, cryptoSvc.encrypt(secret), hashed]
    );
  }

  await query(
    `INSERT INTO admin_audit_log (admin_id, admin_email, admin_role, action, category, target_type, target_id, target_label, result)
     VALUES ($1,$2,'super_admin','admin.password_rotated','security','admin',$3::text,$4,'success')`,
    [owner.id, owner.email, String(owner.id), owner.email]
  );

  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  const existing = fs.existsSync(SECRETS_FILE) ? fs.readFileSync(SECRETS_FILE, 'utf8') : '';
  const oldSecret = (existing.match(/^ Secret\s+:\s+(.+)$/m) || [])[1];
  const oldCodes = (existing.match(/^ {3}([A-Z0-9]{5}-[A-Z0-9]{5})$/gm) || []).map((s) => s.trim());
  const finalSecret = secret || oldSecret;
  const finalCodes = backupCodes.length ? backupCodes : oldCodes;

  const block = [
    '='.repeat(78),
    ' SAWAARI SUPER ADMIN — DEPLOYMENT CREDENTIALS',
    '='.repeat(78),
    ` Updated        : ${new Date().toISOString()}`,
    ` Email          : ${owner.email}`,
    ` Password       : ${generated
      ? password
      : '(set from SUPER_ADMIN_PASSWORD in server/.env — not copied here)'}`,
    '',
    ' TWO-FACTOR AUTHENTICATION (mandatory)',
    ` Secret         : ${finalSecret}`,
    ` otpauth URI    : ${cryptoSvc.totpUri({ secret: finalSecret, email: owner.email, issuer: 'Sawaari Admin' })}`,
    '',
    ' Single-use backup codes (one per line):',
    ...finalCodes.map((c) => `   ${c}`),
    '',
    ' This file is git-ignored. Store it in your password manager, then',
    ' delete it. It is never sent to the frontend, the API or the database.',
    '='.repeat(78),
    '',
  ].join('\n');
  fs.writeFileSync(SECRETS_FILE, block, { mode: 0o600 });

  console.log(`✔ password updated for ${owner.email}`);
  console.log('✔ all active sessions were invalidated (sign in again)');
  if (secret) console.log('✔ two-factor authentication was reset — use the new secret below');
  console.log(`✔ credentials written to: ${SECRETS_FILE}`);
  if (generated) console.log('  the generated password is inside that file only');

  await require('../db').pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
