import { useRef, useState } from 'react';
import { Loader2, Upload, Car } from 'lucide-react';
import { supabase, friendlyError } from '../../lib/supabase';
import { listMyDocuments, myDriver, saveVehicle, updateProfile } from '../../lib/api';
import { uploadFile, signedUrl } from '../../lib/storage';
import { useAuth } from '../../context/AuthContext';
import { Card, Field, ErrorNote, Notice, Loading, StatusBadge, useAsync } from '../../components/ui';

const DOC_TYPES = [
  { key: 'license', label: 'Driving licence' },
  { key: 'aadhaar', label: 'Aadhaar' },
  { key: 'vehicle_rc', label: 'Vehicle RC' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'profile_photo', label: 'Profile photo' },
];

export default function DriverProfile() {
  const { profile, refreshProfile } = useAuth();
  const driver = profile?.driver;
  const vehicle = driver?.vehicle;
  const [tab, setTab] = useState('profile');
  const [form, setForm] = useState({ fullName: profile?.fullName || '', phone: profile?.phone || '' });
  const [vehicleForm, setVehicleForm] = useState({
    registrationNumber: vehicle?.registration_number || '',
    vehicleType: vehicle?.vehicle_type || 'auto',
    model: vehicle?.model || '',
    capacity: vehicle?.capacity || 3,
  });
  const [docType, setDocType] = useState('license');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef(null);

  const docs = useAsync(() => listMyDocuments(), []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setOk('');
    try {
      await updateProfile({ full_name: form.fullName, phone: form.phone });
      await refreshProfile();
      setOk('Your details were saved.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const saveVehicle = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setOk('');
    try {
      await saveVehicle(vehicleForm);
      await refreshProfile();
      setOk('Your vehicle was saved.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError(''); setOk('');
    try {
      const path = `${profile.id}/${Date.now()}-${file.name}`;
      await uploadFile('driver-documents', file, path);
      const { error: err } = await supabase.from('driver_documents')
        .insert({ driver_id: driver.id, doc_type: docType, file_path: path });
      if (err) throw new Error(friendlyError(err));
      setOk('The document was uploaded — an administrator will review it.');
      docs.reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const openDoc = async (path) => {
    try {
      const url = await signedUrl('driver-documents', path);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <div className="flex gap-2">
        {[
          { key: 'profile', label: 'Details' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'documents', label: 'Documents' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              tab === t.key ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <Card title="Your details">
          <form onSubmit={save} className="space-y-3">
            <Field label="Full name">
              <input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
            </Field>
            <Field label="Mobile number">
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="E-mail address">
              <input className="input" value={profile?.email || ''} readOnly />
            </Field>
            <button className="btn-primary" disabled={busy}>Save</button>
          </form>
        </Card>
      ) : null}

      {tab === 'vehicle' ? (
        <Card title="Your vehicle">
          <form onSubmit={saveVehicle} className="space-y-3">
            <Field label="Registration number">
              <input
                className="input"
                placeholder="KA 01 AB 1234"
                value={vehicleForm.registrationNumber}
                onChange={(e) => setVehicleForm({ ...vehicleForm, registrationNumber: e.target.value })}
                required
              />
            </Field>
            <Field label="Vehicle type">
              <select
                className="input"
                value={vehicleForm.vehicleType}
                onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleType: e.target.value })}
              >
                <option value="auto">Auto-rickshaw</option>
                <option value="e_rickshaw">E-rickshaw</option>
              </select>
            </Field>
            <Field label="Model">
              <input
                className="input"
                placeholder="Bajaj RE"
                value={vehicleForm.model}
                onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })}
              />
            </Field>
            <Field label="Passenger capacity">
              <input
                className="input"
                type="number"
                min="1"
                max="8"
                value={vehicleForm.capacity}
                onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: Number(e.target.value) })}
              />
            </Field>
            <button className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Car className="h-4 w-4" />} Save the vehicle
            </button>
          </form>
        </Card>
      ) : null}

      {tab === 'documents' ? (
        <Card title="Your documents">
          <div className="space-y-3">
            <Field label="Document type">
              <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </Field>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy || !driver}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload a document
            </button>
            <p className="text-xs text-slate-400">JPG, PNG or PDF, up to 8 MB. Only you and the administrators can open them.</p>

            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(docs.data || []).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{DOC_TYPES.find((t) => t.key === d.doc_type)?.label || d.doc_type}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={d.status} />
                    <button type="button" className="link" onClick={() => openDoc(d.file_path)}>Open</button>
                  </span>
                </li>
              ))}
            </ul>
            {docs.loading ? <Loading /> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
