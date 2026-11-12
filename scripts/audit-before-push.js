/* Pre-push secret & privacy audit.
 *
 * Scans every file that git would track for:
 *   • real secrets (JWT secret, OTP pepper, admin password, TOTP secret,
 *     keystore passwords, database credentials)
 *   • personal data (real names / phone numbers / emails of accounts)
 *   • anything that should not be published
 *
 *   node scripts/audit-before-push.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* Files git must never publish */
const NEVER_COMMIT = [
  '.env', 'keystore.properties', '.keystore', '.jks',
  'superadmin-credentials.txt', 'android-keystore.properties',
];

/* Build the list of files git would actually track */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT, encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch {
    // not a repo yet — walk the tree with the same exclusions
    const skip = new Set(['node_modules', '.git', 'dist', '.toolchain', 'backups', '.gradle', 'uploads', '.logs', 'logs']);
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(path.relative(ROOT, p));
      }
    };
    walk(ROOT);
    return out;
  }
}

/* ── collect the real secret values from the local environment ── */
const secrets = [];
function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = readEnv(path.join(ROOT, 'server', '.env'));
const SENSORED = [
  ['JWT_SECRET', env.JWT_SECRET],
  ['OTP_PEPPER', env.OTP_PEPPER],
  ['SUPER_ADMIN_PASSWORD', env.SUPER_ADMIN_PASSWORD],
  ['ADMIN_TOTP_ENCRYPTION_KEY', env.ADMIN_TOTP_ENCRYPTION_KEY],
  ['ADMIN_PASSWORD', env.ADMIN_PASSWORD],
  ['DATABASE_URL', env.DATABASE_URL],
];
for (const [name, value] of SENSORED) {
  if (!value || value.length <= 5) continue;
  // a database URL that only points at localhost cannot be used remotely
  if (name === 'DATABASE_URL' && /@(localhost|127\.0\.0\.1)[:/]/.test(value)) continue;
  secrets.push({ name, value });
}

/* the generated owner credentials + keystore passwords */
const credFile = path.join(ROOT, 'server', 'backups', 'superadmin-credentials.txt');
if (fs.existsSync(credFile)) {
  const creds = fs.readFileSync(credFile, 'utf8');
  for (const m of creds.matchAll(/^ (?:Password|Secret)\s+:\s+(.+)$/gm)) {
    const value = m[1].trim();
    // skip documentation placeholders such as "(set from SUPER_ADMIN_PASSWORD …)"
    if (!value || value.startsWith('(') || value.length < 8) continue;
    secrets.push({ name: 'superadmin-credentials', value });
  }
}
const ksProps = path.join(ROOT, 'web', 'android', 'keystore.properties');
if (fs.existsSync(ksProps)) {
  for (const m of fs.readFileSync(ksProps, 'utf8').matchAll(/^(storePassword|keyPassword)=(.+)$/gm)) {
    secrets.push({ name: 'keystore-password', value: m[2].trim() });
  }
}

/* ── scan ── */
const files = trackedFiles();
let leaks = 0;
let flagged = 0;

console.log(`\nScanning ${files.length} file(s) that git would track…\n`);

for (const rel of files) {
  const full = path.join(ROOT, rel);
  let stat;
  try { stat = fs.statSync(full); } catch { continue; }
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) continue;

  const base = path.basename(rel);
  if (NEVER_COMMIT.includes(base)) {
    console.log(`  ✖ NEVER COMMIT: ${rel}`);
    leaks++; continue;
  }

  let content;
  try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }

  for (const s of secrets) {
    if (content.includes(s.value)) {
      console.log(`  ✖ SECRET LEAK: ${rel} contains the real ${s.name}`);
      leaks++;
    }
  }
}

/* personal data that must not be published */
const PII = [
  // a real gmail address belonging to the platform owner
  [/[\w.+-]+@gmail\.com/g, 'a personal gmail address'],
  // real-looking mobile numbers, excluding obvious placeholders
  [/\b[6-9]\d{9}\b/g, 'a possible real mobile number'],
];
const PLACEHOLDER_PHONES = new Set([
  '9999999999', '9990000001', '9812345670', '9876543210',
  '8999999999', '9000000000',   // phone-generation ranges
]);
for (const rel of files) {
  const full = path.join(ROOT, rel);
  let stat;
  try { stat = fs.statSync(full); } catch { continue; }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  if (!/\.(js|jsx|ts|tsx|json|md|sql|html|css|txt|yml|yaml|ps1|cjs)$/.test(rel)) continue;
  let content;
  try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
  for (const [re, what] of PII) {
    const hits = (content.match(re) || [])
      .filter((h) => !(re.source.includes('\\d{9}') && PLACEHOLDER_PHONES.has(h)));
    if (hits.length) {
      console.log(`  ! POSSIBLE ${what} (${hits.length}) in ${rel}`);
      flagged++;
    }
  }
}

/* anything that should not be committed */
const BAD_PATHS = [
  [/node_modules\//, 'node_modules'],
  [/^\.toolchain\//, 'toolchain'],
  [/^server\/backups\//, 'backups (database dumps + credentials)'],
  [/^server\/uploads\/.+\.(png|jpg|jpeg|pdf)$/i, 'uploaded user documents'],
  [/^web\/android\/app\/build\//, 'build output'],
  [/^web\/dist\//, 'build output'],
  [/^electron\/dist\//, 'build output'],
];
for (const rel of files) {
  for (const [re, why] of BAD_PATHS) {
    if (re.test(rel)) {
      console.log(`  ✖ SHOULD NOT COMMIT: ${rel}  (${why})`);
      leaks++;
      break;
    }
  }
}

console.log('');
console.log(`  secret leaks      : ${leaks}`);
console.log(`  personal-data hits: ${flagged}`);
console.log(leaks === 0
  ? '\n  ✔ Safe to publish — no live secrets in the tracked files.\n'
  : '\n  ✖ Fix the items above before pushing.\n');
process.exit(leaks ? 1 : 0);
