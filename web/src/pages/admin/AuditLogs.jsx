import { useState } from 'react';
import { adminListActions } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, useAsync } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export default function AuditLogs() {
  const [page, setPage] = useState(0);
  const limit = 30;

  const actions = useAsync(() => adminListActions({ limit, offset: page * limit }), [page]);
  const rows = actions.data?.rows || [];

  return (
    <div className="space-y-4">
      <Card title={`Activity log (${actions.data?.total ?? 0})`}>
        <p className="mb-3 text-xs text-slate-500">
          Every administrative action is written here. The table is append-only — it
          cannot be edited or deleted, not even by an administrator.
        </p>

        <ErrorNote message={actions.error} onRetry={actions.reload} />
        {actions.loading ? <Loading /> : null}
        {!actions.loading && rows.length === 0 ? <Empty label="Nothing has happened yet." /> : null}

        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((a) => {
            const admin = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
            return (
              <li key={a.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{a.action}</span>
                  <span className="text-xs text-slate-400">{fmtDateTime(a.created_at)}</span>
                </div>
                <p className="text-xs text-slate-500">
                  by {admin?.full_name || a.admin_email || 'the system'}
                  {a.target_type ? ` · ${a.target_type}` : ''}
                  {a.target_id ? ` ${String(a.target_id).slice(0, 8)}` : ''}
                </p>
                {a.details ? (
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-100 p-2 text-[11px] dark:bg-slate-800">
                    {JSON.stringify(a.details)}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex items-center justify-between text-sm">
          <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-slate-500">Page {page + 1}</span>
          <button type="button" className="btn-ghost" disabled={rows.length < limit} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </Card>
    </div>
  );
}
