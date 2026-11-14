/* The data layer.
 *
 * `api.get('/api/bookings/mine')` and friends still work exactly as
 * before — 147 call sites across 41 files depend on them — but the
 * transport changed:
 *
 *   • every rider/driver feature now runs on Supabase (Postgres + Auth +
 *     Storage + Realtime) directly from the browser;
 *   • the administrator console and the payment gateway still talk to the
 *     Express API (the same serverConfig base as before) until those
 *     endpoints are moved across.
 *
 * The router below decides per path. A path it does not know falls
 * through to the Express transport, so nothing breaks while the migration
 * is in progress.
 */
import { supabase, supabaseErrorMessage, isSupabaseConfigured } from './supabase';
import { apiBase } from '../serverConfig';
import { uploadToBucket, publicUrl } from './storage';

/* ── the Express transport (unchanged behaviour, used for the admin
      console and the payment gateway) ─────────────────────────────────── */
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

async function expressRequest(method, path, body, opts = {}) {
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
  } catch (err) {
    console.error(`[api] ${method} ${path} failed`, { url: `${apiBase()}${path}`, cause: err?.message });
    throw new ApiError(
      `Could not reach ${apiBase()}. The API may be down, the address may be wrong, or the browser ` +
      `blocked the reply because the API does not allow this origin (CORS).`,
      0,
      { code: 'network' }
    );
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

/* ── helpers ─────────────────────────────────────────────────────────── */
const ok = (data) => ({ handled: true, data });
const fail = (error) => {
  throw error instanceof ApiError
    ? error
    : new ApiError(supabaseErrorMessage(error), error?.status || 0, { code: 'supabase' });
};

async function profileFor(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, passenger_profiles(*), driver_profiles(*)')
    .eq('id', userId)
    .maybeSingle();
  if (error) fail(error);
  return data;
}

/* ── the router ──────────────────────────────────────────────────────── */
async function route(method, path, body, opts) {
  const m = method.toLowerCase();
  const url = path.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''));

  /* ── profile ── */
  if (m === 'get' && url === '/api/users/me') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new ApiError('Not signed in', 401);
    return ok(await profileFor(user.id));
  }
  if (m === 'patch' && url === '/api/users/me') {
    const { data: { user } } = await supabase.auth.getUser();
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.email !== undefined) patch.email = body.email;
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', user.id).select().single();
    if (error) fail(error);
    return ok(data);
  }
  if (m === 'post' && url === '/api/users/me/avatar') {
    const { data: { user } } = await supabase.auth.getUser();
    const file = body.get?.('file');
    const path = await uploadToBucket('avatars', file, `${user.id}/${Date.now()}-${file.name}`);
    const { data, error } = await supabase
      .from('profiles').update({ avatar_path: path }).eq('id', user.id).select().single();
    if (error) fail(error);
    return ok({ ...data, avatarUrl: publicUrl('avatars', path) });
  }

  /* ── public data ── */
  if (m === 'get' && url === '/api/meta/cities') {
    const { data, error } = await supabase
      .from('cities').select('*, pricing_configs(*)').eq('is_active', true).order('name');
    if (error) fail(error);
    return ok(data.map((c) => ({
      id: c.id, name: c.name, state: c.state, centerLat: c.center_lat, centerLng: c.center_lng,
      radiusKm: c.radius_km,
      baseFare: c.pricing_configs?.[0]?.base_fare ?? null,
      perKm: c.pricing_configs?.[0]?.per_km ?? null,
    })));
  }
  if (m === 'get' && url.startsWith('/api/bookings/share/')) {
    const token = url.split('/').pop();
    const { data, error } = await supabase.rpc('get_booking_by_share_token', { p_token: token });
    if (error) fail(error);
    return ok(data?.booking ?? data ?? null);
  }

  /* ── bookings ── */
  if (m === 'get' && url === '/api/bookings/active') {
    const { data, error } = await supabase.rpc('my_active_booking');
    if (error) fail(error);
    const row = data?.booking ?? data;
    return ok({ booking: row ? mapBooking(row) : null });
  }
  if (m === 'get' && url === '/api/bookings/mine') {
    let q = supabase.from('bookings').select('*')
      .eq('passenger_id', (await supabase.auth.getUser()).data.user?.id || '')
      .order('created_at', { ascending: false })
      .limit(Number(query.limit) || 50);
    if (query.status) q = q.eq('status', query.status);
    const { data, error } = await q;
    if (error) fail(error);
    return ok({ bookings: (data || []).map(mapBooking) });
  }
  if (m === 'get' && url === '/api/bookings/nearby-drivers') {
    const { data, error } = await supabase.rpc('nearby_drivers', {
      p_lat: Number(query.lat), p_lng: Number(query.lng),
      p_radius_km: Number(query.radiusKm) || 10,
      p_vehicle_type: query.vehicleType || 'auto',
    });
    if (error) fail(error);
    return ok({ drivers: data || [] });
  }
  if (m === 'post' && url === '/api/bookings/quote') {
    const { data, error } = await supabase.rpc('quote_fare', {
      p_pickup_lat: body.pickupLat, p_pickup_lng: body.pickupLng,
      p_drop_lat: body.dropLat, p_drop_lng: body.dropLng,
      p_distance_km: body.distanceKm, p_duration_min: body.durationMin,
      p_city_id: body.cityId || null, p_vehicle_type: body.vehicleType || 'auto',
    });
    if (error) fail(error);
    return ok(data);
  }
  if (m === 'post' && url === '/api/bookings') {
    const { data, error } = await supabase.rpc('create_booking', {
      p_pickup_lat: body.pickupLat, p_pickup_lng: body.pickupLng, p_pickup_address: body.pickupAddress,
      p_drop_lat: body.dropLat, p_drop_lng: body.dropLng, p_drop_address: body.dropAddress,
      p_distance_km: body.distanceKm, p_duration_min: body.durationMin,
      p_city_id: body.cityId || null, p_vehicle_type: body.vehicleType || 'auto',
      p_booking_type: body.bookingType || 'immediate',
      p_scheduled_at: body.scheduledAt || null,
    });
    if (error) fail(error);
    if (data?.ok === false) fail(new ApiError(data.error || 'Could not create the booking', 400, data));
    return ok(data);
  }
  const bookingId = url.match(/^\/api\/bookings\/([0-9a-f-]{36})(\/.*)?$/);
  if (bookingId) {
    const id = bookingId[1];
    const rest = bookingId[2] || '';
    if (m === 'get' && rest === '') {
      const { data, error } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
      if (error) fail(error);
      return ok(mapBooking(data));
    }
    if (m === 'get' && rest === '/events') {
      const { data, error } = await supabase.from('ride_events').select('*')
        .eq('booking_id', id).order('created_at');
      if (error) fail(error);
      return ok({ events: data || [] });
    }
    if (m === 'get' && rest === '/chat') {
      const { data, error } = await supabase.from('booking_messages').select('*')
        .eq('booking_id', id).order('created_at');
      if (error) fail(error);
      return ok({ messages: data || [] });
    }
    if (m === 'post' && rest === '/chat') {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('booking_messages')
        .insert({ booking_id: id, sender_id: user.id, body: body.body }).select().single();
      if (error) fail(error);
      return ok({ message: data });
    }
    if (m === 'post' && rest === '/cancel') {
      const { data, error } = await supabase.rpc('cancel_booking', { p_booking_id: id, p_reason: body.reason });
      if (error) fail(error);
      if (data?.ok === false) fail(new ApiError(data.error, 400, data));
      return ok(data);
    }
    if (m === 'post' && rest === '/sos') {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('sos_alerts')
        .insert({ booking_id: id, user_id: user.id, lat: body.lat, lng: body.lng }).select().single();
      if (error) fail(error);
      return ok({ alert: data, emergencyNumber: '112' });
    }
    if (m === 'post' && rest === '/review') {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: booking } = await supabase.from('bookings').select('*').eq('id', id).single();
      const { data, error } = await supabase.from('reviews').insert({
        booking_id: id, reviewer_id: user.id, reviewee_id: booking.driver_profile_id,
        rating: body.rating, comment: body.comment || null,
      }).select().single();
      if (error) fail(error);
      return ok({ review: data });
    }
  }

  /* ── driver ── */
  if (m === 'get' && url === '/api/driver/me') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile, error } = await supabase
      .from('driver_profiles').select('*, vehicles(*), driver_documents(*)').eq('user_id', user.id).maybeSingle();
    if (error) fail(error);
    const { data: loc } = await supabase.from('driver_locations')
      .select('*').eq('driver_profile_id', profile?.id || '').maybeSingle();
    return ok({
      ...profile,
      lastLocation: loc ? { lat: loc.lat, lng: loc.lng, heading: loc.heading } : null,
      documents: profile?.driver_documents || [],
      vehicle: profile?.vehicles?.[0] || null,
    });
  }
  if (m === 'get' && url === '/api/driver/requests') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
    const { data: loc } = await supabase.from('driver_locations')
      .select('*').eq('driver_profile_id', dp?.id || '').maybeSingle();
    const { data, error } = await supabase.rpc('nearby_ride_requests', {
      p_lat: loc?.lat || 0, p_lng: loc?.lng || 0, p_radius_km: 25,
    });
    if (error) fail(error);
    return ok({ requests: data || [] });
  }
  if (m === 'get' && url === '/api/driver/rides') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
    let q = supabase.from('bookings').select('*').eq('driver_profile_id', dp?.id || '')
      .order('created_at', { ascending: false });
    if (query.status) q = q.eq('status', query.status);
    const { data, error } = await q;
    if (error) fail(error);
    return ok({ rides: (data || []).map(mapBooking) });
  }
  if (m === 'get' && url === '/api/driver/earnings') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('*').eq('user_id', user.id).maybeSingle();
    const { data: rows, error } = await supabase.from('driver_earnings').select('*')
      .eq('driver_profile_id', dp?.id || '').order('created_at', { ascending: false });
    if (error) fail(error);
    const total = (rows || []).reduce((sum, r) => sum + Number(r.net), 0);
    return ok({ summary: { total, rides: rows?.length || 0 }, earnings: rows || [], series: [] });
  }
  if (m === 'get' && url === '/api/driver/reviews') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
    const { data, error } = await supabase.from('reviews').select('*')
      .eq('reviewee_id', dp?.id || '').order('created_at', { ascending: false });
    if (error) fail(error);
    return ok({ reviews: data || [] });
  }
  if (m === 'post' && url === '/api/driver/online') {
    const { data, error } = await supabase.rpc('set_driver_online', { p_online: Boolean(body.online) });
    if (error) fail(error);
    return ok({ online: data });
  }
  if (m === 'post' && url === '/api/driver/location') {
    const { data, error } = await supabase.rpc('set_driver_location', {
      p_lat: body.lat, p_lng: body.lng,
      p_heading: body.heading ?? null, p_accuracy: body.accuracy ?? null,
    });
    if (error) fail(error);
    return ok({ saved: data });
  }
  if (m === 'post' && url === '/api/driver/vehicle') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
    const { data, error } = await supabase.from('vehicles').upsert({
      driver_profile_id: dp?.id,
      registration_number: body.registrationNumber,
      vehicle_type: body.vehicleType,
      model: body.model || null,
      capacity: body.capacity || 3,
    }, { onConflict: 'driver_profile_id' }).select().single();
    if (error) fail(error);
    return ok({ vehicle: data });
  }
  if (m === 'post' && url === '/api/driver/upi') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
    const { data, error } = await supabase.from('driver_profiles')
      .update({ upi_id: body.upiId, upi_verified: false }).eq('id', dp?.id).select().single();
    if (error) fail(error);
    return ok({ driver: data });
  }
  if (m === 'post' && url === '/api/driver/documents') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
    const file = body.get?.('file');
    const path = await uploadToBucket('documents', file, `${user.id}/${Date.now()}-${file.name}`);
    const { data, error } = await supabase.from('driver_documents').insert({
      driver_profile_id: dp?.id,
      doc_type: body.get?.('docType'),
      doc_number: body.get?.('docNumber') || null,
      file_path: path,
    }).select().single();
    if (error) fail(error);
    return ok({ document: data });
  }
  if (m === 'post' && url === '/api/driver/vehicle/photo') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: dp } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
    const file = body.get?.('file');
    const path = await uploadToBucket('vehicles', file, `${user.id}/${Date.now()}-${file.name}`);
    const { data, error } = await supabase.from('vehicles')
      .update({ photo_path: path }).eq('driver_profile_id', dp?.id).select().single();
    if (error) fail(error);
    return ok({ vehicle: data, photoUrl: publicUrl('vehicles', path) });
  }
  const driverRide = url.match(/^\/api\/driver\/rides\/([0-9a-f-]{36})\/(accept|reject|arriving|arrived|start|complete|cancel)$/);
  if (m === 'post' && driverRide) {
    const [, id, action] = driverRide;
    if (action === 'accept') {
      const { data, error } = await supabase.rpc('accept_ride', { p_booking_id: id });
      if (error) fail(error);
      if (data?.ok === false) fail(new ApiError(data.error, 409, data));
      return ok(data);
    }
    if (action === 'reject') {
      const { error } = await supabase.rpc('cancel_booking', { p_booking_id: id, p_reason: body.reason || 'Driver declined' });
      if (error) fail(error);
      return ok({ ok: true });
    }
    const { data, error } = await supabase.rpc('transition_ride', {
      p_booking_id: id, p_action: action,
      p_ride_otp: body.rideOtp || null, p_reason: body.reason || null,
    });
    if (error) fail(error);
    if (data?.ok === false) fail(new ApiError(data.error, 409, data));
    return ok(data);
  }

  /* ── payments (history only — the gateway still lives on Express) ── */
  if (m === 'get' && url === '/api/payments/mine') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('payments').select('*')
      .eq('passenger_id', user.id).order('created_at', { ascending: false });
    if (error) fail(error);
    return ok(data || []);
  }
  if (m === 'get' && url.startsWith('/api/payments/booking/')) {
    const id = url.split('/').pop();
    const { data, error } = await supabase.from('payments').select('*').eq('booking_id', id);
    if (error) fail(error);
    return ok(data || []);
  }

  /* ── saved locations ── */
  if (m === 'get' && url === '/api/saved-locations') {
    const { data, error } = await supabase.from('saved_locations').select('*').order('created_at');
    if (error) fail(error);
    return ok(data || []);
  }
  if (m === 'post' && url === '/api/saved-locations') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('saved_locations').insert({
      user_id: user.id, label: body.label, address: body.address, lat: body.lat, lng: body.lng,
    }).select().single();
    if (error) fail(error);
    return ok(data);
  }
  if (m === 'delete' && url.startsWith('/api/saved-locations/')) {
    const id = url.split('/').pop();
    const { error } = await supabase.from('saved_locations').delete().eq('id', id);
    if (error) fail(error);
    return ok({ ok: true });
  }

  /* ── notifications ── */
  if (m === 'get' && url === '/api/notifications') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('notifications').select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
    if (error) fail(error);
    const list = data || [];
    return ok({ notifications: list, unread: list.filter((n) => !n.read_at).length });
  }
  if (m === 'post' && url === '/api/notifications/read-all') {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('notifications')
      .update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
    if (error) fail(error);
    return ok({ ok: true });
  }

  /* ── support ── */
  if (m === 'get' && url === '/api/support/tickets') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('support_tickets').select('*, ticket_messages(*)')
      .eq('user_id', user.id).order('created_at', { ascending: false });
    if (error) fail(error);
    return ok(data || []);
  }
  if (m === 'post' && url === '/api/support/tickets') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('support_tickets').insert({
      user_id: user.id, subject: body.subject, priority: body.priority || 'normal',
    }).select().single();
    if (error) fail(error);
    if (body.message) {
      await supabase.from('ticket_messages').insert({ ticket_id: data.id, sender_id: user.id, body: body.message });
    }
    return ok(data);
  }
  if (m === 'post' && /^\/api\/support\/tickets\/[0-9a-f-]{36}\/reply$/.test(url)) {
    const id = url.split('/')[4];
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('ticket_messages')
      .insert({ ticket_id: id, sender_id: user.id, body: body.body }).select().single();
    if (error) fail(error);
    return ok({ message: data });
  }
  if (m === 'post' && url === '/api/support/reports') {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('user_reports').insert({
      reporter_id: user.id, against_user_id: body.againstUserId,
      reason: body.reason, details: body.details || null,
    }).select().single();
    if (error) fail(error);
    return ok(data);
  }

  /* ── not migrated yet → the Express API ── */
  return { handled: false };
}

/* ── shape helpers ───────────────────────────────────────────────────── */
function mapBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    ref: row.ref,
    passengerId: row.passenger_id,
    driverProfileId: row.driver_profile_id,
    cityId: row.city_id,
    status: row.status,
    bookingType: row.booking_type,
    scheduledAt: row.scheduled_at,
    vehicleType: row.vehicle_type,
    pickup: { lat: row.pickup_lat, lng: row.pickup_lng, address: row.pickup_address },
    drop: { lat: row.drop_lat, lng: row.drop_lng, address: row.drop_address },
    distanceKm: row.distance_km,
    durationMin: row.duration_min,
    fareBreakdown: row.fare_breakdown,
    estimatedFare: row.estimated_fare,
    finalFare: row.final_fare,
    rideOtp: row.ride_otp,
    shareToken: row.share_token,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    assignedAt: row.assigned_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    routeGeometry: row.route_geometry,
  };
}

/* ── the public API (same contract as before) ────────────────────────── */
async function request(method, path, body, opts = {}) {
  if (isSupabaseConfigured) {
    try {
      const routed = await route(method, path, body, opts);
      if (routed.handled) return routed.data;
    } catch (err) {
      throw err;
    }
  }
  return expressRequest(method, path, body, opts);
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

/** Only in-app routes may be opened from data that comes out of the database. */
export const safeInternalPath = (value) => {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/')) return null;
  if (path.startsWith('//') || path.startsWith('/\\')) return null;
  if (/^\/+[\\/]/.test(path)) return null;
  if (/[\r\n]/.test(path)) return null;
  return path;
};
