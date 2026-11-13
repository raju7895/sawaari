/* Tiny fetch wrapper: JSON, auth token, consistent error shape */
import { apiBase } from './serverConfig';

let token = localStorage.getItem('sawaari-token');
export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem('sawaari-token', t);
  else localStorage.removeItem('sawaari-token');
};
export const getToken = () => token;

export class ApiError extends Error {
  constructor(message, status, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

async function request(method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)),
    });
  } catch {
    throw new ApiError('Cannot reach the Sawaari server. Is the API running?', 0);
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth')) {
      setToken(null);
      localStorage.removeItem('sawaari-user');
    }
    const message = typeof data === 'object' && data.error ? data.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, typeof data === 'object' ? data : {});
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
  upload: (path, formData) => request('POST', path, formData),
};

export const fmtINR = (n) =>
  `₹${(typeof n === 'number' ? n : parseFloat(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/* Only in-app routes may be opened from data that comes out of the
   database (notification links, banners…). Anything that could be
   read as an absolute or protocol-relative URL is rejected, which
   closes the open-redirect pattern a backslash can smuggle in
   ("/\\evil.example" and "//evil.example" both point off-site). */
export const safeInternalPath = (value) => {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/')) return null;
  if (path.startsWith('//') || path.startsWith('/\\')) return null;
  if (/^\/+[\\/]/.test(path)) return null;
  if (/[\r\n]/.test(path)) return null;
  return path;
};
