import { listMyPayments } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, StatusBadge, useAsync } from '../../components/ui';
import { fmtINR } from '../../lib/format';

export default function Payments() {
  const payments = useAsync(() => listMyPayments(), []);

  const total = (payments.data || []).reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <Card title="Payments">
      <ErrorNote message={payments.error} onRetry={payments.reload} />
      {payments.loading ? <Loading /> : null}
      {!payments.loading && !payments.error && (payments.data || []).length === 0 ? (
        <Empty label="No payments yet." />
      ) : null}

      {(payments.data || []).length ? (
        <p className="mb-3 text-sm text-slate-500">Total: <b className="text-slate-900 dark:text-slate-100">{fmtINR(total)}</b></p>
      ) : null}

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {(payments.data || []).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.ref || 'Ride'}</p>
              <p className="text-xs text-slate-500">
                {new Date(p.createdAt).toLocaleString('en-IN')} · {p.method}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={p.status} />
              <span className="font-bold">{fmtINR(p.amount)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
