/* The data layer — Supabase only.
 *
 * Every screen talks to this module; nothing in web/src talks to Supabase
 * directly except the client itself. The functions mirror the domain:
 * profiles, drivers, vehicles, rides, payments, ratings, saved places.
 *
 * Business rules (the fare, accepting a ride, the status machine) live in
 * Postgres functions and are called with supabase.rpc() — never computed in
 * the browser.
 */
import { supabase, friendlyError } from './supabase';

export class ApiError extends Error {
  constructor(message, status = 0, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const fail = (error, extra = {}) => {
  throw new ApiError(friendlyError(error), (error && error.status) || 0, { code: error?.code, ...extra });
};

/* ── the signed-in user ───────────────────────────────────────────────── */
export async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) fail(error);
  return data?.user || null;
}

export async function myProfile() {
  /* vehicles hang off the driver, not off the profile — the embed has to
     follow that chain or PostgREST refuses the whole query (PGRST200) and
     the app never learns who the signed-in person is.
     The row is shaped here as well: the whole app reads one shape
     (fullName, avatarUrl, driver, …), not the raw columns. */
  const { data, error } = await supabase
    .from('profiles')
    .select('*, drivers(*, vehicles(*))')
    .eq('id', (await currentUser())?.id || '')
    .maybeSingle();
  if (error) fail(error);
  return data ? shapeProfile(data) : null;
}

/** The driver row of the signed-in user (null for riders). */
export async function myDriver() {
  const { data, error } = await supabase
    .from('drivers')
    .select('*, vehicles(*), driver_documents(*)')
    .eq('user_id', (await currentUser())?.id || '')
    .maybeSingle();
  if (error) fail(error);
  return data || null;
}

/* ── profiles ────────────────────────────────────────────────────────── */
export async function updateProfile(patch) {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', (await currentUser())?.id || '')
    .select()
    .single();
  if (error) fail(error);
  return data;
}

/* ── rides ───────────────────────────────────────────────────────────── */
/* NOTE on the select strings below:
 *   • PostgREST refuses a space between the constraint name and the "(" of a
 *     *nested* embed ("unexpected )"), so the embeds are written without
 *     spaces;
 *   • embedding the same table twice needs an alias, otherwise PostgREST
 *     generates the same alias twice and the query fails with
 *     "table name ... specified more than once".
 */
const RIDE_SELECT = `
  id, ref, rider_id, driver_id, vehicle_type, status, fare, fare_breakdown,
  ride_otp, share_token, pickup_address, pickup_lat, pickup_lng,
  drop_address, drop_lat, drop_lng, distance_km, duration_min,
  cancel_reason, completed_at, cancelled_at, created_at,
  profiles!rides_rider_id_fkey(full_name, phone, avatar_path),
  drivers!rides_driver_id_fkey(id, is_verified, rating_avg, user_id,
    profiles!drivers_user_id_fkey(full_name, phone, avatar_path))
`;

const one = (row) => row || null;

export async function listMyRides({ limit = 30, status } = {}) {
  let q = supabase
    .from('rides')
    .select(RIDE_SELECT)
    .eq('rider_id', (await currentUser())?.id || '')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) fail(error);
  return (data || []).map(shapeRide);
}

export async function listMyDriverRides({ limit = 30, status } = {}) {
  const driver = await myDriver();
  if (!driver) return [];
  let q = supabase
    .from('rides')
    .select(RIDE_SELECT)
    .eq('driver_id', driver.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) fail(error);
  return (data || []).map(shapeRide);
}

export async function getRide(id) {
  const { data, error } = supabase.from('rides').select(RIDE_SELECT).eq('id', id).maybeSingle();
  const res = await supabase.from('rides').select(RIDE_SELECT).eq('id', id).maybeSingle();
  if (res.error) fail(res.error);
  return res.data ? shapeRide(res.data) : null;
}

export async function activeRide() {
  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_SELECT)
    .eq('rider_id', (await currentUser())?.id || '')
    .in('status', ['requested', 'accepted', 'ongoing'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) fail(error);
  return data && data[0] ? shapeRide(data[0]) : null;
}

export async function openRideRequests() {
  const driver = await myDriver();
  if (!driver || !driver.is_verified) return [];
  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_SELECT)
    .eq('status', 'requested')
    .is('driver_id', null)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) fail(error);
  return (data || []).map(shapeRide);
}

export async function quoteRide({ vehicleType = 'auto', distanceKm = 0, durationMin = 0 }) {
  const { data, error } = await supabase.rpc('quote_ride', {
    p_vehicle_type: vehicleType,
    p_distance_km: distanceKm,
    p_duration_min: durationMin,
  });
  if (error) fail(error);
  return data || {};
}

export async function bookRide(input) {
  const { data, error } = await supabase.rpc('book_ride', {
    p_pickup_address: input.pickupAddress,
    p_drop_address: input.dropAddress,
    p_vehicle_type: input.vehicleType || 'auto',
    p_pickup_lat: input.pickupLat ?? null,
    p_pickup_lng: input.pickupLng ?? null,
    p_drop_lat: input.dropLat ?? null,
    p_drop_lng: input.dropLng ?? null,
    p_distance_km: input.distanceKm ?? 0,
    p_duration_min: input.durationMin ?? 0,
  });
  if (error) fail(error);
  if (data && data.ok === false) throw new ApiError(data.error || 'Could not book the ride.', 400, data);
  return data;
}

export async function acceptRide(rideId) {
  const { data, error } = await supabase.rpc('accept_ride', { p_ride_id: rideId });
  if (error) fail(error);
  if (data && data.ok === false) throw new ApiError(data.error || 'Could not accept that ride.', 409, data);
  return data;
}

export async function updateRideStatus(rideId, status, reason) {
  const { data, error } = await supabase.rpc('update_ride_status', {
    p_ride_id: rideId,
    p_status: status,
    p_reason: reason || null,
  });
  if (error) fail(error);
  if (data && data.ok === false) throw new ApiError(data.error || 'Could not update the ride.', 409, data);
  return data;
}

/* ── ratings ─────────────────────────────────────────────────────────── */
export async function rateRide(rideId, toUser, rating, comment) {
  const { data, error } = await supabase
    .from('ratings')
    .insert({ ride_id: rideId, from_user: (await currentUser())?.id, to_user: toUser, rating, comment: comment || null })
    .select()
    .single();
  if (error) fail(error);
  return data;
}

export async function ratingsFor(userId) {
  const { data, error } = await supabase
    .from('ratings')
    .select('*, profiles!ratings_from_user_fkey(full_name)')
    .eq('to_user', userId)
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return data || [];
}

/* ── payments ────────────────────────────────────────────────────────── */
export async function listMyPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('*, rides!payments_ride_id_fkey(ref, drop_address)')
    .or(`rider_id.eq.${(await currentUser())?.id || ''},driver_id.in.(${(await myDriver())?.id || ''})`)
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return (data || []).map((p) => ({
    id: p.id,
    rideId: p.ride_id,
    method: p.method,
    amount: p.amount,
    status: p.status,
    createdAt: p.created_at,
    ref: p.rides?.ref,
  }));
}

/* ── saved places ────────────────────────────────────────────────────── */
export async function listSavedPlaces() {
  const { data, error } = await supabase
    .from('saved_places')
    .select('*')
    .eq('user_id', (await currentUser())?.id || '')
    .order('created_at');
  if (error) fail(error);
  return (data || []).map((p) => ({
    id: p.id, label: p.label, address: p.address, lat: p.lat, lng: p.lng,
  }));
}

export async function addSavedPlace({ label, address, lat, lng }) {
  const { data, error } = await supabase
    .from('saved_places')
    .insert({ user_id: (await currentUser())?.id, label, address, lat: lat ?? null, lng: lng ?? null })
    .select()
    .single();
  if (error) fail(error);
  return data;
}

export async function removeSavedPlace(id) {
  const { error } = await supabase.from('saved_places').delete().eq('id', id);
  if (error) fail(error);
  return true;
}

/* ── drivers ─────────────────────────────────────────────────────────── */
export async function setDriverOnline(online) {
  const driver = await myDriver();
  if (!driver) throw new ApiError('This account is not registered as a driver.', 400);
  const { error } = await supabase.from('drivers').update({ is_online: online }).eq('id', driver.id);
  if (error) fail(error);
  return true;
}

export async function saveVehicle({ registrationNumber, vehicleType, model, capacity }) {
  const driver = await myDriver();
  if (!driver) throw new ApiError('This account is not registered as a driver.', 400);
  const { data, error } = await supabase
    .from('vehicles')
    .upsert({
      driver_id: driver.id,
      registration_number: registrationNumber,
      vehicle_type: vehicleType || 'auto',
      model: model || null,
      capacity: capacity || 3,
    }, { onConflict: 'driver_id' })
    .select()
    .single();
  if (error) fail(error);
  return data;
}

export async function listMyDocuments() {
  const driver = await myDriver();
  if (!driver) return [];
  const { data, error } = await supabase
    .from('driver_documents')
    .select('*')
    .eq('driver_id', driver.id)
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return data || [];
}

/* ── admin ───────────────────────────────────────────────────────────── */
export async function adminListProfiles({ search = '', role = '', limit = 50, offset = 0 } = {}) {
  let q = supabase
    .from('profiles')
    .select('*, drivers(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
  if (role) q = q.eq('role', role);
  const { data, error, count } = await q;
  if (error) fail(error);
  return { rows: (data || []).map(shapeProfile), total: count ?? (data || []).length };
}

export async function adminListDrivers({ status = '', limit = 50, offset = 0 } = {}) {
  let q = supabase
    .from('drivers')
    .select('*, profiles!drivers_user_id_fkey(full_name, phone, email, role), vehicles(*), driver_documents(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('is_verified', status === 'verified');
  const { data, error, count } = await q;
  if (error) fail(error);
  return { rows: data || [], total: count ?? (data || []).length };
}

export async function adminListRides({ status = '', limit = 50, offset = 0 } = {}) {
  let q = supabase
    .from('rides')
    .select(RIDE_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  const { data, error, count } = await q;
  if (error) fail(error);
  return { rows: (data || []).map(shapeRide), total: count ?? (data || []).length };
}

export async function adminListPayments({ status = '', limit = 50, offset = 0 } = {}) {
  let q = supabase
    .from('payments')
    .select('*, rides!payments_ride_id_fkey(ref)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  const { data, error, count } = await q;
  if (error) fail(error);
  return { rows: data || [], total: count ?? (data || []).length };
}

export async function adminListRatings({ limit = 50, offset = 0 } = {}) {
  const { data, error, count } = await supabase
    .from('ratings')
    .select('*, from_user:profiles!ratings_from_user_fkey(full_name), to_user:profiles!ratings_to_user_fkey(full_name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) fail(error);
  return { rows: data || [], total: count ?? (data || []).length };
}

export async function adminListActions({ limit = 50, offset = 0 } = {}) {
  const { data, error, count } = await supabase
    .from('admin_actions')
    .select('*, profiles!admin_actions_admin_id_fkey(full_name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) fail(error);
  return { rows: data || [], total: count ?? (data || []).length };
}

export async function adminDashboard() {
  const [users, drivers, rides, payments, today, revenue, byStatus] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('drivers').select('id', { count: 'exact', head: true }),
    supabase.from('rides').select('id', { count: 'exact', head: true }),
    supabase.from('payments').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', new Date().toISOString().slice(0, 10)),
    supabase.from('payments').select('amount').eq('status', 'paid'),
    supabase.from('rides').select('status'),
  ]);
  const statusCounts = {};
  (byStatus.data || []).forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
  return {
    users: users.count || 0,
    drivers: drivers.count || 0,
    rides: rides.count || 0,
    payments: payments.count || 0,
    signupsToday: today.count || 0,
    revenue: (revenue.data || []).reduce((s, p) => s + Number(p.amount || 0), 0),
    byStatus: statusCounts,
  };
}

export async function adminSetUserState(userId, { role, blocked, verified } = {}) {
  const { data, error } = await supabase.rpc('admin_set_user_state', {
    p_user_id: userId, p_role: role ?? null, p_blocked: blocked ?? null, p_verified: verified ?? null,
  });
  if (error) fail(error);
  if (data && data.ok === false) throw new ApiError(data.error || 'Not allowed.', 403, data);
  return data;
}

export async function adminVerifyDriver(driverId, verified) {
  const { data, error } = await supabase.rpc('admin_set_driver_verified', {
    p_driver_id: driverId, p_verified: verified,
  });
  if (error) fail(error);
  if (data && data.ok === false) throw new ApiError(data.error || 'Not allowed.', 403, data);
  return data;
}

/**
 * Sets a new password for somebody who cannot get the reset e-mail.
 * The reset link needs a working mail provider; this does not, so an
 * administrator can always let a person back in.
 */
export async function adminSetUserPassword(userId, password) {
  const { data, error } = await supabase.rpc('admin_set_user_password', {
    p_user_id: userId, p_new_password: password,
  });
  if (error) fail(error);
  if (data && data.ok === false) throw new ApiError(data.error || 'Not allowed.', 403, data);
  return data;
}

export async function adminSetFares(fares) {
  const { data, error } = await supabase.rpc('admin_set_fares', { p_fares: fares });
  if (error) fail(error);
  if (data && data.ok === false) throw new ApiError(data.error || 'Not allowed.', 403, data);
  return data;
}

export async function adminGetFares() {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'fares').maybeSingle();
  if (error) fail(error);
  return data?.value || { auto: { baseFare: 30, perKm: 12, perMinute: 1, minFare: 50 }, e_rickshaw: { baseFare: 40, perKm: 15, perMinute: 1, minFare: 70 } };
}

export async function adminDeleteRating(id) {
  const { error } = await supabase.from('ratings').delete().eq('id', id);
  if (error) fail(error);
  return true;
}

export async function adminRefundPayment(id) {
  const { error } = await supabase.from('payments').update({ status: 'refunded' }).eq('id', id);
  if (error) fail(error);
  return true;
}

/* ── shaping ─────────────────────────────────────────────────────────── */
export function shapeProfile(p) {
  if (!p) return null;
  /* "drivers" hangs off the profile by its user_id, so PostgREST hands it
     back as a list (one driver per profile, but the embed is one-to-many
     from the database's point of view). */
  const driverRow = Array.isArray(p.drivers) ? p.drivers[0] : p.drivers;
  return {
    id: p.id,
    role: p.role,
    name: p.full_name,
    fullName: p.full_name,
    phone: p.phone,
    email: p.email,
    avatarUrl: p.avatar_path ? publicFileUrl('avatars', p.avatar_path) : null,
    isActive: !p.is_blocked,
    isBlocked: p.is_blocked,
    is_blocked: p.is_blocked,
    isVerified: p.is_verified,
    createdAt: p.created_at,
    driver: driverRow ? shapeDriver(driverRow) : null,
    vehicle: driverRow?.vehicles?.[0] || null,
  };
}

export function shapeDriver(d) {
  if (!d) return null;
  const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
  return {
    id: d.id,
    userId: d.user_id,
    name: profile?.full_name || '',
    phone: profile?.phone || '',
    email: profile?.email || '',
    avatarUrl: profile?.avatar_path ? publicFileUrl('avatars', profile.avatar_path) : null,
    isVerified: d.is_verified,
    isOnline: d.is_online,
    ratingAvg: d.rating_avg,
    ratingCount: d.rating_count,
    ridesCompleted: d.rides_completed,
    totalEarnings: d.total_earnings,
    vehicle: d.vehicles?.[0] || null,
    documents: d.driver_documents || [],
    createdAt: d.created_at,
  };
}

export function shapeRide(r) {
  if (!r) return null;
  const rider = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  const driverProfile = r.drivers
    ? (Array.isArray(r.drivers.profiles) ? r.drivers.profiles[0] : r.drivers.profiles)
    : null;
  return {
    id: r.id,
    ref: r.ref,
    status: r.status,
    riderId: r.rider_id,
    driverId: r.driver_id,
    riderName: rider?.full_name || '',
    riderPhone: rider?.phone || '',
    driverName: driverProfile?.full_name || '',
    driverPhone: driverProfile?.phone || '',
    driverRating: r.drivers?.rating_avg ?? null,
    vehicleType: r.vehicle_type,
    pickup: { address: r.pickup_address, lat: r.pickup_lat, lng: r.pickup_lng },
    drop: { address: r.drop_address, lat: r.drop_lat, lng: r.drop_lng },
    distanceKm: r.distance_km,
    durationMin: r.duration_min,
    fare: r.fare,
    fareBreakdown: r.fare_breakdown,
    rideOtp: r.ride_otp,
    shareToken: r.share_token,
    cancelReason: r.cancel_reason,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
  };
}

/* the public URL of a file in a public bucket */
export function publicFileUrl(bucket, path) {
  if (!path) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}
