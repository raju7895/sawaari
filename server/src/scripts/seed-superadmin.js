/* Create (or repair) the platform owner account.

   Security rules honoured here:
     • the password comes from the environment (SUPER_ADMIN_PASSWORD) or is
       generated with a CSPRNG — it is never hardcoded and never written to
       the repository;
     • the password is stored only as a bcrypt hash (cost 12);
     • two-factor authentication is switched on from the start and the
       TOTP secret is written to a local, git-ignored secrets file;
     • the owner cannot be downgraded or deleted (database trigger);
     • existing accounts, bookings and payments are never touched.

   Usage:
     node src/scripts/seed-superadmin.js            # create/repair
     node src/scripts/seed-superadmin.js --rotate   # reset the owner's password + 2FA
*/
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { query, one } = require('../db');
const cryptoSvc = require('../services/crypto');

const SECRETS_DIR = path.join(__dirname, '..', '..', 'backups');
const SECRETS_FILE = path.join(SECRETS_DIR, 'superadmin-credentials.txt');

/* A password alphabet that is safe to store in a .env file: `#` starts a
   comment in dotenv and quotes/backslashes/spaces break parsing, so a
   password containing them would be silently truncated on read. */
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
  const name = config.admin.superAdmin.name.trim();
  const phone = (config.admin.superAdmin.phone || '').replace(/\D/g, '');

  fs.mkdirSync(SECRETS_DIR, { recursive: true });

  const existing = await one(
    `SELECT u.id, u.name, u.email, u.role, ap.admin_role, ap.is_owner, ap.twofa_enabled
       FROM users u LEFT JOIN admin_profiles ap ON ap.user_id = u.id
      WHERE u.email = $1`, [email]
  );

  /* ── 1. Ensure every legacy 'admin' account has an admin identity ── */
  const legacyAdmins = await query(
    `SELECT u.id, u.name, u.email FROM users u
       LEFT JOIN admin_profiles ap ON ap.user_id = u.id
      WHERE u.role = 'admin' AND ap.user_id IS NULL`
  );
  for (const legacy of legacyAdmins.rows) {
    await query(
      `INSERT INTO admin_profiles (user_id, admin_role, status, email_verified, twofa_enabled)
       VALUES ($1,'admin','active',true,false) ON CONFLICT (user_id) DO NOTHING`,
      [legacy.id]
    );
    console.log(`✔ linked legacy administrator ${legacy.email} to the admin console`);
  }

  /* ── 2. Create or repair the owner ──────────────────────────
     The ENVIRONMENT is the source of truth for the password:
       • SUPER_ADMIN_PASSWORD set  → always applied (re-synced) to the account
       • not set, account exists  → keep the current password; it lives in
         backups/superadmin-credentials.txt. If that file is gone the
         password is unrecoverable, so a fresh one is generated and saved.
       • not set, no account       → generate a strong password and save it. */
  let password = config.admin.superAdmin.password;
  let generatedPassword = false;
  const credsExist = fs.existsSync(SECRETS_FILE);
  let userId = existing ? existing.id : null;

  if (password) {
    if (!envSafe(password)) {
      console.error('✖ SUPER_ADMIN_PASSWORD contains characters that .env cannot represent');
      console.error('  (# starts a comment, quotes/backslashes/spaces break parsing — the value would');
      console.error('   be silently truncated and the sign-in would always fail).');
      console.error('  Use letters, digits and !@%^*-_=+ only.');
      process.exit(1);
    }
    const alreadyMatches = existing
      ? await bcrypt.compare(password, (await one(`SELECT password_hash FROM users WHERE id=$1`, [existing.id])).password_hash)
      : false;
    if (alreadyMatches) {
      console.log(`✔ owner password already matches SUPER_ADMIN_PASSWORD — left untouched`);
    } else if (existing) {
      const hash = await bcrypt.hash(password, 12);
      await query(`UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, [existing.id, hash]);
      await query(`UPDATE admin_profiles SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, [existing.id]);
      console.log(`✔ owner password re-synced from SUPER_ADMIN_PASSWORD (previous password invalidated)`);
    }
  } else if (existing && credsExist) {
    console.log(`✔ owner password unchanged — read it from ${SECRETS_FILE}`);
  } else {
    // no password configured and none recoverable → generate one
    password = strongPassword();
    generatedPassword = true;
    if (existing) {
      const hash = await bcrypt.hash(password, 12);
      await query(`UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, [existing.id, hash]);
      await query(`UPDATE admin_profiles SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, [existing.id]);
      console.log(`✔ owner password rotated (the previous one was unrecoverable)`);
    }
  }

  let totpSecret = cryptoSvc.generateTotpSecret();
  let backupCodes = cryptoSvc.generateBackupCodes(8);

  if (!existing) {
    const hash = await bcrypt.hash(password, 12);
    // A phone number is required by the users table; use the configured one
    // or a unique placeholder derived from the admin role.
    let finalPhone = phone && phone.length === 10 ? phone : '9990000001';
    const phoneTaken = await one(`SELECT id FROM users WHERE phone=$1`, [finalPhone]);
    if (phoneTaken) finalPhone = String(9000000000 + Math.floor(Math.random() * 99999999)).slice(0, 10);
    const { rows } = await query(
      `INSERT INTO users (role, name, phone, email, password_hash, phone_verified, is_active)
       VALUES ('super_admin',$1,$2,$3,$4,true,true) RETURNING id`,
      [name, finalPhone, email, hash]
    );
    userId = rows[0].id;
    console.log(`✔ created owner account ${email}`);
  } else if (rotate) {
    if (!password) {
      password = strongPassword();
      generatedPassword = true;
    }
    const hash = await bcrypt.hash(password, 12);
    await query(`UPDATE users SET password_hash=$2, role='super_admin', is_active=true, updated_at=now() WHERE id=$1`, [userId, hash]);
    await query(`UPDATE admin_profiles SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, [userId]);
    console.log(`✔ rotated the owner password for ${email}`);
  } else {
    console.log(`✔ owner account ${email} already exists — role/status repaired below`);
  }

  /* ── 3. Owner admin profile (idempotent) ── */
  await query(
    `INSERT INTO admin_profiles (user_id, admin_role, is_owner, status, email_verified, email_verified_at)
     VALUES ($1,'super_admin',true,'active',true,now())
     ON CONFLICT (user_id) DO UPDATE
       SET admin_role='super_admin', is_owner=true, status='active', email_verified=true,
           email_verified_at=now(), updated_at=now()`,
    [userId]
  );
  await query(`UPDATE users SET role='super_admin', email_verified_at=now(), updated_at=now() WHERE id=$1`, [userId]);

  /* ── 4. Two-factor authentication ── */
  const profile = await one(`SELECT twofa_enabled, twofa_confirmed_at FROM admin_profiles WHERE user_id=$1`, [userId]);
  let twofaWritten = false;
  if (!profile.twofa_enabled || rotate) {
    const hashedCodes = [];
    for (const code of backupCodes) hashedCodes.push(await bcrypt.hash(code, 10));
    await query(
      `UPDATE admin_profiles SET twofa_enabled=true, twofa_secret=$2, twofa_backup_codes=$3,
              twofa_confirmed_at=now(), updated_at=now() WHERE user_id=$1`,
      [userId, cryptoSvc.encrypt(totpSecret), hashedCodes]
    );
    console.log('✔ two-factor authentication enabled');
    twofaWritten = true;
  } else {
    console.log('✔ two-factor authentication already configured — left untouched');
  }

  /* ── 5. Credentials file ───────────────────────────────────
     Always present so the owner can always recover access:
       • generated password → written into the file
       • password from the environment → the file points at the env var
       • existing account with 2FA already set → the file keeps the original
         secret so the authenticator app keeps working. */
  if (twofaWritten || generatedPassword || !credsExist) {
    if (!twofaWritten) {
      // re-read the stored secret so the file matches what is in the database
      const stored = await one(`SELECT twofa_secret FROM admin_profiles WHERE user_id=$1`, [userId]);
      totpSecret = (stored && cryptoSvc.decrypt(stored.twofa_secret)) || totpSecret;
    }
    const uri = cryptoSvc.totpUri({ secret: totpSecret, email, issuer: 'Sawaari Admin' });
    const block = [
      '='.repeat(78),
      ' SAWAARI SUPER ADMIN — DEPLOYMENT CREDENTIALS',
      '='.repeat(78),
      ` Generated      : ${new Date().toISOString()}`,
      ` Email          : ${email}`,
      ` Password       : ${generatedPassword
        ? password
        : config.admin.superAdmin.password
          ? '(set from SUPER_ADMIN_PASSWORD in server/.env — not copied here)'
          : '(unchanged — see the password previously generated for this account)'}`,
      '',
      ' TWO-FACTOR AUTHENTICATION (mandatory)',
      ` Secret         : ${totpSecret}`,
      ` otpauth URI    : ${uri}`,
      '',
      ' Single-use backup codes (one per line):',
      ...backupCodes.map((c) => `   ${c}`),
      '',
      ' This file is git-ignored. Store it in your password manager, then',
      ' delete it. It is never sent to the frontend, the API or the database.',
      '='.repeat(78),
      '',
    ].join('\n');
    fs.writeFileSync(SECRETS_FILE, block, { mode: 0o600 });
    console.log(`✔ credentials written to: ${SECRETS_FILE}`);
    console.log('  (store them in a password manager, then delete that file)');
  } else {
    console.log(`✔ credentials file already present — left untouched: ${SECRETS_FILE}`);
  }

  /* ── 5. Audit trail ── */
  await query(
    `INSERT INTO admin_audit_log (admin_id, admin_email, admin_role, action, category, target_type, target_id, target_label, result)
     VALUES ($1,$2,'super_admin','admin.owner_seeded','administration','admin',$4,$3,'success')`,
    [userId, email, email, String(userId)]
  );

  console.log('\nSuper admin ready. Sign in at /admin-login with email + password, then the authenticator code.');
  await require('../db').pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
