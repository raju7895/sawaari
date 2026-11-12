/* Location services: geocoding (Nominatim) + road routing (OSRM).
   Both are real services; results cached; failures surface as 503-style
   errors so the UI can show honest fallbacks. For production, self-host
   OSRM/Nominatim or swap in Google/Mapbox (see README). */
const config = require('../config');
const { httpError, TTLCache } = require('../utils');

const UA = 'Sawaari/1.0 (auto-booking platform; contact: admin@sawaari.local)';
const geocodeCache = new TTLCache(10 * 60000, 1000);
const routeCache = new TTLCache(5 * 60000, 1000);

/* Routing hosts are tried in order; a public instance being down or blocked
   must never take the platform down — we degrade to a straight-line estimate. */
const osrmBases = [
  config.geo.osrmBase,
  ...String(config.geo.osrmFallbacks || '').split(',').map((s) => s.trim()).filter(Boolean),
].filter(Boolean);

const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs || 10000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Forward geocode: query → [{lat,lng,label,secondary}] (India-scoped) */
async function geocode(q, near) {
  const key = `q:${q}:${near ? near.join(',') : ''}`;
  const hit = geocodeCache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    q, format: 'json', addressdetails: '1', limit: '8', countrycodes: 'in',
  });
  if (near && near.length === 2) {
    params.set('viewbox', `${near[1]-0.3},${near[0]+0.3},${near[1]+0.3},${near[0]-0.3}`);
    params.set('bounded', '0');
  }
  const data = await fetchJson(`${config.geo.nominatimBase}/search?${params}`);
  const out = (data || []).map((d) => ({
    lat: parseFloat(d.lat), lng: parseFloat(d.lon),
    label: d.name || d.display_name.split(',')[0],
    secondary: d.display_name,
  }));
  geocodeCache.set(key, out);
  return out;
}

/** Reverse geocode: lat,lng → {lat,lng,label,secondary} */
async function reverseGeocode(lat, lng) {
  const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = geocodeCache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'json', zoom: '17' });
  const data = await fetchJson(`${config.geo.nominatimBase}/reverse?${params}`);
  const out = data && !data.error
    ? {
        lat, lng,
        label: data.name || [data.address?.road, data.address?.suburb, data.address?.city || data.address?.town || data.address?.village].filter(Boolean).join(', ') || data.display_name.split(',')[0],
        secondary: data.display_name,
      }
    : null;
  geocodeCache.set(key, out);
  return out;
}

/** Road route between two points: {distanceKm, durationMin, geometry, source}
 *  source: 'road'     — real OSRM road route
 *  source: 'estimate' — routing hosts unreachable; straight-line × 1.3 detour factor */
async function route({ fromLat, fromLng, toLat, toLng }) {
  const key = `${fromLat.toFixed(4)},${fromLng.toFixed(4)};${toLat.toFixed(4)},${toLng.toFixed(4)}`;
  const hit = routeCache.get(key);
  if (hit) return hit;

  let lastError = null;
  for (const base of osrmBases) {
    const url = `${base}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    try {
      const data = await fetchJson(url, { timeoutMs: 12000 });
      if (!data.routes || !data.routes.length) throw new Error('no route in response');
      const r = data.routes[0];
      const out = {
        distanceKm: Math.round((r.distance / 1000) * 100) / 100,
        durationMin: Math.max(1, Math.round(r.duration / 60)),
        geometry: r.geometry, // GeoJSON LineString
        source: 'road',
      };
      routeCache.set(key, out);
      return out;
    } catch (err) {
      lastError = err;
    }
  }

  /* Every routing host failed — degrade to a straight-line estimate so the
     platform keeps working. The response is flagged so the UI can say so. */
  const straight = haversineKm(fromLat, fromLng, toLat, toLng);
  const distanceKm = Math.round(Math.max(0.1, straight * 1.3) * 100) / 100;
  const durationMin = Math.max(1, Math.round((distanceKm / 22) * 60)); // ~22 km/h urban average
  const out = { distanceKm, durationMin, geometry: null, source: 'estimate', degraded: true };
  routeCache.set(key, out);
  console.warn(`[geo] OSRM unavailable (${lastError && lastError.message}); using estimate ${distanceKm} km`);
  return out;
}

module.exports = { geocode, reverseGeocode, route, haversineKm };
