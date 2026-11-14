import { useState } from 'react';
import { Loader2, Ban, CheckCircle2 } from 'lucide-react';
import { adminListProfiles, adminSetUserState } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, StatusBadge, Notice, ConfirmDialog, useAsync } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

const ROLES = ['', 'rider', 'driver', 'admin'];

export default function Users() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [confirm, setConfirm] = useState(null);
  const limit = 25;

  const users = useAsync(
    () => adminListProfiles({ search, role, limit, offset: page * limit }),
    [search, role, page]
  );

  const act = async (fn, message) => {
    setBusy(true); setError(''); setOk('');
    try {
      await fn();
      setOk(message);
      setConfirm(null);
      users.reload();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const rows = users.data?.rows || [];

  return (
    <div className="space-y-4">
      <ErrorNote message={error || users.error} onRetry={users.reload} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        <input
          className="input max-w-xs flex-1"
          placeholder="Search name, e-mail or phone"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <select className="input max-w-[10rem]" value={role} onChange={(e) => { setRole(e.target.value); setPage(0); }}>
          {ROLES.map((r) => <option key={r || 'all'} value={r}>{r || 'All roles'}</option>)}
        </select>
      </div>

      <Card title={`People (${users.data?.total ?? 0})`}>
        {users.loading ? <Loading /> : null}
        {!users.loading && rows.length === 0 ? <Empty label="Nobody matches that search." /> : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-slate-800">
                <th className="py-2">Name</th>
                <th className="py-2">Contact</th>
                <th className="py-2">Role</th>
                <th className="py-2">Joined</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-semibold">
                    {u.name}
                    {u.isBlocked ? <span className="ml-2 text-xs text-red-600">blocked</span> : null}
                  </td>
                  <td className="py-2 text-slate-500">
                    {u.email}<br />{u.phone}
                  </td>
                  <td className="py-2"><StatusBadge status={u.role} /></td>
                  <td className="py-2 text-slate-500">{fmtDateTime(u.createdAt)}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-1">
                      <select
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                        value={u.role}
                        disabled={busy}
                        onChange={(e) => act(
                          () => adminSetUserState(u.id, { role: e.target.value }),
                          `${u.name} is now a ${e.target.value}.`
                        )}
                      >
                        <option value="rider">rider</option>
                        <option value="driver">driver</option>
                        <option value="admin">admin</option>
                      </select>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        disabled={busy}
                        onClick={() => setConfirm({
                          user: u,
                          action: u.isBlocked ? 'unblock' : 'block',
                          label: u.isBlocked ? 'Unblock' : 'Block',
                        })}
                      >
                        {u.isBlocked ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                        {u.isBlocked ? 'Unblock' : 'Block'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-slate-500">Page {page + 1}</span>
          <button type="button" className="btn-ghost" disabled={rows.length < limit} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm ? `${confirm.label} this account?` : ''}
        message={confirm ? `${confirm.user.name} will ${confirm.action === 'block' ? 'not be able to sign in' : 'be able to sign in again'}.` : ''}
        confirmLabel={confirm?.label}
        busy={busy}
        onConfirm={() => act(
          () => adminSetUserState(confirm.user.id, { blocked: confirm.action === 'block' }),
          confirm.action === 'block' ? 'The account was blocked.' : 'The account was unblocked.'
        )}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
