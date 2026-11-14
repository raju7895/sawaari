import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, MapPin } from 'lucide-react';
import { bookRide, quoteRide } from '../../lib/api';
import { Card, Field, ErrorNote, Notice } from '../../components/ui';
import { fmtINR } from '../../lib/format';

const VEHICLES = [
  { key: 'auto', label: 'Auto-rickshaw' },
  { key: 'e_rickshaw', label: 'E-rickshaw' },
];

export default function BookRide() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    pickupAddress: '',
    dropAddress: '',
    vehicleType: 'auto',
    distanceKm: '',
  });
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  /* the fare is always calculated by the server */
  useEffect(() => {
    let active = true;
    const distance = Number(form.distanceKm) || 0;
    quoteRide({ vehicleType: form.vehicleType, distanceKm: distance, durationMin: Math.round(distance * 2) })
      .then((q) => { if (active) setQuote(q); })
      .catch(() => { if (active) setQuote(null); });
    return () => { active = false; };
  }, [form.vehicleType, form.distanceKm]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const distance = Number(form.distanceKm) || 0;
      const res = await bookRide({
        pickupAddress: form.pickupAddress,
        dropAddress: form.dropAddress,
        vehicleType: form.vehicleType,
        distanceKm: distance,
        durationMin: Math.round(distance * 2),
      });
      navigate(`/passenger/ride/${res.rideId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = form.pickupAddress.trim().length > 2 && form.dropAddress.trim().length > 2;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card title="Where are you going?">
        <div className="space-y-4">
          <ErrorNote message={error} />

          <Field label="Pickup address">
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="e.g. 12 MG Road, Bengaluru"
                value={form.pickupAddress}
                onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })}
                required
              />
            </div>
          </Field>

          <Field label="Drop address">
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="e.g. Airport Terminal 2"
                value={form.dropAddress}
                onChange={(e) => setForm({ ...form, dropAddress: e.target.value })}
                required
              />
            </div>
          </Field>

          <Field label="Vehicle">
            <select
              className="input"
              value={form.vehicleType}
              onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
            >
              {VEHICLES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </Field>

          <Field
            label="Approximate distance (km)"
            hint="Optional — the fare is calculated on the server from this number."
          >
            <input
              className="input"
              type="number"
              min="0"
              step="0.5"
              placeholder="e.g. 8"
              value={form.distanceKm}
              onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card title="Fare estimate">
        {quote ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-500">
              <p>Base {fmtINR(quote.breakdown?.baseFare)} · per km {fmtINR(quote.breakdown?.perKm)}</p>
              <p className="text-xs text-slate-400">calculated by the server</p>
            </div>
            <p className="text-2xl font-extrabold">{fmtINR(quote.fare)}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Enter the addresses to see the fare.</p>
        )}
      </Card>

      <button className="btn-primary w-full py-3" disabled={busy || !ready}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Book the ride
      </button>

      {info ? <Notice tone="ok">{info}</Notice> : null}
    </form>
  );
}
