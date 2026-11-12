import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin, Search, XCircle, Download } from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import { api, fmtINR, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';

const STATUS = ['', 'searching', 'scheduled', 'assigned', 'arriving', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'];

export default function AdminBookings() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [q, setQ] = useState('');
  const [cityId, setCityId] = useState('');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [cities, setCities] = useState([]);
  const [cancelFor, setCancelFor] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/meta/cities').then(setCities).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: 25, offset });
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      if (cityId) params.set('cityId', cityId);
      const res = await api.get(`/api/admin/bookings?${params}`);
      setRows(res.bookings);
      setTotal(res.total);
    } catch (e) { toast(e.message, 'error'); }
  }, [status, q, cityId, offset, toast]);
  useEffect(() => { load(); }, [load]);

  const cancel = async () => {
    if (reason.trim().length < 3) return toast('Give a cancellation reason', 'error');
    setBusy(true);
    try {
      await api.post(`/api/admin/bookings/${cancelFor.id}/cancel`, { reason: reason.trim() });
      toast('Booking cancelled', 'info');
      setCancelFor(null); setReason('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const page = Math.floor(offset / 25) + 1;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><MapPin className="h-6 w-6 text-brand-600" /> Bookings</h1>
          <p className="text-sm text-slate-500">Every ride on the platform</p>
        </div>
        <button className="btn-secondary" onClick={() => window.open('/api/admin/export/bookings', '_blank')}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Ref, route or phone…" value={q}
            onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </div>
        <select className="input lg:w-44" value={cityId} onChange={(e) => { setCityId(e.target.value); setOffset(0); }}>
          <option value="">All cities</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input lg:w-40" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          {STATUS.map((s) => <option key={s} value={s}>{s === '' ? 'All statuses' : s.replace('_', ' ')}</option>)}
        </select>
      </div>

      {rows === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {rows !== null && rows.length === 0 && <div className="card p-10 text-center text-sm text-slate-400">No bookings match.</div>}

      <div className="space-y-2">
        {(rows || []).map((b) => (
          <div key={b.id} className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold">{b.ref}</p>
                <StatusBadge status={b.status} />
                <StatusBadge status={b.paymentStatus} />
                {b.city && <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{b.city}</span>}
              </div>
              <p className="mt-1 truncate text-sm">
                <span className="text-emerald-600">●</span> {b.pickupAddress?.split(',')[0]}
                <span className="mx-1.5 text-slate-400">→</span>
                <span className="text-red-500">▲</span> {b.dropAddress?.split(',')[0]}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {fmtDateTime(b.createdAt)} · {b.distanceKm} km
                {b.passenger?.phone ? ` · passenger ${b.passenger.phone}` : ''}
                {b.driver?.phone ? ` · driver ${b.driver.phone}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular font-extrabold">{fmtINR(b.finalFare ?? b.estimatedFare)}</p>
              {b.cancellationReason && <p className="max-w-48 truncate text-xs text-red-500" title={b.cancellationReason}>{b.cancellationReason}</p>}
            </div>
            {['searching', 'scheduled', 'assigned', 'arriving', 'arrived'].includes(b.status) && (
              <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => setCancelFor(b)}>
                <XCircle className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button className="btn-secondary px-3 py-1.5 text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>← Previous</button>
          <span className="text-xs text-slate-400">page {page} of {pages}</span>
          <button className="btn-secondary px-3 py-1.5 text-xs" disabled={offset + 25 >= total} onClick={() => setOffset(offset + 25)}>Next →</button>
        </div>
      )}

      <Modal open={Boolean(cancelFor)} onClose={() => setCancelFor(null)} title="Cancel this booking?">
        <p className="mb-3 text-sm text-slate-500">
          Cancelling frees the driver and notifies the passenger. Reason is shared with both parties.
        </p>
        <textarea className="input min-h-20" maxLength={300} value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Suspicious booking pattern under review" />
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setCancelFor(null)}>Keep booking</button>
          <button className="btn-danger flex-1" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
        </div>
      </Modal>
    </div>
  );
}
