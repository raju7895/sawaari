/* Proves the Render build works — exactly what Render runs, from a clean
 * checkout, with the environment Render provides.
 *
 *   node scripts/verify-render-build.js
 *
 * It builds the static site, checks that the bundle is complete (the app
 * shell, the PWA manifest, the service worker, the hashed assets) and that
 * it contains no leftover localhost address, and that the Supabase URL and
 * the publishable key really made it into the bundle.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(os.tmpdir(), `sawaari-render-check-${Date.now()}`);
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vwpxxgmcjrzegnqrpvsv.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DWc8VP6s8ToTLa5f_AxoHg_rtJvN8A6';

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${label}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  ✖ ${label}${extra ? ` — ${extra}` : ''}`); }
};

function main() {
  console.log('\n── 1. a clean checkout (what Render clones) ──');
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  spawnSync('git', ['clone', '--depth', '1', ROOT, WORK], { cwd: ROOT, encoding: 'utf8' });
  const cloned = fs.readdirSync(WORK).filter((f) => !f.startsWith('.'));
  ok('repository cloned', cloned.includes('web'), cloned.join(', '));
  ok('no .env in the clone', !fs.existsSync(path.join(WORK, 'web', '.env')));
  ok('no node_modules in the clone', !fs.existsSync(path.join(WORK, 'web', 'node_modules')));

  console.log('\n── 2. the build (npm install && npm run build) ──');
  const env = { ...process.env, VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: ANON_KEY, NODE_ENV: 'production' };
  const build = spawnSync('npm', ['install', '--include=dev'], { cwd: path.join(WORK, 'web'), env, encoding: 'utf8', shell: true });
  ok('npm install --include=dev', build.status === 0);
  const built = spawnSync('npm', ['run', 'build'], { cwd: path.join(WORK, 'web'), env, encoding: 'utf8', shell: true });
  if (built.status !== 0) {
    console.log((built.stdout || '') + (built.stderr || ''));
  }
  ok('npm run build', built.status === 0);

  console.log('\n── 3. the bundle ──');
  const dist = path.join(WORK, 'web', 'dist');
  ok('dist/ created', fs.existsSync(dist));
  if (!fs.existsSync(dist)) {
    console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
    fs.rmSync(WORK, { recursive: true, force: true });
    process.exit(1);
  }
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    ok(`dist/${f}`, fs.existsSync(path.join(dist, f)));
  }
  const assets = fs.existsSync(path.join(dist, 'assets')) ? fs.readdirSync(path.join(dist, 'assets')) : [];
  ok('hashed assets emitted', assets.length > 0, assets.slice(0, 5).join(', '));
  ok('the app shell is present', fs.readFileSync(path.join(dist, 'index.html'), 'utf8').includes('id="root"'));
  ok('the manifest icons are present', fs.existsSync(path.join(dist, 'icons', 'icon-512.png')));

  const jsFiles = assets.filter((a) => a.endsWith('.js')).map((a) => path.join(dist, 'assets', a));
  const bundle = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('');
  ok('the Supabase URL is baked into the bundle', bundle.includes(SUPABASE_URL), SUPABASE_URL);
  ok('the publishable key is baked into the bundle', bundle.includes(ANON_KEY));
  const localUrls = [...new Set(bundle.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g) || [])]
    .filter((u) => u !== 'http://localhost:9999');           // supabase-js' own default
  ok('no leftover localhost address in the bundle', localUrls.length === 0, localUrls.join(', ') || 'none');
  // no secret key may be in the bundle: the only key allowed is the one we
  // passed in (the word "service_role" appears inside supabase-js itself)
  const secretKeys = bundle.match(/sb_secret_[A-Za-z0-9_-]+/g) || [];
  const jwts = bundle.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || [];
  const foreignJwts = jwts.filter((k) => k !== ANON_KEY);
  ok('no secret key in the bundle', secretKeys.length === 0 && foreignJwts.length === 0,
    foreignJwts.length ? `${foreignJwts.length} unknown key(s)` : 'only the publishable key');

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main();
