import { useState } from 'react';
import { listMyDriverRides } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, StatusBadge, useAsync } from '../../components/ui';
import { fmtINR, fmtDateTime } from '../../lib/format';

const FILTERS = ['', 'accepted', 'ongoing', 'completed', 'cancelled'];

export default function Rides() {
  const [status, setStatus] = useState('');
  const rides = useAsync(() => listMyDriverRides({ limit: 50, status: status || undefined }), [status]);

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
        {!rides.loading && (rides.data || []).length === 0 ? <Empty label="No rides yet." /> : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(rides.data || []).map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.pickup?.address} → {r.drop?.address}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDateTime(r.createdAt)} · {r.riderName} · {r.ref}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="font-bold">{fmtINR(r.fare)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
