/* Supabase Realtime helpers — the replacement for the socket.io rooms.
 *
 * The old server pushed:
 *   ride:status, ride:assigned, ride:cancelled, ride:driver-location,
 *   chat:message, notification:new
 * over socket.io. Supabase Realtime gives the same thing from the database:
 *
 *   • postgres_changes on `bookings`      → ride:status / ride:assigned / cancelled
 *   • postgres_changes on `driver_locations` → ride:driver-location
 *   • postgres_changes on `booking_messages` → chat:message
 *   • postgres_changes on `notifications`  → notification:new
 *
 * Every subscription is unsubscribed when the page unmounts, so the
 * channel is closed when the rider leaves the ride screen.
 */
import { supabase } from './supabase';

const asChannel = (name) => `ride:${name}`;

/** Live updates for one ride. Returns an unsubscribe function. */
export function subscribeToRide(bookingId, handlers = {}) {
  const channel = supabase
    .channel(asChannel(bookingId))
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'bookings',
      filter: `id=eq.${bookingId}`,
    }, (payload) => {
      const booking = payload.new || payload.old;
      if (!booking) return;
      if (booking.status === 'cancelled') handlers.onCancelled?.(booking);
      else if (booking.driver_profile_id && !booking.assigned_at) handlers.onAssigned?.(booking);
      else handlers.onStatus?.(booking);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'booking_messages',
      filter: `booking_id=eq.${bookingId}`,
    }, (payload) => handlers.onMessage?.(payload.new))
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'driver_locations',
    }, (payload) => {
      // only the driver of this ride moves
      if (!handlers.onDriverLocation) return;
      handlers.onDriverLocation(payload.new);
    });

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** The signed-in user's notifications. */
export function subscribeToNotifications(userId, onNew) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, (payload) => onNew(payload.new));

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** Live positions of every driver on the map. */
export function subscribeToDriverLocations(onLocation) {
  const channel = supabase
    .channel('driver-locations')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'driver_locations',
    }, (payload) => onLocation(payload.new));

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** New ride requests for a driver who is online. */
export function subscribeToRideRequests(onRequest) {
  const channel = supabase
    .channel('ride-requests')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'bookings',
      filter: 'status=eq.searching',
    }, (payload) => onRequest(payload.new));

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}
