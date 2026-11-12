import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, Download, Search, Filter, Loader2, ChevronDown, ChevronRight, Lock, Globe,
} from 'lucide-react';
import { api, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';

const CATEGORIES = [
  ['', 'All categories'], ['users', 'Users'], ['drivers', 'Drivers'], ['bookings', 'Bookings'],
  ['payments', 'Payments'], ['finance', 'Finance'], ['reports', 'Reports'], ['support', 'Support'],
  ['administration', 'Administration'], ['security', 'Security'], ['settings', 'Settings'],
];

const RESULTS = [['', 'All results'], ['success', 'Success'], ['failure', 'Failure'], ['denied', 'Denied']];

export default function AdminAuditLogs() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(false);
  const limit = 50;

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (result) params.set('result', result);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
      const res = await api.get(`/api/master/audit?${params}`);
      setData(res);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }, [q, category, result, from, to, page, toast]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
    window.open(`/api/master/audit/export?${params}`, '_blank');
  };

  const pages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <ShieldCheck className="h-6 w-6 text-brand-600" /> Audit log
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-slate-500">
            <Lock className="h-3.5 w-3.5" /> Append-only — entries cannot be edited or deleted, by anyone
          </p>
        </div>
        <button className="btn-secondary" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      <div className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search action, admin or target…"
              value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
          <select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="input" value={result} onChange={(e) => { setResult(e.target.value); setPage(0); }}>
            {RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
            <span className="text-xs text-slate-400">to</span>
            <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{data ? `${data.total} entries` : '…'}</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Administrator</th>
                <th className="px-2 py-2">Action</th>
                <th className="px-2 py-2">Target</th>
                <th className="px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(data ? data.entries : []).map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2">
                    <button onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      className="text-slate-400 hover:text-slate-600">
                      {expanded === e.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="tabular px-2 py-2 text-xs text-slate-500">{fmtDateTime(e.createdAt)}</td>
                  <td className="px-2 py-2">
                    <p className="text-xs font-semibold">{e.adminEmail || '—'}</p>
                    <p className="text-[11px] text-slate-400">{e.adminRole}</p>
                  </td>
                  <td className="px-2 py-2">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-800">{e.action}</code>
                    <p className="text-[11px] text-slate-400">{e.category}</p>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {e.targetLabel || '—'}
                    {e.targetType && <p className="text-[11px] text-slate-400">{e.targetType}</p>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`badge ${e.result === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : e.result === 'denied' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                      {e.result}
                    </span>
                  </td>
                </tr>
              ))}
              {data && data.entries.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  No audit entries match these filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {expanded && data && (() => {
        const entry = data.entries.find((e) => e.id === expanded);
        if (!entry) return null;
        return (
          <div className="card space-y-3 p-4">
            <p className="text-sm font-bold">Entry #{entry.id} — {entry.action}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Previous value</p>
                <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600 dark:text-slate-300">
                  {entry.previousValue ? JSON.stringify(entry.previousValue, null, 2) : '—'}
                </pre>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">New value</p>
                <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-600 dark:text-slate-300">
                  {entry.newValue ? JSON.stringify(entry.newValue, null, 2) : '—'}
                </pre>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Context</p>
                <p className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <Globe className="h-3 w-3" /> {entry.ip || 'unknown IP'}
                </p>
                <p className="mt-1 break-all text-[11px] text-slate-400">{entry.userAgent || '—'}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-xs text-slate-500">Page {page + 1} of {pages}</span>
          <button className="btn-secondary text-xs" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
