import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapPin, Navigation, Phone, CarTaxiFront, ShieldCheck, Clock, ArrowLeft } from 'lucide-react';
import { api, fmtDateTime } from '../api';
import MapView from '../components/MapView';
import StatusBadge from '../components/StatusBadge';
import { LogoMark } from '../components/DashboardLayout';

/** Public “follow my ride” page — minimal data, no login required. */
export default function TrackPublic() {
  const { token } = useParams();
  const [trip, setTrip] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const t = await api.get(`/api/bookings/share/${token}`);
        if (alive) { setTrip(t); setError(''); }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const timer = setInterval(load, 8000); // live refresh
    return () => { alive = false; clearInterval(timer); };
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <LogoMark size={48} />
        <h1 className="text-xl font-extrabold">Trip link not found</h1>
        <p className="max-w-sm text-sm text-slate-500">{error}</p>
        <Link to="/" className="btn-primary"><ArrowLeft className="h-4 w-4" /> Go to Sawaari</Link>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-600 border-t-transparent" />
        <p className="text-sm text-slate-400">Loading trip…</p>
      </div>
    );
  }

  const active = ['assigned', 'arriving', 'arrived', 'in_progress'].includes(trip.status);

  const markers = [];
  if (trip.pickup?.lat) markers.push({ lat: trip.pickup.lat, lng: trip.pickup.lng, type: 'from' });
  if (trip.drop?.lat) markers.push({ lat: trip.drop.lat, lng: trip.drop.lng, type: 'to' });
  if (trip.driverLoc && active) markers.push({ lat: trip.driverLoc.lat, lng: trip.driverLoc.lng, type: 'driver' });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark size={28} />
          <span className="font-extrabold">Sawaari</span>
        </Link>
        <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <ShieldCheck className="h-3.5 w-3.5" /> Live trip sharing
        </span>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="card h-64 overflow-hidden sm:h-80">
          <MapView
            center={{ lat: trip.pickup?.lat || 12.9716, lng: trip.pickup?.lng || 77.5946, zoom: 13 }}
            markers={markers}
            interactive
          />
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-extrabold">
              {trip.driverFirstName ? `${trip.driverFirstName}'s ride` : 'Sawaari ride'} · {trip.ref}
            </h1>
            <StatusBadge status={trip.status} />
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
              <p className="text-slate-600 dark:text-slate-300">{trip.pickup?.address}</p>
            </div>
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
              <p className="text-slate-600 dark:text-slate-300">{trip.drop?.address}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Navigation className="h-3.5 w-3.5" /> {trip.distanceKm} km trip</span>
            {trip.vehicle?.registrationNumber && (
              <span className="flex items-center gap-1"><CarTaxiFront className="h-3.5 w-3.5" /> {trip.vehicle.registrationNumber}</span>
            )}
            {trip.startedAt && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> started {fmtDateTime(trip.startedAt)}</span>}
            {trip.completedAt && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> completed {fmtDateTime(trip.completedAt)}</span>}
          </div>
        </div>

        {active && trip.driverPhone && (
          <a href={`tel:${trip.driverPhone}`} className="card flex items-center gap-3 border-brand-200 bg-brand-50 p-4 dark:border-brand-800 dark:bg-brand-900/20">
            <Phone className="h-5 w-5 text-brand-600" />
            <p className="text-sm font-semibold">Need something? Call the driver</p>
          </a>
        )}

        {!active && (
          <div className="card p-4 text-sm text-slate-500">
            {trip.status === 'completed' && '✅ This ride has been completed. Thanks for following along!'}
            {trip.status === 'cancelled' && 'This ride was cancelled.'}
            {['searching', 'scheduled'].includes(trip.status) && 'The passenger is still waiting for a driver to accept…'}
            {trip.status === 'expired' && 'No driver accepted this ride.'}
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 pb-4 text-xs text-slate-400">
          <MapPin className="h-3.5 w-3.5" /> Auto-refreshes every few seconds · powered by Sawaari
        </p>
      </main>
    </div>
  );
}
