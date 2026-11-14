import { useState } from 'react';
import { adminListRides, updateRideStatus } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, StatusBadge, Notice, ConfirmDialog, useAsync } from '../../components/ui';
import { fmtINR, fmtDateTime } from '../../lib/format';

const FILTERS = ['', 'requested', 'accepted', 'ongoing', 'completed', 'cancelled'];

export default function Bookings() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [confirm, setConfirm] = useState(null);
  const limit = 25;

  const rides = useAsync(() => adminListRides({ status, limit, offset: page * limit }), [status, page]);
  const rows = rides.data?.rows || [];

  const cancel = async () => {
    if (!confirm) return;
    setBusy(true); setError(''); setOk('');
    try {
      await updateRideStatus(confirm.id, 'cancelled', 'Cancelled by an administrator');
      setOk('The ride was cancelled.');
      setConfirm(null);
      rides.reload();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <ErrorNote message={error || rides.error} onRetry={rides.reload} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => { setStatus(f); setPage(0); }}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              status === f ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>

      <Card title={`Rides (${rides.data?.total ?? 0})`}>
        {rides.loading ? <Loading /> : null}
        {!rides.loading && rows.length === 0 ? <Empty label="No rides match that filter." /> : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-slate-800">
                <th className="py-2">Ref</th>
                <th className="py-2">Rider</th>
                <th className="py-2">Route</th>
                <th className="py-2">Fare</th>
                <th className="py-2">Status</th>
                <th className="py-2">When</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{r.ref}</td>
                  <td className="py-2">{r.riderName}</td>
                  <td className="max-w-[16rem] truncate py-2 text-slate-500">{r.pickup?.address} → {r.drop?.address}</td>
                  <td className="py-2 font-semibold">{fmtINR(r.fare)}</td>
                  <td className="py-2"><StatusBadge status={r.status} /></td>
                  <td className="py-2 text-slate-500">{fmtDateTime(r.createdAt)}</td>
                  <td className="py-2 text-right">
                    {['requested', 'accepted'].includes(r.status) ? (
                      <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => setConfirm(r)}>
                        Cancel
                      </button>
                    ) : null}
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
        title="Cancel this ride?"
        message={confirm ? `Ride ${confirm.ref} will be cancelled for ${confirm.riderName}.` : ''}
        confirmLabel="Cancel the ride"
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
