import { useState } from 'react';
import { Loader2, MapPin, Trash2 } from 'lucide-react';
import { addSavedPlace, listSavedPlaces, removeSavedPlace } from '../../lib/api';
import { Card, Field, Loading, Empty, ErrorNote, Notice, ConfirmDialog, useAsync } from '../../components/ui';

export default function SavedPlaces() {
  const places = useAsync(() => listSavedPlaces(), []);
  const [form, setForm] = useState({ label: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [toDelete, setToDelete] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      await addSavedPlace(form);
      setForm({ label: '', address: '' });
      setOk('Place saved.');
      places.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeSavedPlace(toDelete.id);
      setToDelete(null);
      places.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Add a saved place">
        <form onSubmit={add} className="space-y-3">
          <ErrorNote message={error} />
          <Field label="Label">
            <input
              className="input"
              placeholder="Home, Work, …"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              required
            />
          </Field>
          <Field label="Address">
            <input
              className="input"
              placeholder="e.g. 12 MG Road, Bengaluru"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              required
            />
          </Field>
          <button className="btn-primary" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save the place
          </button>
          {ok ? <Notice tone="ok">{ok}</Notice> : null}
        </form>
      </Card>

      <Card title="My places">
        {places.loading ? <Loading /> : null}
        {!places.loading && (places.data || []).length === 0 ? <Empty label="No saved places yet." /> : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(places.data || []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.label}</p>
                  <p className="truncate text-xs text-slate-500">{p.address}</p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                onClick={() => setToDelete(p)}
                aria-label={`Delete ${p.label}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this place?"
        message={toDelete ? `"${toDelete.label}" will be removed from your saved places.` : ''}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
