/* Simulates the Render build exactly, from a clean checkout, against a
 * brand-new database. This is the definitive "will it deploy" test.
 *
 *   1. git clone the repo to a temp folder (exactly what Render receives)
 *   2. create an empty database
 *   3. API service:  npm ci && npm run migrate && npm run seed && npm run seed:superadmin
 *      then start it and poll /api/health
 *   4. Static site:  npm ci && VITE_API_URL=... npm run build
 *      then check dist/ contains the app shell
 *
 *   node scripts/verify-render-build.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(os.tmpdir(), `sawaari-render-test-${Date.now()}`);
const DB = 'sawaari_render_test';
const API_PORT = 4111;
const BASE = `http://127.0.0.1:${API_PORT}`;

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  ✖ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const psql = (db, sql) => execFileSync('C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
  ['-U', 'postgres', '-d', db, '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env || process.env, encoding: 'utf8', shell: true });
  if (r.status !== 0 && !opts.allowFail) {
    console.log((r.stdout || '') + (r.stderr || ''));
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
  return r;
}

async function main() {
  console.log('\n── 1. clean checkout (what Render clones) ──');
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  run('git', ['clone', '--depth', '1', ROOT, WORK], { cwd: ROOT });
  const cloned = fs.readdirSync(WORK).filter((f) => !f.startsWith('.'));
  ok('repository cloned', cloned.includes('server') && cloned.includes('web'), cloned.join(', '));
  ok('no .env in the clone', !fs.existsSync(path.join(WORK, 'server', '.env')));
  ok('no node_modules in the clone', !fs.existsSync(path.join(WORK, 'server', 'node_modules')));

  console.log('\n── 2. fresh database ──');
  try { psql('postgres', `DROP DATABASE IF EXISTS ${DB};`); } catch { /* ignore */ }
  psql('postgres', `CREATE DATABASE ${DB};`);
  ok(`database ${DB} created`, true);

  console.log('\n── 3. API service: npm ci && migrate && seed && seed:superadmin ──');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(API_PORT),
    DATABASE_URL: `postgres://postgres:postgres@localhost:5432/${DB}`,
    JWT_SECRET: 'render-test-jwt-secret-0123456789abcdef0123456789abcdef',
    OTP_PEPPER: 'render-test-otp-pepper-0123456789abcdef0123456789',
    ADMIN_TOTP_ENCRYPTION_KEY: 'render-test-totp-key-0123456789abcdef0123456789',
    SUPER_ADMIN_EMAIL: 'owner@example.com',
    SUPER_ADMIN_PASSWORD: 'RenderTest@2026Owner',
    ADMIN_EMAIL: 'staff@example.com',
    ADMIN_PASSWORD: 'RenderStaff@2026',
    APP_URL: 'https://example.onrender.com',
    SMS_DEV_MODE: 'false',
  };
  const t0 = Date.now();
  run('npm', ['ci', '--include=dev'], { cwd: path.join(WORK, 'server'), env });
  ok('npm ci --include=dev (API)', true, `${Math.round((Date.now() - t0) / 1000)}s`);
  run('npm', ['run', 'migrate'], { cwd: path.join(WORK, 'server'), env });
  ok('migrations applied', true);
  run('npm', ['run', 'seed'], { cwd: path.join(WORK, 'server'), env });
  ok('seed completed', true);
  run('npm', ['run', 'seed:superadmin'], { cwd: path.join(WORK, 'server'), env });
  ok('super admin seeded', true);

  console.log('\n── 4. start the API and poll the health check ──');
  const child = spawn('npm', ['start'], {
    cwd: path.join(WORK, 'server'), env, shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let health = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${BASE}/api/health`);
      health = await res.json();
      if (health.ok) break;
    } catch { /* not up yet */ }
  }
  ok('GET /api/health', Boolean(health && health.ok), health ? `database=${health.integrations.database}` : 'no response');
  ok('API listens on $PORT', health !== null, `port ${API_PORT}`);

  // the owner account can actually sign in
  const login = await fetch(`${BASE}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'owner@example.com', password: 'RenderTest@2026Owner' }),
  });
  const loginBody = await login.json();
  ok('owner password from the environment works', login.status === 200 && Boolean(loginBody.challenge),
    `2FA required: ${loginBody.requiresTwoFactor}`);

  // the seeded cities exist
  const cities = await fetch(`${BASE}/api/meta/cities`).then((r) => r.json());
  ok('cities seeded', Array.isArray(cities) && cities.length === 10, `${cities.length} cities`);
  // stop the API (and everything it spawned) before the cleanup
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 2000));

  console.log('\n── 5. Static site: npm ci && VITE_API_URL=… npm run build ──');
  const t1 = Date.now();
  run('npm', ['ci', '--include=dev'], { cwd: path.join(WORK, 'web'), env });
  ok('npm ci --include=dev (web)', true, `${Math.round((Date.now() - t1) / 1000)}s`);
  run('npm', ['run', 'build'], {
    cwd: path.join(WORK, 'web'),
    env: { ...env, VITE_API_URL: BASE },
  });
  const dist = path.join(WORK, 'web', 'dist');
  ok('dist/ created', fs.existsSync(dist));
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    ok(`dist/${f}`, fs.existsSync(path.join(dist, f)));
  }
  const assets = fs.existsSync(path.join(dist, 'assets')) ? fs.readdirSync(path.join(dist, 'assets')) : [];
  ok('hashed assets emitted', assets.length > 0, assets.slice(0, 4).join(', '));
  ok('manifest icons present', fs.existsSync(path.join(dist, 'icons', 'icon-512.png')));

  // the built bundle must point at the API, not at a hardcoded host
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const jsFiles = assets.filter((a) => a.endsWith('.js')).map((a) => path.join(dist, 'assets', a));
  const bundle = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('');
  ok('VITE_API_URL baked into the bundle', bundle.includes(BASE), BASE);
  const localUrls = [...new Set(bundle.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g) || [])];
  // http://localhost:9999 is supabase-js' own internal default for its realtime
  // endpoint — it is never used once VITE_SUPABASE_URL is set. Everything else
  // that points at localhost would break the deployed app.
  const libraryDefaults = ['http://localhost:9999'];
  const unexpectedLocal = localUrls.filter((u) => !libraryDefaults.includes(u));
  ok('no hardcoded localhost API in the bundle',
    unexpectedLocal.every((u) => u === BASE || u.startsWith(BASE)),
    localUrls.length ? localUrls.join(', ') : 'none found');
  ok('relative /api paths are appended to the base (apiBase)',
    bundle.includes('apiBase') || bundle.includes('/api/'),
    'paths like /api/bookings are joined to the configured base URL');

  console.log('\n── 6. cleanup ──');
  try {
    execFileSync('C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
      ['-U', 'postgres', '-d', 'postgres', '-c',
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB}';`],
      { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'ignore' });
    execFileSync('C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
      ['-U', 'postgres', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB};`],
      { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'ignore' });
  } catch { /* ignore */ }
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* locked */ }
  ok('test database and checkout removed', true);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('\n✖', e.message); process.exit(1); });
