import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Pencil, CheckCircle2 } from 'lucide-react';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { api, fmtINR } from '../../api';
import { useToast } from '../../context/ToastContext';

const VEHICLE_LABELS = { auto: 'Auto-rickshaw', e_rickshaw: 'E-rickshaw' };

const PRICING_FIELDS = [
  ['baseFare', 'Base fare', '₹', 0, 1000, 0.5],
  ['perKm', 'Per km', '₹', 0, 500, 0.5],
  ['perMinute', 'Per minute', '₹', 0, 100, 0.25],
  ['minFare', 'Minimum fare', '₹', 0, 2000, 1],
  ['bookingFee', 'Booking fee', '₹', 0, 500, 1],
  ['waitingPerMin', 'Waiting per min', '₹', 0, 100, 0.5],
  ['freeWaitMin', 'Free waiting', 'min', 0, 60, 1],
  ['nightMultiplier', 'Night multiplier', '×', 1, 3, 0.1],
];

export default function AdminCities() {
  const toast = useToast();
  const [cities, setCities] = useState(null);
  const [editPricing, setEditPricing] = useState(null); // {city, pricing row}
  const [form, setForm] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [newCity, setNewCity] = useState({ name: '', state: '', centerLat: '', centerLng: '', radiusKm: 25 });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setCities(await api.get('/api/admin/cities'));
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openPricing = (city, p) => {
    setEditPricing({ city, pricing: p });
    setForm({
      baseFare: p.baseFare, perKm: p.perKm, perMinute: p.perMinute, minFare: p.minFare,
      bookingFee: p.bookingFee, waitingPerMin: p.waitingPerMin, freeWaitMin: p.freeWaitMin,
      nightMultiplier: p.nightMultiplier, nightFromHour: p.nightFromHour, nightToHour: p.nightToHour,
      active: p.active,
    });
  };

  const savePricing = async () => {
    setBusy('pricing');
    try {
      await api.put(`/api/admin/pricing/${editPricing.pricing.id}`, {
        baseFare: Number(form.baseFare), perKm: Number(form.perKm), perMinute: Number(form.perMinute),
        minFare: Number(form.minFare), bookingFee: Number(form.bookingFee),
        waitingPerMin: Number(form.waitingPerMin), freeWaitMin: Number(form.freeWaitMin),
        nightMultiplier: Number(form.nightMultiplier), nightFromHour: Number(form.nightFromHour),
        nightToHour: Number(form.nightToHour), active: Boolean(form.active),
      });
      toast('Pricing updated — new quotes use it immediately', 'success');
      setEditPricing(null);
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const toggleCity = async (city) => {
    try {
      await api.patch(`/api/admin/cities/${city.id}`, { isActive: !city.is_active });
      toast(`${city.name} ${city.is_active ? 'deactivated' : 'activated'}`, 'info');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const addCity = async () => {
    if (!newCity.name.trim()) return toast('City name is required', 'error');
    if (newCity.centerLat === '' || newCity.centerLng === '') return toast('Set the city center coordinates', 'error');
    setBusy('add');
    try {
      await api.post('/api/admin/cities', {
        name: newCity.name.trim(), state: newCity.state.trim() || undefined,
        centerLat: Number(newCity.centerLat), centerLng: Number(newCity.centerLng),
        radiusKm: Number(newCity.radiusKm) || 25,
      });
      toast('City added with Bengaluru template pricing — tune it below', 'success');
      setAddOpen(false);
      setNewCity({ name: '', state: '', centerLat: '', centerLng: '', radiusKm: 25 });
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Building2 className="h-6 w-6 text-brand-600" /> Cities &amp; pricing</h1>
          <p className="text-sm text-slate-500">Fares are computed per city and per vehicle type</p>
        </div>
        <button className="btn-primary" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add city</button>
      </div>

      {cities === null && <p className="py-10 text-center text-sm text-slate-400">Loading…</p>}

      <div className="space-y-4">
        {(cities || []).map((c) => (
          <div key={c.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-extrabold">{c.name}</p>
                  {c.state && <span className="text-sm text-slate-400">{c.state}</span>}
                  <StatusBadge status={c.is_active ? 'approved' : 'expired'} />
                </div>
                <p className="text-xs text-slate-400">
                  centre {Number(c.center_lat).toFixed(3)}, {Number(c.center_lng).toFixed(3)} · radius {c.radius_km} km
                </p>
              </div>
              <button className={c.is_active ? 'btn-danger px-3 py-1.5 text-xs' : 'btn-primary px-3 py-1.5 text-xs'}
                onClick={() => toggleCity(c)}>
                {c.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {(c.pricing || []).map((p) => (
                <button key={p.id} onClick={() => openPricing(c, p)}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-brand-400 dark:border-slate-700">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">{VEHICLE_LABELS[p.vehicleType] || p.vehicleType}</p>
                      {!p.active && <span className="badge bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">inactive</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {fmtINR(p.baseFare)} base + {fmtINR(p.perKm)}/km · min {fmtINR(p.minFare)}
                    </p>
                    <p className="text-xs text-slate-400">
                      night ×{p.nightMultiplier} ({p.nightFromHour}:00–{p.nightToHour}:00)
                      {p.waitingPerMin > 0 ? ` · waiting ${fmtINR(p.waitingPerMin)}/min after ${p.freeWaitMin}m` : ''}
                    </p>
                  </div>
                  <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
              {(!c.pricing || c.pricing.length === 0) && (
                <p className="p-2 text-sm text-slate-400">No pricing configured for this city.</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* pricing editor */}
      <Modal open={Boolean(editPricing)} onClose={() => setEditPricing(null)} wide
        title={editPricing ? `${editPricing.city.name} · ${VEHICLE_LABELS[editPricing.pricing.vehicleType] || editPricing.pricing.vehicleType}` : ''}>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRICING_FIELDS.map(([key, label, unit, min, max, step]) => (
            <div key={key}>
              <label className="label">{label} ({unit})</label>
              <input className="input" type="number" min={min} max={max} step={step}
                value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div>
            <label className="label">Night window from (hour)</label>
            <input className="input" type="number" min={0} max={23}
              value={form.nightFromHour} onChange={(e) => setForm((f) => ({ ...f, nightFromHour: e.target.value }))} />
          </div>
          <div>
            <label className="label">Night window to (hour)</label>
            <input className="input" type="number" min={0} max={23}
              value={form.nightToHour} onChange={(e) => setForm((f) => ({ ...f, nightToHour: e.target.value }))} />
          </div>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={Boolean(form.active)}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            className="h-4 w-4 accent-teal-600" />
          Active — passengers can book this vehicle type in this city
        </label>
        <button className="btn-primary mt-4 w-full" disabled={busy === 'pricing'} onClick={savePricing}>
          <CheckCircle2 className="h-4 w-4" /> {busy === 'pricing' ? 'Saving…' : 'Save pricing'}
        </button>
      </Modal>

      {/* add city */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a city">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">City name</label>
              <input className="input" value={newCity.name} maxLength={60}
                onChange={(e) => setNewCity((c) => ({ ...c, name: e.target.value }))} placeholder="Mysuru" />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" value={newCity.state} maxLength={60}
                onChange={(e) => setNewCity((c) => ({ ...c, state: e.target.value }))} placeholder="Karnataka" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Center latitude</label>
              <input className="input" type="number" step="0.0001" value={newCity.centerLat}
                onChange={(e) => setNewCity((c) => ({ ...c, centerLat: e.target.value }))} placeholder="12.2958" />
            </div>
            <div>
              <label className="label">Center longitude</label>
              <input className="input" type="number" step="0.0001" value={newCity.centerLng}
                onChange={(e) => setNewCity((c) => ({ ...c, centerLng: e.target.value }))} placeholder="76.6394" />
            </div>
          </div>
          <div>
            <label className="label">Service radius (km)</label>
            <input className="input" type="number" min={5} max={200} value={newCity.radiusKm}
              onChange={(e) => setNewCity((c) => ({ ...c, radiusKm: e.target.value }))} />
          </div>
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800">
            The new city starts with a copy of Bengaluru's pricing — adjust it after creating.
            Pickup points inside the radius resolve to this city for fare computation.
          </p>
          <button className="btn-primary w-full" disabled={busy === 'add'} onClick={addCity}>
            <Plus className="h-4 w-4" /> {busy === 'add' ? 'Creating…' : 'Create city'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
