import { useEffect, useState } from 'react';
import { Heart, MapPin, Plus, Trash2, Home, Briefcase, Star } from 'lucide-react';
import LocationSearch from '../../components/LocationSearch';
import Modal from '../../components/Modal';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';

export default function SavedLocations() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ label: '', place: null });
  const [saving, setSaving] = useState(false);
  const [near, setNear] = useState(null);

  const load = () => api.get('/api/saved-locations').then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setNear([pos.coords.latitude, pos.coords.longitude]), () => {}, { timeout: 8000 }
      );
    }
  }, []);

  const save = async () => {
    if (!form.label.trim()) return toast('Give this place a name', 'error');
    if (!form.place) return toast('Search and pick a place on the map first', 'error');
    setSaving(true);
    try {
      await api.post('/api/saved-locations', {
        label: form.label.trim(), address: form.place.address, lat: form.place.lat, lng: form.place.lng,
      });
      toast('Saved place added', 'success');
      setAddOpen(false);
      setForm({ label: '', place: null });
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/api/saved-locations/${id}`);
      toast('Removed', 'info');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Heart className="h-6 w-6 text-rose-500" /> Saved places</h1>
          <p className="text-sm text-slate-500">One tap to set home, work, or anywhere you go often</p>
        </div>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add place
        </button>
      </div>

      {items === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}
      {items !== null && items.length === 0 && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <MapPin className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No saved places yet. Add “Home” or “Work” to book faster.</p>
          <button className="btn-primary" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add your first place</button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(items || []).map((s) => (
          <div key={s.id} className="card group flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30">
              {/home/i.test(s.label) ? <Home className="h-5 w-5" /> : /work|office/i.test(s.label) ? <Briefcase className="h-5 w-5" /> : <Star className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{s.label}</p>
              <p className="truncate text-sm text-slate-500" title={s.address}>{s.address}</p>
              <p className="mt-0.5 text-xs text-slate-400">{Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}</p>
            </div>
            <button
              onClick={() => remove(s.id)}
              className="rounded-xl p-2 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-red-900/30"
              aria-label={`Delete ${s.label}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a saved place">
        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              className="input" placeholder="Home, Work, Gym…"
              value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              maxLength={60}
            />
          </div>
          <div>
            <label className="label">Location</label>
            <LocationSearch
              value={form.place}
              onChange={(place) => setForm((f) => ({ ...f, place }))}
              near={near}
              placeholder="Search an address…"
            />
            {form.place && (
              <p className="mt-2 truncate rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800">
                📍 {form.place.address}
              </p>
            )}
          </div>
          <button className="btn-primary w-full" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save place'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
