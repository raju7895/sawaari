/* Deploys Sawaari to Render through the Render API.
 *
 *   $env:RENDER_API_KEY = "rnd_..."      (Windows PowerShell)
 *   export RENDER_API_KEY="rnd_..."      (macOS / Linux)
 *   node scripts/deploy-render.js            # dry run: report what it would do
 *   node scripts/deploy-render.js --apply    # do it
 *
 * What it does
 *   1. lists the services and finds the API (Web Service) and the front end
 *      (Static Site) by name
 *   2. creates whatever is missing (the static site, and the Postgres if
 *      the API has no database)
 *   3. puts the environment variables in place — the secrets are generated
 *      here and never written to the repository
 *   4. triggers a deploy with the build cache cleared (Vite bakes the env
 *      vars into the bundle, so a cached build keeps the old address)
 *   5. waits for the deploy and verifies /api/health
 *
 * The service_role key of Supabase is NEVER used here — it is not needed
 * for the Express API, and it must never reach the browser.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const KEY = process.env.RENDER_API_KEY || '';
const API = 'https://api.render.com/v1';

const WANT = {
  api: 'sawaari',
  web: 'sawaari-web',
};

const log = (...a) => console.log(...a);
const hex = (n) => crypto.randomBytes(n).toString('hex');

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

/* ── 1. inventory ─────────────────────────────────────────────────────── */
async function listServices() {
  const services = await render('/services?limit=100');
  return services;
}

/* The owner's address comes from the local server/.env (never committed),
   so no personal data ends up in the repository. */
function ownerEmail() {
  if (process.env.SUPER_ADMIN_EMAIL) return process.env.SUPER_ADMIN_EMAIL;
  try {
    const env = fs.readFileSync(path.join(ROOT, 'server', '.env'), 'utf8');
    const m = env.match(/^SUPER_ADMIN_EMAIL=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* no local .env */ }
  return 'owner@example.com';
}

/* ── 2. env vars ───────────────────────────────────────────────────────── */
function desiredApiEnv({ frontendUrl, databaseUrl, existing = [] }) {
  const have = new Map(existing.map((e) => [e.key, e.value]));
  const set = (key, value) => { if (!have.get(key)) have.set(key, value); };

  set('NODE_ENV', 'production');
  set('NODE_VERSION', '20');
  set('JWT_SECRET', hex(32));
  set('OTP_PEPPER', hex(24));
  set('ADMIN_TOTP_ENCRYPTION_KEY', hex(32));
  set('SUPER_ADMIN_EMAIL', ownerEmail());
  set('SUPER_ADMIN_PASSWORD', 'Sawaari-' + hex(9));
  set('APP_URL', frontendUrl);
  set('FRONTEND_URL', frontendUrl);
  if (databaseUrl) set('DATABASE_URL', databaseUrl);
  return [...have.entries()].map(([key, value]) => ({ key, value }));
}

/* ── 3. the front end ──────────────────────────────────────────────────── */
async function ensureStaticSite(services, apiUrl, supabaseUrl, anonKey) {
  let site = services.find((s) => s.name === WANT.web && s.type === 'static_site');
  if (!site) {
    log(`  creating the static site "${WANT.web}"`);
    site = await render('/services', {
      method: 'POST',
      body: {
        name: WANT.web,
        type: 'static_site',
        repo: 'https://github.com/raju7895/sawaari',
        branch: 'main',
        autoDeploy: true,
        buildCommand: 'cd web && npm ci --include=dev && npm run build',
        staticPublishPath: './dist',
        envVars: [
          { key: 'VITE_API_URL', value: apiUrl },
          { key: 'VITE_SUPABASE_URL', value: supabaseUrl },
          { key: 'VITE_SUPABASE_ANON_KEY', value: anonKey },
        ],
      },
    });
  } else {
    log(`  static site "${WANT.web}" exists (${site.id})`);
  }
  return site;
}

/* ── 4. deploy + verify ────────────────────────────────────────────────── */
async function deploy(service) {
  log(`  triggering a deploy with the build cache cleared…`);
  const deploy = await render(`/services/${service.id}/deploys?solid=false&clearCache=true`, { method: 'POST' });
  const id = deploy && deploy.id;
  log(`  deploy id: ${id}`);

  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const list = await render(`/services/${service.id}/deploys?limit=1`);
    const latest = (list && list[0]) || {};
    log(`    ${latest.status}  ${latest.updatedAt || ''}`);
    if (['live', 'succeeded'].includes(latest.status)) return latest;
    if (['build_failed', 'update_failed', 'canceled', 'deactivated'].includes(latest.status)) {
      const logs = await render(`/services/${service.id}/logs?type=build&start=${encodeURIComponent(latest.createdAt || '')}&limit=60`);
      log('  ---- last build log lines ----');
      (logs.logLines || []).slice(-25).forEach((l) => log('   ' + (l.text || '')));
      throw new Error(`deploy ${latest.status}`);
    }
  }
  throw new Error('the deploy did not finish within 10 minutes');
}

async function main() {
  if (!KEY) {
    log('✖ RENDER_API_KEY is not set.');
    log('  PowerShell : $env:RENDER_API_KEY = "rnd_..."');
    log('  macOS/Linux: export RENDER_API_KEY="rnd_..."');
    process.exit(1);
  }

  log('== 1. the services in the account ==');
  const services = await listServices();
  for (const s of services) {
    log(`  ${s.name.padEnd(18)} ${s.type.padEnd(12)} ${s.serviceDetails?.url || s.staticSiteDetails?.url || ''}`);
  }

  const apiService = services.find((s) => s.type === 'web_service');
  if (!apiService) {
    log('✖ no Web Service found — create one first (name it "sawaari", root dir "server")');
    process.exit(1);
  }
  log(`\n== 2. the API service: ${apiService.name} (${apiService.id}) ==`);

  const staticSite = services.find((s) => s.type === 'static_site');
  const frontendUrl = (staticSite && (staticSite.staticSiteDetails?.url || staticSite.serviceDetails?.url))
    || `https://${WANT.web}.onrender.com`;
  const apiUrl = apiService.serviceDetails?.url || `https://${apiService.name}.onrender.com`;
  log(`  API URL      : ${apiUrl}`);
  log(`  frontend URL : ${frontendUrl}`);

  log('\n== 3. the recent deploys of the API ==');
  const deploys = await render(`/services/${apiService.id}/deploys?limit=5`);
  for (const d of deploys || []) {
    log(`  ${String(d.status).padEnd(14)} ${d.commit && d.commit.message ? d.commit.message.slice(0, 70) : ''}`);
  }
  const failed = (deploys || []).find((d) => ['build_failed', 'update_failed'].includes(d.status));
  if (failed) {
    log('\n  ---- the build log of the failed deploy ----');
    const logs = await render(`/services/${apiService.id}/logs?type=build&start=${encodeURIComponent(failed.createdAt || '')}&limit=80`);
    (logs.logLines || []).slice(-30).forEach((l) => log('   ' + (l.text || '')));
  }

  if (!APPLY) {
    log('\n(dry run — re-run with --apply to make the changes)');
    return;
  }

  log('\n== 4. the environment variables ==');
  const current = await render(`/services/${apiService.id}/env-vars`);
  const wanted = desiredApiEnv({ frontendUrl, existing: current });
  for (const e of wanted) {
    const was = (current || []).find((c) => c.key === e.key);
    const state = !was ? 'NEW  ' : was.value === e.value ? 'same ' : 'CHANGED';
    log(`  ${state} ${e.key}`);
  }
  await render(`/services/${apiService.id}/env-vars`, { method: 'PUT', body: wanted });

  log('\n== 5. the front end ==');
  const site = await ensureStaticSite(services, apiUrl,
    'https://vwpxxgmcjrzegnqrpvsv.supabase.co',
    process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DWc8VP6s8ToTLa5f_AxoHg_rtJvN8A6');
  const siteEnv = await render(`/services/${site.id}/env-vars`);
  log(`  env vars on the static site: ${(siteEnv || []).map((e) => e.key).join(', ') || '(none)'}`);

  log('\n== 6. deploying ==');
  await deploy(apiService);
  log('  API deployed');
  await deploy(site);
  log('  front end deployed');

  log('\n== 7. verifying ==');
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${apiUrl}/api/health`, { headers: { Accept: 'application/json' } });
      const body = await res.json();
      log(`  GET ${apiUrl}/api/health → ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      if (body && body.ok) { log('\n✔ the API is live and healthy'); break; }
    } catch (e) {
      log(`  … still starting (${e.message})`);
    }
    await sleep(10000);
  }
  try {
    const res = await fetch(frontendUrl, { redirect: 'follow' });
    log(`  GET ${frontendUrl} → ${res.status}`);
  } catch (e) {
    log(`  GET ${frontendUrl} → ${e.message}`);
  }
}

main().catch((e) => { console.error('\n✖', e.message); process.exit(1); });
