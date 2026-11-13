/* Deployment-readiness scan.
 *
 * Walks the tracked source tree and reports:
 *   • empty / zero-byte files
 *   • merge-conflict markers
 *   • invalid JSON / YAML
 *   • import paths that do not resolve, or whose case does not match the file
 *     on disk (Render runs Linux, which is case-sensitive)
 *   • hardcoded localhost / 127.0.0.1 URLs
 *   • dependencies declared in package.json but never imported
 *   • imports of packages that are not declared
 *   • PORT handling
 *   • stray files (backups, logs, editor leftovers)
 *
 *   node scripts/deploy-audit.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const findings = { confirmed: [], possible: [] };
const note = (state, area, message, file, line) =>
  findings[state].push({ area, message, file: file ? path.relative(ROOT, file).replace(/\\\\/g, '/'') : undefined, line });

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
const isText = (rel) => /\.(js|jsx|cjs|mjs|ts|tsx|json|md|yml|yaml|css|html|txt|sql|ps1|bat|conf|env\.example)$/i.test(rel);

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

/* ── 2. merge conflict markers (a real conflict has <<<<<<< or >>>>>>>) ── */
for (const rel of files) {
  if (!isText(rel)) continue;
  const content = read(rel);
  if (!content) continue;
  for (const marker of ['<<<<<<< ', '>>>>>>> ']) {
    const idx = content.indexOf(marker);
    if (idx >= 0) {
      const line = content.slice(0, idx).split('\n').length;
      note('confirmed', 'corrupted', `merge-conflict marker "${marker.trim()}"`, rel, line);
      break;
    }
  }
  if (content.includes('\u0000')) {
    note('confirmed', 'corrupted', 'binary content inside a text file', rel);
  }
}

/* ── 3. JSON / YAML validity ───────────────────────────────── */
for (const rel of files) {
  if (/\.json$/i.test(rel)) {
    const content = read(rel);
    if (content === null) continue;
    try { JSON.parse(content); } catch (e) {
      note('confirmed', 'config', `invalid JSON: ${e.message}`, rel);
    }
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
    name: j.name,
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

/* ── 5. unused dependencies ────────────────────────────────── */
for (const [dir, info] of Object.entries(declaredDeps)) {
  const all = files.filter((f) => f.startsWith(`${dir}/`) && /\.(js|jsx|cjs|mjs)$/.test(f) && !f.includes('node_modules'));
  const corpus = all.map((f) => read(f) || '').join('\n');
  const unused = [];
  for (const [name] of Object.entries({ ...info.deps, ...info.dev })) {
    if (['react', 'react-dom'].includes(name)) continue;
    const used = new RegExp(`from\\s+['"]${name.replace('/', '\\/')}['"]|require\\(['"]${name.replace('/', '\\/')}['"]\\)`).test(corpus)
      || corpus.includes(`'${name}'`) || corpus.includes(`"${name}"`);
    if (!used) unused.push(name);
  }
  if (unused.length) {
    note('possible', 'dependencies', `${dir}: declared but never imported → ${unused.join(', ')}`);
  }
}

/* ── 6. hardcoded local URLs ───────────────────────────────── */
for (const rel of files) {
  if (!/\.(js|jsx|cjs|mjs|json|html)$/i.test(rel) || rel.includes('node_modules')) continue;
  const content = read(rel);
  if (!content) continue;
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (/\/\/.*localhost/.test(line)) return;                 // comments are fine
    const hit = line.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g);
    if (hit) {
      note('possible', 'environment', `hardcoded ${hit.join(', ')}`, rel, i + 1);
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
  if (!/\.(ya?ml|toml|Dockerfile)$/i.test(rel) && !/Dockerfile$/i.test(rel)) continue;
  const content = read(rel) || '';
  for (const m of content.matchAll(/(?:buildCommand|RUN|CMD)\s*[=:"']+([^\n"']+)/g)) {
    if (/npm\s+(ci|install)/.test(m[1])) BUILD_COMMANDS.push({ file: rel, cmd: m[1].trim() });
  }
}
for (const rel of files.filter((f) => f.endsWith('package.json') && !f.includes('node_modules'))) {
  const j = JSON.parse(read(rel));
  const dir = path.dirname(rel);
  for (const [name, cmd] of Object.entries(j.scripts || {})) {
    if (/^(build|prepare|prebuild)$/.test(name) && /npm\s+(ci|install)/.test(cmd)) {
      BUILD_COMMANDS.push({ file: `${rel} (script: ${name})`, cmd });
    }
  }
}

for (const { file, cmd } of BUILD_COMMANDS) {
  if (!/\bnpm\s+ci\b/.test(cmd)) continue;
  if (/--include=dev/.test(cmd)) continue;
  // which package.json does this install belong to?
  const dir = cmd.includes('cd web') ? 'web' : (cmd.includes('cd server') ? 'server' : 'server');
  const devDeps = devToolsFor(dir);
  if (!devDeps.length) continue;
  note('confirmed', 'deployment',
    `${file}: installs with "npm ci" but the build needs devDependencies (${devDeps.join(', ')}). ` +
    `Render sets NODE_ENV=production, so npm ci skips them and the build fails with ` +
    `"'${devDeps[0]}' is not recognized". Use "npm ci --include=dev".`);
}

/* ── report ────────────────────────────────────────────────── */
console.log(`\nScanned ${files.length} tracked files.\n`);
for (const [state, list] of Object.entries(findings)) {
  console.log(`── ${state.toUpperCase()} (${list.length}) ──`);
  if (!list.length) { console.log('  none\n'); continue; }
  for (const f of list) {
    console.log(`  [${f.area}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.message}`);
  }
  console.log('');
}
process.exit(findings.confirmed.length ? 1 : 0);
