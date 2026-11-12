import { useCallback, useEffect, useState } from 'react';
import {
  Car, Search, CheckCircle2, XCircle, FileText, QrCode, Phone, Star, Loader2, ShieldAlert,
} from 'lucide-react';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import Avatar from '../../components/Avatar';
import { StarDisplay } from '../../components/StarRating';
import { api, fmtINR, fmtDate } from '../../api';
import { useToast } from '../../context/ToastContext';

const TABS = [
  ['pending', 'Pending review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['', 'All drivers'],
];

export default function AdminDrivers() {
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState(null); // driver detail object
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: 50 });
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const res = await api.get(`/api/admin/drivers?${params}`);
      setRows(res.drivers);
      setTotal(res.total);
    } catch (e) { toast(e.message, 'error'); }
  }, [status, q, toast]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    try {
      setDetail(await api.get(`/api/admin/drivers/${id}`));
    } catch (e) { toast(e.message, 'error'); }
  };

  const approve = async (id) => {
    setBusy(`approve-${id}`);
    try {
      await api.post(`/api/admin/drivers/${id}/approve`, {});
      toast('Driver approved — they can go online now', 'success');
      setDetail(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const reject = async () => {
    if (rejectReason.trim().length < 5) return toast('Give a short reason for the rejection', 'error');
    setBusy('reject');
    try {
      await api.post(`/api/admin/drivers/${rejectFor}/reject`, { reason: rejectReason.trim() });
      toast('Driver rejected', 'info');
      setRejectFor(null); setRejectReason(''); setDetail(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const reviewDoc = async (docId, reviewStatus, note) => {
    setBusy(`doc-${docId}`);
    try {
      await api.post(`/api/admin/documents/${docId}/review`, { status: reviewStatus, note });
      toast(`Document ${reviewStatus}`, 'success');
      if (detail) await openDetail(detail.id);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const verifyUpi = async (id, verified) => {
    setBusy(`upi-${id}`);
    try {
      await api.post(`/api/admin/drivers/${id}/verify-upi`, { verified });
      toast(verified ? 'UPI ID verified' : 'UPI verification revoked', 'success');
      if (detail) await openDetail(detail.id);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Car className="h-6 w-6 text-brand-600" /> Driver verification</h1>
          <p className="text-sm text-slate-500">Verify documents before approving drivers on the platform</p>
        </div>
        <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{total} drivers</span>
      </div>

      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setStatus(key)}
              className={`badge whitespace-nowrap px-3 py-1.5 ${status === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows === null && <p className="py-10 text-center text-sm text-slate-400">Loading drivers…</p>}
      {rows !== null && rows.length === 0 && (
        <div className="card p-10 text-center text-sm text-slate-400">
          {status === 'pending' ? '🎉 No drivers waiting for review.' : 'No drivers match this filter.'}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(rows || []).map((d) => (
          <button key={d.id} onClick={() => openDetail(d.id)} className="card flex items-center gap-3 p-4 text-left hover:shadow-md">
            <Avatar name={d.name} src={d.avatar_url} size={46} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-bold">{d.name}</p>
                {!d.is_active && <span className="badge bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">blocked</span>}
              </div>
              <p className="tabular text-xs text-slate-500">+91 {d.phone}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={d.verification_status} />
                {d.vehicle && <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{d.vehicle.registrationNumber}</span>}
                <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">
                  {d.doc_verified}/{d.doc_count} docs verified
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* driver detail modal */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `Driver · ${detail.name}` : ''} wide>
        {detail && (
          <div className="space-y-5">
            {/* identity */}
            <div className="flex items-center gap-4">
              <Avatar name={detail.name} src={detail.avatarUrl} size={64} />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-extrabold">{detail.name}</p>
                <p className="tabular text-sm text-slate-500">+91 {detail.phone} {detail.email ? `· ${detail.email}` : ''}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.verificationStatus} />
                  {detail.isOnline && <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">online</span>}
                  {!detail.isActive && <span className="badge bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">blocked</span>}
                  <StarDisplay value={detail.rating.avg} count={detail.rating.count} size={12} />
                </div>
              </div>
            </div>

            {/* stats */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800">
                <p className="text-[10px] font-bold uppercase text-slate-400">Rides</p>
                <p className="tabular font-extrabold">{detail.ridesCompleted}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800">
                <p className="text-[10px] font-bold uppercase text-slate-400">Cancelled</p>
                <p className="tabular font-extrabold">{detail.ridesCancelled}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800">
                <p className="text-[10px] font-bold uppercase text-slate-400">Net earned</p>
                <p className="tabular font-extrabold">{fmtINR(detail.earnings.net)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800">
                <p className="text-[10px] font-bold uppercase text-slate-400">Commission</p>
                <p className="tabular font-extrabold">{fmtINR(detail.earnings.commission)}</p>
              </div>
            </div>

            {/* vehicle */}
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold"><Car className="h-4 w-4 text-brand-600" /> Vehicle</p>
              {detail.vehicle ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  <span className="font-bold">{detail.vehicle.registrationNumber}</span> · {detail.vehicle.vehicleType === 'auto' ? 'Auto-rickshaw' : 'E-rickshaw'}
                  {detail.vehicle.model ? ` · ${detail.vehicle.model}` : ''} · {detail.vehicle.capacity} seats
                </p>
              ) : <p className="text-sm text-slate-400">No vehicle registered.</p>}
            </div>

            {/* documents */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><FileText className="h-4 w-4 text-brand-600" /> Documents</p>
              {detail.documents.length === 0 && (
                <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-400 dark:bg-slate-800">No documents uploaded yet — approve only after documents arrive.</p>
              )}
              <div className="space-y-2">
                {detail.documents.map((doc) => (
                  <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold capitalize">{doc.doc_type.replace('_', ' ')}{doc.doc_number ? ` · ${doc.doc_number}` : ''}</p>
                      <p className="text-xs text-slate-400">uploaded {fmtDate(doc.created_at)}{doc.review_note ? ` · note: ${doc.review_note}` : ''}</p>
                    </div>
                    <StatusBadge status={doc.status} />
                    <a href={doc.file_url} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-1.5 text-xs">View file</a>
                    {doc.status !== 'verified' && (
                      <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === `doc-${doc.id}`}
                        onClick={() => reviewDoc(doc.id, 'verified')}>
                        {busy === `doc-${doc.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Verify
                      </button>
                    )}
                    {doc.status !== 'rejected' && (
                      <button className="btn-danger px-3 py-1.5 text-xs" disabled={busy === `doc-${doc.id}`}
                        onClick={() => reviewDoc(doc.id, 'rejected', 'Could not read the document')}>
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* UPI */}
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold"><QrCode className="h-4 w-4 text-brand-600" /> UPI payout ID</p>
              {detail.upiId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-lg bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800">{detail.upiId}</code>
                  <StatusBadge status={detail.upiVerified ? 'verified' : 'pending'} />
                  <button className={detail.upiVerified ? 'btn-secondary px-3 py-1.5 text-xs' : 'btn-primary px-3 py-1.5 text-xs'}
                    disabled={busy === `upi-${detail.id}`}
                    onClick={() => verifyUpi(detail.id, !detail.upiVerified)}>
                    {detail.upiVerified ? 'Revoke verification' : 'Verify UPI ID'}
                  </button>
                </div>
              ) : <p className="text-sm text-slate-400">No UPI ID set — this driver receives cash only.</p>}
            </div>

            {/* recent rides */}
            {detail.recentRides.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-bold">Recent rides</p>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {detail.recentRides.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-2 text-sm">
                      <span className="font-semibold">{r.ref}</span>
                      <StatusBadge status={r.status} />
                      <span className="tabular">{r.finalFare ? fmtINR(r.finalFare) : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* actions */}
            {detail.verificationStatus !== 'approved' && (
              <div className="flex gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                <button className="btn-primary flex-1" disabled={busy === `approve-${detail.id}`}
                  onClick={() => approve(detail.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Approve driver
                </button>
                <button className="btn-danger flex-1" onClick={() => setRejectFor(detail.id)}>
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </div>
            )}
            {detail.rejectionReason && (
              <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Rejection reason: {detail.rejectionReason}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* reject reason modal */}
      <Modal open={Boolean(rejectFor)} onClose={() => setRejectFor(null)} title="Reject this driver?">
        <p className="mb-3 text-sm text-slate-500">
          The driver will see this reason and can re-upload corrected documents.
        </p>
        <textarea className="input min-h-24" placeholder="e.g. Licence photo was blurred; please re-upload a clear scan"
          maxLength={500} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setRejectFor(null)}>Cancel</button>
          <button className="btn-danger flex-1" disabled={busy === 'reject'} onClick={reject}>
            {busy === 'reject' ? 'Rejecting…' : 'Reject driver'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
