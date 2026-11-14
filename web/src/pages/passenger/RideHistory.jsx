import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyRides } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, StatusBadge, useAsync } from '../../components/ui';
import { fmtINR } from '../../lib/format';

const FILTERS = ['', 'requested', 'accepted', 'ongoing', 'completed', 'cancelled'];

export default function RideHistory() {
  const [status, setStatus] = useState('');
  const rides = useAsync(() => listMyRides({ limit: 50, status: status || undefined }), [status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => setStatus(f)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              status === f ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>

      <Card title="My rides">
        <ErrorNote message={rides.error} onRetry={rides.reload} />
        {rides.loading ? <Loading /> : null}
        {!rides.loading && !rides.error && (rides.data || []).length === 0 ? (
          <Empty label="No rides here yet." action={<Link to="/passenger/book" className="btn-primary">Book a ride</Link>} />
        ) : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(rides.data || []).map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.pickup?.address} → {r.drop?.address}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(r.createdAt).toLocaleString('en-IN')} · {r.ref}
                    {r.driverName ? ` · ${r.driverName}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="text-sm font-bold">{fmtINR(r.fare)}</span>
                </div>
              </div>
              <Link to={`/passenger/ride/${r.id}`} className="link mt-1 inline-block text-xs">Open</Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
