import { useEffect, useState } from 'react';
import { Star, MessageSquareQuote } from 'lucide-react';
import { api, fmtDateTime } from '../../api';
import { StarDisplay } from '../../components/StarRating';
import Avatar from '../../components/Avatar';

export default function DriverReviews() {
  const [reviews, setReviews] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/api/driver/reviews').then(setReviews).catch(() => setReviews([]));
    api.get('/api/driver/me').then(setStats).catch(() => {});
  }, []);

  const avg = stats?.rating?.avg || 0;
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: (reviews || []).filter((r) => r.rating === star).length,
  }));
  const total = (reviews || []).length || 1;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Star className="h-6 w-6 text-brand-600" /> Reviews</h1>
        <p className="text-sm text-slate-500">What passengers say about their rides with you</p>
      </div>

      {/* summary */}
      <div className="card flex flex-wrap items-center gap-8 p-5">
        <div className="text-center">
          <p className="tabular text-5xl font-extrabold text-brand-700 dark:text-brand-300">{avg.toFixed(1)}</p>
          <StarDisplay value={avg} size={18} />
          <p className="mt-1 text-xs text-slate-400">{stats?.rating?.count || 0} reviews</p>
        </div>
        <div className="min-w-52 flex-1 space-y-1.5">
          {dist.map((d) => (
            <div key={d.star} className="flex items-center gap-2 text-xs">
              <span className="tabular w-6 font-bold">{d.star}★</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${(d.count / total) * 100}%` }} />
              </div>
              <span className="tabular w-6 text-slate-400">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      {reviews === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {reviews !== null && reviews.length === 0 && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <MessageSquareQuote className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No reviews yet — they appear after passengers rate completed rides.</p>
        </div>
      )}

      <div className="space-y-3">
        {(reviews || []).map((r, i) => (
          <div key={i} className="card flex items-start gap-3 p-4">
            <Avatar name={r.reviewer_name} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold">{r.reviewer_name || 'Passenger'}</p>
                <StarDisplay value={r.rating} size={13} />
                <span className="text-xs text-slate-400">{fmtDateTime(r.created_at)}</span>
              </div>
              {r.comment && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">“{r.comment}”</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
