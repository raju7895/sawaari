import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminGetFares, adminSetFares } from '../../lib/api';
import { Card, Field, ErrorNote, Notice } from '../../components/ui';

const TYPES = ['auto', 'e_rickshaw'];

export default function Settings() {
  const [fares, setFares] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    adminGetFares().then(setFares).catch((e) => setError(e.message));
  }, []);

  const set = (type, key, value) => {
    setFares((f) => ({ ...f, [type]: { ...f[type], [key]: value } }));
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setOk('');
    try {
      const payload = Object.fromEntries(
        Object.entries(fares).map(([type, v]) => [type, {
          baseFare: Number(v.baseFare) || 0,
          perKm: Number(v.perKm) || 0,
          perMinute: Number(v.perMinute) || 0,
          minFare: Number(v.minFare) || 0,
        }])
      );
      await adminSetFares(payload);
      setOk('The fares were saved — they apply to every new ride.');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  if (!fares) return <p className="text-sm text-slate-500">Loading the fares…</p>;

  return (
    <form onSubmit={save} className="space-y-4">
      <ErrorNote message={error} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      {TYPES.map((type) => (
        <Card key={type} title={type === 'auto' ? 'Auto-rickshaw fares' : 'E-rickshaw fares'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Base fare (₹)">
              <input className="input" type="number" min="0" value={fares[type]?.baseFare ?? 0}
                onChange={(e) => set(type, 'baseFare', e.target.value)} />
            </Field>
            <Field label="Per kilometre (₹)">
              <input className="input" type="number" min="0" value={fares[type]?.perKm ?? 0}
                onChange={(e) => set(type, 'perKm', e.target.value)} />
            </Field>
            <Field label="Per minute (₹)">
              <input className="input" type="number" min="0" value={fares[type]?.perMinute ?? 0}
                onChange={(e) => set(type, 'perMinute', e.target.value)} />
            </Field>
            <Field label="Minimum fare (₹)">
              <input className="input" type="number" min="0" value={fares[type]?.minFare ?? 0}
                onChange={(e) => set(type, 'minFare', e.target.value)} />
            </Field>
          </div>
        </Card>
      ))}

      <button className="btn-primary" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save the fares
      </button>
    </form>
  );
}
