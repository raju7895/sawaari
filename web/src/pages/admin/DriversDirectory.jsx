import { useCallback, useEffect, useState } from 'react';
import {
  Car, Search, Ban, CheckCircle2, Loader2, Star, TrendingUp, Phone, Edit3, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { api, fmtINR, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

const TABS = [
  ['', 'All'], ['approved', 'Approved'], ['pending', 'Pending'], ['rejected', 'Rejected'],
];

export default function DriversDirectory() {
  const toast = useToast();
  const can = usePermission();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState(null);
  const [vehicleEdit, setVehicleEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const limit = 25;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const res = await api.get(`/api/admin/drivers?${params}`);
      setRows(res.drivers);
      setTotal(res.total);
    } catch (e) { toast(e.message, 'error'); }
  }, [status, q, page, toast]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    try {
      setDetail(await api.get(`/api/admin/drivers/${id}`));
    } catch (e) { toast(e.message, 'error'); }
  };

  const suspend = async (driver) => {
    const reason = window.prompt(`Suspend ${driver.name}?\nReason (shown to the driver):`);
    if (!reason) return;
    const hours = window.prompt('Suspend for how many hours? (leave empty for indefinite)', '24');
    setBusy(driver.id);
    try {
      await api.post(`/api/admin/drivers/${driver.id}/suspend`, {
        suspend: true, reason, hours: hours ? Number(hours) : undefined,
      });
      toast('Driver suspended', 'success');
      setDetail(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const reinstate = async (driver) => {
    setBusy(driver.id);
    try {
      await api.post(`/api/admin/drivers/${driver.id}/suspend`, { suspend: false, reason: 'Reinstated by admin' });
      toast('Driver reinstated', 'success');
      setDetail(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const saveVehicle = async () => {
    setBusy('vehicle');
    try {
      await api.put(`/api/admin/drivers/${detail.id}/vehicle`, {
        registrationNumber: vehicleEdit.registrationNumber,
        model: vehicleEdit.model || undefined,
        capacity: Number(vehicleEdit.capacity) || 3,
        vehicleType: vehicleEdit.vehicleType,
      });
      toast('Vehicle details updated', 'success');
      setVehicleEdit(null);
      await openDetail(detail.id);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const pages = Math.ceil(total / limit);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <Car className="h-6 w-6 text-brand-600" /> Driver management
          </h1>
          <p className="text-sm text-slate-500">Availability, earnings, ratings and complaints across the fleet</p>
        </div>
        <div className="relative min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name or phone" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([value, label]) => (
          <button key={value} onClick={() => { setStatus(value); setPage(0); }}
            className={`badge px-3.5 py-1.5 ${status === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-slate-400">{total} drivers</span>
      </div>

      {!rows && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">Driver</th>
                <th className="px-2 py-2">Vehicle</th>
                <th className="px-2 py-2 text-right">Rides</th>
                <th className="px-2 py-2 text-right">Earnings</th>
                <th className="px-2 py-2 text-right">Rating</th>
                <th className="px-2 py-2">Availability</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(rows || []).map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold">{d.name}</p>
                    <p className="tabular text-xs text-slate-400">{d.phone}</p>
                    <StatusBadge status={d.verification_status} />
                  </td>
                  <td className="px-2 py-2.5 text-xs">
                    {d.vehicle ? (
                      <>
                        <p className="font-mono font-semibold">{d.vehicle.registrationNumber}</p>
                        <p className="text-slate-400">{d.vehicle.vehicleType === 'auto' ? 'Auto-rickshaw' : 'E-rickshaw'}{d.vehicle.model ? ` · ${d.vehicle.model}` : ''}</p>
                      </>
                    ) : <span className="text-slate-400">not added</span>}
                  </td>
                  <td className="tabular px-2 py-2.5 text-right">{d.rides_completed}</td>
                  <td className="tabular px-2 py-2.5 text-right">{fmtINR(d.total_earnings)}</td>
                  <td className="tabular px-2 py-2.5 text-right">
                    {parseFloat(d.rating_avg).toFixed(1)}
                    <span className="text-xs text-slate-400"> ({d.rating_count})</span>
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={`badge ${d.is_online ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                      {d.is_online ? 'online' : 'offline'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="btn-secondary text-xs" onClick={() => openDetail(d.id)}>View</button>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No drivers match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-xs text-slate-500">Page {page + 1} of {pages}</span>
          <button className="btn-secondary text-xs" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      {/* driver detail */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} wide
        title={detail ? `${detail.name} · ${detail.phone}` : ''}>
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ['Rides completed', detail.ridesCompleted ?? 0],
                ['Rides cancelled', detail.ridesCancelled ?? 0],
                ['Net earnings', fmtINR(detail.earnings?.net ?? 0)],
                ['Commission', fmtINR(detail.earnings?.commission ?? 0)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
                  <p className="tabular text-lg font-extrabold">{value}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold">Vehicle</p>
                <StatusBadge status={detail.verification_status} />
                <button className="btn-ghost ml-auto text-xs" disabled={!can('drivers.manage')}
                  onClick={() => setVehicleEdit({
                    registrationNumber: detail.vehicle?.registrationNumber || '',
                    vehicleType: detail.vehicle?.vehicleType || 'auto',
                    model: detail.vehicle?.model || '',
                    capacity: detail.vehicle?.capacity || 3,
                  })}>
                  <Edit3 className="h-3.5 w-3.5" /> Edit
                </button>
              </div>
              {detail.vehicle ? (
                <p className="mt-1 text-sm">
                  <span className="font-mono font-semibold">{detail.vehicle.registrationNumber}</span> ·
                  {' '}{detail.vehicle.vehicleType === 'auto' ? 'Auto-rickshaw' : 'E-rickshaw'} ·
                  {' '}{detail.vehicle.model || '—'} · {detail.vehicle.capacity} seats
                </p>
              ) : <p className="mt-1 text-sm text-slate-400">No vehicle on file.</p>}
              <p className="mt-1 text-xs text-slate-400">
                UPI: {detail.upi_id || 'not set'} {detail.upi_verified ? '(verified)' : '(not verified)'}
              </p>
            </div>

            {vehicleEdit && (
              <div className="grid gap-3 rounded-xl bg-brand-50 p-3 sm:grid-cols-4 dark:bg-brand-900/20">
                <div>
                  <label className="label">Registration</label>
                  <input className="input" value={vehicleEdit.registrationNumber}
                    onChange={(e) => setVehicleEdit({ ...vehicleEdit, registrationNumber: e.target.value })} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select className="input" value={vehicleEdit.vehicleType}
                    onChange={(e) => setVehicleEdit({ ...vehicleEdit, vehicleType: e.target.value })}>
                    <option value="auto">Auto-rickshaw</option>
                    <option value="e_rickshaw">E-rickshaw</option>
                  </select>
                </div>
                <div>
                  <label className="label">Model</label>
                  <input className="input" value={vehicleEdit.model}
                    onChange={(e) => setVehicleEdit({ ...vehicleEdit, model: e.target.value })} />
                </div>
                <div>
                  <label className="label">Seats</label>
                  <input className="input" type="number" min="1" max="8" value={vehicleEdit.capacity}
                    onChange={(e) => setVehicleEdit({ ...vehicleEdit, capacity: e.target.value })} />
                </div>
                <div className="sm:col-span-4 flex gap-2">
                  <button className="btn-primary" disabled={busy === 'vehicle'} onClick={saveVehicle}>
                    {busy === 'vehicle' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save vehicle
                  </button>
                  <button className="btn-ghost" onClick={() => setVehicleEdit(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-bold">Documents</p>
              <div className="mt-2 space-y-1.5">
                {(detail.documents || []).map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-xs">
                    <span className="capitalize">{String(d.doc_type).replace('_', ' ')}</span>
                    <StatusBadge status={d.status} />
                    <a href={d.file_url} target="_blank" rel="noreferrer" className="link ml-auto">view</a>
                  </div>
                ))}
                {(detail.documents || []).length === 0 && <p className="text-xs text-slate-400">No documents uploaded.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-bold">Recent rides</p>
              <div className="mt-2 space-y-1.5">
                {(detail.recentRides || []).map((r) => (
                  <div key={r.ref} className="flex items-center gap-2 text-xs">
                    <span className="font-mono">{r.ref}</span>
                    <StatusBadge status={r.status} />
                    <span className="tabular ml-auto">{fmtINR(r.finalFare || r.estimated_fare)}</span>
                    <span className="text-slate-400">{fmtDateTime(r.created_at)}</span>
                  </div>
                ))}
                {(detail.recentRides || []).length === 0 && <p className="text-xs text-slate-400">No rides yet.</p>}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <a href={`tel:${detail.phone}`} className="btn-ghost text-xs"><Phone className="h-3.5 w-3.5" /> Call driver</a>
              {detail.verification_status === 'approved' && can('drivers.manage') && (
                <button className="btn-danger ml-auto text-xs" disabled={busy === detail.id} onClick={() => suspend(detail)}>
                  {busy === detail.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Suspend driver
                </button>
              )}
              {detail.verification_status === 'rejected' && can('drivers.manage') && (
                <button className="btn-secondary ml-auto text-xs" disabled={busy === detail.id} onClick={() => reinstate(detail)}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Reinstate
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
