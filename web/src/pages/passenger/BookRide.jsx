import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpDown, CalendarClock, Loader2, MapPin, Navigation, Radio, Search, ShieldCheck, Zap } from 'lucide-react';
import MapView from '../../components/MapView';
import LocationSearch from '../../components/LocationSearch';
import FareBreakdown from '../../components/FareBreakdown';
import { api, fmtINR } from '../../api';
import { useToast } from '../../context/ToastContext';

const VEHICLE_TYPES = [
  { key: 'auto', label: 'Auto-rickshaw', emoji: '🛺', desc: 'Up to 3 passengers' },
  { key: 'e_rickshaw', label: 'E-rickshaw', emoji: '🛺', desc: 'Eco-friendly, up to 4' },
];

export default function BookRide() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [me, setMe] = useState(null);
  const [vehicleType, setVehicleType] = useState('auto');
  const [bookingType, setBookingType] = useState('immediate');
  const [scheduledAt, setScheduledAt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [nearby, setNearby] = useState([]);
  const [mapMode, setMapMode] = useState(null); // 'pickup' | 'drop'
  const [mapCenter, setMapCenter] = useState(null);
  const pollRef = useRef(null);

  // initial location
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMe(p);
        setMapCenter({ ...p, zoom: 14 });
        api.get(`/api/geo/reverse?lat=${p.lat}&lng=${p.lng}`)
          .then((r) => setPickup({ ...p, address: r?.label || r?.secondary || 'Current location' }))
          .catch(() => setPickup({ ...p, address: 'Current location' }));
      },
      () => { setMapCenter({ lat: 12.9716, lng: 77.5946, zoom: 12 }); },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }, []);

  // nearby drivers polling (real data only)
  useEffect(() => {
    const load = async () => {
      if (!pickup) return;
      try {
        const res = await api.get(`/api/bookings/nearby-drivers?lat=${pickup.lat}&lng=${pickup.lng}&vehicleType=${vehicleType}`);
        setNearby(res.drivers);
      } catch { /* keep last */ }
    };
    load();
    pollRef.current = setInterval(load, 10000);
    return () => clearInterval(pollRef.current);
  }, [pickup?.lat, pickup?.lng, vehicleType]);

  useEffect(() => {
    if (!pickup || !drop) { setQuote(null); return; }
    setQuoting(true);
    api.post('/api/bookings/quote', {
      pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address },
      drop: { lat: drop.lat, lng: drop.lng, address: drop.address },
      vehicleType,
      scheduledAt: bookingType === 'scheduled' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
    })
      .then((q) => setQuote(q))
      .catch((err) => { setQuote(null); toast(err.message, 'error', 7000); })
      .finally(() => setQuoting(false));
  }, [pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, vehicleType, scheduledAt, bookingType]);

  const onMapClick = useCallback(async (lat, lng) => {
    if (!mapMode) return;
    try {
      const r = await api.get(`/api/geo/reverse?lat=${lat}&lng=${lng}`);
      const point = { lat, lng, address: r?.label || r?.secondary || `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
      if (mapMode === 'pickup') setPickup(point); else setDrop(point);
    } catch {
      const point = { lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
      if (mapMode === 'pickup') setPickup(point); else setDrop(point);
    }
    setMapMode(null);
  }, [mapMode]);

  const markers = useMemo(() => {
    const m = [];
    if (pickup) m.push({ lat: pickup.lat, lng: pickup.lng, type: 'from' });
    if (drop) m.push({ lat: drop.lat, lng: drop.lng, type: 'to' });
    if (!drop) for (const d of nearby) m.push({ lat: d.lat, lng: d.lng, type: 'driver', busy: false });
    if (!pickup && me) m.push({ lat: me.lat, lng: me.lng, type: 'passenger' });
    return m;
  }, [pickup, drop, nearby, me]);

  const confirmBooking = async () => {
    if (!pickup || !drop) return;
    if (bookingType === 'scheduled' && !scheduledAt) return toast('Pick a date & time for the scheduled ride', 'error');
    setConfirming(true);
    try {
      const booking = await api.post('/api/bookings', {
        pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address },
        drop: { lat: drop.lat, lng: drop.lng, address: drop.address },
        vehicleType, bookingType,
        scheduledAt: bookingType === 'scheduled' ? new Date(scheduledAt).toISOString() : undefined,
      });
      toast(booking.status === 'scheduled' ? 'Ride scheduled!' : 'Searching for autos near you…', 'success');
      navigate(`/app/ride/${booking.id}`);
    } catch (err) {
      toast(err.message, 'error', 6000);
      if (err.extra?.bookingId) navigate(`/app/ride/${err.extra.bookingId}`);
    } finally { setConfirming(false); }
  };

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Panel */}
      <div className="flex w-full shrink-0 flex-col overflow-auto border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:w-[420px] lg:border-b-0 lg:border-r lg:p-5">
        <h1 className="mb-4 text-xl font-extrabold">Book an auto</h1>

        <div className="space-y-3">
          <div>
            <label className="label flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-emerald-500" /> Pickup</label>
            <LocationSearch
              value={pickup} onChange={(p) => setPickup(p)} placeholder="Where are you?"
              near={me ? [me.lat, me.lng] : undefined}
            />
          </div>
          <div>
            <label className="label flex items-center gap-1.5"><Navigation className="h-3.5 w-3.5 text-red-500" /> Destination</label>
            <LocationSearch
              value={drop} onChange={(p) => setDrop(p)} placeholder="Where to?"
              near={pickup ? [pickup.lat, pickup.lng] : me ? [me.lat, me.lng] : undefined}
            />
          </div>
        </div>

        {/* vehicle type */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {VEHICLE_TYPES.map((v) => (
            <button
              key={v.key}
              onClick={() => setVehicleType(v.key)}
              className={`rounded-xl border-2 p-3 text-left transition-all ${
                vehicleType === v.key
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
              }`}
            >
              <p className="text-lg">{v.emoji}</p>
              <p className="text-sm font-bold">{v.label}</p>
              <p className="text-xs text-slate-500">{v.desc}</p>
            </button>
          ))}
        </div>

        {/* booking type */}
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {[
            { key: 'immediate', label: 'Ride now', icon: Zap },
            { key: 'scheduled', label: 'Schedule', icon: CalendarClock },
          ].map((b) => (
            <button
              key={b.key}
              onClick={() => setBookingType(b.key)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all ${
                bookingType === b.key ? 'bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500'
              }`}
            >
              <b.icon className="h-4 w-4" /> {b.label}
            </button>
          ))}
        </div>
        {bookingType === 'scheduled' && (
          <div className="mt-3">
            <label className="label">Pickup date & time</label>
            <input
              type="datetime-local" className="input"
              min={new Date(Date.now() + 15 * 60000).toISOString().slice(0, 16)}
              value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        )}

        {/* map pick helpers */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setMapMode(mapMode === 'pickup' ? null : 'pickup')}
            className={`btn-secondary flex-1 py-2 text-xs ${mapMode === 'pickup' ? 'border-brand-500 text-brand-700' : ''}`}
          >
            {mapMode === 'pickup' ? 'Click on map…' : 'Set pickup on map'}
          </button>
          <button
            onClick={() => setMapMode(mapMode === 'drop' ? null : 'drop')}
            className={`btn-secondary flex-1 py-2 text-xs ${mapMode === 'drop' ? 'border-brand-500 text-brand-700' : ''}`}
          >
            {mapMode === 'drop' ? 'Click on map…' : 'Set drop on map'}
          </button>
        </div>

        {/* quote / fare */}
        <div className="mt-5">
          {quoting && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-4 text-sm text-slate-500 dark:bg-slate-800">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculating road distance &amp; fare…
            </div>
          )}
          {quote && !quoting && (
            <div className="animate-slide-up space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm dark:bg-slate-800">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Radio className="h-4 w-4 text-brand-600" /> {quote.city.name}
                </span>
                <span className="tabular font-semibold">
                  {quote.distanceKm} km · ~{quote.durationMin} min
                </span>
              </div>
              {quote.routeSource === 'estimate' && (
                <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Live road routing is unreachable right now — distance and fare are straight-line estimates.
                </p>
              )}
              <FareBreakdown fare={quote.fare} title={`Fare estimate (${quote.city.name})`} />
              {nearby.length > 0 ? (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-500 opacity-60" />
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  {nearby.length} auto{nearby.length > 1 ? 's' : ''} nearby right now
                </p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No autos show nearby yet — you can still book; we'll search when you confirm.
                </p>
              )}
              <button
                className="btn-primary w-full py-3.5 text-base"
                onClick={confirmBooking}
                disabled={confirming || (bookingType === 'scheduled' && !scheduledAt)}
              >
                {confirming ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                {bookingType === 'scheduled' ? 'Schedule ride' : `Confirm · ${fmtINR(quote.fare.total)}`}
              </button>
              <p className="text-center text-[11px] text-slate-400">
                Fare may adjust for actual waiting time after arrival. No surge surprises.
              </p>
            </div>
          )}
          {!quote && !quoting && pickup && !drop && (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400 dark:border-slate-700">
              <Search className="mx-auto mb-1 h-5 w-5" />
              Choose your destination to see the road distance and exact fare.
            </p>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="relative min-h-[320px] flex-1">
        <MapView
          center={mapCenter}
          markers={markers}
          route={quote?.geometry}
          onMapClick={onMapClick}
        />
        {mapMode && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-full bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-lg">
            Tap the map to set {mapMode === 'pickup' ? 'pickup' : 'drop'}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-4 left-4 z-[500] rounded-xl bg-white/95 px-3 py-2 text-xs font-medium text-slate-600 shadow-lg dark:bg-slate-900/95 dark:text-slate-300">
          🛺 available drivers · <span className="text-emerald-600 font-bold">●</span> you · <span className="text-red-500 font-bold">▲</span> drop
        </div>
      </div>
    </div>
  );
}
