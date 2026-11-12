import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Send, Reply, CheckCircle2 } from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import { isAdminRole } from '../../roles';
import Modal from '../../components/Modal';
import { api, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';

const STATUS_ACTIONS = [
  ['open', 'Keep open'],
  ['in_progress', 'In progress'],
  ['resolved', 'Resolve'],
  ['closed', 'Close'],
];

export default function AdminTickets() {
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  const [open, setOpen] = useState(null); // ticket with messages
  const [reply, setReply] = useState('');
  const [setStatus, setSetStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTickets(await api.get('/api/admin/tickets'));
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openTicket = async (t) => {
    // fetch thread from the user-side endpoint shape? admin tickets list lacks messages; use per-ticket fetch if available
    setOpen({ ...t, messages: [] });
    try {
      const res = await api.get(`/api/admin/tickets/${t.id}`);
      if (res && res.messages) setOpen(res);
    } catch { /* list-only view */ }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/tickets/${open.id}/reply`, {
        body: reply.trim(), status: setStatus || undefined,
      });
      toast('Reply sent — the user gets a notification', 'success');
      setReply(''); setSetStatus('');
      setOpen(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><MessageSquare className="h-6 w-6 text-brand-600" /> Support tickets</h1>
        <p className="text-sm text-slate-500">Passenger and driver issues, newest first</p>
      </div>

      {tickets === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {tickets !== null && tickets.length === 0 && (
        <div className="card p-10 text-center text-sm text-slate-400">No tickets yet.</div>
      )}

      <div className="space-y-2">
        {(tickets || []).map((t) => (
          <button key={t.id} onClick={() => openTicket(t)} className="card flex w-full flex-wrap items-center gap-3 p-4 text-left hover:shadow-md">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-bold">{t.subject}</p>
                <StatusBadge status={t.status === 'in_progress' ? 'in_progress_ticket' : t.status} />
                <span className={`badge ${t.priority === 'urgent' ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                  {t.priority}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {t.user_name} · <span className="tabular">+91 {t.user_phone}</span> · {fmtDateTime(t.created_at)} · {t.message_count} messages
              </p>
            </div>
            <Reply className="h-5 w-5 shrink-0 text-slate-300" />
          </button>
        ))}
      </div>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.subject} wide>
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <StatusBadge status={open.status === 'in_progress' ? 'in_progress_ticket' : open.status} />
              <span>from {open.user_name} · <span className="tabular">+91 {open.user_phone}</span></span>
              <span>· opened {fmtDateTime(open.created_at)}</span>
            </div>

            {(open.messages || []).length > 0 && (
              <div className="max-h-64 space-y-2.5 overflow-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                {open.messages.map((m, i) => (
                  <div key={i} className={`flex ${isAdminRole(m.sender_role) ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      isAdminRole(m.sender_role) ? 'bg-brand-600 text-white' : 'bg-white shadow-sm dark:bg-slate-900'
                    }`}>
                      <p className={`mb-0.5 text-[11px] font-bold ${isAdminRole(m.sender_role) ? 'text-brand-100' : 'text-slate-400'}`}>
                        {isAdminRole(m.sender_role) ? 'Sawaari Support' : m.sender_name}
                      </p>
                      {m.body}
                      <p className={`mt-1 text-[10px] ${isAdminRole(m.sender_role) ? 'text-brand-200' : 'text-slate-400'}`}>
                        {fmtDateTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <textarea className="input min-h-24" placeholder="Write a reply to the user…"
                maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Set status</span>
                {STATUS_ACTIONS.map(([value, label]) => (
                  <button key={value}
                    onClick={() => setSetStatus(value)}
                    className={`badge px-3 py-1.5 ${setStatus === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button className="btn-primary" onClick={sendReply} disabled={busy || !reply.trim()}>
                <Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
