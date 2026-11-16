/* The wait between two "send me a code" requests.
 *
 * Supabase keeps a 60-second window per address for sign-up
 * confirmations, password resets and OTP requests, and answers a request
 * inside that window with 429. The old message was a vague "try again
 * later" — this remembers when the last request went out, so the screen
 * can say exactly how long is left ("Please wait 45 seconds") and can
 * refuse the request before it costs a round-trip.
 *
 * The time is kept in the browser (localStorage), so it survives a reload
 * and it costs nothing on the server.
 */

export const COOLDOWN_SECONDS = 60;

const KEY = 'sawaari:cooldown';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function write(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* a browser that will not store it simply has no countdown */
  }
}

/** Remembers that a code was requested for this address. */
export function markRequested(key, seconds = COOLDOWN_SECONDS) {
  const map = read();
  map[key] = Date.now() + seconds * 1000;
  write(map);
  // keep the store small
  const keys = Object.keys(map);
  if (keys.length > 20) {
    for (const k of keys.slice(0, keys.length - 20)) delete map[k];
    write(map);
  }
}

/** How many seconds are left before this address may ask again. */
export function secondsLeft(key) {
  const map = read();
  const until = map[key];
  if (!until) return 0;
  const left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/** "Please wait 45 seconds" — empty when the address may ask again. */
export function waitMessage(key) {
  const left = secondsLeft(key);
  if (left <= 0) return '';
  return `Please wait ${left} second${left === 1 ? '' : 's'} and try again.`;
}

/** The key for one address, whichever way it was written. */
export function cooldownKey(kind, address) {
  return `${kind}:${String(address || '').trim().toLowerCase()}`;
}
