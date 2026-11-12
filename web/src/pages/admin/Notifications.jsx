import { useCallback, useEffect, useState } from 'react';
import { Bell, Send, Loader2, Megaphone, Users, Car, ShieldCheck, Building2 } from 'lucide-react';
import { api, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

const AUDIENCES = [
  ['all', 'Everyone', Users],
  ['passengers', 'Passengers', Users],
  ['drivers', 'Approved drivers', Car],
  ['admins', 'Administrators', ShieldCheck],
  ['city', 'Users of a city', Building2],
];

export default function AdminNotifications() {
  const toast = useToast();
  const can = usePermission();
  const [history, setHistory] = useState([]);
  const [cities, setCities] = useState([]);
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', cityId: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([
        api.get('/api/master/notifications'),
        api.get('/api/admin/cities').catch(() => []),
      ]);
      setHistory(h.broadcasts || []);
      // the cities endpoint returns an array; tolerate an object shape too
      setCities(Array.isArray(c) ? c : (c.cities || []));
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (form.title.trim().length < 3) return toast('Give the notification a title', 'error');
    if (form.body.trim().length < 3) return toast('Write the notification body', 'error');
    if (form.audience === 'city' && !form.cityId) return toast('Choose a city', 'error');
    setBusy(true);
    try {
      const audienceFilter = form.audience === 'city' ? { cityId: form.cityId } : undefined;
      const res = await api.post('/api/master/notifications/send', {
        title: form.title.trim(), body: form.body.trim(), audience: form.audience, audienceFilter,
      });
      toast(res.message, 'success');
      setForm({ title: '', body: '', audience: 'all', cityId: '' });
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <Bell className="h-6 w-6 text-brand-600" /> Notifications
        </h1>
        <p className="text-sm text-slate-500">Send platform announcements to riders, drivers or staff</p>
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <label className="label">Audience</label>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {AUDIENCES.map(([value, label, Icon]) => (
              <button key={value} onClick={() => setForm({ ...form, audience: value })}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-xs font-semibold transition-all ${
                  form.audience === value
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700'}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        {form.audience === 'city' && (
          <div>
            <label className="label">City</label>
            <select className="input" value={form.cityId} onChange={(e) => setForm({ ...form, cityId: e.target.value })}>
              <option value="">Choose a city…</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="label">Title</label>
          <input className="input" maxLength={120} value={form.title} placeholder="e.g. Monsoon safety drive"
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="label">Message</label>
          <textarea className="input min-h-28" maxLength={1000} value={form.body}
            placeholder="Write the announcement…"
            onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </div>

        <button className="btn-primary" onClick={send} disabled={busy || !can('notifications.send')}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send notification
        </button>
        {!can('notifications.send') && (
          <p className="text-xs text-amber-600">Your role cannot send platform notifications.</p>
        )}
      </div>

      <div className="card overflow-hidden">
        <p className="flex items-center gap-2 border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">
          <Megaphone className="h-4 w-4 text-brand-600" /> Sent notifications
        </p>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {history.map((b) => (
            <div key={b.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold">{b.title}</p>
                <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">{b.audience}</span>
                <span className="ml-auto text-xs text-slate-400">{fmtDateTime(b.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{b.body}</p>
              <p className="mt-1 text-xs text-slate-400">delivered to {b.delivered} of {b.recipients} recipient(s)</p>
            </div>
          ))}
          {history.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing sent yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
