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

/* ── the administrator console ─────────────────────────────────────────
   The master console runs on Supabase as well. Reads use the admin
   policies (the permission is checked by RLS), writes go through the
   SECURITY DEFINER RPCs so every change is audited.                     */
async function routeAdmin(method, url, body, query) {
  const m = method.toLowerCase();
  const rpc = async (name, args) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) fail(error);
    if (data && data.ok === false) fail(new ApiError(data.error || 'Not allowed.', 403, data));
    return data;
  };
  const count = async (table, build) => {
    const q = supabase.from(table).select('*', { count: 'exact' });
    build(q);
    const { data, error, count } = await q;
    if (error) fail(error);
    return { data: data || [], total: count ?? (data || []).length };
  };

  /* ── users ── */
  if (m === 'get' && url === '/api/admin/users') {
    let q = supabase.from('profiles').select('*, driver_profiles(*), passenger_profiles(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(Number(query.limit) || 50)
      .offset(Number(query.offset) || 0);
    if (query.q) q = q.or(`name.ilike.%${query.q}%,email.ilike.%${query.q}%`);
    if (query.roleF) q = q.eq('role', query.roleF);
    if (query.blocked === 'true') q = q.eq('is_active', false);
    if (query.blocked === 'false') q = q.eq('is_active', true);
    const { data, error, count } = await q;
    if (error) fail(error);
    return ok({
      users: (data || []).map(mapUser),
      total: count ?? (data || []).length,
    });
  }
  if (m === 'get' && /^\/api\/admin\/users\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) fail(error);
    const [bookings, payments, reports, suspensions, notifications] = await Promise.all([
      supabase.from('bookings').select('*').eq('passenger_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('payments').select('*').eq('passenger_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('user_reports').select('*').or(`reporter_id.eq.${id},against_user_id.eq.${id}`),
      supabase.from('user_suspensions').select('*').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('notifications').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    ]);
    return ok({
      ...mapUser(profile),
      bookings: (bookings.data || []).map(mapBooking),
      payments: payments.data || [],
      reports: reports.data || [],
      suspensions: suspensions.data || [],
      notifications: notifications.data || [],
    });
  }
  if (m === 'post' && url === '/api/admin/users/bulk') {
    const r = await rpc('admin_bulk_user_action', {
      p_user_ids: body.userIds, p_action: body.action, p_reason: body.reason, p_hours: body.hours ?? null,
    });
    return ok({ message: r.message, count: r.count });
  }
  const userAction = url.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/(block|suspend|deactivate)$/);
  if (m === 'post' && userAction) {
    const [, id, action] = userAction;
    if (action === 'block') {
      const r = await rpc('admin_set_user_blocked', { p_user_id: id, p_blocked: body.blocked !== false, p_reason: body.reason ?? null });
      return ok({ message: r.message });
    }
    if (action === 'suspend') {
      const r = await rpc('admin_set_user_suspended', {
        p_user_id: id, p_suspend: body.suspend !== false, p_reason: body.reason ?? null, p_hours: body.hours ?? null,
      });
      return ok({ message: r.message });
    }
    const r = await rpc('admin_deactivate_user', { p_user_id: id, p_reason: body.reason ?? null });
    return ok({ message: r.message });
  }
  if (m === 'patch' && /^\/api\/admin\/users\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const r = await rpc('admin_edit_user', { p_user_id: id, p_name: body.name ?? null, p_email: body.email ?? null });
    return ok({ message: r.message });
  }

  /* ── drivers ── */
  if (m === 'get' && url === '/api/admin/drivers') {
    let q = supabase.from('driver_profiles').select('*, profiles!driver_profiles_user_id_fkey(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(Number(query.limit) || 50).offset(Number(query.offset) || 0);
    if (query.status) q = q.eq('verification_status', query.status);
    const { data, error, count } = await q;
    if (error) fail(error);
    const drivers = await Promise.all((data || []).map(async (d) => {
      const user = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
      const { data: vehicle } = await supabase.from('vehicles').select('*').eq('driver_profile_id', d.id).maybeSingle();
      return {
        id: d.id, userId: d.user_id, name: user?.name || '', phone: user?.phone || '', email: user?.email || '',
        verificationStatus: d.verification_status, rejectionReason: d.rejection_reason,
        isOnline: d.is_online, isActive: user?.is_active ?? true,
        ratingAvg: d.rating_avg, ratingCount: d.rating_count,
        ridesCompleted: d.rides_completed, totalEarnings: d.total_earnings,
        upiId: d.upi_id, upiVerified: d.upi_verified,
        vehicle: vehicle ? mapVehicle(vehicle) : null,
        createdAt: d.created_at,
      };
    }));
    return ok({ drivers, total: count ?? drivers.length });
  }
  if (m === 'get' && /^\/api\/admin\/drivers\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const { data: driver, error } = await supabase.from('driver_profiles').select('*').eq('id', id).maybeSingle();
    if (error) fail(error);
    const { data: user } = await supabase.from('profiles').select('*').eq('id', driver?.user_id).maybeSingle();
    const { data: vehicle } = await supabase.from('vehicles').select('*').eq('driver_profile_id', id).maybeSingle();
    const { data: documents } = await supabase.from('driver_documents').select('*').eq('driver_profile_id', id);
    const { data: earnings } = await supabase.from('driver_earnings').select('*').eq('driver_profile_id', id);
    const { data: rides } = await supabase.from('bookings').select('*').eq('driver_profile_id', id)
      .order('created_at', { ascending: false }).limit(10);
    return ok({
      id: driver.id, userId: driver.user_id, name: user?.name || '', phone: user?.phone || '',
      email: user?.email || '', verificationStatus: driver.verification_status,
      rejectionReason: driver.rejection_reason, isOnline: driver.is_online,
      ratingAvg: driver.rating_avg, ratingCount: driver.rating_count,
      ridesCompleted: driver.rides_completed, totalEarnings: driver.total_earnings,
      upiId: driver.upi_id, upiVerified: driver.upi_verified, isActive: user?.is_active ?? true,
      vehicle: vehicle ? mapVehicle(vehicle) : null,
      documents: (documents || []).map(mapDocument),
      earnings: earnings || [],
      recentRides: (rides || []).map(mapBooking),
      createdAt: driver.created_at,
    });
  }
  const driverAction = url.match(/^\/api\/admin\/drivers\/([0-9a-f-]{36})\/(approve|reject|suspend|verify-upi)$/);
  if (m === 'post' && driverAction) {
    const [, id, action] = driverAction;
    if (action === 'approve' || action === 'reject') {
      const r = await rpc('admin_review_driver', {
        p_driver_id: id, p_approved: action === 'approve', p_reason: body.reason ?? null,
      });
      return ok({ message: r.message });
    }
    if (action === 'suspend') {
      const r = await rpc('admin_suspend_driver', {
        p_driver_id: id, p_suspend: body.suspend !== false, p_reason: body.reason ?? null, p_hours: body.hours ?? null,
      });
      return ok({ message: r.message });
    }
    const r = await rpc('admin_verify_upi', { p_driver_id: id, p_verified: body.verified !== false });
    return ok({ message: r.message });
  }
  if (m === 'put' && /^\/api\/admin\/drivers\/[0-9a-f-]{36}\/vehicle$/.test(url)) {
    const id = url.split('/')[4];
    const { data: driver } = await supabase.from('driver_profiles').select('id').eq('user_id', id).maybeSingle();
    const { data: vehicle } = await supabase.from('vehicles').select('id').eq('driver_profile_id', driver?.id || '').maybeSingle();
    const r = await rpc('admin_update_vehicle', {
      p_vehicle_id: vehicle?.id || null,
      p_registration_number: body.registrationNumber ?? null,
      p_vehicle_type: body.vehicleType ?? null,
      p_model: body.model ?? null,
      p_capacity: body.capacity ?? null,
    });
    return ok({ message: r.message });
  }
  if (m === 'post' && /^\/api\/admin\/documents\/[0-9a-f-]{36}\/review$/.test(url)) {
    const id = url.split('/')[4];
    const r = await rpc('admin_review_document', { p_document_id: id, p_status: body.status, p_note: body.note ?? null });
    return ok({ message: r.message });
  }

  /* ── bookings ── */
  if (m === 'get' && url === '/api/admin/bookings') {
    let q = supabase.from('bookings').select('*, profiles!bookings_passenger_id_fkey(name, phone)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(Number(query.limit) || 50).offset(Number(query.offset) || 0);
    if (query.status) q = q.eq('status', query.status);
    if (query.cityId) q = q.eq('city_id', query.cityId);
    const { data, error, count } = await q;
    if (error) fail(error);
    return ok({ bookings: (data || []).map(mapBooking), total: count ?? (data || []).length });
  }
  if (m === 'get' && url === '/api/admin/bookings/live') {
    const { data, error } = await supabase.from('bookings').select('*')
      .in('status', ['searching', 'assigned', 'arriving', 'arrived', 'in_progress'])
      .order('created_at', { ascending: false });
    if (error) fail(error);
    const counts = {};
    (data || []).forEach((b) => { counts[b.status] = (counts[b.status] || 0) + 1; });
    return ok({ live: (data || []).map(mapBooking), counts });
  }
  if (m === 'post' && /^\/api\/admin\/bookings\/[0-9a-f-]{36}\/cancel$/.test(url)) {
    const id = url.split('/')[4];
    const r = await rpc('cancel_booking', { p_booking_id: id, p_reason: body.reason || 'Cancelled by an administrator' });
    return ok({ message: 'Booking cancelled.' });
  }

  /* ── payments ── */
  if (m === 'get' && url === '/api/admin/payments') {
    let q = supabase.from('payments').select('*, bookings!payments_booking_id_fkey(ref)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(Number(query.limit) || 50).offset(Number(query.offset) || 0);
    if (query.status) q = q.eq('status', query.status);
    if (query.method) q = q.eq('method', query.method);
    const { data, error, count } = await q;
    if (error) fail(error);
    const totals = (data || []).reduce((t, p) => {
      t.total = Number(t.total || 0) + Number(p.amount || 0);
      t.count = Number(t.count || 0) + 1;
      return t;
    }, { total: 0, count: 0 });
    return ok({ payments: data || [], total: count ?? (data || []).length, totals });
  }
  const paymentAction = url.match(/^\/api\/admin\/payments\/([0-9a-f-]{36})\/(verify|reject|refund)$/);
  if (m === 'post' && paymentAction) {
    const [, id, action] = paymentAction;
    if (action === 'refund') {
      const r = await rpc('admin_refund_payment', {
        p_payment_id: id, p_amount: body.amount, p_reason: body.reason,
      });
      return ok({ refundId: r.refundId, message: r.message });
    }
    const r = await rpc('admin_verify_payment', {
      p_payment_id: id, p_verified: action === 'verify', p_reason: body.reason ?? null,
    });
    return ok({ message: r.message });
  }

  /* ── cities, pricing, settings ── */
  if (m === 'get' && url === '/api/admin/cities') {
    const { data, error } = await supabase.from('cities').select('*, pricing_configs(*)').order('name');
    if (error) fail(error);
    return ok((data || []).map((c) => ({
      id: c.id, name: c.name, state: c.state, centerLat: c.center_lat, centerLng: c.center_lng,
      radiusKm: c.radius_km, isActive: c.is_active,
      pricing: (c.pricing_configs || []).map(mapPricing),
    })));
  }
  if (m === 'post' && url === '/api/admin/cities') {
    const { data, error } = await supabase.from('cities').insert({
      name: body.name, state: body.state ?? null,
      center_lat: body.centerLat, center_lng: body.centerLng, radius_km: body.radiusKm ?? 25,
    }).select().single();
    if (error) fail(error);
    await rpc('record_audit', { p_action: 'city.create', p_category: 'cities', p_target_type: 'city', p_target_id: data.id });
    return ok({ message: 'City added.' });
  }
  if (m === 'patch' && /^\/api\/admin\/cities\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const { error } = await supabase.from('cities').update({ is_active: body.isActive }).eq('id', id);
    if (error) fail(error);
    await rpc('record_audit', { p_action: 'city.update', p_category: 'cities', p_target_type: 'city', p_target_id: id });
    return ok({ message: 'City updated.' });
  }
  if (m === 'get' && url === '/api/admin/pricing') {
    const { data, error } = await supabase.from('pricing_configs').select('*, cities(name)').order('city_id');
    if (error) fail(error);
    const { data: finance } = await supabase.from('platform_settings').select('value').eq('key', 'finance').maybeSingle();
    return ok({
      pricing: (data || []).map(mapPricing),
      commissionPercent: Number(finance?.value?.commissionPercent ?? 0),
    });
  }
  if (m === 'put' && /^\/api\/admin\/pricing\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const patch = {};
    if (body.baseFare !== undefined) patch.base_fare = body.baseFare;
    if (body.perKm !== undefined) patch.per_km = body.perKm;
    if (body.perMinute !== undefined) patch.per_minute = body.perMinute;
    if (body.minFare !== undefined) patch.min_fare = body.minFare;
    if (body.bookingFee !== undefined) patch.booking_fee = body.bookingFee;
    if (body.waitingPerMin !== undefined) patch.waiting_per_min = body.waitingPerMin;
    if (body.freeWaitMin !== undefined) patch.free_wait_min = body.freeWaitMin;
    if (body.nightMultiplier !== undefined) patch.night_multiplier = body.nightMultiplier;
    if (body.nightFromHour !== undefined) patch.night_from_hour = body.nightFromHour;
    if (body.nightToHour !== undefined) patch.night_to_hour = body.nightToHour;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    const { error } = await supabase.from('pricing_configs').update(patch).eq('id', id);
    if (error) fail(error);
    await rpc('record_audit', { p_action: 'pricing.update', p_category: 'finance', p_target_type: 'pricing', p_target_id: id });
    return ok({ message: 'Pricing updated.' });
  }

  /* ── analytics, dashboard, revenue ── */
  if (m === 'get' && (url === '/api/admin/analytics' || url === '/api/master/analytics')) {
    return ok(await rpc('admin_analytics', { p_days: 30 }));
  }
  if (m === 'get' && url === '/api/master/dashboard') {
    return ok(await rpc('admin_dashboard', {}));
  }
  if (m === 'get' && url === '/api/master/revenue') {
    return ok(await rpc('admin_revenue', { p_range: query.range || 'month' }));
  }
  if (m === 'get' && url === '/api/master/settlements') {
    const { data, error } = await supabase.from('settlements').select('*').order('created_at', { ascending: false });
    if (error) fail(error);
    return ok({ settlements: data || [] });
  }
  if (m === 'post' && url === '/api/master/settlements') {
    const r = await rpc('admin_create_settlement', {
      p_driver_profile_id: body.driverProfileId, p_period_start: body.periodStart, p_period_end: body.periodEnd,
    });
    return ok({ message: r.message });
  }
  if (m === 'post' && /^\/api\/master\/settlements\/[0-9a-f-]{36}\/paid$/.test(url)) {
    const id = url.split('/')[4];
    const r = await rpc('admin_mark_settlement_paid', { p_settlement_id: id, p_reference: body.reference ?? null });
    return ok({ message: r.message });
  }
  if (m === 'get' && url === '/api/master/refunds') {
    const { data, error } = await supabase.from('refunds').select('*, payments(*)').order('created_at', { ascending: false });
    if (error) fail(error);
    return ok({ refunds: data || [], gatewayConfigured: false });
  }
  if (m === 'post' && /^\/api\/master\/refunds\/[0-9a-f-]{36}\/complete$/.test(url)) {
    const id = url.split('/')[4];
    const r = await rpc('admin_complete_refund', { p_refund_id: id, p_notes: body.notes ?? null });
    return ok({ message: r.message });
  }
  if (m === 'post' && url === '/api/master/finance/commission') {
    const r = await rpc('admin_set_commission', { p_percent: body.percent });
    return ok({ message: r.message });
  }

  /* ── reports, SOS, tickets ── */
  if (m === 'get' && url === '/api/admin/sos') {
    const { data, error } = await supabase.from('sos_alerts').select('*').order('created_at', { ascending: false });
    if (error) fail(error);
    return ok(data || []);
  }
  if (m === 'post' && /^\/api\/admin\/sos\/[0-9a-f-]{36}\/(ack|resolve)$/.test(url)) {
    const [, id, action] = url.match(/^\/api\/admin\/sos\/([0-9a-f-]{36})\/(ack|resolve)$/);
    const r = await rpc('admin_sos_action', { p_alert_id: id, p_action: action === 'ack' ? 'ack' : 'resolve' });
    return ok({ message: r.message });
  }
  if (m === 'get' && url === '/api/admin/reports') {
    const { data, error } = await supabase.from('user_reports').select('*').order('created_at', { ascending: false });
    if (error) fail(error);
    return ok(data || []);
  }
  if (m === 'post' && /^\/api\/admin\/reports\/[0-9a-f-]{36}\/resolve$/.test(url)) {
    const id = url.split('/')[4];
    const r = await rpc('admin_resolve_report', { p_report_id: id, p_status: body.status, p_note: body.note ?? null });
    return ok({ message: r.message });
  }
  if (m === 'get' && /^\/api\/admin\/reports\/[0-9a-f-]{36}\/investigations$/.test(url)) {
    const id = url.split('/')[4];
    const { data, error } = await supabase.from('report_investigations').select('*')
      .eq('report_id', id).order('created_at', { ascending: false });
    if (error) fail(error);
    return ok(data || []);
  }
  if (m === 'post' && /^\/api\/admin\/reports\/[0-9a-f-]{36}\/investigate$/.test(url)) {
    const id = url.split('/')[4];
    const r = await rpc('admin_investigate_report', {
      p_report_id: id, p_action: body.action, p_note: body.note ?? null,
      p_assign_to: body.assignTo ?? null, p_evidence: body.evidence ?? null,
    });
    return ok({ message: r.message });
  }
  if (m === 'get' && url === '/api/admin/tickets') {
    const { data, error } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    if (error) fail(error);
    return ok(data || []);
  }
  if (m === 'get' && /^\/api\/admin\/tickets\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const { data: ticket, error } = await supabase.from('support_tickets').select('*').eq('id', id).maybeSingle();
    if (error) fail(error);
    const { data: messages } = await supabase.from('ticket_messages').select('*').eq('ticket_id', id).order('created_at');
    return ok({ ...ticket, messages: messages || [] });
  }
  if (m === 'post' && /^\/api\/admin\/tickets\/[0-9a-f-]{36}\/reply$/.test(url)) {
    const id = url.split('/')[4];
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('ticket_messages')
      .insert({ ticket_id: id, sender_id: user.id, body: body.body });
    if (error) fail(error);
    if (body.status) {
      await supabase.from('support_tickets').update({ status: body.status }).eq('id', id);
    }
    const { data: messages } = await supabase.from('ticket_messages').select('*').eq('ticket_id', id).order('created_at');
    return ok({ messages: messages || [] });
  }

  /* ── the audit log ── */
  if (m === 'get' && url === '/api/master/audit') {
    let q = supabase.from('admin_audit_log').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(Number(query.limit) || 50).offset(Number(query.offset) || 0);
    if (query.category) q = q.eq('category', query.category);
    if (query.result) q = q.eq('result', query.result);
    if (query.q) q = q.or(`action.ilike.%${query.q}%,target_label.ilike.%${query.q}%`);
    const { data, error, count } = await q;
    if (error) fail(error);
    return ok({ entries: data || [], total: count ?? (data || []).length });
  }

  /* ── platform settings ── */
  if (m === 'get' && url === '/api/master/settings') {
    const { data, error } = await supabase.from('platform_settings').select('*').order('category');
    if (error) fail(error);
    return ok({ settings: data || [], gateway: { razorpay: false } });
  }
  if (m === 'put' && url === '/api/master/settings') {
    const entries = Object.entries(body.settings || {});
    for (const [key, value] of entries) {
      const { error } = await supabase.from('platform_settings')
        .upsert({ key, value: typeof value === 'object' ? value : { value } }, { onConflict: 'key' });
      if (error) fail(error);
    }
    await rpc('record_audit', { p_action: 'settings.update', p_category: 'settings' });
    return ok({ message: 'Settings saved.' });
  }

  /* ── admins ── */
  if (m === 'get' && url === '/api/master/admins') {
    const { data, error } = await supabase.from('admin_profiles').select('*, profiles!admin_profiles_user_id_fkey(name, email, phone, is_active)');
    if (error) fail(error);
    const admins = (data || []).map((a) => {
      const u = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
      return {
        userId: a.user_id, name: u?.name || '', email: u?.email || a.admin_email || '',
        phone: u?.phone || '', adminRole: a.admin_role, isOwner: a.is_owner, status: a.status,
        emailVerified: a.email_verified, twofaEnabled: a.twofa_enabled,
        locked: Boolean(a.locked_until && new Date(a.locked_until) > new Date()),
        lockedUntil: a.locked_until, failedAttempts: a.failed_attempts,
        lastLoginAt: a.last_login_at, lastLoginIp: a.last_login_ip, createdAt: a.created_at,
        isProtected: a.admin_role === 'super_admin' || a.is_owner,
        permissions: [],
      };
    });
    return ok({ admins, roles: ADMIN_ROLES, permissions: ALL_PERMISSIONS });
  }
  const adminAction = url.match(/^\/api\/master\/admins\/([0-9a-f-]{36})\/(suspend|2fa\/reset)$/);
  if (m === 'post' && adminAction) {
    const [, id, action] = adminAction;
    if (action === 'suspend') {
      const r = await rpc('admin_suspend_admin', {
        p_user_id: id, p_suspend: body.suspend !== false, p_reason: body.reason ?? null,
      });
      return ok({ message: r.message });
    }
    const r = await rpc('admin_reset_admin_2fa', { p_user_id: id });
    return ok({ message: r.message });
  }
  if (m === 'patch' && /^\/api\/master\/admins\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const r = await rpc('admin_update_admin', {
      p_user_id: id, p_admin_role: body.adminRole ?? null,
      p_permissions: body.permissions ? { grant: body.permissions.grant || [] } : null,
    });
    return ok({ message: r.message });
  }
  if (m === 'delete' && /^\/api\/master\/admins\/[0-9a-f-]{36}$/.test(url)) {
    const id = url.split('/').pop();
    const r = await rpc('admin_remove_admin', { p_user_id: id });
    return ok({ message: r.message });
  }

  return { handled: false };
}

/* ── shape helpers for the admin screens ──────────────────────────────── */
const mapUser = (p) => ({
  id: p.id, role: p.role, name: p.name, phone: p.phone, email: p.email,
  avatarUrl: p.avatar_path ? publicUrl('avatars', p.avatar_path) : null,
  isActive: p.is_active, blockedReason: p.blocked_reason,
  phoneVerified: p.phone_verified, emailVerified: Boolean(p.email_verified_at),
  createdAt: p.created_at, deactivatedAt: p.deactivated_at,
  ratingAvg: p.passenger_profiles?.[0]?.rating_avg ?? p.driver_profiles?.[0]?.rating_avg ?? 0,
  ratingCount: p.passenger_profiles?.[0]?.rating_count ?? p.driver_profiles?.[0]?.rating_count ?? 0,
});

const mapVehicle = (v) => ({
  id: v.id, registrationNumber: v.registration_number, vehicleType: v.vehicle_type,
  model: v.model, capacity: v.capacity, photoUrl: v.photo_path ? publicUrl('vehicles', v.photo_path) : null,
  isPrimary: v.is_primary,
});

const mapDocument = (d) => ({
  id: d.id, docType: d.doc_type, docNumber: d.doc_number,
  fileUrl: d.file_path, status: d.status, reviewNote: d.review_note,
  createdAt: d.created_at,
});

const mapPricing = (p) => ({
  id: p.id, cityId: p.city_id, cityName: p.cities?.name,
  vehicleType: p.vehicle_type, baseFare: p.base_fare, perKm: p.per_km,
  perMinute: p.per_minute, minFare: p.min_fare, bookingFee: p.booking_fee,
  waitingPerMin: p.waiting_per_min, freeWaitMin: p.free_wait_min,
  nightMultiplier: p.night_multiplier, nightFromHour: p.night_from_hour,
  nightToHour: p.night_to_hour, isActive: p.is_active,
});

/* the role catalogue and the 35 permissions (mirrors server/src/services/rbac.js) */
const ALL_PERMISSIONS = [
  'users.view', 'users.edit', 'users.block', 'users.suspend', 'users.deactivate', 'users.bulk',
  'drivers.view', 'drivers.verify', 'drivers.manage',
  'bookings.view', 'bookings.cancel', 'bookings.dispute',
  'payments.view', 'payments.verify', 'payments.refund',
  'finance.view', 'finance.reports', 'finance.settings',
  'reports.view', 'reports.investigate',
  'tickets.view', 'tickets.reply',
  'notifications.send',
  'analytics.view',
  'cities.view', 'cities.manage',
  'settings.view', 'settings.edit', 'settings.security',
  'admins.view', 'admins.create', 'admins.edit', 'admins.suspend', 'admins.remove',
  'audit.view',
];
const ADMIN_ROLES = ['super_admin', 'admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator'];

/* ── the public API (same contract as before) ────────────────────────── */
async function request(method, path, body, opts = {}) {
  if (isSupabaseConfigured) {
    const routed = await route(method, path, body, opts);
    if (routed.handled) return routed.data;
    const admin = await routeAdmin(method, path.split('?')[0], body, Object.fromEntries(new URLSearchParams(path.split('?')[1] || '')));
    if (admin.handled) return admin.data;
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
