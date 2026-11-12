/* Socket.IO real-time layer. JWT-authenticated. Exposed helpers let the
   REST layer push events into rooms without circular imports. */
const { Server } = require('socket.io');
const config = require('./config');
const jwt = require('jsonwebtoken');
const { one, query } = require('./db');

let io = null;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    path: '/socket.io/',
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('auth required'));
      const payload = jwt.verify(token, config.jwtSecret);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error('invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, role } = socket.data;
    socket.join(`user:${userId}`);
    if (role === 'driver') socket.join('drivers');

    // ── Driver: live location stream ─────────────────────────
    if (role === 'driver') {
      socket.on('driver:location', async (loc, ack) => {
        try {
          if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') throw new Error('bad payload');
          const dp = await one(
            `UPDATE driver_locations
                SET lat=$2, lng=$3, heading=$4, accuracy_m=$5, updated_at=now()
              WHERE driver_profile_id=$1 RETURNING driver_profile_id`,
            [ (await one(`SELECT id FROM driver_profiles WHERE user_id=$1`, [userId])).id,
              loc.lat, loc.lng, loc.heading ?? null, loc.accuracy ?? null ]
          );
          if (!dp) {
            await query(
              `INSERT INTO driver_locations (driver_profile_id, lat, lng, heading, accuracy_m)
               SELECT id,$2,$3,$4,$5 FROM driver_profiles WHERE user_id=$1
               ON CONFLICT (driver_profile_id) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, heading=EXCLUDED.heading, updated_at=now()`,
              [userId, loc.lat, loc.lng, loc.heading ?? null, loc.accuracy ?? null]
            );
          }
          // Broadcast to the driver's active booking room so the passenger
          // sees the approach live
          const active = await one(
            `SELECT current_booking_id AS id FROM driver_profiles WHERE user_id=$1`,
            [userId]
          );
          if (active && active.id) {
            socket.to(`booking:${active.id}`).emit('ride:driver-location', {
              lat: loc.lat, lng: loc.lng, heading: loc.heading ?? null, at: Date.now(),
            });
          }
          if (typeof ack === 'function') ack({ ok: true });
        } catch (err) {
          if (typeof ack === 'function') ack({ ok: false });
        }
      });
    }

    // ── Ride chat ────────────────────────────────────────────
    socket.on('chat:send', async (msg, ack) => {
      try {
        const { bookingId, body } = msg || {};
        if (!bookingId || !body || typeof body !== 'string' || body.length > 1000) throw new Error('bad payload');
        const b = await one(
          `SELECT id, passenger_id, driver_profile_id FROM bookings WHERE id=$1`, [bookingId]
        );
        if (!b) throw new Error('booking not found');
        let isMember = b.passenger_id === userId;
        if (!isMember && b.driver_profile_id) {
          const dp = await one(`SELECT user_id FROM driver_profiles WHERE id=$1`, [b.driver_profile_id]);
          isMember = dp && dp.user_id === userId;
        }
        if (!isMember) throw new Error('not a member of this ride');
        const { rows } = await query(
          `INSERT INTO booking_messages (booking_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *`,
          [bookingId, userId, body.trim()]
        );
        io.to(`booking:${bookingId}`).emit('chat:message', rows[0]);
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        if (typeof ack === 'function') ack({ ok: false });
      }
    });

    // Join a booking room (passenger or assigned driver)
    socket.on('booking:join', async (bookingId, ack) => {
      try {
        const b = await one(
          `SELECT id, passenger_id, driver_profile_id FROM bookings WHERE id=$1`, [bookingId]
        );
        if (!b) throw new Error('not found');
        let ok = b.passenger_id === userId;
        if (!ok && b.driver_profile_id) {
          const dp = await one(`SELECT user_id FROM driver_profiles WHERE id=$1`, [b.driver_profile_id]);
          ok = dp && dp.user_id === userId;
        }
        if (!ok && socket.data.role === 'admin') ok = true;
        if (!ok) throw new Error('forbidden');
        socket.join(`booking:${bookingId}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        if (typeof ack === 'function') ack({ ok: false });
      }
    });
  });

  console.log('✔ Socket.IO ready');
  return io;
}

const emitToUser = (userId, event, payload) => { if (io) io.to(`user:${userId}`).emit(event, payload); };
const emitToBooking = (bookingId, event, payload) => { if (io) io.to(`booking:${bookingId}`).emit(event, payload); };
const emitToDriverProfile = async (driverProfileId, event, payload) => {
  if (!io) return;
  const dp = await one(`SELECT user_id FROM driver_profiles WHERE id=$1`, [driverProfileId]);
  if (dp) io.to(`user:${dp.user_id}`).emit(event, payload);
};
const emitToDrivers = async (driverProfileIds, event, payload) => {
  if (!io || !driverProfileIds?.length) return;
  const { rows } = await query(`SELECT user_id FROM driver_profiles WHERE id = ANY($1)`, [driverProfileIds]);
  for (const r of rows) io.to(`user:${r.user_id}`).emit(event, payload);
};
const emitToAllDrivers = (event, payload) => { if (io) io.to('drivers').emit(event, payload); };

module.exports = { init, emitToUser, emitToBooking, emitToDriverProfile, emitToDrivers, emitToAllDrivers, getIo: () => io };
