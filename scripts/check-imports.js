/* Proves that every file we are about to delete is not imported anywhere,
 * and lists the importers of the files that stay.
 *
 *   node scripts/check-imports.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'));

/* the files this migration removes */
const DELETE = [
  // the whole custom API
  'server/',
  'Procfile',
  'docker-compose.yml',
  'server/Dockerfile',
  // the old migration (the schema is replaced by the Supabase one)
  'supabase/migrations/20261114000000_init.sql',
  // the API address machinery — Supabase is the only backend now
  'web/src/serverConfig.js',
  'web/src/components/ServerSettings.jsx',
  'web/src/context/SocketContext.jsx',
  // features with no table behind them any more
  'web/src/components/ChatPanel.jsx',
  'web/src/pages/common/Support.jsx',
  'web/src/pages/auth/VerifyOtp.jsx',
  'web/src/pages/admin/AcceptInvite.jsx',
  'web/src/pages/admin/VerifyAdminEmail.jsx',
  'web/src/pages/admin/ResetAdminPassword.jsx',
  'web/src/pages/admin/DriversDirectory.jsx',
  'web/src/pages/admin/Revenue.jsx',
  'web/src/pages/admin/Refunds.jsx',
  'web/src/pages/admin/Reports.jsx',
  'web/src/pages/admin/Tickets.jsx',
  'web/src/pages/admin/Admins.jsx',
  'web/src/pages/admin/Analytics.jsx',
  'web/src/pages/admin/Cities.jsx',
  'web/src/pages/admin/Pricing.jsx',
  'web/src/pages/admin/Notifications.jsx',
  'web/src/pages/admin/Security.jsx',
];

const deleted = files.filter((f) => DELETE.some((d) => f === d || f.startsWith(d)));
const kept = files.filter((f) => !deleted.includes(f) && fs.existsSync(path.join(ROOT, f)));

/* who imports what */
const importers = new Map();
for (const f of kept) {
  if (!/\.(js|jsx|css)$/.test(f)) continue;
  const c = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const other of kept) {
    if (other === f) continue;
    const base = path.basename(other).replace(/\.(jsx?|css)$/, '');
    const re = new RegExp(`['"]([^'"]*${base})['"]`);
    if (re.test(c)) {
      if (!importers.has(other)) importers.set(other, []);
      importers.get(other).push(f);
    }
  }
}

console.log(`\n${deleted.length} files marked for deletion, ${kept.length} stay\n`);
console.log('File | imported by');
console.log('---|---|');
let orphans = 0;
for (const f of deleted) {
  if (f.endsWith('/')) { console.log(`${f} | (directory)`); continue; }
  const used = (importers.get(f) || []).filter((i) => !deleted.includes(i));
  if (!used.length) { orphans++; console.log(`${f} | — nothing imports it`); }
  else console.log(`${f} | ${used.join(', ')}`);
}
console.log(`\n${orphans} of them are imported by nothing that survives.`);

/* the reverse: does anything still import a file that is going away? */
const broken = [];
for (const f of kept) {
  if (!/\.(js|jsx)$/.test(f)) continue;
  let c; try { c = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(c))) {
    const spec = m[1];
    const target = path.normalize(path.join(path.dirname(f), spec)).replace(/\\/g, '/');
    const hit = kept.find((k) => k === target || k.replace(/\.(jsx?|css|json)$/, '') === target);
    if (!hit) broken.push(`${f} → ${spec}`);
  }
}
console.log('\nBroken imports (target missing):');
console.log(broken.length ? broken.map((b) => '  ' + b).join('\n') : '  none');
