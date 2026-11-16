/* Prints a login code and a login link for an address — without sending
 * any e-mail or SMS.
 *
 * Run it on YOUR OWN computer, never on the server:
 *
 *   1. copy the "service_role / secret" key from
 *      Supabase → Project Settings → API Keys
 *   2. put it in a file that is NOT in the repository:
 *
 *        .env.local
 *        SUPABASE_URL=https://<project-ref>.supabase.co
 *        SUPABASE_SERVICE_ROLE_KEY=<the secret key>
 *
 *   3. run it:
 *
 *        node --env-file=.env.local scripts/get-login-code.mjs you@example.com
 *
 * The service-role key has full control of the database. It stays on your
 * machine: this file reads it from the environment, it is never bundled
 * into the app, and .env.local is git-ignored.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const email = (process.argv[2] || '').trim().toLowerCase();

if (!email) {
  console.error('  Usage: node --env-file=../.env.local web/scripts/get-login-code.mjs you@example.com');
  process.exit(2);
}

if (!url || !key) {
  console.error('');
  console.error('  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.');
  console.error('');
  console.error('  Put them in a .env.local next to this file (it is git-ignored) and run:');
  console.error('    node --env-file=../.env.local web/scripts/get-login-code.mjs ' + email);
  console.error('');
  process.exit(2);
}

/* the anon / publishable key cannot do this — catch a copy/paste mistake
   before it fails with a confusing error */
if (key.startsWith('sb_publishable_') || key.startsWith('eyJ')) {
  console.error('');
  console.error('  That looks like the anon / publishable key, not the secret key.');
  console.error('  Use the "service_role / secret" key from Project Settings → API Keys.');
  console.error('');
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: process.env.SAWARI_REDIRECT_TO || 'https://sawaari-web.onrender.com/auth/callback' },
});

if (error) {
  console.error('  Error:', error.message);
  process.exit(1);
}

const p = data?.properties || {};
console.log('');
console.log('  address    :', email);
console.log('  code       :', p.email_otp || '(none — use the link)');
console.log('  login link :', p.action_link || '(none)');
console.log('');
console.log('  Type the code into the site, or open the link in a browser.');
console.log('  Nothing was e-mailed and no SMS was sent.');
console.log('');
