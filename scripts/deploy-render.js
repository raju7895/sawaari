/* Deploys the Sawaari static site to Render through the Render API.
 *
 *   export RENDER_API_KEY="rnd_..."      (macOS / Linux)
 *   $env:RENDER_API_KEY = "rnd_..."      (Windows PowerShell)
 *   node scripts/deploy-render.js            # dry run
 *   node scripts/deploy-render.js --apply    # do it
 *
 * There is no backend any more — Supabase is the whole backend — so this
 * only manages the one static site: it sets the two environment variables
 * (the Supabase URL and the publishable key), triggers a deploy with the
 * build cache cleared and verifies that the site answers.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const KEY = process.env.RENDER_API_KEY || '';
const API = 'https://api.render.com/v1';

const NAME = 'sawaari-web';
const REPO = 'https://github.com/raju7895/sawaari';

const log = (...a) => console.log(...a);

async function render(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const detail = (json && (json.message || json.error)) || text.slice(0, 300);
    throw new Error(`${method} ${pathname} → ${res.status}: ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The values the bundle needs. The anon key is public by design. */
function siteEnv() {
  const env = {};
  try {
    const text = fs.readFileSync(path.join(ROOT, 'web', '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^(VITE_[A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch { /* no local .env — the values come from the environment */ }
  return [
    { key: 'VITE_SUPABASE_URL', value: env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '' },
    { key: 'VITE_SUPABASE_ANON_KEY', value: env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '' },
  ];
}

async function main() {
  if (!KEY) {
    log('✖ RENDER_API_KEY is not set.');
    log('  PowerShell  : $env:RENDER_API_KEY = "rnd_..."');
    log('  macOS/Linux : export RENDER_API_KEY="rnd_..."');
    process.exit(1);
  }

  log('== 1. the services in the account ==');
  const services = await render('/services?limit=100');
  for (const s of services) {
    log(`  ${s.name.padEnd(18)} ${s.type.padEnd(12)} ${s.serviceDetails?.url || s.staticSiteDetails?.url || ''}`);
  }

  let site = services.find((s) => s.name === NAME && s.type === 'static_site');
  const wanted = siteEnv();
  const missing = wanted.filter((v) => !v.value);
  if (missing.length) {
    log(`\n✖ ${missing.map((m) => m.key).join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set.`);
    log('  Put them in web/.env (copy web/.env.example) or in the environment, and run again.');
    process.exit(1);
  }

  log(`\n== 2. the static site ==`);
  if (!site) {
    log(`  it does not exist yet — creating "${NAME}"`);
    if (!APPLY) { log('  (dry run — re-run with --apply to create it)'); return; }
    site = await render('/services', {
      method: 'POST',
      body: {
        name: NAME,
        type: 'static_site',
        repo: REPO,
        branch: 'main',
        autoDeploy: true,
        rootDir: 'web',
        // --include=dev is required: if NODE_ENV=production is set, npm skips
        // devDependencies and the build fails with "vite is not recognized"
        buildCommand: 'npm install --include=dev && npm run build',
        staticPublishPath: './dist',
        envVars: wanted,
        routes: [{ type: 'rewrite', source: '/*', destination: '/index.html' }],
      },
    });
    log(`  created: ${site.id}`);
  } else {
    log(`  it exists (${site.id})`);
  }

  const current = await render(`/services/${site.id}/env-vars`);
  for (const v of wanted) {
    const was = (current || []).find((c) => c.key === v.key);
    const state = !was ? 'NEW' : was.value === v.value ? 'same' : 'CHANGED';
    log(`  ${state.padEnd(8)} ${v.key}`);
  }

  if (!APPLY) {
    log('\n(dry run — re-run with --apply to make the changes)');
    return;
  }

  await render(`/services/${site.id}/env-vars`, {
    method: 'PUT',
    body: [...(current || []).filter((c) => !wanted.some((v) => v.key === c.key)), ...wanted],
  });
  log('  environment variables saved');

  log('\n== 3. deploying (build cache cleared) ==');
  const deploy = await render(`/services/${site.id}/deploys?solid=false&clearCache=true`, { method: 'POST' });
  log(`  deploy id: ${deploy && deploy.id}`);

  let last = null;
  for (let i = 0; i < 90; i++) {
    await sleep(10000);
    const list = await render(`/services/${site.id}/deploys?limit=1`);
    last = (list && list[0]) || null;
    log(`    ${last?.status}  ${last?.updatedAt || ''}`);
    if (['live', 'succeeded'].includes(last?.status)) break;
    if (['build_failed', 'update_failed', 'canceled', 'deactivated'].includes(last?.status)) {
      const logs = await render(`/services/${site.id}/logs?type=build&start=${encodeURIComponent(last.createdAt || '')}&limit=60`);
      log('  ---- last build log ----');
      (logs.logLines || []).slice(-25).forEach((l) => log('   ' + (l.text || '')));
      throw new Error(`the deploy ${last.status}`);
    }
  }
  if (!last || !['live', 'succeeded'].includes(last.status)) {
    throw new Error('the deploy did not finish within 15 minutes');
  }
  log('  the site is live');

  log('\n== 4. verifying ==');
  const url = site.serviceDetails?.url || site.staticSiteDetails?.url || `https://${NAME}.onrender.com`;
  log(`  GET ${url}/`);
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const html = await res.text();
    log(`  → HTTP ${res.status}, ${html.length} bytes`);
    log(`  → the app shell is ${html.includes('<div id="root"') ? 'present' : 'MISSING'}`);
  } catch (e) {
    log(`  → ${e.message}`);
  }
  for (const path of ['/login', '/register', '/admin/login']) {
    try {
      const res = await fetch(`${url}${path}`, { redirect: 'follow' });
      log(`  GET ${path} → HTTP ${res.status} (a deep link must serve the app, not a 404)`);
    } catch (e) {
      log(`  GET ${path} → ${e.message}`);
    }
  }
}

main().catch((e) => { console.error('\n✖', e.message); process.exit(1); });
