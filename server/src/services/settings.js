/* Platform settings with a small in-process cache */
const { one } = require('../db');

const DEFAULTS = {
  commission_percent: 15,
  driver_request_timeout_sec: 120,
  search_radius_km: 6,
  cancellation_fee_after_accept: 10,
  support_phone: '+91-80-4000-1234',
  sos_number: '112',
  currency: 'INR',
};

let cache = null;
let loadedAt = 0;
const TTL = 15000;

async function loadAll(force = false) {
  if (!force && cache && Date.now() - loadedAt < TTL) return cache;
  const { rows } = await require('../db').query('SELECT key, value FROM platform_settings');
  const map = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;
  cache = map;
  loadedAt = Date.now();
  return map;
}

async function getSettings() { return loadAll(); }
async function getSetting(key) {
  const all = await loadAll();
  return all[key];
}
function invalidate() { cache = null; }

module.exports = { getSettings, getSetting, invalidate };
