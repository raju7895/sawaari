import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CarTaxiFront, Power, MapPin, Navigation, KeyRound, CheckCircle2, XCircle,
  Wallet, Star, Phone, MessageSquare, Loader2, ShieldAlert, ShieldCheck, UserX,
} from 'lucide-react';
import MapView from '../../components/MapView';
import Modal from '../../components/Modal';
import ChatPanel from '../../components/ChatPanel';
import FareBreakdown from '../../components/FareBreakdown';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import { StarDisplay } from '../../components/StarRating';
import { api, fmtINR } from '../../api';
import { useToast } from '../../context/ToastContext';
import { useSocket } from '../../context/SocketContext';

const RIDE_STEPS = ['assigned', 'arriving', 'arrived', 'in_progress'];

export default function DriverDashboard() {
  const toast = useToast();
  const { subscribe, emit, connected } = useSocket();
  const [me, setMe] = useState(null);
  const [activeRide, setActiveRide] = useState(null);
  const [requests, setRequests] = useState([]); // incoming ride:request payloads
  const [otpModal, setOtpModal] = useState(false);
  const [otp, setOtp] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [myLoc, setMyLoc] = useState(null);
  const [gpsBlocked, setGpsBlocked] = useState(false);
  const [pickLoc, setPickLoc] = useState(false);
  const watchRef = useRef(null);
  const lastSentRef = useRef(0);

  const loadMe = useCallback(async () => {
    try {
      const d = await api.get('/api/driver/me');
      setMe(d);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  const loadActive = useCallback(async () => {
    try {
      const res = await api.get('/api/bookings/active');
      setActiveRide(res.booking);
    } catch { /* non-driver */ }
  }, []);

  /* Poll for open requests. The socket push is the fast path, but a driver who
     is on another screen, backgrounded or reconnected would miss it. */
  const loadRequests = useCallback(async () => {
    try {
      const res = await api.get('/api/driver/requests');
      setRequests((cur) => {
        const live = res.requests || [];
        const liveIds = new Set(live.map((r) => r.bookingId));
        return [...live, ...cur.filter((r) => !liveIds.has(r.bookingId))];
      });
    } catch { /* ignore — the socket path still works */ }
  }, []);

  useEffect(() => { loadMe(); loadActive(); }, [loadMe, loadActive]);

  useEffect(() => {
    if (!me?.isOnline) return undefined;
    loadRequests();
    const t = setInterval(loadRequests, 8000);
    return () => clearInterval(t);
  }, [me?.isOnline, loadRequests]);

  /* ── live location streaming (socket preferred, REST fallback) ── */
  const pushLocation = useCallback((lat, lng, heading, accuracy) => {
    const now = Date.now();
    if (now - lastSentRef.current < 6000) return; // throttle to ~1 per 6s
    lastSentRef.current = now;
    emit('driver:location', { lat, lng, heading, accuracy }, (res) => {
      if (!res?.ok) {
        api.post('/api/driver/location', { lat, lng, heading, accuracy }).catch(() => {});
      }
    });
  }, [emit]);

  useEffect(() => {
    if (!me) return;
    if (!me.isOnline || !navigator.geolocation) {
      if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, accuracy } = pos.coords;
        setGpsBlocked(false);
        setMyLoc({ lat: latitude, lng: longitude });
        pushLocation(latitude, longitude, heading ?? undefined, accuracy ?? undefined);
      },
      (err) => {
        /* Permission denied / GPS unavailable — the driver can still work by
           dropping a pin on the map (below). */
        setGpsBlocked(err.code === 1 || err.code === 2);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    };
  }, [me?.isOnline, pushLocation]);

  /* Seed the map with the last known position so the driver isn't lost. */
  useEffect(() => {
    if (!myLoc && me?.lastLocation) {
      setMyLoc({ lat: me.lastLocation.lat, lng: me.lastLocation.lng });
    }
  }, [me?.lastLocation, myLoc]);

  /** Manual position: used when GPS is unavailable or denied. */
  const setManualLocation = (lat, lng) => {
    setMyLoc({ lat, lng });
    setPickLoc(false);
    lastSentRef.current = 0; // bypass the streaming throttle
    pushLocation(lat, lng);
  };

  /* ── socket wiring: requests + active ride updates ── */
  useEffect(() => {
    const offs = [
      subscribe('ride:request', (req) => {
        setRequests((cur) => (cur.some((r) => r.bookingId === req.bookingId) ? cur : [...cur, req]));
      }),
      subscribe('ride:request-cancelled', ({ bookingId }) => {
        setRequests((cur) => cur.filter((r) => r.bookingId !== bookingId));
      }),
      subscribe('ride:status', (b) => { if (activeRide?.id === b.id) setActiveRide(b); }),
      subscribe('ride:cancelled', ({ bookingId }) => {
        if (activeRide?.id === bookingId) {
          toast('Ride cancelled by the passenger', 'info');
          setActiveRide(null);
          loadMe();
        }
      }),
      subscribe('ride:driver-location', () => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [subscribe, activeRide?.id, toast, loadMe]);

  /* ── actions ── */
  const toggleOnline = async () => {
    try {
      await api.post('/api/driver/online', { online: !me.isOnline });
      toast(!me.isOnline ? 'You are online — requests will arrive here' : 'You are offline', 'success');
      loadMe();
    } catch (e) { toast(e.message, 'error'); }
  };

  const accept = async (bookingId) => {
    setBusyAction(bookingId);
    try {
      const ride = await api.post(`/api/driver/rides/${bookingId}/accept`, {});
      setRequests((cur) => cur.filter((r) => r.bookingId !== bookingId));
      setActiveRide(ride);
      toast('Ride accepted — head to the pickup point', 'success');
      loadMe();
    } catch (e) { toast(e.message, 'error'); } finally { setBusyAction(''); }
  };

  const reject = (bookingId) => {
    api.post(`/api/driver/rides/${bookingId}/reject`, {}).catch(() => {});
    setRequests((cur) => cur.filter((r) => r.bookingId !== bookingId));
  };

  const rideAction = async (action, extra = {}) => {
    setBusyAction(action);
    try {
      const ride = await api.post(`/api/driver/rides/${activeRide.id}/${action}`, extra);
      setActiveRide(ride);
      if (action === 'complete') {
        toast(`Ride completed — you earned ${fmtINR(ride.fareBreakdown?.total || ride.finalFare)}`, 'success');
        loadMe();
      } else {
        toast(action === 'start' ? 'Ride started' : `Marked ${action}`, 'success');
      }
      if (action === 'complete') setActiveRide(null);
    } catch (e) { toast(e.message, 'error'); } finally { setBusyAction(''); setOtpModal(false); setOtp(''); }
  };

  const stepIndex = activeRide ? RIDE_STEPS.indexOf(activeRide.status) : -1;
  const markers = [];
  if (myLoc) markers.push({ lat: myLoc.lat, lng: myLoc.lng, type: 'driver', label: 'You' });
  if (activeRide) {
    markers.push({ lat: activeRide.pickup.lat, lng: activeRide.pickup.lng, type: 'from' });
    markers.push({ lat: activeRide.drop.lat, lng: activeRide.drop.lng, type: 'to' });
  }

  /* verification gate */
  if (me && me.verificationStatus !== 'approved') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-6 pt-16 text-center">
        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${me.verificationStatus === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-extrabold">
          {me.verificationStatus === 'rejected' ? 'Verification unsuccessful' : 'Verification in progress'}
        </h1>
        <p className="text-sm text-slate-500">
          {me.verificationStatus === 'rejected'
            ? (me.rejectionReason || 'Your documents were not approved.')
            : 'Our team is reviewing your documents. You can go online once you are approved.'}
        </p>
        <Link to="/driver/profile" className="btn-primary">
          {me.verificationStatus === 'rejected' ? 'Update documents' : 'View submission status'}
        </Link>
      </div>
    );
  }

  if (!me) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      {/* status header */}
      <div className="card flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleOnline}
            className={`relative flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${
              me.isOnline ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'
            }`}
            title={me.isOnline ? 'Go offline' : 'Go online'}
          >
            <Power className="h-6 w-6" />
            {me.isOnline && <span className="absolute inset-0 animate-ping rounded-2xl bg-emerald-400 opacity-30" />}
          </button>
          <div>
            <p className="text-lg font-extrabold">{me.isOnline ? 'You are online' : 'You are offline'}</p>
            <p className="text-xs text-slate-500">
              {me.isOnline
                ? (connected ? 'Location streaming live · requests will pop up' : 'Connecting to live server…')
                : 'Go online to receive ride requests'}
            </p>
          </div>
        </div>
        <div className="ml-auto grid grid-cols-3 gap-2 text-center sm:gap-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Today</p>
            <p className="tabular text-sm font-extrabold text-emerald-600">{fmtINR(me.todayEarnings)}</p>
            <p className="text-[10px] text-slate-400">{me.todayRides} rides</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Rating</p>
            <div className="flex justify-center"><StarDisplay value={me.rating.avg} size={12} /></div>
            <p className="text-[10px] text-slate-400">{me.rating.count} reviews</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total</p>
            <p className="tabular text-sm font-extrabold">{fmtINR(me.totalEarnings)}</p>
            <p className="text-[10px] text-slate-400">{me.ridesCompleted} rides</p>
          </div>
        </div>
      </div>

      {/* active ride */}
      {activeRide && (
        <div className="card overflow-hidden border-brand-300 dark:border-brand-800">
          <div className="flex flex-wrap items-center gap-3 bg-brand-50 px-4 py-3 dark:bg-brand-900/20">
            <span className="relative flex h-3 w-3">
              <span className="absolute h-3 w-3 animate-ping rounded-full bg-brand-500 opacity-60" />
              <span className="h-3 w-3 rounded-full bg-brand-500" />
            </span>
            <p className="font-extrabold">Active ride · {activeRide.ref}</p>
            <StatusBadge status={activeRide.status} />
            <span className="ml-auto text-sm font-bold text-brand-700 dark:text-brand-300">
              {fmtINR(activeRide.finalFare ?? activeRide.estimatedFare)}
            </span>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              {/* passenger */}
              {activeRide.passenger && (
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                  <Avatar name={activeRide.passenger.name} src={activeRide.passenger.avatarUrl} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{activeRide.passenger.name}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <StarDisplay value={activeRide.passenger.rating} count={activeRide.passenger.ratingCount} size={11} />
                    </p>
                  </div>
                  <a href={`tel:${activeRide.passenger.phone}`} className="btn-secondary px-3 py-2">
                    <Phone className="h-4 w-4" /> Call
                  </a>
                  <button onClick={() => setChatOpen(!chatOpen)} className="btn-secondary px-3 py-2">
                    <MessageSquare className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* route */}
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                  <div>
                    <p className="font-semibold">{activeRide.pickup.address.split(',')[0]}</p>
                    <p className="text-xs text-slate-400">{activeRide.pickup.address}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                  <div>
                    <p className="font-semibold">{activeRide.drop.address.split(',')[0]}</p>
                    <p className="text-xs text-slate-400">{activeRide.drop.address}</p>
                  </div>
                </div>
                <p className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Navigation className="h-3.5 w-3.5" /> {activeRide.distanceKm} km</span>
                  <span>~{activeRide.durationMin} min</span>
                  <span>{activeRide.vehicleType === 'auto' ? 'Auto' : 'E-rickshaw'}</span>
                </p>
              </div>

              {/* progress + actions */}
              <div className="flex items-center gap-1.5">
                {RIDE_STEPS.map((s, i) => (
                  <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {activeRide.status === 'assigned' && (
                  <button className="btn-primary flex-1" disabled={busyAction === 'arriving'} onClick={() => rideAction('arriving')}>
                    <MapPin className="h-4 w-4" /> Start heading to pickup
                  </button>
                )}
                {(activeRide.status === 'assigned' || activeRide.status === 'arriving') && (
                  <button className="btn-secondary flex-1" disabled={busyAction === 'arrived'} onClick={() => rideAction('arrived')}>
                    <CheckCircle2 className="h-4 w-4" /> Arrived at pickup
                  </button>
                )}
                {(activeRide.status === 'assigned' || activeRide.status === 'arriving' || activeRide.status === 'arrived') && (
                  <button className="btn-primary flex-1" disabled={busyAction === 'start'} onClick={() => setOtpModal(true)}>
                    <KeyRound className="h-4 w-4" /> Start ride (OTP)
                  </button>
                )}
                {activeRide.status === 'in_progress' && (
                  <button className="btn-primary flex-1" disabled={busyAction === 'complete'} onClick={() => rideAction('complete')}>
                    <CheckCircle2 className="h-4 w-4" /> {busyAction === 'complete' ? 'Completing…' : 'Complete ride'}
                  </button>
                )}
                <button className="btn-danger" onClick={() => setCancelOpen(true)}>
                  <XCircle className="h-4 w-4" /> Cancel
                </button>
              </div>
            </div>

            {/* fare + map */}
            <div className="space-y-3 lg:col-span-2">
              <FareBreakdown fare={activeRide.fareBreakdown} title="Estimated fare" />
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  {pickLoc ? 'Tap the map to update your position' : 'Your live position is shared with the passenger'}
                </span>
                <button
                  onClick={() => setPickLoc((v) => !v)}
                  className={`btn-ghost text-xs ${pickLoc ? 'text-brand-600' : ''}`}
                >
                  <MapPin className="h-3.5 w-3.5" /> {pickLoc ? 'Cancel pin' : 'Set on map'}
                </button>
              </div>
              <div className="h-52 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <MapView
                  center={{ lat: activeRide.pickup.lat, lng: activeRide.pickup.lng, zoom: 14 }}
                  markers={markers}
                  interactive
                  onMapClick={pickLoc ? setManualLocation : undefined}
                />
              </div>
            </div>
          </div>

          {chatOpen && (
            <div className="h-72 border-t border-slate-200 dark:border-slate-700">
              <ChatPanel bookingId={activeRide.id} me={{ id: me.userId }} onClose={() => setChatOpen(false)} />
            </div>
          )}
        </div>
      )}

      {/* idle map */}
      {!activeRide && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <p className="flex items-center gap-1.5 text-sm font-bold"><MapPin className="h-4 w-4 text-brand-600" /> Your position</p>
            <div className="flex items-center gap-2">
              <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{requests.length} incoming</span>
              {me.isOnline && (
                <button
                  onClick={() => setPickLoc((v) => !v)}
                  className={`btn-ghost text-xs ${pickLoc ? 'text-brand-600' : ''}`}
                >
                  <MapPin className="h-3.5 w-3.5" /> {pickLoc ? 'Cancel pin' : 'Set on map'}
                </button>
              )}
            </div>
          </div>
          <div className="h-72">
            {pickLoc && (
              <p className="flex items-center gap-1.5 bg-brand-50 px-4 py-2 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-200">
                <MapPin className="h-3.5 w-3.5" /> Tap the map to set your current position
              </p>
            )}
            {myLoc || pickLoc ? (
              <MapView
                center={{ lat: myLoc?.lat ?? 23.0225, lng: myLoc?.lng ?? 72.5714, zoom: 14 }}
                markers={markers}
                interactive
                onMapClick={pickLoc ? setManualLocation : undefined}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
                <MapPin className="h-8 w-8" />
                <p>{me.isOnline ? 'Waiting for your GPS position…' : 'Go online and share your location'}</p>
              </div>
            )}
          </div>
          {gpsBlocked && me.isOnline && (
            <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs text-amber-600 dark:border-slate-800 dark:text-amber-400">
              <ShieldAlert className="h-3.5 w-3.5" />
              Location permission is off — tap “Set on map” to show where you are.
            </p>
          )}
        </div>
      )}

      {/* incoming requests */}
      {requests.length > 0 && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-bold text-brand-700 dark:text-brand-300">
            <CarTaxiFront className="h-5 w-5" /> New ride requests ({requests.length})
          </p>
          {requests.map((r) => (
            <div key={r.bookingId} className="card border-2 border-brand-400 p-4 animate-slide-up dark:border-brand-600">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-extrabold">{fmtINR(r.estimatedFare)}</p>
                    <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{r.distanceKm} km · ~{r.durationMin} min</span>
                    <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{r.vehicleType === 'auto' ? 'Auto' : 'E-rickshaw'}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">🟢 {r.pickup.address}</p>
                  <p className="truncate text-sm text-slate-500">🔴 {r.drop.address}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-primary" disabled={busyAction === r.bookingId}
                    onClick={() => accept(r.bookingId)}
                  >
                    {busyAction === r.bookingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Accept
                  </button>
                  <button className="btn-secondary" onClick={() => reject(r.bookingId)}>
                    <UserX className="h-4 w-4" /> Skip
                  </button>
                </div>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-400">Fare breakdown</summary>
                <div className="mt-2"><FareBreakdown fare={r.fareBreakdown} title="Fare" /></div>
              </details>
            </div>
          ))}
        </div>
      )}

      {/* offline hint */}
      {!me.isOnline && requests.length === 0 && !activeRide && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <Power className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">Tap the power button above to go online and start earning.</p>
        </div>
      )}

      {/* OTP modal */}
      <Modal open={otpModal} onClose={() => setOtpModal(false)} title="Enter ride OTP">
        <p className="mb-4 text-sm text-slate-500">
          Ask the passenger for the 4-digit OTP shown on their screen. The ride starts only with the correct code —
          this confirms you picked up the right passenger.
        </p>
        <input
          className="input text-center text-2xl font-extrabold tracking-[0.5em]" maxLength={4} inputMode="numeric"
          placeholder="••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && otp.length === 4 && rideAction('start', { rideOtp: otp })}
        />
        <button
          className="btn-primary mt-4 w-full"
          disabled={otp.length !== 4 || busyAction === 'start'}
          onClick={() => rideAction('start', { rideOtp: otp })}
        >
          {busyAction === 'start' ? 'Starting…' : 'Start ride'}
        </button>
      </Modal>

      {/* cancel confirm */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this ride?">
        <p className="mb-4 text-sm text-slate-500">
          Cancelling will free the passenger to book again. Frequent cancellations affect your acceptance stats.
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setCancelOpen(false)}>Keep ride</button>
          <button
            className="btn-danger flex-1" disabled={busyAction === 'cancel'}
            onClick={async () => { setCancelOpen(false); await rideAction('cancel'); }}
          >
            Cancel ride
          </button>
        </div>
      </Modal>
    </div>
  );
}
