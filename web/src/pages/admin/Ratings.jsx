import { useState } from 'react';
import { Trash2, Star } from 'lucide-react';
import { adminDeleteRating, adminListRatings } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, Notice, ConfirmDialog, useAsync } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export default function Ratings() {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [confirm, setConfirm] = useState(null);
  const limit = 25;

  const ratings = useAsync(() => adminListRatings({ limit, offset: page * limit }), [page]);
  const rows = ratings.data?.rows || [];

  const remove = async () => {
    if (!confirm) return;
    setBusy(true); setError(''); setOk('');
    try {
      await adminDeleteRating(confirm.id);
      setOk('The rating was deleted.');
      setConfirm(null);
      ratings.reload();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <Card title={`Ratings (${ratings.data?.total ?? 0})`}>
        {ratings.loading ? <Loading /> : null}
        {!ratings.loading && rows.length === 0 ? <Empty label="No ratings yet." /> : null}

        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => {
            const from = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 font-semibold">
                    {Array.from({ length: r.rating }).map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ))}
                    <span className="ml-1 text-xs text-slate-500">{r.rating}/5</span>
                  </p>
                  {r.comment ? <p className="text-sm text-slate-600 dark:text-slate-300">{r.comment}</p> : null}
                  <p className="text-xs text-slate-400">{fmtDateTime(r.created_at)}</p>
                </div>
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs text-red-600"
                  onClick={() => setConfirm(r)}
                  aria-label="Delete the rating"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
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

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete this rating?"
        message="Abusive or spam ratings can be deleted. This cannot be undone."
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
