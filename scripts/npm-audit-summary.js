// Summarises `npm audit` for the API and the web app.
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

for (const dir of ['server', 'web']) {
  let raw = '';
  try {
    raw = execFileSync('npm', ['audit', '--json'], { cwd: path.join(ROOT, dir), encoding: 'utf8', shell: true });
  } catch (e) {
    raw = e.stdout || '{}';
  }
  raw = raw.replace(/^\uFEFF/, '');
  let j;
  try { j = JSON.parse(raw); } catch { console.log(`  ${dir}: audit output could not be parsed`); continue; }

  const meta = (j.metadata && j.metadata.vulnerabilities) || {};
  console.log(`\n-- ${dir} --`);
  console.log(`  totals: critical=${meta.critical || 0} high=${meta.high || 0} moderate=${meta.moderate || 0} low=${meta.low || 0} total=${meta.total || 0}`);
  const vulns = j.vulnerabilities || {};
  for (const [name, v] of Object.entries(vulns)) {
    const via = (v.via || []).map((x) => (typeof x === 'string' ? x : x.title)).join(' | ');
    const fix = v.fixAvailable === true ? 'npm audit fix'
      : (typeof v.fixAvailable === 'object' ? `upgrade to ${v.fixAvailable.name}@${v.fixAvailable.version}` : 'NO FIX AVAILABLE');
    console.log(`   - ${name} [${v.severity}] ${String(via).slice(0, 130)}`);
    console.log(`       fix: ${fix}; direct=${v.isDirect}`);
  }
}
