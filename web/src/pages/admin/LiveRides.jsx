import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Radio, RefreshCw, MapPin, Navigation, Clock, Phone, Loader2, Search, CircleDot,
} from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import { api, fmtINR, timeAgo } from '../../api';
import { useToast } from '../../context/ToastContext';

const FILTERS = [
  ['', 'All'],
  ['searching', 'Searching'],
  ['assigned', 'Assigned'],
  ['arriving', 'Arriving'],
  ['arrived', 'Arrived'],
  ['in_progress', 'In progress'],
  ['scheduled', 'Scheduled'],
];

export default function LiveRides() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/bookings/live');
      setData(res);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const rides = (data ? data.live : []).filter((r) => {
    if (filter && r.status !== filter) return false;
    if (!q.trim()) return true;
    const hay = `${r.ref} ${r.passenger} ${r.driver} ${r.pickup} ${r.drop}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  const cancelRide = async (ride) => {
    const reason = window.prompt(`Cancel ride ${ride.ref}?\nReason (recorded in the audit log):`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(ride.id);
    try {
      await api.post(`/api/admin/bookings/${ride.id}/cancel`, { reason: reason.trim() });
      toast(`Ride ${ride.ref} cancelled and logged`, 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <Radio className="h-6 w-6 text-brand-600" /> Live rides
          </h1>
          <p className="text-sm text-slate-500">Rides currently on the road · refreshes every 10 seconds</p>
        </div>
        <button className="btn-secondary" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Searching', data.counts.searching, 'amber'],
            ['Assigned', data.counts.assigned, 'blue'],
            ['Arriving', data.counts.arriving, 'blue'],
            ['Arrived', data.counts.arrived, 'violet'],
            ['In progress', data.counts.inProgress, 'brand'],
            ['Scheduled', data.counts.scheduled, 'slate'],
          ].map(([label, value, tone]) => (
            <div key={label} className={`card p-3 text-center ${filter === label.toLowerCase().replace(' ', '_') ? 'ring-2 ring-brand-500' : ''}`}>
              <p className="tabular text-2xl font-extrabold">{value}</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search by ref, passenger, driver or address"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([value, label]) => (
            <button key={value} onClick={() => setFilter(value)}
              className={`badge px-3 py-1.5 ${filter === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {!data && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      {data && rides.length === 0 && (
        <div className="card p-10 text-center text-sm text-slate-400">
          No rides match this filter right now.
        </div>
      )}

      <div className="space-y-3">
        {rides.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-extrabold">{r.ref}</p>
                  <StatusBadge status={r.status} />
                  <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{r.vehicleType === 'auto' ? 'Auto' : 'E-rickshaw'}</span>
                  <span className="tabular badge bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    {fmtINR(r.fare)}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> {r.pickup}
                </p>
                <p className="flex items-center gap-1.5 truncate text-sm text-slate-500">
                  <Navigation className="h-3.5 w-3.5 shrink-0 text-red-500" /> {r.drop}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-semibold text-slate-700 dark:text-slate-200">{r.passenger}</p>
                {r.driver ? <p>{r.driver} · {r.driverPhone}</p> : <p className="text-amber-600">awaiting a driver</p>}
                <p className="mt-0.5 flex items-center justify-end gap-1">
                  <Clock className="h-3 w-3" /> {timeAgo(r.createdAt)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <Link to="/admin/bookings" className="btn-ghost text-xs">Open in bookings</Link>
              <a href={`tel:${r.passengerPhone}`} className="btn-ghost text-xs"><Phone className="h-3.5 w-3.5" /> Call passenger</a>
              {r.driverPhone && (
                <a href={`tel:${r.driverPhone}`} className="btn-ghost text-xs"><Phone className="h-3.5 w-3.5" /> Call driver</a>
              )}
              <button className="btn-danger ml-auto text-xs" disabled={busy === r.id} onClick={() => cancelRide(r)}>
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleDot className="h-3.5 w-3.5" />}
                Cancel with reason
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
