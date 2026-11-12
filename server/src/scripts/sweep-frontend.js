/* Static integrity scan of the web app:
     • every relative import resolves to a file that exists
     • every route referenced by <Link>/navigate() has a matching route
     • no page imports a component that was renamed or removed
   Run: node src/scripts/sweep-frontend.js
*/
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'web', 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(jsx?|js)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
let errors = 0;
let warnings = 0;

const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');

// ── 1. relative imports resolve ─────────────────────────────
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  const importRe = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(code))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), spec);
    const candidates = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')];
    if (!candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile())) {
      errors++;
      console.log(`  ✖ ${rel(file)} imports missing module "${spec}"`);
    }
  }
}

// ── 2. every route in App.jsx has a page component ─────────
const appPath = path.join(SRC, 'App.jsx');
const appCode = fs.readFileSync(appPath, 'utf8');
const routeRe = /<Route\s+path="([^"]*)"\s+element=\{<([A-Za-z0-9_]+)/g;
let rm;
const routes = [];
while ((rm = routeRe.exec(appCode))) {
  routes.push({ path: rm[1], component: rm[2] });
}
const importBlock = appCode.slice(0, appCode.indexOf('function'));
/* components declared inside App.jsx itself (Protected, FullScreenLoader…) */
const localComponents = new Set(
  [...appCode.matchAll(/(?:function|const)\s+([A-Za-z0-9_]+)\s*[=(]/g)].map((m) => m[1])
);
const resolveModule = (from, spec) => {
  if (!spec.startsWith('.')) return true; // package import — resolved by the bundler
  const base = path.resolve(path.dirname(from), spec);
  return [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')]
    .some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
};
for (const r of routes) {
  if (localComponents.has(r.component)) continue; // declared locally — fine
  /* named or default import */
  const re = new RegExp(`import\\s+(?:\\{[^}]*\\b${r.component}\\b[^}]*\\}|${r.component})\\s+from\\s+'([^']+)'`);
  const im = importBlock.match(re);
  if (!im) {
    errors++;
    console.log(`  ✖ route ${r.path} uses <${r.component}> but it is not imported`);
    continue;
  }
  if (!resolveModule(appPath, im[1])) {
    errors++;
    console.log(`  ✖ route ${r.path} → <${r.component}> points at missing file ${im[1]}`);
  }
}

// ── 3. sidebar links point at real routes ───────────────────
const layoutPath = path.join(SRC, 'components', 'DashboardLayout.jsx');
const layoutCode = fs.readFileSync(layoutPath, 'utf8');

/* App.jsx declares parents ('/app') and relative children ('book'). A link is
   valid when the full path is declared, or when its parent is declared and
   its last segment is one of the relative child paths. */
const normalisePath = (p) => p.replace(/\/+$/, '') || '/';
const declaredPaths = new Set(routes.map((r) => normalisePath(r.path)));
const relativeChildren = new Set(routes.map((r) => r.path).filter((p) => !p.startsWith('/')));

const linkRe = /to:\s*'([^']+)'/g;
let lm;
while ((lm = linkRe.exec(layoutCode))) {
  const to = normalisePath(lm[1]);
  if (declaredPaths.has(to)) continue;
  const segments = to.split('/').filter(Boolean);
  const parent = '/' + segments.slice(0, -1).join('/');
  const child = segments[segments.length - 1];
  if (declaredPaths.has(normalisePath(parent)) && relativeChildren.has(child)) continue;
  warnings++;
  console.log(`  ! sidebar link "${to}" has no matching route in App.jsx`);
}

// ── 4. components imported but never used in a page ─────────
const componentDir = path.join(SRC, 'components');
const componentFiles = fs.readdirSync(componentDir).filter((f) => /\.(jsx|js)$/.test(f));
for (const cf of componentFiles) {
  const base = cf.replace(/\.(jsx|js)$/, '');
  const used = files.some((f) => {
    if (f === path.join(componentDir, cf)) return false;
    const code = fs.readFileSync(f, 'utf8');
    return new RegExp(`from\\s+'[^']*${base}'`).test(code);
  });
  if (!used) {
    warnings++;
    console.log(`  ! component "${base}" is never imported anywhere`);
  }
}

console.log(`\n  frontend scan: ${files.length} files, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
