import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Plus, MessageSquare, Flag, Send, Clock } from 'lucide-react';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { api, fmtDateTime, timeAgo } from '../../api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { isAdminRole } from '../../roles';

const REASONS = [
  ['rude_behaviour', 'Rude behaviour'],
  ['unsafe_driving', 'Unsafe driving'],
  ['overcharged', 'Overcharged me'],
  ['no_show', 'Did not show up'],
  ['harassment', 'Harassment'],
  ['other', 'Other'],
];

export default function SupportPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [tickets, setTickets] = useState(null);
  const [openTicket, setOpenTicket] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', message: '', priority: 'normal' });
  const [reply, setReply] = useState('');
  const [report, setReport] = useState({ againstUserId: '', reason: 'other', details: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/support/tickets').then(setTickets).catch(() => setTickets([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submitTicket = async () => {
    if (form.subject.trim().length < 3) return toast('Subject is too short', 'error');
    if (form.message.trim().length < 5) return toast('Please describe your issue', 'error');
    setBusy(true);
    try {
      await api.post('/api/support/tickets', {
        subject: form.subject.trim(), message: form.message.trim(), priority: form.priority,
      });
      toast('Ticket created — our team will reply soon', 'success');
      setNewOpen(false);
      setForm({ subject: '', message: '', priority: 'normal' });
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/support/tickets/${openTicket.id}/reply`, { body: reply.trim() });
      setReply('');
      const fresh = await api.get('/api/support/tickets');
      setTickets(fresh);
      setOpenTicket(fresh.find((t) => t.id === openTicket.id) || openTicket);
      toast('Reply sent', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const submitReport = async () => {
    if (!report.againstUserId.trim()) return toast('Paste the user ID of the person you are reporting', 'error');
    setBusy(true);
    try {
      await api.post('/api/support/reports', {
        againstUserId: report.againstUserId.trim(),
        reason: report.reason,
        details: report.details.trim() || undefined,
      });
      toast('Report submitted — our safety team will review it', 'success');
      setReportOpen(false);
      setReport({ againstUserId: '', reason: 'other', details: '' });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><LifeBuoy className="h-6 w-6 text-brand-600" /> Help &amp; support</h1>
          <p className="text-sm text-slate-500">Raise a ticket or report a safety issue</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New ticket</button>
          <button className="btn-secondary" onClick={() => setReportOpen(true)}><Flag className="h-4 w-4" /> Report user</button>
        </div>
      </div>

      {/* emergency strip */}
      <div className="card flex items-center justify-between gap-3 border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-900/20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚨</span>
          <div>
            <p className="text-sm font-bold text-red-800 dark:text-red-200">In an emergency during a ride?</p>
            <p className="text-xs text-red-600 dark:text-red-300">Use the SOS button on the live ride screen — it alerts our safety team instantly.</p>
          </div>
        </div>
        <a href="tel:112" className="btn-danger shrink-0">Call 112</a>
      </div>

      {tickets === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {tickets !== null && tickets.length === 0 && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <MessageSquare className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No tickets yet. We usually reply within a few hours.</p>
        </div>
      )}

      <div className="space-y-3">
        {(tickets || []).map((t) => (
          <button
            key={t.id} onClick={() => setOpenTicket(t)}
            className="card flex w-full items-center gap-4 p-4 text-left hover:shadow-md"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-bold">{t.subject}</p>
                <StatusBadge status={t.status === 'in_progress' ? 'in_progress_ticket' : t.status} />
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                #{t.id.slice(0, 8)} · {t.priority} priority · {timeAgo(t.created_at)} · {t.message_count} messages
              </p>
            </div>
            <MessageSquare className="h-5 w-5 shrink-0 text-slate-300" />
          </button>
        ))}
      </div>

      {/* new ticket modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New support ticket">
        <div className="space-y-4">
          <div>
            <label className="label">Subject</label>
            <input className="input" maxLength={120} value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="e.g. Fare charged incorrectly on ride SW-1234" />
          </div>
          <div>
            <label className="label">How can we help?</label>
            <textarea className="input min-h-28" maxLength={3000} value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              placeholder="Describe what happened — include the ride reference if relevant." />
          </div>
          <div>
            <label className="label">Priority</label>
            <div className="flex gap-2">
              {['low', 'normal', 'high', 'urgent'].map((p) => (
                <button key={p}
                  onClick={() => setForm((f) => ({ ...f, priority: p }))}
                  className={`badge px-3 py-1.5 ${form.priority === p ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <button className="btn-primary w-full" onClick={submitTicket} disabled={busy}>
            {busy ? 'Sending…' : 'Create ticket'}
          </button>
        </div>
      </Modal>

      {/* ticket thread modal */}
      <Modal open={Boolean(openTicket)} onClose={() => setOpenTicket(null)} title={openTicket?.subject} wide>
        {openTicket && (
          <div className="flex max-h-[60vh] flex-col">
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
              <StatusBadge status={openTicket.status === 'in_progress' ? 'in_progress_ticket' : openTicket.status} />
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> opened {fmtDateTime(openTicket.created_at)}</span>
            </div>
            <div className="flex-1 space-y-3 overflow-auto pr-1">
              {(openTicket.messages || []).map((m) => {
                const mine = m.sender_id === user?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      mine ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'
                    }`}>
                      <p className={`mb-0.5 text-[11px] font-bold ${mine ? 'text-brand-100' : 'text-slate-400'}`}>
                        {isAdminRole(m.sender_role) ? 'Sawaari Support' : m.sender_name}
                      </p>
                      {m.body}
                      <p className={`mt-1 text-[10px] ${mine ? 'text-brand-200' : 'text-slate-400'}`}>{fmtDateTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {openTicket.status !== 'resolved' && openTicket.status !== 'closed' && (
              <div className="mt-3 flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                <input className="input" placeholder="Write a reply…" value={reply} onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendReply()} />
                <button className="btn-primary px-3" onClick={sendReply} disabled={busy}><Send className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* report user modal */}
      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Report a user">
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            Report a driver or passenger for unsafe or inappropriate behaviour. Our team reviews every report.
            You can find the user ID on the ride page.
          </p>
          <div>
            <label className="label">User ID of the person</label>
            <input className="input" placeholder="xxxxxxxx-xxxx-…" value={report.againstUserId}
              onChange={(e) => setReport((r) => ({ ...r, againstUserId: e.target.value }))} />
          </div>
          <div>
            <label className="label">Reason</label>
            <select className="input" value={report.reason}
              onChange={(e) => setReport((r) => ({ ...r, reason: e.target.value }))}>
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Details (optional)</label>
            <textarea className="input min-h-20" maxLength={2000} value={report.details}
              onChange={(e) => setReport((r) => ({ ...r, details: e.target.value }))} />
          </div>
          <button className="btn-danger w-full" onClick={submitReport} disabled={busy}>
            <Flag className="h-4 w-4" /> {busy ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
