/* Runs every PostgREST "select" the app uses against the live project.
 *
 * A wrong embed does not break the build — PostgREST answers with a 4xx at
 * runtime and the screen quietly shows nothing. This script parses the
 * select strings out of web/src/lib/api.js and asks the live API for them,
 * so a broken query fails loudly instead of silently.
 *
 * The credentials come from the environment (never from the repository):
 *   SAWAARI_TEST_EMAIL, SAWAARI_TEST_PASSWORD
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_BASE = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.SAWAARI_TEST_EMAIL;
const PASSWORD = process.env.SAWAARI_TEST_PASSWORD;

if (!URL_BASE || !ANON) {
  console.error('  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.');
  process.exit(2);
}
if (!EMAIL || !PASSWORD) {
  console.error('  SAWAARI_TEST_EMAIL and SAWAARI_TEST_PASSWORD must be set.');
  process.exit(2);
}

const apiSrc = readFileSync(join(process.cwd(), 'web', 'src', 'lib', 'api.js'), 'utf8');

/* ── pull "…from('table')…select('…')" pairs out of the source ────────── */
function extractQueries(src) {
  // select strings that live in a constant (RIDE_SELECT) are resolved too
  const constants = {};
  const constRe = /const\s+(\w+)\s*=\s*`([^`]*)`/g;
  let c;
  while ((c = constRe.exec(src)) !== null) {
    constants[c[1]] = c[2].replace(/\s+/g, ' ').trim();
  }

  const found = [];
  const fromRe = /\.from\('([a-z_]+)'\)/g;
  let m;
  while ((m = fromRe.exec(src)) !== null) {
    const table = m[1];
    const rest = src.slice(m.index + m[0].length, m.index + m[0].length + 400);

    const selIdx = rest.indexOf('.select(');
    if (selIdx < 0) continue;

    // read the argument, which may be a quoted string or a constant name
    let i = selIdx + '.select('.length;
    const quote = rest[i];

    let select = null;
    if (quote === "'" || quote === '`') {
      let value = '';
      let j = i + 1;
      for (; j < rest.length; j += 1) {
        const ch = rest[j];
        if (ch === '\\') { value += rest[j + 1]; j += 1; continue; }
        if (ch === quote) break;
        value += ch;
      }
      if (rest[j] !== quote) continue;
      select = value.replace(/\s+/g, ' ').trim();
    } else {
      const id = rest.slice(i).match(/^(\w+)/);
      if (!id || !constants[id[1]]) continue;
      select = constants[id[1]];
    }

    const label = select === '*' ? `${table}: *` : `${table}: ${select.slice(0, 60)}`;
    if (!found.some((f) => f.table === table && f.select === select)) {
      found.push({ table, select, label });
    }
    fromRe.lastIndex = m.index + m[0].length + selIdx + 1;
  }
  return found;
}

async function signIn() {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error(`  Sign-in failed: ${data.msg || data.error_code || res.status}`);
    process.exit(2);
  }
  return data.access_token;
}

async function main() {
  const token = await signIn();
  const queries = extractQueries(apiSrc);
  let failed = 0;

  console.log(`  checking ${queries.length} select statements against ${URL_BASE}`);

  for (const q of queries) {
    const url = `${URL_BASE}/rest/v1/${q.table}?select=${encodeURIComponent(q.select)}&limit=1`;
    const res = await fetch(url, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    const body = await res.text();
    if (res.ok) {
      console.log(`    ok    ${q.label}`);
    } else {
      failed += 1;
      console.log(`    FAIL  ${q.label}`);
      console.log(`          ${body.slice(0, 220)}`);
    }
  }

  if (failed) {
    console.log(`  ${failed} of ${queries.length} selects failed`);
    process.exit(1);
  }
  console.log(`  all ${queries.length} selects are valid`);
}

main();
