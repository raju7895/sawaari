import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Search, CheckCircle2, XCircle, Undo2, Banknote, Loader2 } from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import { api, fmtINR, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import StatCard from '../../components/StatCard';

const METHODS = ['', 'upi_qr', 'razorpay', 'cash'];

export default function AdminPayments() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [totals, setTotals] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [refundFor, setRefundFor] = useState(null);
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: 25, offset });
      if (status) params.set('status', status);
      if (method) params.set('method', method);
      if (q.trim()) params.set('q', q.trim());
      const res = await api.get(`/api/admin/payments?${params}`);
      setRows(res.payments);
      setTotals(res.totals);
      setTotal(res.total);
    } catch (e) { toast(e.message, 'error'); }
  }, [status, method, q, offset, toast]);
  useEffect(() => { load(); }, [load]);

  const verify = async (id) => {
    setBusy(`v-${id}`);
    try {
      await api.post(`/api/admin/payments/${id}/verify`, {});
      toast('Payment verified — booking marked paid', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const reject = async () => {
    if (rejectReason.trim().length < 3) return toast('Give a rejection reason', 'error');
    setBusy('reject');
    try {
      await api.post(`/api/admin/payments/${rejectFor.id}/reject`, { reason: rejectReason.trim() });
      toast('Payment rejected', 'info');
      setRejectFor(null); setRejectReason('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const refund = async () => {
    if (refundReason.trim().length < 3) return toast('Give a refund reason', 'error');
    setBusy('refund');
    try {
      const res = await api.post(`/api/admin/payments/${refundFor.id}/refund`, {
        amount: refundFor.amount, reason: refundReason.trim(),
      });
      toast(res.refundId ? `Refunded via Razorpay (${res.refundId.slice(0, 14)}…)` : 'Refund recorded manually', 'success');
      setRefundFor(null); setRefundReason('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const page = Math.floor(offset / 25) + 1;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><CreditCard className="h-6 w-6 text-brand-600" /> Payments</h1>
          <p className="text-sm text-slate-500">Verify UTR submissions, manage refunds — nothing is auto-marked paid</p>
        </div>
        <button className="btn-secondary" onClick={() => window.open('/api/admin/export/payments', '_blank')}>
          <Banknote className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {totals && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard icon={Banknote} label="Collected (verified)" value={totals.collected} currency tone="emerald" />
          <StatCard icon={Undo2} label="Refunded" value={totals.refunded} currency tone="violet" />
          <StatCard icon={Loader2} label="Awaiting verification" value={total} tone="amber"
            sub="current filter count" />
        </div>
      )}

      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Booking ref or UTR…" value={q}
            onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </div>
        <select className="input lg:w-44" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          {['', 'pending', 'awaiting_verification', 'paid', 'failed', 'refunded'].map((s) => (
            <option key={s} value={s}>{s === '' ? 'All statuses' : s.replace('_', ' ')}</option>
          ))}
        </select>
        <select className="input lg:w-36" value={method} onChange={(e) => { setMethod(e.target.value); setOffset(0); }}>
          {METHODS.map((m) => <option key={m} value={m}>{m === '' ? 'All methods' : m.replace('_', ' ')}</option>)}
        </select>
      </div>

      {rows === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {rows !== null && rows.length === 0 && <div className="card p-10 text-center text-sm text-slate-400">No payments match.</div>}

      <div className="space-y-2">
        {(rows || []).map((p) => (
          <div key={p.id} className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold">{p.bookingRef}</p>
                <StatusBadge status={p.status} />
                <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">
                  {p.method === 'upi_qr' ? 'UPI QR' : p.method === 'razorpay' ? 'Razorpay' : p.method}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                {p.passenger?.name} → {p.driver?.name || '—'} · {p.pickupAddress?.split(',')[0]} → {p.dropAddress?.split(',')[0]}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {fmtDateTime(p.createdAt)}
                {p.utr ? ` · UTR ${p.utr}` : ''}
                {p.rzpPaymentId ? ` · ${p.rzpPaymentId}` : ''}
                {p.verifiedAt ? ` · verified ${fmtDateTime(p.verifiedAt)}` : ''}
                {p.failureReason ? ` · ⚠ ${p.failureReason}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-lg font-extrabold">{fmtINR(p.amount)}</p>
              {p.refundedAmount > 0 && <p className="text-xs text-violet-600">refunded {fmtINR(p.refundedAmount)}</p>}
            </div>
            <div className="flex gap-2">
              {(p.status === 'awaiting_verification' || p.status === 'pending') && (
                <>
                  <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === `v-${p.id}`} onClick={() => verify(p.id)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Verify
                  </button>
                  <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => setRejectFor(p)}>
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </button>
                </>
              )}
              {p.status === 'paid' && (
                <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setRefundFor(p)}>
                  <Undo2 className="h-3.5 w-3.5" /> Refund
                </button>
              )}
            </div>
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

      {/* reject modal */}
      <Modal open={Boolean(rejectFor)} onClose={() => setRejectFor(null)} title="Reject this payment?">
        <p className="mb-3 text-sm text-slate-500">
          The passenger will be asked to check their UTR or pay again. The booking stays unpaid.
        </p>
        <textarea className="input min-h-20" maxLength={300} value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="e.g. UTR not found in the settlement report" />
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setRejectFor(null)}>Cancel</button>
          <button className="btn-danger flex-1" disabled={busy === 'reject'} onClick={reject}>{busy === 'reject' ? 'Rejecting…' : 'Reject payment'}</button>
        </div>
      </Modal>

      {/* refund modal */}
      <Modal open={Boolean(refundFor)} onClose={() => setRefundFor(null)} title="Refund this payment?">
        <p className="mb-3 text-sm text-slate-500">
          Refunding {refundFor && <b>{fmtINR(refundFor.amount)}</b>} for ride {refundFor?.bookingRef}.
          {refundFor?.method === 'razorpay' && refundFor?.rzpPaymentId
            ? ' This will be processed through the Razorpay gateway.'
            : ' This is a manual refund record (UPI/cash settle directly between passenger and driver).'}
        </p>
        <textarea className="input min-h-20" maxLength={300} value={refundReason}
          onChange={(e) => setRefundReason(e.target.value)}
          placeholder="e.g. Ride cancelled by driver after payment" />
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setRefundFor(null)}>Cancel</button>
          <button className="btn-primary flex-1" disabled={busy === 'refund'} onClick={refund}>
            <Undo2 className="h-4 w-4" /> {busy === 'refund' ? 'Refunding…' : 'Process refund'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
