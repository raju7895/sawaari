import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Phone, MessageSquare, ShieldAlert, Share2, XCircle, MapPin, Navigation, KeyRound,
  Loader2, Wallet, QrCode, Smartphone, Banknote, CheckCircle2, Star, Copy,
} from 'lucide-react';
import MapView from '../../components/MapView';
import ChatPanel from '../../components/ChatPanel';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import FareBreakdown from '../../components/FareBreakdown';
import { StarInput } from '../../components/StarRating';
import Avatar from '../../components/Avatar';
import { api, fmtINR } from '../../api';
import { useToast } from '../../context/ToastContext';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';

const TIMELINE = [
  ['searching', 'Searching for driver'],
  ['assigned', 'Driver assigned'],
  ['arriving', 'Driver arriving'],
  ['arrived', 'Driver arrived'],
  ['in_progress', 'Ride started'],
  ['completed', 'Ride completed'],
];
const ACTIVE_AT = ['searching', 'scheduled', 'assigned', 'arriving', 'arrived', 'in_progress'];

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function RideTracking() {
  const { id } = useParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { subscribe, emit, connected } = useSocket();
  const [booking, setBooking] = useState(null);
  const [events, setEvents] = useState([]);
  const [driverLoc, setDriverLoc] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [payments, setPayments] = useState([]);
  const [payCfg, setPayCfg] = useState({ razorpay: { enabled: false } });
  const [upi, setUpi] = useState(null);
  const [utr, setUtr] = useState('');
  const [review, setReview] = useState({ rating: 0, comment: '', done: false });
  const [busyAction, setBusyAction] = useState('');
  const shareUrl = useRef('');

  const refresh = useCallback(async () => {
    try {
      const b = await api.get(`/api/bookings/${id}`);
      setBooking(b);
      const ev = await api.get(`/api/bookings/${id}/events`).catch(() => []);
      setEvents(ev);
      if (b.status === 'completed') {
        const pays = await api.get(`/api/payments/booking/${id}`).catch(() => []);
        setPayments(pays);
      }
    } catch (err) { toast(err.message, 'error'); }
  }, [id, toast]);

  useEffect(() => {
    refresh();
    api.get('/api/payments/config').then(setPayCfg).catch(() => {});
  }, [refresh]);

  // socket wiring
  useEffect(() => {
    emit('booking:join', id, () => {});
    const offs = [
      subscribe('ride:status', (b) => { if (b.id === id) { setBooking(b); refresh(); } }),
      subscribe('ride:assigned', (b) => { if (b.id === id) { setBooking(b); toast('A driver accepted your ride!', 'success'); } }),
      subscribe('ride:cancelled', (payload) => {
        if (payload.bookingId === id) {
          toast(payload.reason === 'accepted' ? '' : 'Ride cancelled', 'info');
          refresh();
        }
      }),
      subscribe('ride:driver-location', (loc) => setDriverLoc(loc)),
      subscribe('chat:message', (m) => { if (m.booking_id === id) setChatOpen(true); }),
    ];
    return () => offs.forEach((off) => off());
  }, [id, subscribe, emit, refresh, toast]);

  const markers = useMemo(() => {
    const m = [];
    if (booking) {
      m.push({ lat: booking.pickup.lat, lng: booking.pickup.lng, type: 'from' });
      m.push({ lat: booking.drop.lat, lng: booking.drop.lng, type: 'to' });
    }
    if (driverLoc) m.push({ lat: driverLoc.lat, lng: driverLoc.lng, type: 'driver' });
    return m;
  }, [booking, driverLoc]);

  const activeIdx = TIMELINE.findIndex(([k]) => k === booking?.status);
  const canCancel = booking && ACTIVE_AT.includes(booking.status);
  const paid = payments.some((p) => p.status === 'paid');
  const awaiting = payments.some((p) => p.status === 'awaiting_verification');
  const finalFare = booking?.finalFare ?? booking?.estimatedFare;

  const doCancel = async () => {
    setBusyAction('cancel');
    try {
      await api.post(`/api/bookings/${id}/cancel`, { reason: cancelReason });
      toast('Ride cancelled', 'info');
      setCancelOpen(false);
      refresh();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusyAction(''); }
  };

  const shareTrip = async () => {
    shareUrl.current = `${window.location.origin}/track/${booking.shareToken}`;
    try {
      if (navigator.share) await navigator.share({ title: 'My Sawaari ride', url: shareUrl.current });
      else { await navigator.clipboard.writeText(shareUrl.current); toast('Trip link copied — anyone can watch your ride live', 'success'); }
    } catch { /* user dismissed */ }
  };

  const sos = async () => {
    if (!window.confirm('Raise an SOS alert to the Sawaari safety team?')) return;
    try {
      const res = await api.post(`/api/bookings/${id}/sos`, {});
      toast(`Alert sent. In an emergency, call ${res.emergencyNumber}.`, 'error', 8000);
    } catch (err) { toast(err.message, 'error'); }
  };

  const payOnline = async () => {
    setBusyAction('online');
    try {
      const ok = await loadRazorpay();
      if (!ok) return toast('Could not load the payment gateway. Check your connection.', 'error');
      const order = await api.post(`/api/payments/booking/${id}/online`);
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amountRupees * 100,
        currency: order.currency,
        name: 'Sawaari',
        description: `Ride ${booking.ref}`,
        order_id: order.orderId,
        theme: { color: '#0d9488' },
        handler: async (resp) => {
          try {
            await api.post('/api/payments/razorpay/verify', resp);
            toast('Payment successful & verified ✅', 'success');
            refresh();
          } catch (err) { toast(err.message, 'error', 8000); }
        },
        modal: { ondismiss: () => toast('Payment window closed', 'info') },
      });
      rzp.open();
    } catch (err) { toast(err.message, 'error', 8000); }
    finally { setBusyAction(''); }
  };

  const getUpiQr = async () => {
    setBusyAction('upi');
    try {
      const res = await api.post(`/api/payments/booking/${id}/upi`);
      setUpi(res);
    } catch (err) { toast(err.message, 'error', 7000); }
    finally { setBusyAction(''); }
  };

  const submitUtr = async () => {
    if (!/^\d{12}$/.test(utr)) return toast('Enter the 12-digit UTR from your UPI app', 'error');
    setBusyAction('utr');
    try {
      const res = await api.post(`/api/payments/booking/${id}/utr`, { utr });
      toast(res.message, 'success');
      setUpi(null);
      refresh();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusyAction(''); }
  };

  const submitReview = async () => {
    if (!review.rating) return toast('Pick a star rating', 'error');
    setBusyAction('review');
    try {
      await api.post(`/api/bookings/${id}/review`, { rating: review.rating, comment: review.comment || undefined });
      setReview((r) => ({ ...r, done: true }));
      toast('Thanks for rating your ride!', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusyAction(''); }
  };

  if (!booking) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Left: map + status */}
      <div className="relative order-1 min-h-[340px] flex-1 lg:order-2">
        <MapView
          center={{ lat: booking.pickup.lat, lng: booking.pickup.lng, zoom: 14 }}
          markers={markers}
          route={booking.routeGeometry}
          focus={driverLoc ? { lat: driverLoc.lat, lng: driverLoc.lng } : undefined}
        />
        <div className="absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-3 pr-4 shadow-lg dark:bg-slate-900/95">
          <StatusBadge status={booking.status} />
          {!connected && <span className="text-[11px] font-semibold text-amber-600">reconnecting…</span>}
        </div>
        {booking.status === 'searching' && (
          <div className="absolute inset-x-4 bottom-4 z-[500] rounded-2xl bg-white/95 p-4 shadow-lg dark:bg-slate-900/95">
            <p className="flex items-center gap-2.5 text-sm font-bold">
              <span className="relative flex h-3 w-3">
                <span className="absolute h-3 w-3 animate-ping rounded-full bg-amber-500 opacity-60" />
                <span className="h-3 w-3 rounded-full bg-amber-500" />
              </span>
              Finding autos near your pickup…
            </p>
            <p className="mt-1 text-xs text-slate-500">Nearby online drivers receive your request instantly.</p>
          </div>
        )}
        {booking.status === 'expired' && (
          <div className="absolute inset-x-4 bottom-4 z-[500] rounded-2xl bg-white/95 p-4 shadow-lg dark:bg-slate-900/95">
            <p className="text-sm font-bold text-red-600">No driver accepted in time</p>
            <Link to="/app/book" className="btn-primary mt-2 w-full py-2.5">Try booking again</Link>
          </div>
        )}
      </div>

      {/* Right: details */}
      <div className="order-2 flex w-full shrink-0 flex-col overflow-auto border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:order-1 lg:w-[430px] lg:border-r">
        {/* timeline */}
        <div className="border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-extrabold">Ride {booking.ref}</p>
            <StatusBadge status={booking.status} />
          </div>
          <ol className="relative ml-1.5 space-y-0 border-l-2 border-slate-200 dark:border-slate-700">
            {TIMELINE.map(([key, label], i) => {
              const done = booking.status !== 'cancelled' && booking.status !== 'expired' && i < activeIdx;
              const current = booking.status === key;
              const skipped = (booking.status === 'cancelled' || booking.status === 'expired');
              return (
                <li key={key} className="relative flex items-center gap-3 py-1.5 pl-4">
                  <span className={`absolute -left-[9px] h-4 w-4 rounded-full border-2 ${
                    current ? 'border-brand-500 bg-brand-500 animate-pulse-slow'
                    : done ? 'border-brand-500 bg-white dark:bg-slate-900'
                    : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900'
                  }`} />
                  <span className={`text-sm font-semibold ${
                    current ? 'text-brand-700 dark:text-brand-300'
                    : done ? 'text-slate-700 dark:text-slate-200'
                    : skipped ? 'text-slate-300 dark:text-slate-600' : 'text-slate-400'
                  }`}>{label}</span>
                </li>
              );
            })}
          </ol>
          {booking.status === 'cancelled' && (
            <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              Cancelled — {booking.cancellationReason || 'reason not recorded'}
            </p>
          )}
        </div>

        {/* driver card */}
        {booking.driver && ['assigned','arriving','arrived','in_progress'].includes(booking.status) && (
          <div className="border-b border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <Avatar src={booking.driver.avatarUrl} name={booking.driver.name} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{booking.driver.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {booking.driver.rating.toFixed(1)} ({booking.driver.ratingCount})
                  </span>
                  {booking.vehicle && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold dark:bg-slate-800">
                      {booking.vehicle.registrationNumber}
                    </span>
                  )}
                  {booking.vehicle?.vehicleType === 'auto' ? '🛺 Auto' : '🛺 E-rickshaw'}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={`tel:${booking.driver.phone}`} className="btn-secondary">
                <Phone className="h-4 w-4" /> Call driver
              </a>
              <button onClick={() => setChatOpen(true)} className="btn-secondary">
                <MessageSquare className="h-4 w-4" /> Chat
              </button>
            </div>
          </div>
        )}

        {/* ride OTP for start */}
        {['assigned','arriving','arrived'].includes(booking.status) && booking.rideOtp && (
          <div className="flex items-center gap-3 border-b border-slate-200 bg-brand-50 p-4 dark:border-slate-800 dark:bg-brand-900/20">
            <KeyRound className="h-5 w-5 text-brand-600" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Ride start OTP</p>
              <p className="tabular text-2xl font-extrabold tracking-[0.3em] text-brand-800 dark:text-brand-200">{booking.rideOtp}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Share only when the driver starts the trip</p>
            </div>
          </div>
        )}

        {/* addresses + fare */}
        <div className="space-y-2 border-b border-slate-200 p-4 text-sm dark:border-slate-800">
          <div className="flex gap-2.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span className="text-slate-600 dark:text-slate-300">{booking.pickup.address}</span>
          </div>
          <div className="flex gap-2.5">
            <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <span className="text-slate-600 dark:text-slate-300">{booking.drop.address}</span>
          </div>
          <div className="tabular flex items-center justify-between pt-1 text-xs text-slate-500">
            <span>{booking.distanceKm} km · ~{booking.durationMin} min</span>
            <span>{booking.waitingMinutes > 0 ? `+${booking.waitingMinutes} min wait` : ''}</span>
          </div>
          {booking.status === 'completed' && booking.fareBreakdown && (
            <FareBreakdown fare={{ ...booking.fareBreakdown, total: booking.finalFare ?? booking.fareBreakdown.total }} title="Final fare" />
          )}
        </div>

        {/* actions */}
        <div className="space-y-2.5 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={shareTrip} className="btn-secondary" disabled={!booking.shareToken}>
              <Share2 className="h-4 w-4" /> Share trip
            </button>
            <button onClick={sos} className="btn-danger">
              <ShieldAlert className="h-4 w-4" /> SOS
            </button>
          </div>
          {canCancel && (
            <button onClick={() => setCancelOpen(true)} className="btn-ghost w-full text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" /> Cancel ride
            </button>
          )}
        </div>

        {/* payment panel (after completion) */}
        {booking.status === 'completed' && (
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <p className="mb-3 flex items-center gap-2 text-sm font-extrabold">
              <Wallet className="h-4 w-4 text-brand-600" /> Payment
              <StatusBadge status={booking.paymentStatus} className="ml-auto" />
            </p>

            {paid ? (
              <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle2 className="mb-1 h-5 w-5" />
                <p className="font-bold">Paid {fmtINR(finalFare)}</p>
                <p className="mt-0.5 text-xs">
                  {payments.find((p) => p.status === 'paid')?.method === 'upi_qr' ? 'UPI payment verified' : ''}
                  {payments.find((p) => p.status === 'paid')?.method === 'online' ? 'Online payment (gateway verified)' : ''}
                  {payments.find((p) => p.status === 'paid')?.method === 'cash' ? 'Paid in cash to the driver' : ''}
                </p>
              </div>
            ) : awaiting ? (
              <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <p className="font-bold">Payment being verified…</p>
                <p className="mt-0.5 text-xs">Your UTR was submitted. We confirm once the payment is verified on the driver's UPI.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">Total due: <b className="tabular text-base text-slate-900 dark:text-slate-100">{fmtINR(finalFare)}</b></p>
                <div className="grid gap-2">
                  {payCfg.razorpay?.enabled && (
                    <button onClick={payOnline} disabled={busyAction === 'online'} className="btn-primary py-3">
                      {busyAction === 'online' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                      Pay online (UPI / cards)
                    </button>
                  )}
                  <button onClick={getUpiQr} disabled={busyAction === 'upi'} className="btn-secondary py-3">
                    {busyAction === 'upi' ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                    Scan driver's UPI QR
                  </button>
                  <p className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <Banknote className="h-4 w-4 shrink-0" /> Paying cash? Hand it to the driver — they will confirm it in their app.
                  </p>
                  {!payCfg.razorpay?.enabled && (
                    <p className="text-[11px] text-slate-400">Online gateway payments aren't configured on this server (admin can enable Razorpay in settings).</p>
                  )}
                </div>
              </div>
            )}

            {/* review */}
            {!review.done && (
              <div className="mt-4 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                <p className="mb-2 text-sm font-bold">Rate your ride</p>
                <StarInput value={review.rating} onChange={(r) => setReview({ ...review, rating: r })} />
                <textarea
                  className="input mt-2 min-h-16" placeholder="How was the ride? (optional)" maxLength={500}
                  value={review.comment} onChange={(e) => setReview({ ...review, comment: e.target.value })}
                />
                <button onClick={submitReview} className="btn-primary mt-2 w-full" disabled={busyAction === 'review'}>
                  {busyAction === 'review' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />} Submit rating
                </button>
              </div>
            )}
            {review.done && (
              <p className="mt-4 flex items-center gap-1.5 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Thanks for the feedback!
              </p>
            )}
          </div>
        )}
      </div>

      {/* Chat drawer */}
      {chatOpen && (
        <div className="fixed inset-y-0 right-0 z-[80] w-full max-w-sm border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <ChatPanel bookingId={id} me={user} onClose={() => setChatOpen(false)} />
        </div>
      )}

      {/* Cancel modal */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel ride?">
        <p className="mb-3 text-sm text-slate-500">
          {booking.driver
            ? 'Your driver is already on the way. A small cancellation fee may apply per policy.'
            : 'Are you sure you want to cancel this booking?'}
        </p>
        <textarea
          className="input min-h-20" placeholder="Reason (required)" maxLength={300}
          value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
        />
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setCancelOpen(false)}>Keep ride</button>
          <button className="btn-danger flex-1" onClick={doCancel} disabled={busyAction === 'cancel' || cancelReason.trim().length < 3}>
            {busyAction === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel ride
          </button>
        </div>
      </Modal>

      {/* UPI QR modal */}
      <Modal open={Boolean(upi)} onClose={() => setUpi(null)} title="Pay by UPI QR">
        {upi && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-slate-500">Pay <b className="text-slate-900 dark:text-slate-100">{fmtINR(upi.amount)}</b> to {upi.driverName}'s UPI</p>
            <img src={upi.qrDataUrl} alt="UPI QR code" className="mx-auto rounded-xl border-4 border-white bg-white shadow" width={240} height={240} />
            <p className="tabular text-xs text-slate-400">UPI ID: {upi.upiVpa} · Ref: {upi.txnRef}</p>
            <a href={upi.intentUrl} className="btn-primary w-full">
              <Smartphone className="h-4 w-4" /> Open in UPI app (GPay / PhonePe / Paytm)
            </a>
            <button onClick={() => { navigator.clipboard.writeText(upi.upiVpa); toast('UPI ID copied', 'success'); }} className="btn-ghost w-full text-xs">
              <Copy className="h-3.5 w-3.5" /> Copy UPI ID
            </button>
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <label className="label text-left">Already paid? Enter the 12-digit UTR from your UPI app</label>
              <div className="flex gap-2">
                <input className="input tabular" inputMode="numeric" maxLength={12} placeholder="e.g. 402912345678" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))} />
                <button className="btn-primary" onClick={submitUtr} disabled={busyAction === 'utr' || utr.length !== 12}>
                  {busyAction === 'utr' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit
                </button>
              </div>
              <p className="mt-2 text-left text-[11px] text-slate-400">
                Your payment stays <b>pending verification</b> until we confirm it against the driver's UPI statement. This protects both you and the driver.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
