/* Ride engine: booking lifecycle, driver dispatch, status machine.
   Double-booking is prevented with transactional optimistic locks
   (driver can only take a ride while free; a ride can only be taken
   while unassigned). */
const { query, one, many, withTransaction } = require('../db');
const { httpError, randomRef, round2 } = require('../utils');
const geo = require('./geo');
const fareSvc = require('./fare');
const settingsSvc = require('./settings');
const { notify } = require('./notify');
const socket = require('../socket');

const HAVERSINE = (latCol, lngCol, latP, lngP) =>
  `(6371 * acos(least(1, greatest(-1,
      cos(radians(${latP})) * cos(radians(${latCol})) * cos(radians(${lngCol}) - radians(${lngP}))
      + sin(radians(${latP})) * sin(radians(${latCol}))
    ))))`;

/** Public view of a booking (role-aware: hides ride OTP from driver, etc.) */
async function serializeBooking(b, viewer) {
  if (!b) return null;
  const driverUserId = b.driver_user_id;
  const isPassenger = viewer && b.passenger_id === viewer.id;
  const isDriver = viewer && driverUserId === viewer.id;
  const isAdmin = viewer && viewer.role === 'admin';

  const out = {
    id: b.id, ref: b.ref, status: b.status, bookingType: b.booking_type, scheduledAt: b.scheduled_at,
    vehicleType: b.vehicle_type,
    pickup: { lat: b.pickup_lat, lng: b.pickup_lng, address: b.pickup_address },
    drop: { lat: b.drop_lat, lng: b.drop_lng, address: b.drop_address },
    distanceKm: parseFloat(b.distance_km), durationMin: b.duration_min,
    routeGeometry: b.route_geometry,
    fareBreakdown: b.fare_breakdown,
    estimatedFare: parseFloat(b.estimated_fare),
    finalFare: b.final_fare === null ? null : parseFloat(b.final_fare),
    waitingMinutes: b.waiting_minutes,
    paymentStatus: b.payment_status,
    cancellationFee: parseFloat(b.cancellation_fee),
    cancellationReason: b.cancellation_reason,
    createdAt: b.created_at, assignedAt: b.assigned_at, arrivedAt: b.arrived_at,
    startedAt: b.started_at, completedAt: b.completed_at, cancelledAt: b.cancelled_at,
    passenger: null, driver: null, vehicle: null,
  };
  if (isPassenger || isAdmin) out.rideOtp = b.ride_otp;
  if (isPassenger || isAdmin || driverUserId === viewer?.id) {
    out.shareToken = b.share_token;
  }

  if ((isPassenger || isDriver || isAdmin) && driverUserId) {
    const d = await one(
      `SELECT u.name, u.phone, u.avatar_url, u.id AS user_id, dp.rating_avg, dp.rating_count,
              dp.rides_completed, dp.verification_status, dp.id AS driver_profile_id
       FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
       WHERE dp.id = $1`, [b.driver_profile_id]
    );
    if (d) {
      out.driver = {
        userId: d.user_id, name: d.name, phone: d.phone, avatarUrl: d.avatar_url,
        rating: parseFloat(d.rating_avg), ratingCount: d.rating_count, ridesCompleted: d.rides_completed,
      };
      const v = await one(
        `SELECT registration_number, vehicle_type, model, capacity, photo_url
         FROM vehicles WHERE driver_profile_id=$1 AND is_primary`, [d.driver_profile_id]
      );
      out.vehicle = v ? {
        registrationNumber: v.registration_number, vehicleType: v.vehicle_type,
        model: v.model, capacity: v.capacity, photoUrl: v.photo_url,
      } : null;
    }
  }
  if ((isDriver || isAdmin) && b.passenger_id) {
    const p = await one(
      `SELECT u.name, u.phone, u.avatar_url, u.id AS user_id, pp.rating_avg, pp.rating_count
       FROM users u LEFT JOIN passenger_profiles pp ON pp.user_id = u.id
       WHERE u.id = $1`, [b.passenger_id]
    );
    if (p) out.passenger = {
      userId: p.user_id, name: p.name, phone: p.phone, avatarUrl: p.avatar_url,
      rating: parseFloat(p.rating_avg || 0), ratingCount: p.rating_count,
    };
  }
  return out;
}

const BOOKING_SELECT = `
  SELECT b.*, dp.user_id AS driver_user_id
  FROM bookings b LEFT JOIN driver_profiles dp ON dp.id = b.driver_profile_id`;

const getBooking = (id) => one(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);

/** Nearby available drivers (for the passenger's live map) */
async function nearbyDrivers(lat, lng, radiusKm, vehicleType) {
  const radius = radiusKm || (await settingsSvc.getSetting('search_radius_km'));
  const dist = HAVERSINE('dl.lat', 'dl.lng', '$2', '$3');
  return (await query(
    `SELECT v.vehicle_type, v.registration_number, dp.rating_avg,
            dl.lat, dl.lng, dl.heading, round((${dist})::numeric, 2) AS distance_km
     FROM driver_locations dl
     JOIN driver_profiles dp ON dp.id = dl.driver_profile_id
          AND dp.is_online AND dp.verification_status = 'approved' AND dp.current_booking_id IS NULL
     LEFT JOIN vehicles v ON v.driver_profile_id = dp.id AND v.is_primary
     WHERE dl.updated_at > now() - interval '10 minutes'
       AND (${dist}) <= $1
       AND ($4::text IS NULL OR v.vehicle_type = $4)
     ORDER BY distance_km ASC LIMIT 30`,
    [radius, lat, lng, vehicleType || null]
  )).rows.map((r) => ({
    vehicleType: r.vehicle_type, registrationNumber: r.registration_number,
    rating: parseFloat(r.rating_avg), lat: r.lat, lng: r.lng,
    heading: r.heading ? parseFloat(r.heading) : null, distanceKm: parseFloat(r.distance_km),
  }));
}

/** Quote: road route + fare for a city/vehicle type */
async function quote({ pickupLat, pickupLng, dropLat, dropLng, vehicleType = 'auto', scheduledAt }) {
  const city = await fareSvc.findCityForPoint(pickupLat, pickupLng);
  const pricing = await fareSvc.getPricing(city.id, vehicleType);
  if (!pricing) throw httpError(422, `No pricing configured for ${vehicleType} in ${city.name}.`);
  const route = await geo.route({ fromLat: pickupLat, fromLng: pickupLng, toLat: dropLat, toLng: dropLng });
  const at = scheduledAt ? new Date(scheduledAt) : new Date();
  const fare = fareSvc.computeFare(pricing, { distanceKm: route.distanceKm, durationMin: route.durationMin, at });
  return { city, route, fare, pricing };
}

/** Create booking + dispatch to nearby drivers */
async function createBooking(passenger, {
  pickupLat, pickupLng, pickupAddress, dropLat, dropLng, dropAddress,
  vehicleType = 'auto', bookingType = 'immediate', scheduledAt,
}) {
  const q = await quote({ pickupLat, pickupLng, dropLat, dropLng, vehicleType, scheduledAt });
  const isScheduled = bookingType === 'scheduled' && scheduledAt && new Date(scheduledAt) > new Date();

  const rideOtp = String(Math.floor(1000 + Math.random() * 9000));
  const shareToken = require('crypto').randomBytes(16).toString('hex');

  const { rows } = await query(
    `INSERT INTO bookings
      (ref, passenger_id, city_id, booking_type, scheduled_at, vehicle_type,
       pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address,
       distance_km, duration_min, route_geometry, fare_breakdown, estimated_fare,
       status, ride_otp, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [randomRef(), passenger.id, q.city.id, bookingType, isScheduled ? scheduledAt : null, vehicleType,
     pickupLat, pickupLng, pickupAddress, dropLat, dropLng, dropAddress,
     q.route.distanceKm, q.route.durationMin, JSON.stringify(q.route.geometry),
     JSON.stringify(q.fare), q.fare.total,
     isScheduled ? 'scheduled' : 'searching', rideOtp, shareToken]
  );
  const booking = rows[0];
  await query(`INSERT INTO ride_events (booking_id, status, actor_id) VALUES ($1,$2,$3)`,
    [booking.id, isScheduled ? 'scheduled' : 'searching', passenger.id]);

  if (!isScheduled) await dispatchToDrivers(booking);
  await notify(passenger.id, {
    type: isScheduled ? 'ride_scheduled' : 'ride_created',
    title: isScheduled ? 'Ride scheduled' : 'Finding your auto…',
    body: isScheduled
      ? `We'll find a driver for your ${new Date(scheduledAt).toLocaleString('en-IN')} ride.`
      : 'We are searching for autos near your pickup location.',
    data: { bookingId: booking.id, url: `/app/ride/${booking.id}` },
  });
  return booking;
}

/** Broadcast a ride request to eligible nearby drivers */
async function dispatchToDrivers(booking) {
  const radius = await settingsSvc.getSetting('search_radius_km');
  const candidates = await nearbyDrivers(
    booking.pickup_lat, booking.pickup_lng, radius, booking.vehicle_type
  );
  // notify + socket push (request card payload – no passenger phone yet)
  const payload = {
    bookingId: booking.id, ref: booking.ref, vehicleType: booking.vehicle_type,
    pickup: { lat: booking.pickup_lat, lng: booking.pickup_lng, address: booking.pickup_address },
    drop: { lat: booking.drop_lat, lng: booking.drop_lng, address: booking.drop_address },
    distanceKm: parseFloat(booking.distance_km),
    estimatedFare: parseFloat(booking.estimated_fare),
    fareBreakdown: booking.fare_breakdown,
    durationMin: booking.duration_min,
    createdAt: booking.created_at,
  };
  const driverUserIds = await query(
    `SELECT user_id FROM driver_profiles dp
     JOIN driver_locations dl ON dl.driver_profile_id = dp.id AND dl.updated_at > now() - interval '10 minutes'
     WHERE dp.is_online AND dp.verification_status='approved' AND dp.current_booking_id IS NULL
       AND (${HAVERSINE('dl.lat', 'dl.lng', '$2', '$3')}) <= $1`,
    [radius, booking.pickup_lat, booking.pickup_lng]
  );
  for (const d of driverUserIds.rows) {
    await notify(d.user_id, {
      type: 'ride_request', title: 'New ride request',
      body: `${booking.distance_km} km · ₹${booking.estimated_fare} · ${booking.pickup_address}`,
      data: { bookingId: booking.id, url: '/driver' },
    });
  }
  socket.emitToDrivers(driverUserIds.rows.map((r) => r.user_id), 'ride:request', payload);
  return driverUserIds.rows.length;
}

/** Driver accepts – atomic, race-safe */
async function acceptRide(driverProfile, bookingId) {
  if (driverProfile.verification_status !== 'approved')
    throw httpError(403, 'Your driver account is not approved yet. You cannot accept rides.');
  if (!driverProfile.is_online) throw httpError(400, 'Go online before accepting rides.');

  const booking = await withTransaction(async (tx) => {
    // lock 1: driver must be free
    const d = await tx.query(
      `UPDATE driver_profiles SET current_booking_id = $2, updated_at = now()
       WHERE id = $1 AND is_online AND verification_status='approved' AND current_booking_id IS NULL
       RETURNING id`, [driverProfile.id, bookingId]
    );
    if (d.rowCount !== 1) {
      throw httpError(409, 'You are already on a ride or offline.');
    }
    // lock 2: ride must be unassigned
    const b = await tx.query(
      `UPDATE bookings SET driver_profile_id = $2, status = 'assigned', assigned_at = now(), updated_at = now()
       WHERE id = $1 AND driver_profile_id IS NULL AND status IN ('searching')
       RETURNING *`, [bookingId, driverProfile.id]
    );
    if (b.rowCount !== 1) {
      throw httpError(409, 'This ride is no longer available.');
    }
    await tx.query(`INSERT INTO ride_events (booking_id, status, actor_id) VALUES ($1,'assigned',$2)`,
      [bookingId, driverProfile.user_id]);
    return b.rows[0];
  });

  socket.emitToAllDrivers('ride:request-cancelled', { bookingId, reason: 'accepted' });
  const view = await serializeBooking(await getBooking(booking.id), { id: driverProfile.user_id, role: 'driver' });
  socket.emitToUser(booking.passenger_id, 'ride:assigned', view);
  socket.emitToBooking(booking.id, 'ride:assigned', view);
  await notify(booking.passenger_id, {
    type: 'ride_assigned', title: 'Auto on the way',
    body: 'A driver accepted your booking. Track them on the map.',
    data: { bookingId: booking.id, url: `/app/ride/${booking.id}` },
  });
  await notify(driverProfile.user_id, {
    type: 'ride_assigned', title: 'Ride accepted',
    body: `Pick up at ${booking.pickup_address}. Share OTP only when the ride starts.`,
    data: { bookingId: booking.id, url: '/driver' },
  });
  return view;
}

/** Driver progression: arriving → arrived → in_progress → completed */
async function driverAction(driverProfile, bookingId, action, { rideOtp } = {}) {
  const booking = await getBooking(bookingId);
  if (!booking) throw httpError(404, 'Booking not found');
  if (booking.driver_profile_id !== driverProfile.id)
    throw httpError(403, 'You are not the driver of this ride.');

  const now = new Date();
  const transitions = {
    arriving: { from: ['assigned'], to: 'arriving' },
    arrived: { from: ['assigned', 'arriving'], to: 'arrived' },
    start: { from: ['arrived', 'arriving', 'assigned'], to: 'in_progress' },
    complete: { from: ['in_progress'], to: 'completed' },
    cancel: { from: ['assigned', 'arriving', 'arrived'], to: 'cancelled' },
  };
  const t = transitions[action];
  if (!t) throw httpError(400, 'Unknown ride action');
  if (!t.from.includes(booking.status))
    throw httpError(409, `Cannot ${action} a ride that is "${booking.status}".`);

  if (action === 'start') {
    if (!rideOtp || rideOtp !== booking.ride_otp)
      throw httpError(400, 'Incorrect ride OTP. Ask the passenger for the 4-digit code shown on their screen.');
  }

  if (action === 'complete') {
    return completeRide(driverProfile, booking);
  }
  if (action === 'cancel') {
    return cancelRide(booking, { byUserId: driverProfile.user_id, byRole: 'driver', reason: 'Cancelled by driver' });
  }

  const sets = {
    arriving: `status='arriving'`,
    arrived: `status='arrived', arrived_at=now()`,
    start: `status='in_progress', started_at=now()`,
  };
  const { rows } = await query(
    `UPDATE bookings SET ${sets[action]}, updated_at=now() WHERE id=$1 RETURNING *`, [bookingId]
  );
  await query(`INSERT INTO ride_events (booking_id, status, actor_id) VALUES ($1,$2,$3)`,
    [bookingId, t.to, driverProfile.user_id]);

  const updated = rows[0];
  const view = await serializeBooking(await getBooking(bookingId), { id: driverProfile.user_id, role: 'driver' });
  socket.emitToBooking(bookingId, 'ride:status', view);
  socket.emitToUser(updated.passenger_id, 'ride:status', view);

  const passengerMsgs = {
    arriving: { title: 'Auto arriving', body: 'Your driver is on the way to the pickup point.' },
    arrived: { title: 'Driver arrived', body: 'Your auto has arrived at the pickup point.' },
    start: { title: 'Ride started', body: 'Your ride has started. Have a safe trip!' },
  };
  if (passengerMsgs[action]) {
    await notify(updated.passenger_id, {
      type: `ride_${action}`, ...passengerMsgs[action],
      data: { bookingId, url: `/app/ride/${bookingId}` },
    });
  }
  return view;
}

/** Complete: timestamp-based waiting, final fare, earnings, free driver */
async function completeRide(driverProfile, booking) {
  const pricing = await fareSvc.getPricing(booking.city_id, booking.vehicle_type);
  if (!pricing) throw httpError(500, 'Pricing configuration missing for this ride.');

  const waitingMinutes = booking.arrived_at && booking.started_at
    ? Math.max(0, Math.round((new Date(booking.started_at) - new Date(booking.arrived_at)) / 60000))
    : 0;

  const fare = fareSvc.computeFare(pricing, {
    distanceKm: parseFloat(booking.distance_km),
    durationMin: booking.duration_min,
    waitingMinutes,
    at: booking.started_at ? new Date(booking.started_at) : new Date(booking.created_at),
  });

  const commissionPct = (await settingsSvc.getSetting('commission_percent')) || 0;
  const gross = fare.total;
  const commission = round2((gross * commissionPct) / 100);
  const net = round2(gross - commission);

  const updated = await withTransaction(async (tx) => {
    const b = (await tx.query(
      `UPDATE bookings
          SET status='completed', completed_at=now(), updated_at=now(),
              waiting_minutes=$2, final_fare=$3,
              fare_breakdown = $4::jsonb
        WHERE id=$1 AND status='in_progress'
        RETURNING *`,
      [booking.id, waitingMinutes, gross, JSON.stringify(fare)]
    )).rows[0];
    await tx.query(
      `UPDATE driver_profiles
          SET current_booking_id=NULL, rides_completed=rides_completed+1,
              total_earnings=total_earnings+$2, updated_at=now()
        WHERE id=$1`, [driverProfile.id, net]
    );
    await tx.query(
      `INSERT INTO driver_earnings (driver_profile_id, booking_id, gross, commission, net)
       VALUES ($1,$2,$3,$4,$5)`,
      [driverProfile.id, booking.id, gross, commission, net]
    );
    await tx.query(
      `INSERT INTO ride_events (booking_id, status, actor_id) VALUES ($1,'completed',$2)`,
      [booking.id, driverProfile.user_id]
    );
    return b;
  });

  const view = await serializeBooking(await getBooking(booking.id), { id: driverProfile.user_id, role: 'driver' });
  socket.emitToBooking(booking.id, 'ride:status', view);
  socket.emitToUser(updated.passenger_id, 'ride:status', view);
  await notify(updated.passenger_id, {
    type: 'ride_completed', title: 'Ride completed',
    body: `Total fare ₹${gross}. Please pay and rate your ride.`,
    data: { bookingId: booking.id, url: `/app/ride/${booking.id}` },
  });
  await notify(driverProfile.user_id, {
    type: 'ride_completed', title: 'Ride completed',
    body: `You earned ₹${net} (after ₹${commission} platform fee).`,
    data: { bookingId: booking.id, url: '/driver' },
  });
  return view;
}

/** Cancellation (passenger, driver or admin) */
async function cancelRide(booking, { byUserId, byRole, reason }) {
  if (!['searching', 'scheduled', 'assigned', 'arriving', 'arrived'].includes(booking.status)) {
    throw httpError(409, `Cannot cancel a ride that is "${booking.status}".`);
  }
  const wasAssigned = Boolean(booking.driver_profile_id);
  const feeApplies = byRole === 'passenger' && wasAssigned;

  const updated = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `UPDATE bookings
          SET status='cancelled', cancelled_at=now(), cancelled_by=$2,
              cancellation_reason=$3, updated_at=now(),
              cancellation_fee = CASE WHEN $4 THEN COALESCE($5, 0) ELSE 0 END
        WHERE id=$1 AND status = $6
        RETURNING *`,
      [booking.id, byUserId, reason || null, feeApplies,
       await settingsSvc.getSetting('cancellation_fee_after_accept'), booking.status]
    );
    if (!rows.length) throw httpError(409, 'Ride state changed, try refreshing.');
    if (wasAssigned) {
      await tx.query(
        `UPDATE driver_profiles
            SET current_booking_id=NULL,
                rides_cancelled = rides_cancelled + CASE WHEN $2='driver' THEN 1 ELSE 0 END
          WHERE id=$1`,
        [booking.driver_profile_id, byRole]
      );
    }
    await tx.query(
      `INSERT INTO ride_events (booking_id, status, actor_id, note) VALUES ($1,'cancelled',$2,$3)`,
      [booking.id, byUserId, reason || `cancelled by ${byRole}`]
    );
    return rows[0];
  });

  socket.emitToBooking(booking.id, 'ride:cancelled', {
    bookingId: booking.id, status: 'cancelled', cancelledBy: byRole, reason,
  });
  socket.emitToAllDrivers('ride:request-cancelled', { bookingId: booking.id, reason: 'cancelled' });

  // notify the other party
  if (byRole !== 'passenger') {
    await notify(booking.passenger_id, {
      type: 'ride_cancelled', title: 'Ride cancelled',
      body: reason || `Your ride was cancelled by the ${byRole}. Any amount paid will be refunded.`,
      data: { bookingId: booking.id, url: `/app/ride/${booking.id}` },
    });
  }
  if (byRole !== 'driver' && booking.driver_profile_id) {
    const dp = await one(`SELECT user_id FROM driver_profiles WHERE id=$1`, [booking.driver_profile_id]);
    if (dp) await notify(dp.user_id, {
      type: 'ride_cancelled', title: 'Booking cancelled by passenger',
      body: reason || 'The passenger cancelled this booking.',
      data: { bookingId: booking.id, url: '/driver' },
    });
  }
  return serializeBooking(await getBooking(updated.id), { id: byUserId, role: byRole });
}

/** Scheduler: dispatch scheduled rides whose time has come */
async function dispatchDueScheduled() {
  const due = (await query(
    `UPDATE bookings SET status='searching', updated_at=now()
      WHERE status='scheduled' AND scheduled_at <= now()
      RETURNING *`
  )).rows;
  for (const b of due) {
    await query(`INSERT INTO ride_events (booking_id, status) VALUES ($1,'searching')`, [b.id]);
    await dispatchToDrivers(b);
    await notify(b.passenger_id, {
      type: 'ride_searching', title: 'Finding your auto…',
      body: 'Your scheduled ride is now being matched with nearby drivers.',
      data: { bookingId: b.id, url: `/app/ride/${b.id}` },
    });
  }
  return due.length;
}

/** Scheduler: expire unanswered searches so passengers can retry */
async function expireStaleSearches() {
  const timeoutSec = (await settingsSvc.getSetting('driver_request_timeout_sec')) || 120;
  const stale = (await query(
    `UPDATE bookings SET status='expired', updated_at=now()
      WHERE status='searching' AND created_at < now() - ($1 || ' seconds')::interval
      RETURNING *`, [String(timeoutSec)]
  )).rows;
  for (const b of stale) {
    await query(`INSERT INTO ride_events (booking_id, status) VALUES ($1,'expired')`, [b.id]);
    await notify(b.passenger_id, {
      type: 'ride_expired', title: 'No autos found',
      body: 'No driver accepted your request in time. Please try booking again.',
      data: { bookingId: b.id, url: '/app/book' },
    });
  }
  return stale.length;
}

/** Open requests a driver can still accept (polling fallback for the socket push).
 *  A driver may be on another screen, backgrounded, or reconnected when the
 *  request is broadcast — polling guarantees they still see it. */
async function availableRequests(driverProfile) {
  if (!driverProfile.is_online) return [];
  if (driverProfile.verification_status !== 'approved') return [];
  if (driverProfile.current_booking_id) return [];
  const radius = await settingsSvc.getSetting('search_radius_km');
  const loc = await one(
    `SELECT lat, lng FROM driver_locations WHERE driver_profile_id=$1 AND updated_at > now() - interval '10 minutes'`,
    [driverProfile.id]
  );
  if (!loc) return [];
  const vehicleType = await one(
    `SELECT vehicle_type FROM vehicles WHERE driver_profile_id=$1 AND is_primary LIMIT 1`,
    [driverProfile.id]
  );
  const rows = await many(
    `SELECT b.id, b.ref, b.vehicle_type, b.pickup_lat, b.pickup_lng, b.pickup_address,
            b.drop_lat, b.drop_lng, b.drop_address, b.distance_km, b.duration_min,
            b.estimated_fare, b.fare_breakdown, b.created_at,
            (${HAVERSINE('b.pickup_lat', 'b.pickup_lng', '$2', '$3')}) AS driver_distance_km
       FROM bookings b
      WHERE b.status = 'searching'
        AND b.driver_profile_id IS NULL
        AND b.created_at > now() - interval '10 minutes'
        AND ($4::text IS NULL OR b.vehicle_type = $4)
        AND (${HAVERSINE('b.pickup_lat', 'b.pickup_lng', '$2', '$3')}) <= $1
      ORDER BY b.created_at ASC LIMIT 20`,
    [radius, loc.lat, loc.lng, vehicleType ? vehicleType.vehicle_type : null]
  );
  return rows.map((b) => ({
    bookingId: b.id,
    ref: b.ref,
    vehicleType: b.vehicle_type,
    pickup: { lat: parseFloat(b.pickup_lat), lng: parseFloat(b.pickup_lng), address: b.pickup_address },
    drop: { lat: parseFloat(b.drop_lat), lng: parseFloat(b.drop_lng), address: b.drop_address },
    distanceKm: parseFloat(b.distance_km),
    driverDistanceKm: Math.round(parseFloat(b.driver_distance_km) * 100) / 100,
    estimatedFare: parseFloat(b.estimated_fare),
    fareBreakdown: b.fare_breakdown,
    durationMin: b.duration_min,
    createdAt: b.created_at,
  }));
}

module.exports = {
  serializeBooking, getBooking, nearbyDrivers, quote, createBooking,
  dispatchToDrivers, acceptRide, driverAction, cancelRide,
  dispatchDueScheduled, expireStaleSearches, availableRequests,
};
