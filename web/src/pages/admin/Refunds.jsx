import { useCallback, useEffect, useState } from 'react';
import {
  RotateCcw, Loader2, Download, AlertTriangle, BadgeIndianRupee, CheckCircle2, XCircle, Banknote,
} from 'lucide-react';
import StatCard from '../../components/StatCard';
import { api, fmtINR, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

export default function AdminRefunds() {
  const toast = useToast();
  const can = usePermission();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/master/refunds');
      setData(res);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const complete = async (refund) => {
    const notes = window.prompt(`Mark this ${fmtINR(refund.amount)} refund as settled.\nReference / note:`);
    if (notes === null) return;
    setBusy(refund.id);
    try {
      await api.post(`/api/master/refunds/${refund.id}/complete`, { notes: notes || undefined });
      toast('Refund marked as completed', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const refundable = (data ? data.refunds : []).filter((r) => r.status !== 'completed' && r.status !== 'rejected');
  const totalRefunded = (data ? data.refunds : [])
    .filter((r) => r.status === 'completed')
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <RotateCcw className="h-6 w-6 text-brand-600" /> Refunds
          </h1>
          <p className="text-sm text-slate-500">
            Refunds are recorded as new entries — the original payment row is never modified
          </p>
        </div>
        <button className="btn-secondary" onClick={() => window.open('/api/admin/export/refunds', '_blank')}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={RotateCcw} label="Refund records" value={data ? data.refunds.length : 0} tone="violet" />
        <StatCard icon={Banknote} label="Settled refunds" value={totalRefunded} currency tone="emerald"
          sub="money returned to riders" />
        <StatCard icon={AlertTriangle} label="Open refunds" value={refundable.length} tone="amber"
          sub={data && !data.gatewayConfigured ? 'gateway not configured — settle manually' : 'awaiting settlement'} />
      </div>

      {!data && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      {data && !data.gatewayConfigured && (
        <div className="card flex items-start gap-3 border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            The payment gateway is not configured on this server, so refunds cannot be pushed to Razorpay.
            Record them with the <b>manual</b> method and settle through the original payment channel — the
            refund keeps a full reference trail either way.
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {data && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">Ride</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Method</th>
                <th className="px-2 py-2">Reason</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.refunds.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-xs font-semibold">{r.bookingRef || '—'}</p>
                    <p className="text-xs text-slate-400">{r.passenger} {r.driver ? `→ ${r.driver}` : ''}</p>
                    <p className="text-[11px] text-slate-400">{fmtDateTime(r.createdAt)}</p>
                  </td>
                  <td className="tabular px-2 py-2.5 font-semibold">{fmtINR(r.amount)}</td>
                  <td className="px-2 py-2.5 text-xs uppercase">{r.method}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-600 dark:text-slate-300">{r.reason}</td>
                  <td className="px-2 py-2.5">
                    <span className={`badge ${r.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : r.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                      {r.status}
                    </span>
                    {r.gatewayRef && <p className="mt-0.5 font-mono text-[11px] text-slate-400">{r.gatewayRef}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.status !== 'completed' && can('payments.refund') && (
                      <button className="btn-ghost text-xs" disabled={busy === r.id} onClick={() => complete(r)}>
                        {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Mark settled
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.refunds.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  No refunds have been issued on this platform yet.
                </td></tr>
              )}
            </tbody>
          </table>
          )}
        </div>
      </div>
    </div>
  );
}
