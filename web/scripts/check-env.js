/* The build refuses to run without the two variables the bundle needs.
 *
 * Vite inlines VITE_* variables at build time. If they are missing the
 * bundle is built perfectly well — and the deployed site then says
 * "Sawaari is not connected yet" to every visitor, which is a much worse
 * way to find out than a failed build.
 *
 * Run as: node scripts/check-env.js
 */
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

const missing = REQUIRED.filter((key) => !process.env[key]);

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

const url = process.env.VITE_SUPABASE_URL;
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  console.error('');
  console.error(`  VITE_SUPABASE_URL does not look like a Supabase project URL: ${url}`);
  console.error('  It should be https://<project-ref>.supabase.co');
  console.error('');
  process.exit(1);
}

if (process.env.VITE_SUPABASE_ANON_KEY.length < 20) {
  console.error('');
  console.error('  VITE_SUPABASE_ANON_KEY does not look like a Supabase key.');
  console.error('  It should be the anon key or the publishable key (sb_publishable_...).');
  console.error('');
  process.exit(1);
}

console.log('  the build environment is complete (' + REQUIRED.join(', ') + ')');
