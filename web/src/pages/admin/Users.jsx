import { useCallback, useEffect, useState } from 'react';
import {
  Users, Search, Ban, RotateCcw, Phone, Mail, UserX, Clock, Trash2, Eye, Pencil,
  ShieldCheck, CalendarDays, AlertTriangle, CheckCircle2, Loader2, History, CreditCard, Flag,
} from 'lucide-react';
import Modal from '../../components/Modal';
import Avatar from '../../components/Avatar';
import StatusBadge from '../../components/StatusBadge';
import { api, fmtINR, fmtDate, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';
import { isAdminRole } from '../../roles';

const ROLE_TABS = [
  ['', 'Everyone'],
  ['passenger', 'Passengers'],
  ['driver', 'Drivers'],
  ['admin', 'Admins'],
];

const STATUS_TABS = [
  ['', 'Any status'],
  ['true', 'Active'],
  ['false', 'Blocked'],
];

export default function AdminUsers() {
  const toast = useToast();
  const can = usePermission();
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState('');
  const [blocked, setBlocked] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState([]);
  const [blockFor, setBlockFor] = useState(null);
  const [blockReason, setBlockReason] = useState('');
  const [suspendFor, setSuspendFor] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendHours, setSuspendHours] = useState('24');
  const [deactivateFor, setDeactivateFor] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [editFor, setEditFor] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '' });
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('profile');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState('block');
  const [bulkReason, setBulkReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: 25, offset });
      if (q.trim()) params.set('q', q.trim());
      if (roleF) params.set('roleF', roleF);
      if (blocked) params.set('blocked', blocked);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
      const res = await api.get(`/api/admin/users?${params}`);
      setRows(res.users);
      setTotal(res.total);
      setSelected((cur) => cur.filter((id) => res.users.some((u) => u.id === id)));
    } catch (e) { toast(e.message, 'error'); }
  }, [q, roleF, blocked, from, to, offset, toast]);
  useEffect(() => { load(); }, [load]);

  const doBlock = async (block) => {
    setBusy('block');
    try {
      await api.post(`/api/admin/users/${blockFor.id}/block`, { blocked: block, reason: block ? blockReason.trim() || undefined : undefined });
      toast(block ? 'User blocked' : 'User unblocked', 'success');
      setBlockFor(null); setBlockReason('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const doSuspend = async () => {
    if (suspendReason.trim().length < 3) return toast('Give a reason', 'error');
    setBusy('suspend');
    try {
      await api.post(`/api/admin/users/${suspendFor.id}/suspend`, {
        suspend: true, reason: suspendReason.trim(), hours: Number(suspendHours) || undefined,
      });
      toast('Account suspended', 'success');
      setSuspendFor(null); setSuspendReason(''); setSuspendHours('24');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const doReactivate = async (user) => {
    setBusy(user.id);
    try {
      await api.post(`/api/admin/users/${user.id}/suspend`, { suspend: false, reason: 'Reactivated by administrator' });
      toast('Account reactivated', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const doDeactivate = async () => {
    if (deactivateReason.trim().length < 5) return toast('Give a clear reason (min 5 characters)', 'error');
    setBusy('deactivate');
    try {
      await api.post(`/api/admin/users/${deactivateFor.id}/deactivate`, { reason: deactivateReason.trim() });
      toast('Account deactivated — financial and ride records retained', 'success');
      setDeactivateFor(null); setDeactivateReason('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const doEdit = async () => {
    setBusy('edit');
    try {
      await api.patch(`/api/admin/users/${editFor.id}`, {
        name: editForm.name.trim(),
        email: editForm.email.trim() || undefined,
      });
      toast('User details updated', 'success');
      setEditFor(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const openDetail = async (user) => {
    setDetail({ user, loading: true });
    setDetailTab('profile');
    try {
      const res = await api.get(`/api/admin/users/${user.id}`);
      setDetail(res);
    } catch (e) { toast(e.message, 'error'); setDetail(null); }
  };

  const runBulk = async () => {
    if (!bulkReason.trim()) return toast('Give a reason for the bulk action', 'error');
    setBusy('bulk');
    try {
      const res = await api.post('/api/admin/users/bulk', {
        userIds: selected, action: bulkAction, reason: bulkReason.trim(),
        hours: bulkAction === 'suspend' ? 24 : undefined,
      });
      toast(res.message, 'success');
      setBulkOpen(false); setBulkReason(''); setSelected([]);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const toggleSelect = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const page = Math.floor(offset / 25) + 1;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Users className="h-6 w-6 text-brand-600" /> Users</h1>
          <p className="text-sm text-slate-500">Search, review and control every account on the platform</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.length > 0 && can('users.bulk') && (
            <button className="btn-primary" onClick={() => setBulkOpen(true)}>
              <ShieldCheck className="h-4 w-4" /> Bulk action ({selected.length})
            </button>
          )}
          <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{total} accounts</span>
        </div>
      </div>

      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, phone or email…" value={q}
            onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </div>
        <div className="flex flex-wrap gap-1">
          {ROLE_TABS.map(([key, label]) => (
            <button key={key} onClick={() => { setRoleF(key); setOffset(0); }}
              className={`badge px-3 py-1.5 ${roleF === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map(([key, label]) => (
            <button key={key} onClick={() => { setBlocked(key); setOffset(0); }}
              className={`badge px-3 py-1.5 ${blocked === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          <input className="input w-36" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} />
          <span className="text-xs text-slate-400">to</span>
          <input className="input w-36" type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} />
        </div>
      </div>

      {rows === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {rows !== null && rows.length === 0 && <div className="card p-10 text-center text-sm text-slate-400">No users match.</div>}

      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {(rows || []).map((u) => (
          <div key={u.id} className="flex items-center gap-3 p-3.5">
            {can('users.bulk') && u.role !== 'admin' && (
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={selected.includes(u.id)} onChange={() => toggleSelect(u.id)} />
            )}
            <Avatar name={u.name} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-bold">{u.name}</p>
                <span className={`badge ${isAdminRole(u.role) ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : u.role === 'driver' ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                  {u.role}
                </span>
                {!u.is_active && <span className="badge bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">blocked</span>}
                {u.deactivated_at && <span className="badge bg-slate-200 text-slate-600 dark:bg-slate-700">deactivated</span>}
                {u.blocked_reason && <span className="truncate text-xs text-slate-400">· {u.blocked_reason}</span>}
              </div>
              <p className="truncate text-xs text-slate-400">
                <span className="tabular">+91 {u.phone}</span>
                {u.email ? ` · ${u.email}` : ''}
                {u.rides > 0 ? ` · ${u.rides} rides` : ''}
                {` · joined ${fmtDate(u.created_at)}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => openDetail(u)}>
                <Eye className="h-3.5 w-3.5" /> View
              </button>
              {can('users.edit') && u.role !== 'admin' && (
                <button className="btn-ghost px-2.5 py-1.5 text-xs"
                  onClick={() => { setEditFor(u); setEditForm({ name: u.name, email: u.email || '' }); }}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              )}
              {u.role !== 'admin' && u.is_active && can('users.block') && (
                <button className="btn-danger px-2.5 py-1.5 text-xs" onClick={() => setBlockFor(u)}>
                  <Ban className="h-3.5 w-3.5" /> Block
                </button>
              )}
              {u.role !== 'admin' && !u.is_active && can('users.suspend') && !u.deactivated_at && (
                <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => doReactivate(u)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </button>
              )}
              {u.role !== 'admin' && can('users.suspend') && u.is_active && (
                <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setSuspendFor(u)}>
                  <Clock className="h-3.5 w-3.5" /> Suspend
                </button>
              )}
              {u.role !== 'admin' && can('users.deactivate') && u.is_active && (
                <button className="btn-ghost px-2.5 py-1.5 text-xs text-red-600" onClick={() => setDeactivateFor(u)}>
                  <Trash2 className="h-3.5 w-3.5" /> Deactivate
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

      {/* block modal */}
      <Modal open={Boolean(blockFor)} onClose={() => setBlockFor(null)}
        title={blockFor && blockFor.is_active ? `Block ${blockFor?.name}?` : `Unblock ${blockFor?.name}?`}>
        {blockFor && blockFor.is_active ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> <span className="tabular">+91 {blockFor.phone}</span></p>
              {blockFor.email && <p className="mt-1 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {blockFor.email}</p>}
            </div>
            <div>
              <label className="label">Reason (shared with the user)</label>
              <textarea className="input min-h-20" maxLength={300} value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="e.g. Repeated ride cancellations after acceptance" />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setBlockFor(null)}>Cancel</button>
              <button className="btn-danger flex-1" disabled={busy === 'block'} onClick={() => doBlock(true)}>
                <Ban className="h-4 w-4" /> {busy === 'block' ? 'Blocking…' : 'Block account'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Restore access for this user? They will be able to log in and book/accept rides again.</p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setBlockFor(null)}>Cancel</button>
              <button className="btn-primary flex-1" disabled={busy === 'block'} onClick={() => doBlock(false)}>
                <RotateCcw className="h-4 w-4" /> Unblock
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* suspend modal */}
      <Modal open={Boolean(suspendFor)} onClose={() => setSuspendFor(null)} title={`Suspend ${suspendFor?.name || ''}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            A suspended account cannot book or accept rides. The account keeps its history and can be restored.
          </p>
          <div>
            <label className="label">Reason</label>
            <textarea className="input min-h-20" maxLength={300} value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)} placeholder="Why is this account being suspended?" />
          </div>
          <div>
            <label className="label">Duration (hours)</label>
            <input className="input" type="number" min="1" max="2160" value={suspendHours}
              onChange={(e) => setSuspendHours(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setSuspendFor(null)}>Cancel</button>
            <button className="btn-danger flex-1" disabled={busy === 'suspend'} onClick={doSuspend}>
              <Clock className="h-4 w-4" /> {busy === 'suspend' ? 'Suspending…' : 'Suspend account'}
            </button>
          </div>
        </div>
      </Modal>

      {/* deactivate modal */}
      <Modal open={Boolean(deactivateFor)} onClose={() => setDeactivateFor(null)} title={`Deactivate ${deactivateFor?.name || ''}`}>
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Deactivation is permanent: the account can no longer log in, book or accept rides.
            Bookings, payments and reports are never deleted — they are retained for legal and accounting records.
          </p>
          <div>
            <label className="label">Reason (recorded in the audit log)</label>
            <textarea className="input min-h-20" maxLength={300} value={deactivateReason}
              onChange={(e) => setDeactivateReason(e.target.value)} placeholder="Why is this account being deactivated?" />
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setDeactivateFor(null)}>Cancel</button>
            <button className="btn-danger flex-1" disabled={busy === 'deactivate'} onClick={doDeactivate}>
              <UserX className="h-4 w-4" /> {busy === 'deactivate' ? 'Deactivating…' : 'Deactivate permanently'}
            </button>
          </div>
        </div>
      </Modal>

      {/* edit modal */}
      <Modal open={Boolean(editFor)} onClose={() => setEditFor(null)} title={`Edit ${editFor?.name || ''}`}>
        <div className="space-y-3">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Email address</label>
            <input className="input" type="email" value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="Leave empty to keep as is" />
          </div>
          <p className="text-xs text-slate-400">
            Mobile numbers and ride history cannot be edited — they are legally significant records.
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setEditFor(null)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy === 'edit'} onClick={doEdit}>
              {busy === 'edit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save changes
            </button>
          </div>
        </div>
      </Modal>

      {/* bulk modal */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={`Bulk action on ${selected.length} account(s)`}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {[['block', 'Block'], ['unblock', 'Restore'], ['suspend', 'Suspend 24h'], ['reactivate', 'Reactivate']].map(([v, l]) => (
              <button key={v} onClick={() => setBulkAction(v)}
                className={`badge px-3.5 py-2 ${bulkAction === v ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                {l}
              </button>
            ))}
          </div>
          <div>
            <label className="label">Reason</label>
            <textarea className="input min-h-20" maxLength={300} value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)} placeholder="Recorded against every affected account" />
          </div>
          <p className="text-xs text-slate-400">
            The platform owner is excluded automatically — bulk actions can never touch that account.
          </p>
          <button className="btn-danger w-full" disabled={busy === 'bulk'} onClick={runBulk}>
            {busy === 'bulk' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Apply to {selected.length} account(s)
          </button>
        </div>
      </Modal>

      {/* user detail */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} wide
        title={detail?.user ? `${detail.user.name} · ${detail.user.phone}` : ''}>
        {detail && (
          <div className="space-y-4">
            {detail.loading && <p className="py-6 text-center text-sm text-slate-400">Loading profile…</p>}
            {detail.user && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800">{detail.user.role}</span>
                  <StatusBadge status={detail.user.isActive ? 'approved' : 'rejected'} />
                  {detail.user.verificationStatus && <StatusBadge status={detail.user.verificationStatus} />}
                  {detail.user.phoneVerified ? <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">phone verified</span> : null}
                  {detail.user.emailVerifiedAt ? <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">email verified</span> : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  {[
                    ['Rides', detail.user.ridesCompleted ?? (detail.bookings || []).length],
                    ['Rating', (detail.user.rating ?? 0).toFixed(1)],
                    ['Earnings', fmtINR(detail.user.totalEarnings ?? 0)],
                    ['Joined', fmtDate(detail.user.createdAt)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
                      <p className="tabular text-lg font-extrabold">{value}</p>
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-700">
                  {[['profile', 'Profile'], ['bookings', 'Booking history'], ['payments', 'Payments'], ['reports', 'Reports & complaints'], ['activity', 'Activity']].map(([v, l]) => (
                    <button key={v} onClick={() => setDetailTab(v)}
                      className={`px-3 py-2 text-xs font-semibold ${detailTab === v ? 'border-b-2 border-brand-600 text-brand-700 dark:text-brand-300' : 'text-slate-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>

                {detailTab === 'profile' && (
                  <div className="space-y-1.5 text-sm">
                    <p><span className="text-slate-500">Name:</span> {detail.user.name}</p>
                    <p><span className="text-slate-500">Phone:</span> <span className="tabular">+91 {detail.user.phone}</span></p>
                    <p><span className="text-slate-500">Email:</span> {detail.user.email || '—'}</p>
                    {detail.user.upiId && <p><span className="text-slate-500">UPI:</span> {detail.user.upiId} {detail.user.upiVerified ? '(verified)' : '(unverified)'}</p>}
                    {detail.user.blockedReason && (
                      <p className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-900/20 dark:text-red-200">
                        <span className="font-semibold">Account note:</span> {detail.user.blockedReason}
                      </p>
                    )}
                    {detail.suspensions?.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Suspension history</p>
                        {detail.suspensions.map((s) => (
                          <p key={s.id} className="text-xs text-slate-500">
                            {s.kind} · {s.reason} · {fmtDateTime(s.created_at)}{s.lifted_at ? ` · lifted ${fmtDateTime(s.lifted_at)}` : ' · active'}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'bookings' && (
                  <div className="max-h-72 space-y-1.5 overflow-auto">
                    {(detail.bookings || []).map((b) => (
                      <div key={b.id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                        <span className="font-mono font-semibold">{b.ref}</span>
                        <StatusBadge status={b.status} />
                        <span className="truncate text-slate-500">{b.pickup_address} → {b.drop_address}</span>
                        <span className="tabular ml-auto font-bold">{fmtINR(b.final_fare || b.estimated_fare)}</span>
                      </div>
                    ))}
                    {(detail.bookings || []).length === 0 && <p className="py-4 text-center text-sm text-slate-400">No bookings.</p>}
                  </div>
                )}

                {detailTab === 'payments' && (
                  <div className="max-h-72 space-y-1.5 overflow-auto">
                    {(detail.payments || []).map((p) => (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                        <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                        <span className="font-mono">{p.booking_ref || '—'}</span>
                        <span className="uppercase text-slate-500">{p.method}</span>
                        <StatusBadge status={p.status} />
                        <span className="tabular ml-auto font-bold">{fmtINR(p.amount)}</span>
                      </div>
                    ))}
                    {(detail.payments || []).length === 0 && <p className="py-4 text-center text-sm text-slate-400">No payments.</p>}
                  </div>
                )}

                {detailTab === 'reports' && (
                  <div className="max-h-72 space-y-1.5 overflow-auto">
                    {[...(detail.reports || []), ...(detail.reportsAgainst || [])].map((r) => (
                      <div key={r.id} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                        <div className="flex items-center gap-2">
                          <Flag className="h-3.5 w-3.5 text-red-400" />
                          <span className="capitalize">{String(r.reason).replace(/_/g, ' ')}</span>
                          <StatusBadge status={r.status === 'open' ? 'open' : r.status} />
                          <span className="ml-auto text-slate-400">{fmtDateTime(r.created_at)}</span>
                        </div>
                        {r.details && <p className="mt-1 text-slate-500">{r.details}</p>}
                        {r.resolution_note && <p className="mt-1 italic text-slate-400">“{r.resolution_note}”</p>}
                      </div>
                    ))}
                    {(detail.reports || []).length === 0 && (detail.reportsAgainst || []).length === 0 && (
                      <p className="py-4 text-center text-sm text-slate-400">No reports filed.</p>
                    )}
                  </div>
                )}

                {detailTab === 'activity' && (
                  <div className="max-h-72 space-y-1.5 overflow-auto">
                    {(detail.notifications || []).map((n) => (
                      <div key={n.id} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                        <History className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <p className="font-semibold">{n.title}</p>
                          <p className="truncate text-slate-500">{n.body}</p>
                        </div>
                        <span className="ml-auto shrink-0 text-slate-400">{fmtDateTime(n.created_at)}</span>
                      </div>
                    ))}
                    {(detail.notifications || []).length === 0 && <p className="py-4 text-center text-sm text-slate-400">No recent activity.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
