/* Deployment-readiness scan.
 *
 * Walks the tracked source tree and reports:
 *   • empty / zero-byte files
 *   • merge-conflict markers
 *   • invalid JSON
 *   • import paths that do not resolve, or whose case does not match the file
 *     on disk (Render runs Linux, which is case-sensitive)
 *   • hardcoded localhost / 127.0.0.1 URLs that would ship to production
 *   • dependencies declared in package.json but never used
 *   • imports of packages that are not declared
 *   • PORT handling
 *   • stray files (backups, logs, editor leftovers)
 *   • .gitignore coverage
 *   • build commands that lose devDependencies under NODE_ENV=production
 *   • secrets committed to the deployment manifest
 *
 *   node scripts/deploy-audit.js
 *
 * Exit code is 1 only when a CONFIRMED problem is found.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const findings = { confirmed: [], possible: [] };
const note = (state, area, message, file, line) =>
  findings[state].push({
    area,
    message,
    file: file ? path.relative(ROOT, file).split(path.sep).join('/') : undefined,
    line,
  });

/* ── the file list git would ship ────────────────────────────── */
function tracked() {
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
const files = tracked().map((f) => f.replace(/\\/g, '/'));
const trackedSet = new Set(files);

const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; }
};
const readJson = (abs) => {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; }
};
const isText = (rel) => /\.(js|jsx|cjs|mjs|ts|tsx|json|md|yml|yaml|css|html|txt|sql|ps1|bat|conf|env\.example)$/i.test(rel);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/* ── 1. empty / zero-byte files (.gitkeep placeholders are intentional) ── */
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let st;
  try { st = fs.statSync(abs); } catch { continue; }
  if (!st.isFile()) continue;
  if (st.size === 0) {
    if (/\.gitkeep$/.test(rel)) continue;          // deliberate placeholder
    note('confirmed', 'corrupted', 'zero-byte file', rel);
    continue;
  }
  if (isText(rel) && st.size < 20 && !/\.gitkeep$/.test(rel)) {
    note('confirmed', 'corrupted', `suspiciously small file (${st.size} bytes)`, rel);
  }
}

/* ── 2. merge conflict markers ───────────────────────────────
   A real conflict starts a line with seven angle brackets
   followed by a space and a branch name.                     */
const CONFLICT_START = ['<'.repeat(7), '>'.repeat(7)];
for (const rel of files) {
  if (!isText(rel)) continue;
  const content = read(rel);
  if (!content) continue;
  for (const marker of CONFLICT_START) {
    const idx = content.indexOf(`${marker} `);
    if (idx >= 0) {
      const line = content.slice(0, idx).split('\n').length;
      note('confirmed', 'corrupted', `merge-conflict marker "${marker} "`, rel, line);
      break;
    }
  }
  if (content.includes('\u0000')) {
    note('confirmed', 'corrupted', 'binary content inside a text file', rel);
  }
}

/* ── 3. JSON validity ───────────────────────────────────────── */
for (const rel of files) {
  if (!/\.json$/i.test(rel)) continue;
  const content = read(rel);
  if (content === null) continue;
  try { JSON.parse(content); } catch (e) {
    note('confirmed', 'config', `invalid JSON: ${e.message}`, rel);
  }
}

/* ── 4. import resolution + case sensitivity ───────────────── */
const IMPORT_RE = /(?:import\s[^'"]*from\s*|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
function resolveLocal(spec, fromRel) {
  const base = path.resolve(path.dirname(path.join(ROOT, fromRel)), spec);
  const candidates = [
    base, `${base}.js`, `${base}.jsx`, `${base}.cjs`, `${base}.mjs`,
    `${base}.ts`, `${base}.tsx`, `${base}.json`,
    path.join(base, 'index.js'), path.join(base, 'index.jsx'),
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const rel = path.relative(ROOT, c).replace(/\\/g, '/');
    if (!trackedSet.has(rel)) {
      note('confirmed', 'imports', `imports "${spec}" which is NOT committed to git`, fromRel);
    }
    return rel;
  }
  return null;
}

const declaredDeps = {};
for (const rel of files.filter((f) => f.endsWith('package.json') && !f.includes('node_modules'))) {
  const j = JSON.parse(read(rel));
  const dir = path.dirname(rel);
  declaredDeps[dir] = {
    deps: { ...(j.dependencies || {}) }, dev: { ...(j.devDependencies || {}) },
    name: j.name, scripts: { ...(j.scripts || {}) },
  };
}

for (const rel of files) {
  if (!/\.(js|jsx|cjs|mjs)$/.test(rel) || rel.includes('node_modules')) continue;
  // only application code — helper/documentation scripts embed code as text
  const isAppCode = rel.startsWith('server/src/') || rel.startsWith('web/src/');
  const content = read(rel);
  if (!content) continue;
  const dir = path.dirname(rel);
  const pkgDir = declaredDeps[dir] ? dir : (dir.startsWith('server') ? 'server' : 'web');
  const known = declaredDeps[pkgDir];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content))) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      const resolved = resolveLocal(spec, rel);
      if (!resolved) {
        // tooling scripts embed code as text — only app code is checked strictly
        if (isAppCode) {
          const line = content.slice(0, m.index).split('\n').length;
          note('confirmed', 'imports', `cannot resolve import "${spec}"`, rel, line);
        }
      } else {
        // case-sensitivity check (Render runs Linux)
        const wanted = path.basename(spec).replace(/\.(js|jsx|cjs|mjs|json)$/, '');
        const actual = path.basename(resolved).replace(/\.(js|jsx|cjs|mjs|json)$/, '');
        if (wanted !== actual && wanted.toLowerCase() === actual.toLowerCase()) {
          const line = content.slice(0, m.index).split('\n').length;
          note('confirmed', 'imports', `case mismatch: imports "${wanted}" but the file is "${actual}" (breaks on Linux)`, rel, line);
        }
      }
    } else if (!spec.startsWith('node:') && isAppCode) {
      const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      const builtin = ['fs', 'path', 'crypto', 'http', 'https', 'os', 'url', 'zlib', 'util', 'stream', 'events', 'buffer', 'child_process', 'net', 'tls', 'assert', 'querystring', 'readline', 'worker_threads', 'perf_hooks'];
      if (builtin.includes(pkgName) || pkgName.startsWith('node:')) continue;
      if (!known) continue;
      if (!known.deps[pkgName] && !known.dev[pkgName]) {
        const line = content.slice(0, m.index).split('\n').length;
        note('confirmed', 'dependencies', `imports "${pkgName}" but it is not in ${pkgDir}/package.json`, rel, line);
      }
    }
  }
}

/* ── 5. unused dependencies ────────────────────────────────────
   A dependency counts as USED when any of these is true:
     • the code imports it (including a dynamic import())
     • a config file or a file name mentions it (postcss, tailwind)
     • a CLI binary it provides is called from a package.json script
     • the native Android project links it (Capacitor plugins)
     • another installed package requires it (@capacitor/core)          */
const NODE_MODULES_ROOTS = ['.', 'web', 'server', 'electron']
  .map((d) => path.join(ROOT, d, 'node_modules'))
  .filter((d) => fs.existsSync(d));

function installedPkgJson(pkgName) {
  for (const nm of NODE_MODULES_ROOTS) {
    const j = readJson(path.join(nm, ...pkgName.split('/'), 'package.json'));
    if (j) return j;
  }
  return null;
}

// every package name required by another installed package
const installedRequires = new Set();
for (const nm of NODE_MODULES_ROOTS) {
  const addDeps = (pj) => {
    if (!pj) return;
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(pj[field] || {})) installedRequires.add(name);
    }
  };
  let entries = [];
  try { entries = fs.readdirSync(nm, { withFileTypes: true }); } catch { continue; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(nm, entry.name);
    if (entry.name.startsWith('@')) {
      let scoped = [];
      try { scoped = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }
      for (const sub of scoped) {
        if (sub.isDirectory()) addDeps(readJson(path.join(full, sub.name, 'package.json')));
      }
      continue;
    }
    addDeps(readJson(path.join(full, 'package.json')));
  }
}

const nativeCorpus = files
  .filter((f) => /\.gradle(\.kts)?$/i.test(f))
  .map((f) => read(f) || '')
  .join('\n');

const usedByImport = (corpus, name) =>
  new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${esc(name)}['"]`).test(corpus);

const usedByConfig = (text, name) => {
  if (name.startsWith('@')) return text.includes(name);
  return new RegExp(`(?<![@\\w-])${esc(name)}(?![\\w-])`).test(text);
};

const usedByCli = (scriptsText, name) => {
  const pj = installedPkgJson(name);
  const bins = [];
  if (pj && pj.bin) {
    if (typeof pj.bin === 'string') bins.push(pj.bin);
    else bins.push(...Object.keys(pj.bin));
  }
  if (!bins.length) bins.push(name.startsWith('@') ? name.split('/').pop() : name);
  return bins.some((b) => new RegExp(`(?<![\\w-])${esc(b)}(?![\\w-])`).test(scriptsText));
};

for (const [dir, info] of Object.entries(declaredDeps)) {
  const pkgFiles = files.filter((f) => f.startsWith(`${dir}/`) && !f.includes('node_modules'));
  const codeFiles = pkgFiles.filter((f) => /\.(js|jsx|cjs|mjs)$/.test(f));
  const corpus = codeFiles.map((f) => read(f) || '').join('\n');
  const names = pkgFiles.map((f) => path.basename(f)).join(' ');
  const scriptsText = Object.values(info.scripts || {}).join(' ');
  const unused = [];
  for (const name of Object.keys({ ...info.deps, ...info.dev })) {
    if (['react', 'react-dom'].includes(name)) continue;
    const unscoped = name.startsWith('@') ? name.split('/').pop() : name;
    if (usedByImport(corpus, name)) continue;                       // import / dynamic import
    if (usedByConfig(`${corpus}\n${names}`, name)) continue;         // config file or file name
    if (usedByCli(scriptsText, name)) continue;                      // CLI binary in a script
    if (nativeCorpus.includes(`capacitor-${unscoped}`)) continue;    // native Android plugin
    if (installedRequires.has(name)) continue;                      // required by another package
    unused.push(name);
  }
  if (unused.length) {
    note('possible', 'dependencies',
      `${unused.join(', ')} — declared in ${dir}/package.json but never imported, ` +
      `not called as a CLI, not referenced by a config file and not linked by the native project`);
  }
}

/* ── 6. hardcoded local URLs ───────────────────────────────────
   Only code that ships to production is inspected. Test scripts,
   the Vite dev proxy, documentation and the desktop loopback
   server are local by design and are skipped.                     */
const LOCAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^/\s"'@]*@)?(localhost|127\.0\.0\.1)(?::\d+)?/gi;

const SKIP_LOCAL = [
  [/\.md$/i, 'documentation'],
  [/(^|\/)scripts\//i, 'developer tooling'],
  [/(^|\/)server\/src\/scripts\//i, 'test and diagnostic tooling'],
  [/(^|\/)vite\.config\.js$/i, 'Vite dev-server proxy (not part of the production build)'],
  [/(^|\/)electron\//i, 'desktop app loopback server'],
];
const skipReason = (rel) => {
  for (const [re, why] of SKIP_LOCAL) if (re.test(rel)) return why;
  return null;
};

for (const rel of files) {
  if (!/\.(js|jsx|cjs|mjs|json|html)$/i.test(rel) || rel.includes('node_modules')) continue;
  if (skipReason(rel)) continue;
  const content = read(rel);
  if (!content) continue;
  content.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return; // comments
    if (line.includes('console.log')) return;                       // startup log line
    const hits = line.match(LOCAL_URL);
    if (!hits) return;
    const envFallback = line.match(/required\(\s*'([A-Z0-9_]+)'/);
    if (envFallback) {
      note('possible', 'environment',
        `${hits.join(', ')} is only the fallback for ${envFallback[1]} — ` +
        `set ${envFallback[1]} in the deployment environment or the app will point at localhost`,
        rel, i + 1);
    } else {
      note('confirmed', 'environment', `hardcoded local URL ${hits.join(', ')}`, rel, i + 1);
    }
  });
}

/* ── 7. PORT handling ──────────────────────────────────────── */
const serverIndex = read('server/src/index.js') || '';
if (!/process\.env\.PORT|config\.port/.test(serverIndex)) {
  note('confirmed', 'config', 'the API does not read PORT from the environment', 'server/src/index.js');
}

/* ── 8. stray files ────────────────────────────────────────── */
const STRAY = [
  [/\.(bak|orig|rej|tmp)$/i, 'backup file'],
  [/^.*(copy|backup) of .*/i, 'duplicate copy'],
  [/(^|\/)\.DS_Store$/, 'macOS metadata'],
  [/(^|\/)Thumbs\.db$/i, 'Windows thumbnail cache'],
  [/\.log$/i, 'log file'],
  [/~$/, 'Office temp file'],
  [/\.swp$/, 'vim swap file'],
];
for (const rel of files) {
  for (const [re, why] of STRAY) {
    if (re.test(rel)) note('confirmed', 'stray', `${why} — should not be committed`, rel);
  }
}

/* ── 9. .gitignore coverage ────────────────────────────────── */
const gi = read('.gitignore') || '';
for (const [pattern, why] of [
  ['node_modules', 'dependencies'],
  ['.env', 'secrets'],
  ['dist', 'build output'],
  ['backups', 'database dumps and credentials'],
  ['keystore', 'signing keys'],
]) {
  if (!gi.includes(pattern)) {
    note('confirmed', 'gitignore', `missing an entry for ${why} ("${pattern}")`);
  }
}

/* ── 10. build tooling must survive NODE_ENV=production ──────
   Render sets NODE_ENV=production, which makes `npm ci` skip
   devDependencies. If the build script needs a tool that lives there
   (vite, tailwindcss, postcss…) the build dies with
   "'vite' is not recognized". Detect that configuration here, in both
   package.json scripts and the Render/Fly/Docker build commands. */
const devToolsFor = (dir) => {
  const rel = files.find((f) => f === `${dir}/package.json`);
  if (!rel) return [];
  return Object.keys(JSON.parse(read(rel)).devDependencies || {});
};

const BUILD_COMMANDS = [];
for (const rel of files) {
  if (!/\.(ya?ml|toml)$/i.test(rel) && !/Dockerfile$/i.test(rel)) continue;
  const content = read(rel) || '';
  for (const m of content.matchAll(/(?:buildCommand|RUN|CMD)\s*[=:"']+([^\n"']+)/g)) {
    if (/npm\s+(ci|install)/.test(m[1])) BUILD_COMMANDS.push({ file: rel, cmd: m[1].trim() });
  }
}
for (const rel of files.filter((f) => f.endsWith('package.json') && !f.includes('node_modules'))) {
  const j = JSON.parse(read(rel));
  for (const [name, cmd] of Object.entries(j.scripts || {})) {
    if (/^(build|prepare|prebuild)$/.test(name) && /npm\s+(ci|install)/.test(cmd)) {
      BUILD_COMMANDS.push({ file: `${rel} (script: ${name})`, cmd });
    }
  }
}

for (const { file, cmd } of BUILD_COMMANDS) {
  if (!/\bnpm\s+ci\b/.test(cmd)) continue;
  if (/--include=dev/.test(cmd)) continue;
  const dir = cmd.includes('cd web') ? 'web' : 'server';
  const devDeps = devToolsFor(dir);
  if (!devDeps.length) continue;
  note('confirmed', 'deployment',
    `${file}: installs with "npm ci" but the build needs devDependencies (${devDeps.join(', ')}). ` +
    `Render sets NODE_ENV=production, so npm ci skips them and the build fails with ` +
    `"'${devDeps[0]}' is not recognized". Use "npm ci --include=dev".`);
}

/* ── 11. no secret may be committed to the deployment manifest ── */
const renderYaml = read('render.yaml') || '';
if (renderYaml) {
  const envBlocks = renderYaml.split(/\n\s*-\s+key:\s*/).slice(1);
  for (const block of envBlocks) {
    const key = block.split('\n')[0].trim();
    const value = (block.match(/^\s*value:\s*["']?([^"'\n]+)["']?\s*$/m) || [])[1];
    if (!key || value === undefined) continue;
    if (!/SECRET|PASSWORD|KEY|PEPPER|TOKEN|CREDENTIAL/i.test(key)) continue;
    note('confirmed', 'secrets',
      `${key} has a literal value in render.yaml — use "generateValue: true" or "sync: false"`,
      'render.yaml');
  }
  // the critical variables must be declared at all
  for (const key of ['JWT_SECRET', 'OTP_PEPPER', 'ADMIN_TOTP_ENCRYPTION_KEY',
    'SUPER_ADMIN_PASSWORD', 'SUPER_ADMIN_EMAIL', 'APP_URL', 'NODE_ENV']) {
    if (!renderYaml.includes(key)) {
      note('confirmed', 'deployment', `render.yaml does not declare ${key}`, 'render.yaml');
    }
  }
}

/* ── 12. production must not boot with the published dev secrets ── */
const serverConfig = read('server/src/config.js') || '';
if (serverConfig.includes('dev-jwt-secret-change-me')) {
  // the fallback may exist, but a production guard must validate the value
  const prodIdx = serverConfig.search(/env\s*===\s*['"]production['"]/);
  const guardIdx = prodIdx >= 0 ? serverConfig.indexOf('JWT_SECRET', prodIdx) : -1;
  const guarded = guardIdx > prodIdx && guardIdx - prodIdx < 1500;
  if (!guarded) {
    note('confirmed', 'secrets',
      'config.js still falls back to the published dev JWT secret and nothing blocks it in production — ' +
      'add a production guard that refuses to boot without a strong JWT_SECRET',
      'server/src/config.js');
  }
}

/* ── report ────────────────────────────────────────────────── */
console.log(`\nScanned ${files.length} tracked files.\n`);
for (const [state, list] of Object.entries(findings)) {
  console.log(`── ${state.toUpperCase()} (${list.length}) ──`);
  if (!list.length) { console.log('  none\n'); continue; }
  for (const f of list) {
    console.log(`  [${f.area}] ${f.file || '(project)'}${f.line ? ':' + f.line : ''} — ${f.message}`);
  }
  console.log('');
}
process.exit(findings.confirmed.length ? 1 : 0);
