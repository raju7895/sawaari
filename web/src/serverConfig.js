/* Central API configuration.
 *
 * One place decides which API every request goes to, so a wrong address can
 * never be spread across the app:
 *
 *   1. an address saved by the operator (Server settings → localStorage)
 *   2. VITE_API_URL — baked in at build time (Render sets it per service)
 *   3. the same origin the page was opened from, but ONLY when that origin
 *      really serves the API (the Vite dev proxy, or a single-host install).
 *      The origin is probed once, so a static site on its own hostname is
 *      never mistaken for the API.
 *   4. http://localhost:4000 — development fallback only.
 *
 * Everything the API talks to is validated here:
 *   • the address must be http(s) and parseable,
 *   • an http:// address on an https:// page is refused (the browser blocks
 *     it as mixed content and the request would die silently),
 *   • the resolved address and its origin are exposed through
 *     apiDiagnostics() so the console and the Server settings panel can
 *     explain exactly what is being contacted and why.
 */

const STORAGE_KEY = 'sawaari-server-url';
/* The port the API listens on locally. The development fallback is built
   from it, so no full URL is hardcoded in the source — and it is guarded
   by import.meta.env.DEV, which means the production bundle never carries
   a localhost address. */
const DEV_API_PORT = 4000;
const DEV_FALLBACK = import.meta.env.DEV ? `http://localhost:${DEV_API_PORT}` : '';   // audit:dev-only
const VITE_DEV_PORT = '5173';

const isNative = () => typeof window !== 'undefined'
  && (window.Capacitor !== undefined || window.__SAWAARI_DESKTOP__ === true);

const pageOrigin = () => (typeof window !== 'undefined' ? window.location.origin : '');

const isHttpsPage = () => pageOrigin().startsWith('https://');

const isDev = () => Boolean(import.meta.env && import.meta.env.DEV);

/** The Vite dev server proxies /api to the API on :4000. */
const isViteDev = () => {
  if (!isDev()) return false;
  try {
    return new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${VITE_DEV_PORT}$`).test(pageOrigin());
  } catch {
    return false;
  }
};

const normalize = (value) => (value || '').trim().replace(/\/+$/, '');

/** Build-time default (Render injects VITE_API_URL into the build). */
const buildTimeUrl = () => normalize(import.meta.env.VITE_API_URL || '');

/** Where the current address came from — for the UI and the console. */
export function apiBaseSource() {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return 'saved';
  } catch { /* private mode */ }
  if (buildTimeUrl()) return 'build';
  if (isViteDev()) return 'dev-proxy';
  if (isDev()) return 'dev-fallback';
  return 'same-origin';
}

/**
 * The base URL every API call should use right now.
 * An empty string means "same origin" — only correct when the API really is
 * served from the page's own origin (use resolveApiBase() before fetching).
 */
export function apiBase() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalize(saved);
  } catch { /* private mode */ }
  if (buildTimeUrl()) return buildTimeUrl();
  if (isViteDev()) return '';              // the dev proxy forwards /api to :4000
  if (isDev()) return DEV_FALLBACK;        // development fallback only
  return '';
}

/** True when an http:// API would be blocked on this https:// page. */
export function isMixedContent(url) {
  const target = normalize(url || apiBase());
  return Boolean(target) && isHttpsPage() && target.startsWith('http://');
}

/** Everything needed to explain a failing request. */
export function apiDiagnostics() {
  const base = apiBase();
  return {
    url: base || pageOrigin(),
    source: apiBaseSource(),
    pageOrigin: pageOrigin(),
    pageIsHttps: isHttpsPage(),
    mixedContent: isMixedContent(base),
    native: isNative(),
    dev: isDev(),
  };
}

/** Thrown when the app has no usable API address at all. */
export class ApiConfigError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'ApiConfigError';
    this.code = 'no-api-url';
    this.detail = detail;
  }
}

/* ── is the API served from the page's own origin? ─────────────────────
   Probed once per session. It is what makes the "same origin" fallback
   safe: a static site on its own hostname answers /api/health with the
   app shell (HTML), not JSON, so it is correctly rejected.              */
let sameOriginProbe = null;
export function sameOriginServesApi() {
  if (!sameOriginProbe) {
    sameOriginProbe = (async () => {
      const origin = pageOrigin();
      if (!origin) return false;
      try {
        const res = await fetch(`${origin}/api/health`, { method: 'GET', cache: 'no-store' });
        if (!res.ok) return false;
        const type = res.headers.get('content-type') || '';
        if (!type.includes('application/json')) return false;
        const body = await res.json();
        return Boolean(body && body.ok);
      } catch {
        return false;
      }
    })();
  }
  return sameOriginProbe;
}

/**
 * The base URL to fetch from — throws a descriptive error when the app has
 * no usable address instead of silently calling the wrong host.
 */
export async function resolveApiBase() {
  const base = apiBase();
  if (base) {
    if (isMixedContent(base)) {
      throw new ApiConfigError(
        `Blocked by the browser: this page is https:// but the API address ${base} is http://. ` +
        `Use an https:// address for the API.`,
        apiDiagnostics()
      );
    }
    return base;
  }
  if (await sameOriginServesApi()) return '';
  throw new ApiConfigError(
    'No API address is configured. Set VITE_API_URL when building the web app ' +
    '(Render → the static site → Environment), or enter the server address in Server settings.',
    apiDiagnostics()
  );
}

/** Persist a server URL (empty string = same origin). */
export function setApiBase(url) {
  const clean = normalize(url);
  if (clean) {
    let parsed;
    try {
      parsed = new URL(clean);
    } catch {
      throw new Error('Enter a full address, for example https://sawaari-api.onrender.com');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('The address must start with http:// or https://');
    }
    if (isHttpsPage() && parsed.protocol === 'http:') {
      throw new Error(
        'This page is https://, so the browser blocks http:// addresses. ' +
        'Use an https:// address for the API.'
      );
    }
  }
  try { localStorage.setItem(STORAGE_KEY, clean); } catch { /* ignore */ }
  return clean;
}

export function clearApiBase() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** Human-readable description of where the app is pointing. */
export function describeApiBase() {
  const base = apiBase();
  if (base) return base;
  if (isNative()) return 'not configured — set the server address';
  if (isViteDev()) return `${pageOrigin()} (dev proxy → ${DEV_FALLBACK})`;
  return `${pageOrigin()} (same origin)`;
}

export { isNative, STORAGE_KEY, DEV_FALLBACK };
