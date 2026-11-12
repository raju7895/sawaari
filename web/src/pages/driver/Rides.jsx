import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, ChevronRight, Search } from 'lucide-react';
import { api, fmtINR, fmtDateTime } from '../../api';
import StatusBadge from '../../components/StatusBadge';

const TABS = [
  ['', 'All'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['in_progress', 'Active'],
];

export default function DriverRides() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rides, setRides] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/driver/rides${status ? `?status=${status}` : ''}`);
      setRides(res.bookings);
    } catch { setRides([]); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const filtered = (rides || []).filter((b) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (b.pickup?.address || '').toLowerCase().includes(needle)
      || (b.drop?.address || '').toLowerCase().includes(needle)
      || (b.passenger?.name || '').toLowerCase().includes(needle);
  });

  const earned = (rides || []).filter((b) => b.status === 'completed')
    .reduce((s, b) => s + (b.finalFare || 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><History className="h-6 w-6 text-brand-600" /> My rides</h1>
          <p className="text-sm text-slate-500">Rides you accepted, completed and cancelled</p>
        </div>
        {rides && rides.length > 0 && (
          <div className="card px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Gross fares</p>
            <p className="tabular text-lg font-extrabold text-emerald-600">{fmtINR(earned)}</p>
          </div>
        )}
      </div>

      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search passenger or route…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setStatus(key)}
              className={`badge px-3 py-1.5 ${status === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {rides === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {rides !== null && filtered.length === 0 && (
        <div className="card p-10 text-center text-sm text-slate-400">
          No rides here yet. Go online to start accepting requests.
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((b) => (
          <Link key={b.id} to="/driver" className="card flex items-center gap-4 p-4 hover:shadow-md">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold">{b.ref}</p>
                <StatusBadge status={b.status} />
              </div>
              <p className="mt-1.5 truncate text-sm font-medium">
                {b.pickup?.address?.split(',')[0]} <span className="text-slate-400">→</span> {b.drop?.address?.split(',')[0]}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {fmtDateTime(b.createdAt)} · {b.distanceKm} km
                {b.passenger?.name ? ` · ${b.passenger.name}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-base font-extrabold">{fmtINR(b.finalFare ?? b.estimatedFare)}</p>
              <p className="text-xs text-slate-400">{b.paymentStatus}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
          </Link>
        ))}
      </div>
    </div>
  );
}
