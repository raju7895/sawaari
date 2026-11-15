/* Checks the whole e-mail sign-up flow end to end.
 *
 *   node scripts/verify-otp.js --email you@example.com
 *
 * It signs the address up, tells you that a code is on its way and then
 * waits for you to type the code you received. After that it verifies the
 * code and signs in — so the whole path (sign-up → code → account → sign
 * in) is proved in one run.
 *
 * The credentials come from the environment, never from the repository:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */
import { createInterface } from 'node:readline';

const URL_BASE = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : '';
};

const email = (arg('email') || '').trim().toLowerCase();
/* no password is written down anywhere — one is made up for the test */
const password = arg('password') || `Temp-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
const fullName = arg('name') || 'Flow Check';

const log = (...a) => console.log(' ', ...a);

if (!URL_BASE || !ANON) {
  console.error('  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.');
  process.exit(2);
}
if (!email) {
  console.error('  Usage: node scripts/verify-otp.js --email you@example.com');
  process.exit(2);
}

async function api(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1${path}`, {
    method,
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log('');
  console.log('  == 1. sign up ==');
  const signup = await api('/signup', {
    body: {
      email,
      password,
      data: { full_name: fullName, phone: '9000000000', role: 'rider' },
    },
  });
  if (signup.status >= 400) {
    const code = signup.json?.error_code || signup.json?.code || signup.status;
    if (code === 'over_email_send_rate_limit') {
      log('the e-mail rate limit is reached — raise it in Supabase -> Authentication -> Rate Limits');
    } else if (signup.json?.msg && /already registered/i.test(signup.json.msg)) {
      log('the account exists already — fine, ask for a code below');
    } else {
      log('signup failed:', signup.json?.msg || signup.text.slice(0, 200));
    }
  } else {
    log('the account was created; a 6-digit code is on its way to', email);
  }

  console.log('');
  console.log('  == 2. type the code you received ==');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await new Promise((resolve) => {
    rl.question('  code: ', (answer) => { rl.close(); resolve(answer.trim()); });
  })).replace(/\D/g, '');
  if (code.length !== 6) {
    log('that does not look like a 6-digit code');
    process.exit(1);
  }

  console.log('');
  console.log('  == 3. verify the code ==');
  const verify = await api('/verify', { body: { email, token: code, type: 'email' } });
  if (verify.status >= 400) {
    log('the code was refused:', verify.json?.msg || verify.text.slice(0, 200));
    process.exit(1);
  }
  log('the address is confirmed and a session was issued');

  console.log('');
  console.log('  == 4. sign in with the password ==');
  const login = await api('/token?grant_type=password', { body: { email, password } });
  if (login.status >= 400) {
    log('the sign-in failed:', login.json?.msg || login.text.slice(0, 200));
    process.exit(1);
  }
  log('signed in as', login.json?.user?.email, '- role', login.json?.user?.role);

  console.log('');
  console.log('  everything works: sign-up → code → confirmed → sign-in');
  console.log('');
}

main();
