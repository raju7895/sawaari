// Proves that safeInternalPath() blocks every open-redirect payload
// that the React Router advisory (GHSA-wrjc-x8rr-h8h6) describes,
// while still allowing normal in-app routes.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'web', 'src', 'api.js'), 'utf8');
// pull the function out of the module and evaluate it on its own
const start = src.indexOf('export const safeInternalPath');
const body = src.slice(start).replace('export const safeInternalPath', 'const safeInternalPath');
const fn = new Function(`${body}\nreturn safeInternalPath;`)();

const ALLOWED = ['/app', '/app/ride/12', '/admin/bookings', '/track/abc', '/admin/2fa-setup'];
const BLOCKED = [
  ['//evil.example', 'protocol-relative'],
  ['/\\evil.example', 'backslash after slash'],
  ['\\\\evil.example', 'double backslash'],
  ['/\\evil.example', 'backslash directly'],
  ['/\\/evil.example', 'mixed'],
  ['https://evil.example', 'absolute URL'],
  ['http://evil.example', 'absolute URL'],
  ['javascript:alert(1)', 'javascript scheme'],
  ['admin/bookings', 'not rooted'],
  ['', 'empty'],
  [null, 'null'],
  [undefined, 'undefined'],
  [42, 'number'],
  ['/app\n//evil', 'header injection'],
];

let pass = 0;
let fail = 0;
for (const p of ALLOWED) {
  const r = fn(p);
  if (r === p) { pass++; console.log(`  OK   allowed  ${JSON.stringify(p)}`); }
  else { fail++; console.log(`  FAIL allowed  ${JSON.stringify(p)} -> got ${JSON.stringify(r)}`); }
}
for (const [p, why] of BLOCKED) {
  const r = fn(p);
  if (r === null) { pass++; console.log(`  OK   blocked  ${JSON.stringify(p)} (${why})`); }
  else { fail++; console.log(`  FAIL blocked  ${JSON.stringify(p)} (${why}) -> got ${JSON.stringify(r)}`); }
}
console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
