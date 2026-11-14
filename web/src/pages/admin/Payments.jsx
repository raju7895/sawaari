import { useState } from 'react';
import { adminListPayments, adminRefundPayment } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, StatusBadge, Notice, ConfirmDialog, useAsync } from '../../components/ui';
import { fmtINR, fmtDateTime } from '../../lib/format';

const FILTERS = ['', 'pending', 'paid', 'refunded', 'failed'];

export default function Payments() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [confirm, setConfirm] = useState(null);
  const limit = 25;

  const payments = useAsync(() => adminListPayments({ status, limit, offset: page * limit }), [status, page]);
  const rows = payments.data?.rows || [];

  const refund = async () => {
    if (!confirm) return;
    setBusy(true); setError(''); setOk('');
    try {
      await adminRefundPayment(confirm.id);
      setOk('The payment was marked as refunded.');
      setConfirm(null);
      payments.reload();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => { setStatus(f); setPage(0); }}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              status === f ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>

      <Card title={`Payments (${payments.data?.total ?? 0})`}>
        {payments.loading ? <Loading /> : null}
        {!payments.loading && rows.length === 0 ? <Empty label="No payments yet." /> : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-slate-800">
                <th className="py-2">Ride</th>
                <th className="py-2">Method</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Status</th>
                <th className="py-2">When</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{p.rides?.ref || '—'}</td>
                  <td className="py-2 capitalize">{p.method}</td>
                  <td className="py-2 font-semibold">{fmtINR(p.amount)}</td>
                  <td className="py-2"><StatusBadge status={p.status} /></td>
                  <td className="py-2 text-slate-500">{fmtDateTime(p.created_at)}</td>
                  <td className="py-2 text-right">
                    {p.status !== 'refunded' ? (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirm(p)}>Refund</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-slate-500">Page {page + 1}</span>
          <button type="button" className="btn-ghost" disabled={rows.length < limit} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Mark this payment as refunded?"
        message={confirm ? `${fmtINR(confirm.amount)} will be marked as refunded.` : ''}
        confirmLabel="Mark refunded"
        busy={busy}
        onConfirm={refund}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
