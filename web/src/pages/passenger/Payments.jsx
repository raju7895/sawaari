import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Wallet, CheckCircle2, Clock, XCircle, Undo2 } from 'lucide-react';
import { api, fmtINR, fmtDateTime } from '../../api';
import StatusBadge from '../../components/StatusBadge';

const METHOD_ICON = {
  upi_qr: <Wallet className="h-4 w-4" />,
  razorpay: <CreditCard className="h-4 w-4" />,
  cash: <Wallet className="h-4 w-4" />,
};

export default function PassengerPayments() {
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/payments/mine')
      .then(setPayments)
      .catch((e) => setError(e.message));
  }, []);

  const totalPaid = (payments || []).filter((p) => p.status === 'paid')
    .reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <CreditCard className="h-6 w-6 text-brand-600" /> Payments
          </h1>
          <p className="text-sm text-slate-500">Your Sawaari payment history</p>
        </div>
        {payments && payments.length > 0 && (
          <div className="card px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total paid</p>
            <p className="tabular text-lg font-extrabold text-emerald-600">{fmtINR(totalPaid)}</p>
          </div>
        )}
      </div>

      {error && <p className="card p-4 text-sm text-red-600">{error}</p>}
      {payments === null && !error && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      {payments !== null && payments.length === 0 && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <Wallet className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No payments yet. They appear here after a ride is paid.</p>
          <Link to="/app/book" className="btn-primary">Book an auto</Link>
        </div>
      )}

      <div className="space-y-3">
        {(payments || []).map((p) => (
          <div key={p.id} className="card p-4">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold">{p.bookingRef || 'Payment'}</p>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                  {p.pickupAddress?.split(',')[0]} <span className="text-slate-400">→</span> {p.dropAddress?.split(',')[0]}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                  {METHOD_ICON[p.method] || <Wallet className="h-4 w-4" />}
                  {p.method === 'upi_qr' ? 'UPI (QR / intent)' : p.method === 'razorpay' ? 'Online (Razorpay)' : p.method}
                  · {fmtDateTime(p.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular text-lg font-extrabold">{fmtINR(p.amount)}</p>
                {p.status === 'awaiting_verification' && (
                  <p className="flex items-center justify-end gap-1 text-xs text-amber-600">
                    <Clock className="h-3.5 w-3.5" /> Verifying UTR
                  </p>
                )}
                {p.status === 'paid' && (
                  <p className="flex items-center justify-end gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {p.verifiedAt ? 'Verified' : 'Paid'}
                  </p>
                )}
                {p.status === 'failed' && (
                  <p className="flex items-center justify-end gap-1 text-xs text-red-600"><XCircle className="h-3.5 w-3.5" /> Failed</p>
                )}
                {p.status === 'refunded' && (
                  <p className="flex items-center justify-end gap-1 text-xs text-violet-600"><Undo2 className="h-3.5 w-3.5" /> Refunded {fmtINR(p.refundedAmount || 0)}</p>
                )}
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <Link to={`/app/ride/${p.bookingId}`} className="link text-xs font-semibold">View ride →</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
