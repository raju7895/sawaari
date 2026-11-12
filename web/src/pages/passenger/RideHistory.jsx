import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { History, MapPin, Filter, ChevronRight, Search } from 'lucide-react';
import { api, fmtINR, fmtDateTime } from '../../api';
import StatusBadge from '../../components/StatusBadge';

const STATUS_TABS = [
  ['', 'All rides'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['scheduled', 'Scheduled'],
];

export default function RideHistory() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rides, setRides] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/bookings/mine?limit=50${status ? `&status=${status}` : ''}`);
      setRides(res.bookings);
    } catch { setRides([]); }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const filtered = (rides || []).filter((b) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (b.pickup?.address || '').toLowerCase().includes(needle)
      || (b.drop?.address || '').toLowerCase().includes(needle)
      || (b.ref || '').toLowerCase().includes(needle);
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><History className="h-6 w-6 text-brand-600" /> My rides</h1>
        <p className="text-sm text-slate-500">Every trip you have taken with Sawaari</p>
      </div>

      {/* filters */}
      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9" placeholder="Search by route or reference…"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStatus(key)}
              className={`badge px-3 py-1.5 transition-colors ${
                status === key
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* list */}
      {rides === null && <p className="py-10 text-center text-sm text-slate-400">Loading your rides…</p>}
      {rides !== null && filtered.length === 0 && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <MapPin className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">
            {q || status ? 'No rides match this filter.' : 'You have no rides yet.'}
          </p>
          <Link to="/app/book" className="btn-primary">Book an auto</Link>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((b) => (
          <button
            key={b.id}
            onClick={() => navigate(`/app/ride/${b.id}`)}
            className="card flex w-full items-center gap-4 p-4 text-left transition-shadow hover:shadow-md"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold">{b.ref}</p>
                <StatusBadge status={b.status} />
              </div>
              <p className="mt-1.5 truncate text-sm font-medium">
                {b.pickup?.address?.split(',')[0]} <span className="text-slate-400">→</span> {b.drop?.address?.split(',')[0]}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {fmtDateTime(b.createdAt)} · {b.distanceKm} km · {b.vehicleType === 'auto' ? 'Auto' : 'E-rickshaw'}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-base font-extrabold">{fmtINR(b.finalFare ?? b.estimatedFare)}</p>
              <p className="text-xs">
                {b.paymentStatus === 'paid' ? (
                  <span className="text-emerald-600">Paid</span>
                ) : b.paymentStatus === 'unpaid' && b.status === 'completed' ? (
                  <span className="text-amber-600">Payment due</span>
                ) : (
                  <span className="text-slate-400">{b.paymentStatus}</span>
                )}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
          </button>
        ))}
      </div>
    </div>
  );
}
