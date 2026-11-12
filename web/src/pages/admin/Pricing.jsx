import { useCallback, useEffect, useState } from 'react';
import { Percent, Save, Loader2, IndianRupee, Clock, Moon, Building2, Receipt } from 'lucide-react';
import { api, fmtINR } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

export default function AdminPricing() {
  const toast = useToast();
  const can = usePermission();
  const [pricing, setPricing] = useState(null);
  const [commission, setCommission] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/pricing');
      setPricing(res.pricing);
      setCommission(String(res.commissionPercent ?? 15));
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const saveRow = async (row) => {
    setBusy(row.id);
    try {
      await api.put(`/api/admin/pricing/${row.id}`, {
        baseFare: row.baseFare,
        perKm: row.perKm,
        perMinute: row.perMinute,
        minFare: row.minFare,
        bookingFee: row.bookingFee,
        waitingPerMin: row.waitingPerMin,
        freeWaitMin: row.freeWaitMin,
        nightMultiplier: row.nightMultiplier,
        nightFromHour: row.nightFromHour,
        nightToHour: row.nightToHour,
        isActive: row.isActive,
      });
      toast(`Pricing updated for ${row.city} · ${row.vehicleType}`, 'success');
      setEditing(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const saveCommission = async () => {
    const value = Number(commission);
    if (!Number.isFinite(value) || value < 0 || value > 50) return toast('Commission must be between 0 and 50', 'error');
    setBusy('commission');
    try {
      const res = await api.post('/api/master/finance/commission', { percent: value });
      toast(res.message || 'Platform commission updated', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  if (!pricing) return <p className="p-6 text-center text-sm text-slate-400">Loading…</p>;

  const cities = [...new Set(pricing.map((p) => p.city))];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <Receipt className="h-6 w-6 text-brand-600" /> Pricing management
        </h1>
        <p className="text-sm text-slate-500">Per city, per vehicle type — every fare on the platform is computed from these rules</p>
      </div>

      {/* platform commission */}
      <div className="card p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold">
          <Percent className="h-4 w-4 text-brand-600" /> Platform commission
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Commission percentage</label>
            <input className="input w-40" type="number" min="0" max="50" step="0.5" value={commission}
              disabled={!can('finance.settings')}
              onChange={(e) => setCommission(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={saveCommission} disabled={busy === 'commission' || !can('finance.settings')}>
            {busy === 'commission' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save commission
          </button>
          <p className="text-xs text-slate-500">
            Charged on every completed ride; driver earnings are stored net of this fee in the earnings ledger.
          </p>
        </div>
      </div>

      {/* per city pricing */}
      {cities.map((city) => (
        <div key={city} className="card overflow-hidden">
          <p className="flex items-center gap-2 border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">
            <Building2 className="h-4 w-4 text-brand-600" /> {city}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-2">Vehicle</th>
                  <th className="px-2 py-2 text-right">Base</th>
                  <th className="px-2 py-2 text-right">Per km</th>
                  <th className="px-2 py-2 text-right">Per min</th>
                  <th className="px-2 py-2 text-right">Min fare</th>
                  <th className="px-2 py-2 text-right">Booking fee</th>
                  <th className="px-2 py-2 text-right">Waiting</th>
                  <th className="px-2 py-2 text-right">Night</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pricing.filter((p) => p.city === city).map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2">
                      <p className="font-semibold">{row.vehicleType === 'auto' ? 'Auto-rickshaw' : 'E-rickshaw'}</p>
                      <p className="text-xs text-slate-400">
                        {row.isActive ? 'active' : 'inactive'} · night {row.nightFromHour}:00–{row.nightToHour}:00
                      </p>
                    </td>
                    <td className="tabular px-2 py-2 text-right">{fmtINR(row.baseFare)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtINR(row.perKm)}/km</td>
                    <td className="tabular px-2 py-2 text-right">{fmtINR(row.perMinute)}/min</td>
                    <td className="tabular px-2 py-2 text-right">{fmtINR(row.minFare)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtINR(row.bookingFee)}</td>
                    <td className="tabular px-2 py-2 text-right">
                      {fmtINR(row.waitingPerMin)}/min
                      <p className="text-[11px] text-slate-400">free {row.freeWaitMin}m</p>
                    </td>
                    <td className="tabular px-2 py-2 text-right">
                      ×{row.nightMultiplier}
                      <p className="text-[11px] text-slate-400">{Math.round((row.nightMultiplier - 1) * 100)}% surcharge</p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editing === row.id ? (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button className="btn-primary text-xs" disabled={busy === row.id} onClick={() => saveRow(row)}>
                            {busy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                          </button>
                          <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn-secondary text-xs" disabled={!can('finance.settings')}
                          onClick={() => setEditing(row.id)}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing && pricing.some((p) => p.id === editing) && (
            <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-3 lg:grid-cols-5 dark:border-slate-800">
              {(() => {
                const row = pricing.find((p) => p.id === editing);
                const fields = [
                  ['baseFare', 'Base fare'], ['perKm', 'Per km'], ['perMinute', 'Per minute'],
                  ['minFare', 'Minimum fare'], ['bookingFee', 'Booking fee'],
                  ['waitingPerMin', 'Waiting per min'], ['freeWaitMin', 'Free wait minutes'],
                  ['nightMultiplier', 'Night multiplier'], ['nightFromHour', 'Night from hour'],
                  ['nightToHour', 'Night to hour'],
                ];
                return fields.map(([key, label]) => (
                  <div key={key}>
                    <label className="label">{label}</label>
                    <input className="input" type="number" step="0.01" value={row[key]}
                      onChange={(e) => setPricing((cur) => cur.map((p) => (p.id === row.id ? { ...p, [key]: Number(e.target.value) } : p)))} />
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      ))}

      <p className="flex items-start gap-1.5 text-xs text-slate-400">
        <Moon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        The night multiplier applies to the distance and time components only. Changes affect new quotes — rides
        already completed keep the fare they were charged.
      </p>
    </div>
  );
}
