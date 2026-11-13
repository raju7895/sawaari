// Prints the longest line per tracked text file, so a corruption threshold
// can be chosen from real data instead of a guess.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'));

const TEXT = /\.(js|jsx|cjs|mjs|ts|tsx|json|md|yml|yaml|css|html|txt|sql|ps1|bat|nsi|conf|example)$/i;
const rows = [];
for (const rel of files) {
  if (!TEXT.test(rel)) continue;
  let content;
  try { content = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  rows.push([longest, Buffer.byteLength(content), rel]);
}
rows.sort((a, b) => b[0] - a[0]);
console.log('  longest-line report (top 12):');
for (const [longest, size, rel] of rows.slice(0, 12)) {
  console.log(`   ${String(longest).padStart(7)} chars  ${String(size).padStart(9)} bytes  ${rel}`);
}
