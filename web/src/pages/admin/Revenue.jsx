import { useCallback, useEffect, useState } from 'react';
import {
  Banknote, Download, Wallet, Percent, Loader2, RefreshCw, Users, TrendingUp, FileSpreadsheet,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import StatCard from '../../components/StatCard';
import { api, fmtINR, fmtDate } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

const RANGES = [['day', 'Today'], ['week', '7 days'], ['month', '30 days'], ['quarter', '90 days'], ['year', '12 months']];

export default function AdminRevenue() {
  const toast = useToast();
  const can = usePermission();
  const [range, setRange] = useState('month');
  const [data, setData] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/master/revenue?range=${range}`);
      setData(res);
      if (can('finance.view')) {
        const s = await api.get('/api/master/settlements');
        setSettlements(s.settlements);
      }
    } catch (e) { toast(e.message, 'error'); }
  }, [range, toast, can]);

  useEffect(() => { load(); }, [load]);

  const markPaid = async (s) => {
    const reference = window.prompt(`Settlement reference (UTR / transaction id) for ${s.driverName}:`);
    if (!reference) return;
    setBusy(s.id);
    try {
      await api.post(`/api/master/settlements/${s.id}/paid`, { reference });
      toast('Settlement marked paid', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const createSettlement = async () => {
    const driverId = window.prompt('Driver profile id:');
    if (!driverId) return;
    const periodStart = window.prompt('Period start (YYYY-MM-DD):');
    const periodEnd = window.prompt('Period end (YYYY-MM-DD):');
    if (!periodStart || !periodEnd) return;
    setBusy('new');
    try {
      await api.post('/api/master/settlements', { driverProfileId: driverId.trim(), periodStart, periodEnd });
      toast('Settlement created from recorded earnings', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <Banknote className="h-6 w-6 text-brand-600" /> Revenue &amp; earnings
          </h1>
          <p className="text-sm text-slate-500">
            Figures come from the driver_earnings ledger — payments are never edited to change revenue
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => window.open('/api/admin/export/revenue', '_blank')}>
            <Download className="h-4 w-4" /> Revenue CSV
          </button>
          <button className="btn-secondary" onClick={() => window.open('/api/admin/export/settlements', '_blank')}>
            <FileSpreadsheet className="h-4 w-4" /> Settlements CSV
          </button>
          <button className="btn-ghost" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RANGES.map(([value, label]) => (
          <button key={value} onClick={() => setRange(value)}
            className={`badge px-3.5 py-1.5 ${range === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {!data && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Wallet} label="Gross fares" value={data.totals.gross} currency tone="blue"
              sub={`${data.totals.rides} completed rides`} />
            <StatCard icon={Percent} label="Platform commission" value={data.totals.commission} currency tone="emerald"
              sub="earnings retained by Sawaari" />
            <StatCard icon={Users} label="Driver payouts" value={data.totals.net} currency tone="violet"
              sub="net of commission" />
            <StatCard icon={TrendingUp} label="Pending payments" value={data.pendingPayments.amount} currency tone="amber"
              sub={`${data.pendingPayments.count} awaiting verification`} />
          </div>

          <div className="card p-5">
            <p className="mb-3 text-sm font-bold">Daily earnings breakdown</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtINR(v)} />
                  <Legend />
                  <Bar dataKey="gross" name="Gross fares" fill="#0d9488" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="commission" name="Commission" fill="#f59e0b" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="net" name="Driver payout" fill="#8b5cf6" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-hidden">
              <p className="border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">Driver-wise earnings</p>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className="px-4 py-2">Driver</th>
                      <th className="px-2 py-2 text-right">Rides</th>
                      <th className="px-2 py-2 text-right">Gross</th>
                      <th className="px-2 py-2 text-right">Fee</th>
                      <th className="px-4 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.drivers.map((d) => (
                      <tr key={d.driverProfileId}>
                        <td className="px-4 py-2">
                          <p className="font-semibold">{d.name}</p>
                          <p className="tabular text-xs text-slate-400">{d.phone}</p>
                        </td>
                        <td className="tabular px-2 py-2 text-right">{d.rides}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtINR(d.gross)}</td>
                        <td className="tabular px-2 py-2 text-right text-amber-600">{fmtINR(d.commission)}</td>
                        <td className="tabular px-4 py-2 text-right font-semibold">{fmtINR(d.net)}</td>
                      </tr>
                    ))}
                    {data.drivers.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No earnings in this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card overflow-hidden">
              <p className="border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">Payment method analytics</p>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.methods.map((m) => (
                  <div key={m.method} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="font-semibold uppercase">{m.method}</span>
                    <span className="text-xs text-slate-400">{m.paid} settled of {m.payments}</span>
                    <span className="tabular font-bold">{fmtINR(m.amount)}</span>
                  </div>
                ))}
                {data.methods.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">No payments in this period.</p>
                )}
              </div>
              {data.cashRecords.length > 0 && (
                <>
                  <p className="border-t border-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                    Cash payments
                  </p>
                  <div className="max-h-40 overflow-auto">
                    {data.cashRecords.map((c) => (
                      <div key={c.id} className="flex items-center justify-between px-4 py-2 text-xs">
                        <span className="font-mono">{c.bookingRef}</span>
                        <span className="truncate px-2 text-slate-400">{c.passenger} → {c.driver}</span>
                        <span className="tabular font-bold">{fmtINR(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* settlements */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
              <p className="text-sm font-bold">Driver settlements</p>
              <button className="btn-secondary text-xs" onClick={createSettlement} disabled={busy === 'new'}>
                {busy === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} New settlement
              </button>
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-2">Driver</th>
                    <th className="px-2 py-2">Period</th>
                    <th className="px-2 py-2 text-right">Rides</th>
                    <th className="px-2 py-2 text-right">Net</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {settlements.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2">
                        <p className="font-semibold">{s.driverName}</p>
                        <p className="tabular text-xs text-slate-400">{s.driverPhone}</p>
                      </td>
                      <td className="px-2 py-2 text-xs">{fmtDate(s.periodStart)} → {fmtDate(s.periodEnd)}</td>
                      <td className="tabular px-2 py-2 text-right">{s.rides}</td>
                      <td className="tabular px-2 py-2 text-right font-semibold">{fmtINR(s.net)}</td>
                      <td className="px-2 py-2">
                        <span className={`badge ${s.status === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {s.status !== 'paid' && (
                          <button className="btn-ghost text-xs" onClick={() => markPaid(s)}>Mark paid</button>
                        )}
                        {s.reference && <p className="text-xs text-slate-400">{s.reference}</p>}
                      </td>
                    </tr>
                  ))}
                  {settlements.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No settlements recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
