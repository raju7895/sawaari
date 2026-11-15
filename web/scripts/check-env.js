/* The build refuses to run without the two variables the bundle needs.
 *
 * Vite inlines VITE_* variables at build time. If they are missing the
 * bundle is built perfectly well — and the deployed site then says
 * "Sawaari is not connected yet" to every visitor, which is a much worse
 * way to find out than a failed build.
 *
 * The values are looked up the way Vite looks them up: the environment
 * first, then the .env files in the project folder. On Render there is no
 * .env file, so the environment is the only source — and if it is empty
 * the build stops here with an explanation.
 *
 * Run as: node scripts/check-env.js
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');                       // the web folder
const MODE = process.env.NODE_ENV === 'production' ? 'production' : 'development';

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

/* the .env files Vite reads, least important first */
const FILES = ['.env', '.env.local', `.env.${MODE}`, `.env.${MODE}.local`];

function readEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/* the environment wins over the files, exactly like in Vite */
const env = {};
for (const file of FILES) Object.assign(env, readEnvFile(file));
Object.assign(env, process.env);

const missing = REQUIRED.filter((key) => !env[key]);

if (missing.length) {
  console.error('');
  console.error('  The build cannot start: ' + missing.join(' and ') + ' ' + (missing.length > 1 ? 'are' : 'is') + ' not set.');
  console.error('');
  console.error('  Vite copies these into the bundle while it builds, so they have to be');
  console.error('  present in the environment of the build itself.');
  console.error('');
  console.error('  On Render: open the Static Site -> Environment -> add the two');
  console.error('  variables -> Save -> then "Clear build cache & deploy" (a plain');
  console.error('  deploy reuses the old bundle, which still has the old values).');
  console.error('');
  console.error('  Locally: copy web/.env.example to web/.env and fill it in.');
  console.error('');
  process.exit(1);
}

const url = env.VITE_SUPABASE_URL;
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  console.error('');
  console.error(`  VITE_SUPABASE_URL does not look like a Supabase project URL: ${url}`);
  console.error('  It should be https://<project-ref>.supabase.co');
  console.error('');
  process.exit(1);
}

if (env.VITE_SUPABASE_ANON_KEY.length < 20) {
  console.error('');
  console.error('  VITE_SUPABASE_ANON_KEY does not look like a Supabase key.');
  console.error('  It should be the anon key or the publishable key (sb_publishable_...).');
  console.error('');
  process.exit(1);
}

console.log('  the build environment is complete (' + REQUIRED.join(', ') + ')');
