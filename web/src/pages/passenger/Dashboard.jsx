import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CarTaxiFront, MapPin, Heart, History, ChevronRight, Navigation, Clock, Wallet } from 'lucide-react';
import MapView from '../../components/MapView';
import { api, fmtINR, fmtDateTime } from '../../api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import { useSocket } from '../../context/SocketContext';

export default function PassengerDashboard() {
  const { user } = useAuth();
  const [nearby, setNearby] = useState([]);
  const [active, setActive] = useState(null);
  const [recent, setRecent] = useState([]);
  const [saved, setSaved] = useState([]);
  const [me, setMe] = useState(null);
  const { subscribe } = useSocket();

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, []);

  useEffect(() => {
    const load = () => {
      api.get('/api/bookings/active').then((r) => setActive(r.booking)).catch(() => {});
      api.get('/api/bookings/mine?limit=5').then((r) => setRecent(r.bookings)).catch(() => {});
      api.get('/api/saved-locations').then(setSaved).catch(() => {});
    };
    load();
    const off = subscribe('ride:status', load);
    const off2 = subscribe('ride:assigned', load);
    return () => { off(); off2(); };
  }, [subscribe]);

  useEffect(() => {
    const load = async () => {
      if (!me) return;
      try {
        const res = await api.get(`/api/bookings/nearby-drivers?lat=${me.lat}&lng=${me.lng}`);
        setNearby(res.drivers);
      } catch { /* empty state is honest */ }
    };
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [me?.lat, me?.lng]);

  const markers = [
    ...(me ? [{ lat: me.lat, lng: me.lng, type: 'passenger' }] : []),
    ...nearby.map((d) => ({ lat: d.lat, lng: d.lng, type: 'driver' })),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      {/* Welcome */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">
            {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-slate-500">Need an auto right now?</p>
        </div>
        <Link to="/app/book" className="btn-primary px-6 py-3">
          <CarTaxiFront className="h-5 w-5" /> Book an auto
        </Link>
      </div>

      {/* active ride banner */}
      {active && (
        <Link to={`/app/ride/${active.id}`} className="card flex items-center gap-4 border-brand-300 bg-brand-50 p-4 dark:border-brand-800 dark:bg-brand-900/20">
          <span className="relative flex h-3 w-3">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-brand-500 opacity-60" />
            <span className="h-3 w-3 rounded-full bg-brand-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Ride {active.ref} · <StatusBadge status={active.status} /></p>
            <p className="truncate text-sm text-slate-600 dark:text-slate-300">{active.pickup.address} → {active.drop.address}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-brand-600" />
        </Link>
      )}

      {/* map + nearby */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-4 pt-4">
            <p className="flex items-center gap-1.5 text-sm font-bold"><MapPin className="h-4 w-4 text-brand-600" /> Autos near you</p>
            <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              {nearby.length} online
            </span>
          </div>
          <div className="h-72">
            {me ? (
              <MapView center={{ lat: me.lat, lng: me.lng, zoom: 14 }} markers={markers} interactive />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
                <MapPin className="h-8 w-8" />
                <p>Allow location access to see nearby autos on the map</p>
                <button className="btn-secondary" onClick={() => window.location.reload()}>Enable location</button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* saved places */}
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-bold"><Heart className="h-4 w-4 text-rose-500" /> Saved places</p>
              <Link to="/app/locations" className="link text-xs">manage</Link>
            </div>
            {saved.length === 0 && <p className="py-3 text-sm text-slate-400">No saved places yet</p>}
            {saved.slice(0, 3).map((s) => (
              <Link key={s.id} to="/app/book" className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                <MapPin className="h-4 w-4 text-brand-600" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.label}</p>
                  <p className="truncate text-xs text-slate-400">{s.address}</p>
                </div>
              </Link>
            ))}
          </div>

          {/* quick stats */}
          <div className="card grid grid-cols-2 gap-3 p-4">
            <Link to="/app/history" className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <History className="h-5 w-5 text-brand-600" />
              <span className="text-sm font-bold">{recent.length ? `${recent.length}+ rides` : 'No rides'}</span>
            </Link>
            <Link to="/app/payments" className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <Wallet className="h-5 w-5 text-brand-600" />
              <span className="text-sm font-bold">Payments</span>
            </Link>
          </div>
        </div>
      </div>

      {/* recent rides */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-bold"><Clock className="h-4 w-4 text-brand-600" /> Recent rides</p>
          <Link to="/app/history" className="link text-xs">view all</Link>
        </div>
        {recent.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-400">You haven't booked any autos yet</p>
            <Link to="/app/book" className="btn-primary mt-3">Book your first ride</Link>
          </div>
        )}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {recent.map((b) => (
            <Link key={b.id} to={b.status === 'completed' ? `/app/ride/${b.id}` : `/app/ride/${b.id}`} className="flex items-center gap-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <Navigation className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{b.pickup.address.split(',')[0]} → {b.drop.address.split(',')[0]}</p>
                <p className="text-xs text-slate-400">{fmtDateTime(b.createdAt)}</p>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-bold">{fmtINR(b.finalFare ?? b.estimatedFare)}</p>
                <StatusBadge status={b.status} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
