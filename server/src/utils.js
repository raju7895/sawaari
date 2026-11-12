/* Shared helpers */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const httpError = (status, message, extra) => new HttpError(status, message, extra);

/** Wrap async route handlers, forwarding errors to express */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Normalise Indian mobile to 10 digits */
function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return null;
}

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined ? null : parseFloat(v));

function randomRef(prefix = 'SW') {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Simple TTL cache (for geocoding/routing responses) */
class TTLCache {
  constructor(ttlMs = 300000, max = 500) { this.ttl = ttlMs; this.max = max; this.map = new Map(); }
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) { this.map.delete(key); return null; }
    return e.val;
  }
  set(key, val) {
    if (this.map.size >= this.max) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, { val, exp: Date.now() + this.ttl });
  }
}

/**
 * Build a CSV string. `columns` can be supplied so an empty result set
 * still produces a labelled header row instead of a 0-byte file.
 */
function rowsToCsv(rows, columns = null) {
  const cols = columns && columns.length ? columns : (rows[0] ? Object.keys(rows[0]) : []);
  if (!cols.length) return '';
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

module.exports = { HttpError, httpError, asyncHandler, normalizePhone, round2, num, randomRef, sleep, TTLCache, rowsToCsv };
