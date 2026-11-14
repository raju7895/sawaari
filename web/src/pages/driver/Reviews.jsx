import { useState } from 'react';
import { Star } from 'lucide-react';
import { rateRide, ratingsFor, listMyDriverRides } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Card, Loading, Empty, ErrorNote, Notice, Field, useAsync } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export default function Reviews() {
  const { profile } = useAuth();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const reviews = useAsync(() => ratingsFor(profile?.id), [profile?.id]);
  const rides = useAsync(() => listMyDriverRides({ limit: 20, status: 'completed' }), []);

  const send = async (ride) => {
    setBusy(true); setError(''); setOk('');
    try {
      await rateRide(ride.id, ride.riderId, rating, comment);
      setOk(`Thanks — you rated the rider of ride ${ride.ref}.`);
      setComment('');
      reviews.reload();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const toRate = (rides.data || []).filter((r) => r.riderId && !reviews.data?.some((x) => x.ride_id === r.id));

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <Card title="Rate a rider">
        {rides.loading ? <Loading /> : null}
        {!rides.loading && toRate.length === 0 ? <Empty label="No completed rides waiting for a rating." /> : null}
        {toRate.length ? (
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
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="How was the passenger?" />
            </Field>
            <ul className="space-y-2">
              {toRate.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <span className="text-sm">
                    <b>{r.riderName}</b> · {r.ref} · {fmtDateTime(r.completedAt || r.createdAt)}
                  </span>
                  <button className="btn-primary" onClick={() => send(r)} disabled={busy}>Rate {rating}★</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card title="What riders said">
        {reviews.loading ? <Loading /> : null}
        {!reviews.loading && (reviews.data || []).length === 0 ? <Empty label="No ratings yet." /> : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(reviews.data || []).map((r) => {
            const from = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
            return (
              <li key={r.id} className="py-3">
                <p className="flex items-center gap-1">
                  {Array.from({ length: r.rating }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                  <span className="ml-1 text-xs text-slate-500">{r.rating}/5</span>
                </p>
                {r.comment ? <p className="text-sm text-slate-600 dark:text-slate-300">{r.comment}</p> : null}
                <p className="text-xs text-slate-400">{from?.full_name || 'A rider'} · {fmtDateTime(r.created_at)}</p>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
