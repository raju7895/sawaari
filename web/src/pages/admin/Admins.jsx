import { useCallback, useEffect, useState } from 'react';
import {
  UserPlus, ShieldCheck, Users, Loader2, Mail, Ban, CheckCircle2, Trash2, KeyRound,
  Copy, Lock, AlertTriangle, UserCog, XCircle,
} from 'lucide-react';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { api, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

export default function AdminManagement() {
  const toast = useToast();
  const can = usePermission();
  const [data, setData] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', adminRole: 'admin', message: '' });
  const [detail, setDetail] = useState(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [grant, setGrant] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [admins, inv] = await Promise.all([
        api.get('/api/master/admins'),
        api.get('/api/master/invitations').catch(() => ({ invitations: [] })),
      ]);
      setData(admins);
      setInvitations(inv.invitations || []);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const sendInvite = async () => {
    if (!/^\S+@\S+\.\S+$/.test(invite.email)) return toast('Enter a valid email address', 'error');
    setBusy('invite');
    try {
      const res = await api.post('/api/master/admins/invite', {
        email: invite.email.trim(),
        adminRole: invite.adminRole,
        message: invite.message.trim() || undefined,
      });
      toast(res.message, 'success', 8000);
      if (res.invitationLink) {
        window.prompt('Copy this one-time invitation link (email delivery is not configured):', res.invitationLink);
      }
      setInviteOpen(false);
      setInvite({ email: '', adminRole: 'admin', message: '' });
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const suspend = async (admin, suspendIt) => {
    const reason = window.prompt(`${suspendIt ? 'Suspend' : 'Reactivate'} ${admin.email}.\nReason:`);
    if (!reason) return;
    setBusy(admin.userId);
    try {
      await api.post(`/api/master/admins/${admin.userId}/suspend`, { suspend: suspendIt, reason });
      toast(suspendIt ? 'Administrator suspended' : 'Administrator reactivated', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const remove = async (admin) => {
    const reason = window.prompt(`Remove administrator access for ${admin.email}?\nTheir history is retained.\nReason:`);
    if (!reason) return;
    setBusy(admin.userId);
    try {
      await api.delete(`/api/master/admins/${admin.userId}`);
      toast('Administrator access removed', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const resetTwoFactor = async (admin) => {
    if (!window.confirm(`Reset two-factor authentication for ${admin.email}? They must re-enrol at next sign-in.`)) return;
    setBusy(admin.userId);
    try {
      await api.post(`/api/master/admins/${admin.userId}/2fa/reset`, {});
      toast('Two-factor reset', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const openPermissions = (admin) => {
    setDetail(admin);
    setGrant(admin.permissions || []);
    setPermissionsOpen(true);
  };

  const savePermissions = async () => {
    setBusy('perms');
    try {
      await api.patch(`/api/master/admins/${detail.userId}`, { permissions: { grant } });
      toast('Permissions updated', 'success');
      setPermissionsOpen(false);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const changeRole = async (admin, adminRole) => {
    setBusy(admin.userId);
    try {
      await api.patch(`/api/master/admins/${admin.userId}`, { adminRole });
      toast(`${admin.email} is now ${adminRole.replace(/_/g, ' ')}`, 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const revokeInvite = async (inv) => {
    setBusy(inv.id);
    try {
      await api.post(`/api/master/invitations/${inv.id}/revoke`, {});
      toast('Invitation revoked', 'success');
      load();
    } catch (e) { toast(e.error || e.message, 'error'); } finally { setBusy(''); }
  };

  if (!data) return <p className="p-6 text-center text-sm text-slate-400">Loading…</p>;

  const roles = data.roles || [];
  const permissionList = data.permissions || {};

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <UserCog className="h-6 w-6 text-brand-600" /> Admin &amp; staff management
          </h1>
          <p className="text-sm text-slate-500">Invite staff, assign roles and keep the platform owner protected</p>
        </div>
        {can('admins.create') && (
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Invite administrator
          </button>
        )}
      </div>

      {/* role reference */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((r) => (
          <div key={r.key} className={`card p-4 ${r.protected ? 'border-brand-400 dark:border-brand-700' : ''}`}>
            <div className="flex items-center justify-between">
              <p className="font-bold">{r.label}</p>
              {r.protected && <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">Protected</span>}
            </div>
            <p className="mt-1 text-xs text-slate-400">{r.permissions.length} permissions</p>
            <p className="mt-2 line-clamp-2 text-xs text-slate-500">
              {r.permissions.slice(0, 6).map((p) => permissionList[p]).filter(Boolean).join(' · ')}
              {r.permissions.length > 6 ? ' …' : ''}
            </p>
          </div>
        ))}
      </div>

      {/* administrators */}
      <div className="card overflow-hidden">
        <p className="border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">
          Administrators ({data.admins.length})
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">Administrator</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Security</th>
                <th className="px-2 py-2">Last sign-in</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.admins.map((a) => (
                <tr key={a.userId}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{a.name}</p>
                      {a.isOwner && <span className="badge bg-brand-600 text-white">Owner</span>}
                    </div>
                    <p className="text-xs text-slate-400">{a.email} · {a.phone}</p>
                    {a.locked && <p className="text-xs font-semibold text-red-500">Locked until {fmtDateTime(a.lockedUntil)}</p>}
                  </td>
                  <td className="px-2 py-2.5">
                    {a.isOwner ? (
                      <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">Super Admin</span>
                    ) : (
                      <select
                        className="input py-1 text-xs"
                        value={a.adminRole}
                        disabled={!can('admins.edit') || busy === a.userId}
                        onChange={(e) => changeRole(a, e.target.value)}
                      >
                        {roles.filter((r) => !r.protected).map((r) => (
                          <option key={r.key} value={r.key}>{r.label}</option>
                        ))}
                      </select>
                    )}
                    <p className="mt-1"><StatusBadge status={a.status === 'active' ? 'approved' : a.status === 'suspended' ? 'rejected' : 'pending'} /></p>
                  </td>
                  <td className="px-2 py-2.5 text-xs">
                    <p className={a.emailVerified ? 'text-emerald-600' : 'text-amber-600'}>
                      {a.emailVerified ? 'Email verified' : 'Email unverified'}
                    </p>
                    <p className={a.twofaEnabled ? 'text-emerald-600' : 'text-amber-600'}>
                      {a.twofaEnabled ? '2FA active' : '2FA off'}
                    </p>
                    {a.failedAttempts > 0 && (
                      <p className="text-red-500">{a.failedAttempts} failed attempt(s)</p>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-500">
                    {a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : 'never'}
                    {a.lastLoginIp && <p className="tabular">{a.lastLoginIp}</p>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {can('admins.edit') && (
                        <button className="btn-ghost text-xs" onClick={() => openPermissions(a)}>
                          <KeyRound className="h-3.5 w-3.5" /> Permissions
                        </button>
                      )}
                      {!a.isOwner && can('admins.edit') && (
                        <button className="btn-ghost text-xs" onClick={() => resetTwoFactor(a)}>
                          <Lock className="h-3.5 w-3.5" /> 2FA reset
                        </button>
                      )}
                      {!a.isOwner && can('admins.suspend') && (
                        <button className="btn-ghost text-xs" onClick={() => suspend(a, a.status !== 'suspended')}>
                          {a.status === 'suspended' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                          {a.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        </button>
                      )}
                      {!a.isOwner && can('admins.remove') && (
                        <button className="btn-danger text-xs" onClick={() => remove(a)}>
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      )}
                      {a.isOwner && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <ShieldCheck className="h-3.5 w-3.5" /> protected
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* invitations */}
      <div className="card overflow-hidden">
        <p className="border-b border-slate-100 p-4 text-sm font-bold dark:border-slate-800">
          Invitations ({invitations.length})
        </p>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {invitations.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Mail className="h-4 w-4 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{inv.email}</p>
                <p className="text-xs text-slate-400">{inv.roleLabel} · expires {fmtDateTime(inv.expiresAt)}</p>
              </div>
              <span className={`badge ${inv.status === 'accepted' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : inv.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                {inv.status}
              </span>
              {inv.status === 'pending' && can('admins.create') && (
                <button className="btn-ghost text-xs" onClick={() => revokeInvite(inv)}>
                  <XCircle className="h-3.5 w-3.5" /> Revoke
                </button>
              )}
            </div>
          ))}
          {invitations.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No invitations sent yet.</p>
          )}
        </div>
      </div>

      {/* invite modal */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite an administrator">
        <div className="space-y-4">
          <div>
            <label className="label">Email address</label>
            <input className="input" type="email" placeholder="staff@example.com" value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={invite.adminRole}
              onChange={(e) => setInvite({ ...invite, adminRole: e.target.value })}>
              {roles.filter((r) => !r.protected).map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              {permissionList && Object.keys(permissionList).length
                ? `${(roles.find((r) => r.key === invite.adminRole)?.permissions || []).length} permissions granted by default`
                : ''}
            </p>
          </div>
          <div>
            <label className="label">Message (optional)</label>
            <textarea className="input min-h-20" maxLength={500} value={invite.message}
              onChange={(e) => setInvite({ ...invite, message: e.target.value })} />
          </div>
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The invitee must verify their email and set up two-factor authentication before using the console.
            Only the Super Admin can grant elevated privileges.
          </p>
          <button className="btn-primary w-full" onClick={sendInvite} disabled={busy === 'invite'}>
            {busy === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Send invitation
          </button>
        </div>
      </Modal>

      {/* permissions modal */}
      <Modal open={permissionsOpen} onClose={() => setPermissionsOpen(false)}
        title={detail ? `Permissions — ${detail.email}` : ''} wide>
        {detail && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Base role: <b>{detail.roleLabel}</b>. Tick any extra permission to grant on top of the role defaults.
            </p>
            <div className="grid max-h-96 gap-1.5 overflow-auto sm:grid-cols-2">
              {Object.entries(permissionList).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={grant.includes(key)}
                    disabled={detail.isProtected}
                    onChange={(e) => setGrant((cur) => (e.target.checked ? [...new Set([...cur, key])] : cur.filter((k) => k !== key)))}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block font-mono text-[11px] text-slate-400">{key}</span>
                  </span>
                </label>
              ))}
            </div>
            <button className="btn-primary w-full" onClick={savePermissions} disabled={busy === 'perms' || detail.isProtected}>
              {busy === 'perms' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Save permissions
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
