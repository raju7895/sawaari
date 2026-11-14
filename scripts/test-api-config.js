/* Proves the API-address resolution and the error messages.
 *
 * The bug this guards against: the front end silently called the wrong
 * host (or its own origin) and reported "Cannot reach the Sawaari server"
 * for every cause. These checks pin the behaviour down.
 *
 *   node scripts/test-api-config.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'web', 'src', 'serverConfig.js'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
};

/* Load serverConfig.js with a controlled browser/import.meta.env */
function load({ saved = null, build = '', dev = false, origin = 'https://sawaari-web.onrender.com' } = {}) {
  const store = { 'sawaari-server-url': saved };
  const sandbox = {
    console,
    // import.meta is not valid inside a script — the module reads it as a
    // plain object, so the test injects the same shape
    __ENV__: { DEV: dev, VITE_API_URL: build },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    },
    window: {
      location: { origin, href: origin + '/' },
      Capacitor: undefined,
    },
    fetch: async () => { throw new Error('not used'); },
    URL,
    setTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // strip the ESM syntax and evaluate the module body
  const body = source
    .replace(/import\.meta\.env/g, '__ENV__')
    .replace(/^import .*$/gm, '')
    .replace(/^export\s+(async\s+)?(const|function|class|let)\s/gm, '$1$2 ')
    .replace(/^export \{[^}]*\};?$/gm, '')
    .replace(/^export default .*$/gm, '');
  vm.runInContext(body + '\n;globalThis.__api = { apiBase, apiBaseSource, apiDiagnostics, isMixedContent, describeApiBase, setApiBase, clearApiBase, sameOriginServesApi };', sandbox);
  return { api: sandbox.__api, store };
}

console.log('\n== production build with VITE_API_URL set ==');
{
  const { api } = load({ build: 'https://sawaari-api.onrender.com' });
  check('the build-time URL is used', api.apiBase(), 'https://sawaari-api.onrender.com');
  check('the source is reported', api.apiBaseSource(), 'build');
  check('no mixed content', api.isMixedContent(api.apiBase()), false);
}

console.log('\n== production build WITHOUT VITE_API_URL ==');
{
  const { api } = load({ build: '' });
  check('it falls back to the same origin', api.apiBase(), '');
  check('the source is reported', api.apiBaseSource(), 'same-origin');
  check('the diagnostics name the page origin',
    api.apiDiagnostics().pageOrigin, 'https://sawaari-web.onrender.com');
}

console.log('\n== a saved address wins over the build-time one ==');
{
  const { api } = load({ saved: 'http://192.168.1.5:4000', build: 'https://sawaari-api.onrender.com' });
  check('the saved address is used', api.apiBase(), 'http://192.168.1.5:4000');
  check('the source is reported', api.apiBaseSource(), 'saved');
}

console.log('\n== trailing slashes are removed ==');
{
  const { api } = load({ saved: 'https://sawaari-api.onrender.com///' });
  check('no trailing slash', api.apiBase(), 'https://sawaari-api.onrender.com');
}

console.log('\n== mixed content is detected (https page + http API) ==');
{
  const { api } = load({ saved: 'http://192.168.1.5:4000' });
  check('mixed content is flagged', api.isMixedContent(api.apiBase()), true);
}
{
  const { api } = load({ saved: 'https://sawaari-api.onrender.com' });
  check('https on an https page is fine', api.isMixedContent(api.apiBase()), false);
}
{
  // an http page may talk to an http API (the LAN case)
  const { api } = load({ saved: 'http://192.168.1.5:4000', origin: 'http://localhost:5173' });
  check('http on an http page is fine', api.isMixedContent(api.apiBase()), false);
}

console.log('\n== the Vite dev server uses its /api proxy ==');
{
  const { api } = load({ dev: true, origin: 'http://localhost:5173' });
  check('same origin (the proxy forwards it)', api.apiBase(), '');
  check('the source is reported', api.apiBaseSource(), 'dev-proxy');
}

console.log('\n== the development fallback ==');
{
  const { api } = load({ dev: true, origin: 'http://localhost:4001' });
  check('localhost:4000 is used', api.apiBase(), 'http://localhost:4000');
  check('the source is reported', api.apiBaseSource(), 'dev-fallback');
}

console.log('\n== setApiBase validates the address ==');
{
  const { api } = load({ origin: 'https://sawaari-web.onrender.com' });
  let error = null;
  try { api.setApiBase('not a url'); } catch (e) { error = e.message; }
  check('a broken address is rejected', Boolean(error && /full address/i.test(error)), true);

  error = null;
  try { api.setApiBase('http://192.168.1.5:4000'); } catch (e) { error = e.message; }
  check('http on an https page is rejected', Boolean(error && /https/i.test(error)), true);

  error = null;
  try { api.setApiBase('javascript:alert(1)'); } catch (e) { error = e.message; }
  check('a non-http protocol is rejected', Boolean(error && /http/i.test(error)), true);

  check('a valid https address is accepted', api.setApiBase('https://sawaari-api.onrender.com/'), 'https://sawaari-api.onrender.com');
}

console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
