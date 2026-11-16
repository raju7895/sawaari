import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, Phone, Star, Share2 } from 'lucide-react';
import { getRide, rateRide, updateRideStatus } from '../../lib/api';
import { subscribeToRide } from '../../lib/realtime';
import { Card, Loading, ErrorNote, StatusBadge, Notice, Field } from '../../components/ui';
import { fmtINR } from '../../lib/format';

const STEPS = [
  { status: 'requested', label: 'Looking for a driver' },
  { status: 'accepted', label: 'Driver on the way' },
  { status: 'ongoing', label: 'On the trip' },
  { status: 'completed', label: 'Completed' },
];

export default function RideTracking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [info, setInfo] = useState('');
  const [copied, setCopied] = useState(false);

  /* the link that lets somebody else follow this ride without an account */
  const shareUrl = ride?.shareToken ? `${window.location.origin}/track/${ride.shareToken}` : '';

  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setInfo(shareUrl);
    }
  };

  const load = async () => {
    try {
      const row = await getRide(id);
      setRide(row);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  /* live updates */
  useEffect(() => {
    if (!id) return undefined;
    return subscribeToRide(id, { onChange: () => load(), onCancelled: () => load(), onAccepted: () => load() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const cancel = async () => {
    setBusy(true);
    try {
      await updateRideStatus(id, 'cancelled', 'Cancelled by the rider');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendRating = async () => {
    if (!ride?.driverId) return;
    setBusy(true);
    try {
      await rateRide(ride.id, ride.driverId, rating, comment);
      setRated(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading the ride…" />;
  if (!ride) return <ErrorNote message={error || 'That ride does not exist.'} onRetry={load} />;

  const stepIndex = STEPS.findIndex((s) => s.status === ride.status);

  return (
    <div className="space-y-4">
      <ErrorNote message={error} onRetry={load} />

      <Card title={`Ride ${ride.ref}`} action={<StatusBadge status={ride.status} />}>
        <ol className="space-y-3">
          {STEPS.map((s, i) => {
            const done = ride.status === 'cancelled' ? false : i <= stepIndex;
            return (
              <li key={s.status} className="flex items-center gap-3">
                <span className={`h-3 w-3 rounded-full ${done ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
                <span className={done ? 'font-semibold' : 'text-slate-400'}>{s.label}</span>
              </li>
            );
          })}
          {ride.status === 'cancelled' ? (
            <li className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-red-500" />
              <span className="font-semibold text-red-600">Cancelled{ride.cancelReason ? ` — ${ride.cancelReason}` : ''}</span>
            </li>
          ) : null}
        </ol>

        <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
          <p><span className="text-slate-500">Pickup:</span> {ride.pickup?.address}</p>
          <p><span className="text-slate-500">Drop:</span> {ride.drop?.address}</p>
          <p><span className="text-slate-500">Fare:</span> <b>{fmtINR(ride.fare)}</b></p>
          {ride.driverName ? (
            <p className="flex items-center gap-2">
              <span className="text-slate-500">Driver:</span> <b>{ride.driverName}</b>
              {ride.driverPhone ? (
                <a className="link inline-flex items-center gap-1" href={`tel:${ride.driverPhone}`}>
                  <Phone className="h-3.5 w-3.5" /> call
                </a>
              ) : null}
            </p>
          ) : null}
          {ride.rideOtp && ride.status === 'accepted' ? (
            <p><span className="text-slate-500">Your ride OTP:</span> <b className="tracking-widest">{ride.rideOtp}</b></p>
          ) : null}
        </div>
      </Card>

      {shareUrl ? (
        <Card title="Follow this ride">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Send this link to somebody who should know where the ride is. They do not
            need an account.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input className="input flex-1" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn-secondary" onClick={copyShare}>
              <Share2 className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
            </button>
            <a className="btn-ghost" href={shareUrl} target="_blank" rel="noreferrer">Open</a>
          </div>
          {copied ? <Notice tone="ok">The link is on your clipboard.</Notice> : null}
        </Card>
      ) : null}

      {['requested', 'accepted'].includes(ride.status) ? (
        <button className="btn-secondary w-full" onClick={cancel} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel this ride
        </button>
      ) : null}

      {ride.status === 'completed' && !rated ? (
        <Card title="Rate your driver">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className={n <= rating ? 'text-amber-500' : 'text-slate-300'}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                >
                  <Star className="h-7 w-7 fill-current" />
                </button>
              ))}
              <span className="text-sm text-slate-500">{rating} / 5</span>
            </div>
            <Field label="Comment (optional)">
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="How was the trip?" />
            </Field>
            <button className="btn-primary" onClick={sendRating} disabled={busy}>Send rating</button>
          </div>
        </Card>
      ) : null}

      {rated ? <Notice tone="ok">Thanks — your rating was saved.</Notice> : null}

      <Link to="/passenger/rides" className="link block text-center text-sm">All my rides</Link>
    </div>
  );
}
