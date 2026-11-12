/* Runtime server configuration.
 *
 * The web build talks to the API through a base URL. On the web that is the
 * same origin (the dev server proxies /api). In an installed app — the
 * Android APK, the Electron shell or an installed PWA — the API lives on a
 * different host, so the base URL must be configurable at runtime without
 * rebuilding.
 *
 * Resolution order:
 *   1. a URL saved by the operator (localStorage)
 *   2. VITE_API_URL baked in at build time
 *   3. same origin (web deployment behind one host)
 */

const STORAGE_KEY = 'sawaari-server-url';

const isNative = () => typeof window !== 'undefined'
  && (window.Capacitor !== undefined || window.__SAWAARI_DESKTOP__ === true);

/** Build-time default, normalised (no trailing slash). */
const buildTimeUrl = () => (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/** The base URL every API call should use right now. */
export function apiBase() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved.replace(/\/+$/, '');
  } catch { /* private mode */ }
  return buildTimeUrl();
}

/** Persist a server URL (empty string = same origin). */
export function setApiBase(url) {
  const clean = (url || '').trim().replace(/\/+$/, '');
  if (clean) {
    // validate: must be http(s) and parseable
    try {
      const u = new URL(clean);
      if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
    } catch {
      throw new Error('Enter a full address, for example http://192.168.1.5:4000');
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
  return `${window.location.origin} (same origin)`;
}

/** True when the app is running inside a native shell. */
export { isNative, STORAGE_KEY };
