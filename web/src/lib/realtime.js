/* Supabase Realtime — the live ride board.
 *
 * The rides table is in the `supabase_realtime` publication, so a simple
 * postgres_changes subscription pushes every status change to the rider, the
 * driver and the admin board.
 */
import { supabase } from './supabase';

/** Live updates for one ride. Returns an unsubscribe function. */
export function subscribeToRide(rideId, handlers = {}) {
  const channel = supabase
    .channel(`ride:${rideId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'rides',
      filter: `id=eq.${rideId}`,
    }, (payload) => {
      const ride = payload.new || payload.old;
      if (!ride) return;
      if (ride.status === 'cancelled') handlers.onCancelled?.(ride);
      else if (ride.status === 'accepted') handlers.onAccepted?.(ride);
      else handlers.onChange?.(ride);
    });

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** Every open request (the driver's live list). */
export function subscribeToOpenRides(onNew) {
  const channel = supabase
    .channel('open-rides')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'rides',
      filter: 'status=eq.requested',
    }, (payload) => onNew(payload.new));

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** The admin live board: every ride, any status. */
export function subscribeToAllRides(onChange) {
  const channel = supabase
    .channel('all-rides')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'rides',
    }, (payload) => onChange(payload.new));

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}
