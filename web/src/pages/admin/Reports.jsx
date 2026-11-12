import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Flag, MapPin, Phone, RefreshCw, CheckCheck, ShieldCheck, XCircle, Eye,
  FileSearch, UserPlus, Loader2, Paperclip, History,
} from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import MapView from '../../components/MapView';
import { api, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

const REPORT_REASONS = ['rude_behaviour', 'unsafe_driving', 'overcharged', 'late_arrival', 'cancelled_last_minute', 'harassment', 'other'];

export default function AdminReports() {
  const toast = useToast();
  const can = usePermission();
  const [sos, setSos] = useState(null);
  const [reports, setReports] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [busy, setBusy] = useState('');
  const [resolveOpen, setResolveOpen] = useState(null);
  const [status, setStatus] = useState('resolved');
  const [note, setNote] = useState('');
  const [investigation, setInvestigation] = useState(null);
  const [inviteNote, setInviteNote] = useState('');
  const [inviteAssignee, setInviteAssignee] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api.get('/api/admin/sos'),
        api.get('/api/admin/reports'),
      ]);
      setSos(s); setReports(r);
      if (can('admins.view')) {
        const a = await api.get('/api/master/admins').catch(() => ({ admins: [] }));
        setAdmins(a.admins || []);
      }
    } catch (e) { toast(e.message, 'error'); }
  }, [toast, can]);

  useEffect(() => { load(); }, [load]);
  // SOS is time-critical — poll every 20s while the page is open
  useEffect(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const ackSos = async (id) => {
    setBusy(id);
    try {
      await api.post(`/api/admin/sos/${id}/ack`);
      toast('SOS acknowledged — user notified help is coming', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const resolveSos = async (id) => {
    setBusy(id);
    try {
      await api.post(`/api/admin/sos/${id}/resolve`);
      toast('SOS marked resolved', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const submitResolution = async () => {
    if (!resolveOpen) return;
    setBusy(resolveOpen.id);
    try {
      await api.post(`/api/admin/reports/${resolveOpen.id}/resolve`, {
        status, note: note.trim() || undefined,
      });
      toast('Report updated — reporter notified', 'success');
      setResolveOpen(null); setNote(''); setStatus('resolved');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const openInvestigation = async (report) => {
    try {
      const res = await api.get(`/api/admin/reports/${report.id}/investigations`);
      setInvestigation(res);
      setInviteNote('');
      setInviteAssignee('');
    } catch (e) { toast(e.message, 'error'); }
  };

  const addInvestigation = async (action) => {
    if (!investigation) return;
    setBusy('investigation');
    try {
      await api.post(`/api/admin/reports/${investigation.report.id}/investigate`, {
        action,
        note: inviteNote.trim() || undefined,
        assignTo: action === 'assign' ? inviteAssignee : undefined,
        evidence: action === 'note' && inviteNote.trim() ? { note: inviteNote.trim() } : undefined,
      });
      toast('Investigation note saved', 'success');
      setInviteNote('');
      const fresh = await api.get(`/api/admin/reports/${investigation.report.id}/investigations`);
      setInvestigation(fresh);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const openSos = (sos || []).filter((s) => s.status === 'open');
  const pastSos = (sos || []).filter((s) => s.status !== 'open');
  const openReports = (reports || []).filter((r) => r.status === 'open' || r.status === 'reviewing');
  const closedReports = (reports || []).filter((r) => r.status === 'resolved' || r.status === 'dismissed');

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <AlertTriangle className="h-6 w-6 text-red-500" /> Reports &amp; complaints
          </h1>
          <p className="text-sm text-slate-500">Safety alerts and user reports, refreshed every 20 seconds</p>
        </div>
        <button className="btn-ghost" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      {/* ── OPEN SOS ALERTS ─────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-bold">
          <ShieldCheck className="h-5 w-5 text-red-500" /> SOS alerts
          {openSos.length > 0 && <span className="badge bg-red-600 text-white">{openSos.length} open</span>}
        </h2>

        {sos === null && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}

        {sos !== null && openSos.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-400">No open SOS alerts. All clear 🎉</div>
        )}

        {openSos.map((s) => (
          <div key={s.id} className="card border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-lg font-extrabold text-red-600 dark:text-red-300">🚨 SOS — {s.user_name}</p>
                <p className="text-sm">
                  <Phone className="mr-1 inline h-4 w-4" /><span className="tabular">+91 {s.user_phone}</span>
                  {s.booking_ref && <> · ride <span className="tabular font-bold">{s.booking_ref}</span></>}
                </p>
                <p className="text-xs text-slate-500 dark:text-red-200/70">raised {fmtDateTime(s.created_at)}</p>
                {s.lat != null && s.lng != null && (
                  <p className="text-xs">
                    <MapPin className="mr-1 inline h-4 w-4" />
                    <a className="link tabular"
                      href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=16/${s.lat}/${s.lng}`}
                      target="_blank" rel="noreferrer">
                      {s.lat.toFixed(5)}, {s.lng.toFixed(5)} — open in OpenStreetMap
                    </a>
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button className="btn-primary" disabled={busy === s.id} onClick={() => ackSos(s.id)}>
                  <CheckCheck className="h-4 w-4" /> {busy === s.id ? '…' : 'Acknowledge'}
                </button>
                <button className="btn-danger" disabled={busy === s.id} onClick={() => resolveSos(s.id)}>
                  <ShieldCheck className="h-4 w-4" /> Resolve
                </button>
              </div>
            </div>
            {s.lat != null && s.lng != null && (
              <div className="mt-3 h-48 overflow-hidden rounded-xl">
                <MapView center={{ lat: s.lat, lng: s.lng, zoom: 15 }}
                  markers={[{ lat: s.lat, lng: s.lng, type: 'passenger', label: s.user_name }]}
                  interactive={false} zoomControl={false} />
              </div>
            )}
          </div>
        ))}

        {pastSos.length > 0 && (
          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-500">
              Handled SOS alerts ({pastSos.length})
            </summary>
            <div className="mt-3 space-y-2">
              {pastSos.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge status={s.status} />
                  <span className="font-semibold">{s.user_name}</span>
                  <span className="tabular text-xs text-slate-400">+91 {s.user_phone}</span>
                  {s.booking_ref && <span className="badge bg-slate-100 dark:bg-slate-800">{s.booking_ref}</span>}
                  <span className="text-xs text-slate-400">{fmtDateTime(s.created_at)}</span>
                  {s.acknowledged_by_name && <span className="text-xs text-slate-400">· ack by {s.acknowledged_by_name}</span>}
                  {s.status === 'acknowledged' && (
                    <button className="btn-ghost ml-auto" disabled={busy === s.id} onClick={() => resolveSos(s.id)}>
                      <ShieldCheck className="h-3.5 w-3.5" /> Resolve
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ── USER REPORTS ────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-bold">
          <Flag className="h-5 w-5 text-brand-600" /> User reports
          {openReports.length > 0 && <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{openReports.length} active</span>}
        </h2>

        {reports === null && <p className="py-6 text-center text-sm text-slate-400">Loading…</p>}

        {reports !== null && reports.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-400">No user reports filed.</div>
        )}

        {openReports.map((r) => (
          <div key={r.id} className="card space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={r.status} />
              <span className="badge bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">
                {REPORT_REASONS.includes(r.reason) ? r.reason.replace(/_/g, ' ') : r.reason}
              </span>
              {r.booking_ref && <span className="badge bg-slate-100 dark:bg-slate-800">ride {r.booking_ref}</span>}
              <span className="ml-auto text-xs text-slate-400">{fmtDateTime(r.created_at)}</span>
            </div>
            <p className="text-sm">
              <span className="font-bold">{r.reporter_name}</span> reported{' '}
              <span className="font-bold">{r.against_name}</span>{' '}
              <span className="tabular text-xs text-slate-400">(+91 {r.against_phone})</span>
            </p>
            {r.details && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">{r.details}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-primary" onClick={() => { setResolveOpen(r); setStatus('resolved'); setNote(''); }}>
                <CheckCircle2 className="h-4 w-4" /> Take action
              </button>
              <button className="btn-ghost" onClick={() => { setResolveOpen(r); setStatus('reviewing'); setNote(''); }}>
                <Eye className="h-4 w-4" /> Reviewing
              </button>
              <button className="btn-ghost" onClick={() => openInvestigation(r)}>
                <FileSearch className="h-4 w-4" /> Investigation file
              </button>
            </div>
          </div>
        ))}

        {closedReports.length > 0 && (
          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-500">
              Closed reports ({closedReports.length})
            </summary>
            <div className="mt-3 space-y-2">
              {closedReports.map((r) => (
                <div key={r.id} className="space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="font-semibold">{r.reporter_name} → {r.against_name}</span>
                    <span className="badge bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">
                      {REPORT_REASONS.includes(r.reason) ? r.reason.replace(/_/g, ' ') : r.reason}
                    </span>
                    <span className="text-xs text-slate-400">{fmtDateTime(r.created_at)}</span>
                    <button className="btn-ghost ml-auto" onClick={() => { setResolveOpen(r); setStatus(r.status); setNote(r.resolution_note || ''); }}>
                      Edit outcome
                    </button>
                    <button className="btn-ghost" onClick={() => openInvestigation(r)}>
                      <FileSearch className="h-3.5 w-3.5" /> File
                    </button>
                  </div>
                  {r.resolution_note && (
                    <p className="pl-2 text-xs italic text-slate-400">“{r.resolution_note}”</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ── RESOLVE MODAL ───────────────────────────────────── */}
      <Modal open={Boolean(resolveOpen)} onClose={() => setResolveOpen(null)}
        title={resolveOpen ? `Report: ${resolveOpen.reporter_name} → ${resolveOpen.against_name}` : ''}>
        {resolveOpen && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="badge bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">
                {REPORT_REASONS.includes(resolveOpen.reason) ? resolveOpen.reason.replace(/_/g, ' ') : resolveOpen.reason}
              </span>
              {resolveOpen.booking_ref && <> · ride <span className="tabular font-bold">{resolveOpen.booking_ref}</span></>}
            </p>
            {resolveOpen.details && (
              <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                {resolveOpen.details}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {[
                ['reviewing', 'Reviewing', 'bg-blue-600'],
                ['resolved', 'Resolved', 'bg-emerald-600'],
                ['dismissed', 'Dismissed', 'bg-slate-500'],
              ].map(([value, label, color]) => (
                <button key={value} onClick={() => setStatus(value)}
                  className={`badge px-3.5 py-2 ${status === value ? `${color} text-white` : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            <textarea className="input min-h-24" placeholder="Resolution note sent to the reporter (optional, max 500 chars)"
              maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={submitResolution} disabled={busy === resolveOpen.id}>
                <CheckCircle2 className="h-4 w-4" /> {busy === resolveOpen.id ? 'Saving…' : 'Save & notify reporter'}
              </button>
              <button className="btn-danger" onClick={() => { setResolveOpen(null); setNote(''); }}>
                <XCircle className="h-4 w-4" /> Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── INVESTIGATION FILE ──────────────────────────────── */}
      <Modal open={Boolean(investigation)} onClose={() => setInvestigation(null)} wide
        title={investigation ? `Investigation · ${investigation.report.reason.replace(/_/g, ' ')}` : ''}>
        {investigation && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Reported by</p>
                <p className="font-semibold">{investigation.report.reporter.name}</p>
                <p className="tabular text-xs text-slate-500">+91 {investigation.report.reporter.phone}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Against</p>
                <p className="font-semibold">{investigation.report.against.name}</p>
                <p className="tabular text-xs text-slate-500">+91 {investigation.report.against.phone}</p>
              </div>
            </div>
            {investigation.report.details && (
              <p className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">{investigation.report.details}</p>
            )}

            {/* action bar */}
            <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <textarea className="input min-h-20" placeholder="Internal note, evidence reference or action taken…"
                value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" disabled={busy === 'investigation' || !inviteNote.trim()}
                  onClick={() => addInvestigation('note')}>
                  {busy === 'investigation' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} Add note
                </button>
                <button className="btn-secondary" disabled={busy === 'investigation'}
                  onClick={() => addInvestigation('action_taken')}>
                  <ShieldCheck className="h-4 w-4" /> Action taken
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-52 flex-1">
                  <label className="label">Assign to administrator</label>
                  <select className="input" value={inviteAssignee} onChange={(e) => setInviteAssignee(e.target.value)}>
                    <option value="">Choose an administrator…</option>
                    {admins.filter((a) => a.status === 'active').map((a) => (
                      <option key={a.userId} value={a.userId}>{a.name} · {a.roleLabel}</option>
                    ))}
                  </select>
                </div>
                <button className="btn-primary" disabled={busy === 'investigation' || !inviteAssignee}
                  onClick={() => addInvestigation('assign')}>
                  <UserPlus className="h-4 w-4" /> Assign
                </button>
              </div>
            </div>

            {/* history */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                <History className="h-3.5 w-3.5" /> Investigation history
              </p>
              <div className="max-h-56 space-y-2 overflow-auto">
                {investigation.investigations.map((i) => (
                  <div key={i.id} className="rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                        {i.action.replace(/_/g, ' ')}
                      </span>
                      <span className="font-semibold">{i.adminName || i.adminEmail}</span>
                      <span className="ml-auto text-slate-400">{fmtDateTime(i.createdAt)}</span>
                    </div>
                    {i.note && <p className="mt-1 text-slate-600 dark:text-slate-300">{i.note}</p>}
                  </div>
                ))}
                {investigation.investigations.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-400">No investigation notes yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
