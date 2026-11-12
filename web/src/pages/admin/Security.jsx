import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, Monitor, Loader2, LogOut, KeyRound, Lock, AlertTriangle, History,
  Globe, Smartphone, RefreshCw, CheckCircle2,
} from 'lucide-react';
import { api, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

export default function AdminSecurity() {
  const toast = useToast();
  const can = usePermission();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/master/security');
      setData(res);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const revokeSession = async (session) => {
    setBusy(session.id);
    try {
      await api.post(`/api/master/security/sessions/${session.id}/revoke`, {});
      toast('Session revoked', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const revokeAll = async () => {
    if (!window.confirm('Sign out of every device for your account?')) return;
    setBusy('all');
    try {
      await api.post('/api/master/security/sessions/revoke-all', {});
      toast('All sessions signed out — please sign in again', 'success');
      setTimeout(() => { window.location.href = '/admin-login'; }, 1200);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const changePassword = async () => {
    const currentPassword = window.prompt('Current password:');
    if (!currentPassword) return;
    const newPassword = window.prompt('New password (minimum 12 characters):');
    if (!newPassword) return;
    if (newPassword.length < 12) return toast('Use at least 12 characters', 'error');
    setBusy('pw');
    try {
      const res = await api.post('/api/master/security/change-password', { currentPassword, newPassword });
      toast(res.message, 'success', 6000);
      setTimeout(() => { window.location.href = '/admin-login'; }, 1200);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  if (!data) return <p className="p-6 text-center text-sm text-slate-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <ShieldCheck className="h-6 w-6 text-brand-600" /> Security settings
          </h1>
          <p className="text-sm text-slate-500">Sessions, sign-in history and the platform security policy</p>
        </div>
        <button className="btn-ghost" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      {/* policy */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Two-factor authentication', data.policy.twoFactorEnforced ? 'Enforced for every admin' : 'Optional', true],
          ['Email verification', data.policy.emailVerificationEnforced ? 'Required before sign-in' : 'Optional', true],
          ['Session lifetime', `${data.policy.sessionHours}h absolute · ${data.policy.idleHours}h idle`, false],
          ['Lockout policy', `${data.policy.maxFailedAttempts} failures → ${data.policy.accountLockMinutes} min lock`, false],
        ].map(([label, value, ok]) => (
          <div key={label} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-bold">
              {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Lock className="h-4 w-4 text-slate-400" />}
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* my sessions */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
          <p className="flex items-center gap-2 text-sm font-bold"><Monitor className="h-4 w-4 text-brand-600" /> My active sessions</p>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={changePassword}>
              {busy === 'pw' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Change password
            </button>
            <button className="btn-danger text-xs" onClick={revokeAll} disabled={busy === 'all'}>
              {busy === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Sign out everywhere
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.mySessions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Globe className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.ip || 'unknown IP'}</p>
                <p className="truncate text-xs text-slate-400">{s.userAgent}</p>
                <p className="text-[11px] text-slate-400">
                  started {fmtDateTime(s.createdAt)} · last seen {fmtDateTime(s.lastSeenAt)} · expires {fmtDateTime(s.expiresAt)}
                </p>
              </div>
              {s.active ? (
                <>
                  <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">active</span>
                  {can('settings.security') && (
                    <button className="btn-ghost text-xs" disabled={busy === s.id} onClick={() => revokeSession(s)}>Revoke</button>
                  )}
                </>
              ) : (
                <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">
                  {s.revokedAt ? `revoked — ${s.revokedReason || 'manual'}` : 'expired'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* failed logins */}
        <div className="card overflow-hidden">
          <p className="flex items-center gap-2 border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">
            <AlertTriangle className="h-4 w-4 text-red-500" /> Failed sign-ins (7 days)
          </p>
          <div className="max-h-72 overflow-auto divide-y divide-slate-100 dark:divide-slate-800">
            {data.failedByEmail.map((f) => (
              <div key={f.email} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="truncate font-medium">{f.email}</span>
                <span className="text-xs text-slate-400">{f.failures} failures · last {fmtDateTime(f.lastAttempt)}</span>
              </div>
            ))}
            {data.failedByEmail.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No failed sign-ins recorded.</p>
            )}
          </div>
        </div>

        {/* lockouts */}
        <div className="card overflow-hidden">
          <p className="flex items-center gap-2 border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">
            <Lock className="h-4 w-4 text-amber-500" /> Locked or flagged accounts
          </p>
          <div className="max-h-72 overflow-auto divide-y divide-slate-100 dark:divide-slate-800">
            {data.lockedAccounts.map((l) => (
              <div key={l.email} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="truncate text-xs text-slate-400">{l.email}</p>
                </div>
                <div className="text-right text-xs">
                  {l.lockedUntil && new Date(l.lockedUntil) > new Date()
                    ? <span className="font-semibold text-red-600">locked until {fmtDateTime(l.lockedUntil)}</span>
                    : <span className="text-slate-400">{l.failedAttempts} failed attempt(s)</span>}
                  {l.lastLoginAt && <p className="text-slate-400">last in {fmtDateTime(l.lastLoginAt)}</p>}
                </div>
              </div>
            ))}
            {data.lockedAccounts.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No locked accounts.</p>
            )}
          </div>
        </div>
      </div>

      {/* login history */}
      <div className="card overflow-hidden">
        <p className="flex items-center gap-2 border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">
          <History className="h-4 w-4 text-brand-600" /> Sign-in history
        </p>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-2 py-2">Account</th>
                <th className="px-2 py-2">IP</th>
                <th className="px-2 py-2">Outcome</th>
                <th className="px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.loginHistory.map((l) => (
                <tr key={l.id}>
                  <td className="tabular px-4 py-2 text-xs text-slate-500">{fmtDateTime(l.at)}</td>
                  <td className="px-2 py-2 text-xs font-medium">{l.email || '—'}</td>
                  <td className="tabular px-2 py-2 text-xs">{l.ip || '—'}</td>
                  <td className="px-2 py-2">
                    <span className={`badge ${l.success ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                      {l.success ? 'success' : 'failed'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{l.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-slate-400">
        <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Administrator sessions are tracked server-side: signing out, a password change, a suspension or a
        2FA reset invalidates every device immediately.
      </p>
    </div>
  );
}
