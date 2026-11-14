/* Phase 1 — the full audit scan.
 *
 *   node scripts/audit-project.js
 *
 * Produces the table:  File | Problem | Severity | Action
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'));

const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
const rows = [];
const add = (file, problem, severity, action) => rows.push({ file, problem, severity, action });

const SEV = { BLOCKER: 'Blocker', HIGH: 'High', LOW: 'Low' };

/* ── 1. Supabase client, keys, env ─────────────────────────────────── */
let clientFiles = [];
const SELF = 'scripts/audit-project.js';
for (const f of files.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f) && !f.includes('node_modules'))) {
  const c = read(f) || '';
  if (/createClient\s*\(/.test(c)) clientFiles.push(f);
  if (f === SELF) continue;                       // the scanner names the patterns itself
  // a real secret key anywhere, or the words in front-end code
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(c)) add(f, 'a Supabase secret key is in the source', SEV.BLOCKER, 'Fix');
  if (/service_role|sb_secret/i.test(c) && f.startsWith('web/')) add(f, 'a service-role / secret key is referenced in the front end', SEV.BLOCKER, 'Fix');
  // the publishable key is public, but it must not be hardcoded in the front end
  if (/\bsb_publishable_[A-Za-z0-9_-]{20,}/.test(c) && f.startsWith('web/')) add(f, 'a publishable key is hardcoded in the front end — read it from the environment', SEV.HIGH, 'Fix');
  if (/eyJhbGciOiJ[A-Za-z0-9_-]{10,}/.test(c) && f.startsWith('web/')) add(f, 'a JWT (anon/service key) is hardcoded in the front end', SEV.HIGH, 'Fix');
}

/* ── 2. calls to a custom / non-existent API ───────────────────────── */
for (const f of files.filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('node_modules'))) {
  const c = read(f) || '';
  const lines = c.split('\n');
  lines.forEach((line, i) => {
    if (/VITE_API_URL/.test(line) && f.startsWith('web/')) add(f, `line ${i + 1}: refers to VITE_API_URL (the old custom API)`, SEV.HIGH, 'Fix');
    if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(line) && !/audit:dev-only/.test(line)) {
      add(f, `line ${i + 1}: a hardcoded localhost URL`, SEV.HIGH, 'Fix');
    }
    if (/api\.(get|post|put|patch|delete)\(\s*['"`]\/api\//.test(line)) {
      add(f, `line ${i + 1}: calls the old custom API (${line.trim().slice(0, 60)})`, SEV.HIGH, 'Fix');
    }
    if (/(<<<<<<<|>>>>>>>|=======)/.test(line) && /^(<<<<<<<|>>>>>>>|=======)/.test(line.trim())) {
      add(f, `line ${i + 1}: merge-conflict marker`, SEV.BLOCKER, 'Fix');
    }
  });
}

/* ── 3. corrupt / empty files ───────────────────────────────────────── */
for (const f of files) {
  const abs = path.join(ROOT, f);
  let st; try { st = fs.statSync(abs); } catch { continue; }
  if (!st.isFile()) continue;
  if (st.size === 0) {
    if (!/\.gitkeep$/.test(f)) add(f, 'empty file', SEV.LOW, 'Delete');
    continue;
  }
  if (/\.(json|jsonc)$/.test(f)) {
    const c = read(f) || '';
    try { JSON.parse(c.replace(/^\s*\/\/.*$/gm, '')); } catch (e) {
      add(f, `invalid JSON: ${e.message.slice(0, 60)}`, SEV.BLOCKER, 'Fix');
    }
  }
}

/* ── 4. case-sensitive import mismatches (Render runs Linux) ────────── */
const exists = (p) => fs.existsSync(path.join(ROOT, p));
for (const f of files.filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('node_modules'))) {
  const c = read(f) || '';
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(c))) {
    const spec = m[1];
    const base = path.join(path.dirname(f), spec);
    const dir = path.dirname(base);
    const want = path.basename(base);
    if (!exists(dir)) continue;
    const names = fs.readdirSync(dir);
    const exact = names.includes(want);
    const caseOnly = names.find((n) => n.toLowerCase() === want.toLowerCase());
    if (!exact && caseOnly) add(f, `imports "${spec}" but the file is "${caseOnly}" (breaks on Linux)`, SEV.BLOCKER, 'Fix');
    if (!exact && !caseOnly && !/\.(css|json|svg|png)$/.test(want)) {
      const withExt = names.find((n) => n.replace(/\.(js|jsx)$/, '') === want);
      if (!withExt) add(f, `imports "${spec}" which does not exist`, SEV.BLOCKER, 'Fix');
    }
  }
}

/* ── 5. mock / hardcoded data and dead files ───────────────────────── */
for (const f of files.filter((f) => /\.(jsx|js)$/.test(f) && f.startsWith('web/src'))) {
  const c = read(f) || '';
  if (/Illustration only|hardcoded|mock data|MOCK_/i.test(c)) add(f, 'mock / decorative data', SEV.LOW, 'Fix');
}

/* ─* 6. leftovers ──────────────────────────────────────────────────── */
for (const f of files) {
  if (/\.(bak|orig|rej|tmp|log)$/i.test(f)) add(f, 'stray file', SEV.LOW, 'Delete');
  if (/(^|\/)(copy of|backup)/i.test(f)) add(f, 'duplicate file', SEV.LOW, 'Delete');
  if (/_old\.|_backup\.|\.old$/i.test(f)) add(f, 'old copy of a file', SEV.LOW, 'Delete');
}

/* ── 7. package.json ───────────────────────────────────────────────── */
for (const f of files.filter((f) => f.endsWith('package.json') && !f.includes('node_modules'))) {
  const j = JSON.parse(read(f));
  if (!j.engines) add(f, 'no "engines" field (Render cannot pick the Node version)', SEV.LOW, 'Fix');
  if (!j.scripts) add(f, 'no "scripts"', SEV.HIGH, 'Fix');
}

/* ── 8. .gitignore coverage ────────────────────────────────────────── */
const gi = read('.gitignore') || '';
for (const need of ['node_modules', '.env', 'dist']) {
  if (!gi.includes(need)) add('.gitignore', `does not cover "${need}"`, SEV.HIGH, 'Fix');
}

/* ── 9. the backend that should not exist any more ─────────────────── */
if (files.some((f) => f.startsWith('server/'))) {
  add('server/**', 'a custom Express API — it is what produces "cannot reach the sawaari server"', SEV.BLOCKER, 'Delete');
  add('render.yaml', 'describes a Postgres + Web Service + Static Site — the backend services must go', SEV.HIGH, 'Fix');
  add('Procfile', 'starts the Express API', SEV.HIGH, 'Delete');
  add('docker-compose.yml', 'starts the Express API and Postgres', SEV.LOW, 'Delete');
}

/* ── report ────────────────────────────────────────────────────────── */
const order = { Blocker: 0, High: 1, Low: 2 };
rows.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file));
console.log(`\nAUDIT — ${rows.length} findings in ${files.length} tracked files\n`);
console.log('| File | Problem | Severity | Action |');
console.log('|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.file} | ${r.problem.replace(/\|/g, '\\|')} | ${r.severity} | ${r.action} |`);
}
console.log('\nSupabase clients found:', clientFiles.length ? clientFiles.join(', ') : 'NONE');
const counts = rows.reduce((a, r) => { a[r.severity] = (a[r.severity] || 0) + 1; return a; }, {});
console.log('severity:', JSON.stringify(counts));
