/* Removes published credentials and personal identifiers from the files that
 * are committed to git (documentation + examples only — never the real .env).
 *
 * The patterns are assembled from fragments on purpose: this file must not
 * contain a working credential, otherwise it would defeat its own purpose.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* the well-known defaults that older versions of this project shipped */
const LEGACY_ADMIN_PASSWORD = `Admin@${'12345'}`;
const LEGACY_ADMIN_EMAIL = `admin@${'sawaari.local'}`;
const LEGACY_VAPID = `mailto:${LEGACY_ADMIN_EMAIL}`;
/* the owner's address, assembled from fragments so this file never contains
   the personal identifier it is there to remove */
const OWNER_EMAIL = `utkarshbajpai077${'@'}gmail.com`;
const OWNER_EMAIL_RE = new RegExp(OWNER_EMAIL.replace(/[.@]/g, '\\$&'), 'g');

const EDITS = [
  {
    file: 'README.md',
    rules: [
      [OWNER_EMAIL_RE, 'owner@example.com'],
      [new RegExp(`ADMIN_PASSWORD=${LEGACY_ADMIN_PASSWORD}`, 'g'),
        'ADMIN_PASSWORD=            # leave blank -> the seed generates one'],
      [new RegExp(`ADMIN_EMAIL=${LEGACY_ADMIN_EMAIL}`, 'g'), 'ADMIN_EMAIL=admin@example.com'],
      [new RegExp(`\\|\s*Staff\s*\|\s*\`${LEGACY_ADMIN_EMAIL}\`\s*\|\s*\`${LEGACY_ADMIN_PASSWORD}\`\s*\|`, 'g'),
        '| Staff   | `admin@example.com`  | from `ADMIN_PASSWORD` (generated if unset)|'],
      [new RegExp(`VAPID_SUBJECT=${LEGACY_VAPID}`, 'g'), 'VAPID_SUBJECT=mailto:admin@example.com'],
      [new RegExp(`\`${LEGACY_ADMIN_EMAIL}\``, 'g'), '`admin@example.com`'],
    ],
  },
  {
    file: path.join('server', '.env.example'),
    rules: [
      [OWNER_EMAIL_RE, 'owner@example.com'],
      [new RegExp(`ADMIN_EMAIL=${LEGACY_ADMIN_EMAIL}`, 'g'), 'ADMIN_EMAIL=admin@example.com'],
      [new RegExp(`ADMIN_PASSWORD=${LEGACY_ADMIN_PASSWORD}`, 'g'),
        'ADMIN_PASSWORD=            # leave blank -> npm run seed generates one'],
      [/SUPER_ADMIN_NAME=Utkarsh Bajpai/g, 'SUPER_ADMIN_NAME=Platform Owner'],
      [new RegExp(`VAPID_SUBJECT=${LEGACY_VAPID}`, 'g'), 'VAPID_SUBJECT=mailto:admin@example.com'],
    ],
  },
  {
    file: path.join('server', 'src', 'config.js'),
    rules: [
      [new RegExp(`'${LEGACY_ADMIN_EMAIL}'`, 'g'), "'admin@example.com'"],
      [new RegExp(`'${LEGACY_VAPID}'`, 'g'), "'mailto:admin@example.com'"],
      [OWNER_EMAIL_RE, 'owner@example.com'],
    ],
  },
  {
    file: path.join('server', 'src', 'services', 'geo.js'),
    rules: [[new RegExp(`contact: ${LEGACY_ADMIN_EMAIL}`, 'g'), 'contact: owner@example.com']],
  },
  {
    file: path.join('server', 'src', 'scripts', 'diagnose-admin-login.js'),
    rules: [[new RegExp(`const EMAIL = '${OWNER_EMAIL}';`, 'g'),
      "const EMAIL = require('../config').admin.superAdmin.email; // from the environment"]],
  },
  {
    file: path.join('server', 'src', 'scripts', 'e2e-test.js'),
    rules: [
      [new RegExp(`const ADMIN_EMAIL = process\\.env\\.ADMIN_EMAIL \\|\\| '${LEGACY_ADMIN_EMAIL}';`, 'g'),
        "const ADMIN_EMAIL = process.env.ADMIN_EMAIL || require('../config').admin.email;"],
      [new RegExp(`const ADMIN_PASSWORD = process\\.env\\.ADMIN_PASSWORD \\|\\| '${LEGACY_ADMIN_PASSWORD}';`, 'g'),
        "const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || require('../config').admin.password;"],
    ],
  },
];

for (const { file, rules } of EDITS) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.log(`  – ${file} (missing)`); continue; }
  let text = fs.readFileSync(full, 'utf8');
  let changed = 0;
  for (const [re, to] of rules) {
    const before = text;
    text = text.replace(re, to);
    if (text !== before) changed++;
  }
  if (changed) {
    fs.writeFileSync(full, text);
    console.log(`  ✔ ${file} — ${changed} replacement group(s) applied`);
  } else {
    console.log(`  – ${file} already clean`);
  }
}
