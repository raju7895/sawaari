import { useCallback, useEffect, useState } from 'react';
import {
  Car, FileText, Upload, QrCode, ShieldCheck, ShieldAlert, Clock, BadgeCheck, XCircle,
  Camera, CheckCircle2, Banknote,
} from 'lucide-react';
import Modal from '../../components/Modal';
import { api, fmtDateTime } from '../../api';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';

const DOC_TYPES = [
  ['license', 'Driving licence'],
  ['aadhaar', 'Aadhaar card'],
  ['vehicle_rc', 'Vehicle RC'],
  ['insurance', 'Insurance'],
  ['profile_photo', 'Profile photo'],
];

const VEHICLE_TYPES = [
  ['auto', 'Auto-rickshaw'],
  ['e_rickshaw', 'E-rickshaw'],
];

export default function DriverProfilePage() {
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [vehicleForm, setVehicleForm] = useState({ registrationNumber: '', vehicleType: 'auto', model: '', capacity: 3 });
  const [upiId, setUpiId] = useState('');
  const [docType, setDocType] = useState('license');
  const [docNumber, setDocNumber] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/driver/me');
      setMe(d);
      setUpiId(d.upiId || '');
      if (d.vehicle) {
        setVehicleForm({
          registrationNumber: d.vehicle.registrationNumber || '',
          vehicleType: d.vehicle.vehicleType || 'auto',
          model: d.vehicle.model || '',
          capacity: d.vehicle.capacity || 3,
        });
      }
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const saveVehicle = async () => {
    setBusy('vehicle');
    try {
      await api.post('/api/driver/vehicle', vehicleForm);
      toast('Vehicle details saved', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const uploadDoc = async (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast('File must be under 8 MB', 'error');
    setBusy('doc');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', docType);
      if (docNumber.trim()) fd.append('docNumber', docNumber.trim());
      await api.upload('/api/driver/documents', fd);
      toast('Document uploaded for verification', 'success');
      setDocNumber('');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const uploadVehiclePhoto = async (file) => {
    if (!file) return;
    setBusy('vphoto');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload('/api/driver/vehicle/photo', fd);
      toast('Vehicle photo updated', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const saveUpi = async () => {
    setBusy('upi');
    try {
      await api.post('/api/driver/upi', { upiId: upiId.trim() });
      toast('UPI ID saved — an admin will verify it before QR payments unlock', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  if (!me) return <p className="p-6 text-center text-sm text-slate-400">Loading…</p>;

  const statusBanner = {
    approved: { icon: ShieldCheck, cls: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200', msg: 'Your driver account is approved. You can go online and accept rides.' },
    pending: { icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200', msg: 'Documents under review — you will be notified once approved.' },
    rejected: { icon: ShieldAlert, cls: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200', msg: me.rejectionReason || 'Your submission was rejected. Please re-upload valid documents.' },
  }[me.verificationStatus] || { icon: Clock, cls: '', msg: '' };
  const BannerIcon = statusBanner.icon;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Car className="h-6 w-6 text-brand-600" /> Profile &amp; vehicle</h1>

      {/* verification banner */}
      <div className={`card flex items-start gap-3 p-4 text-sm ${statusBanner.cls}`}>
        <BannerIcon className="mt-0.5 h-5 w-5 shrink-0" />
        <p>{statusBanner.msg}</p>
        <span className="ml-auto"><StatusBadge status={me.verificationStatus} /></span>
      </div>

      {/* vehicle */}
      <div className="card space-y-4 p-5">
        <p className="flex items-center gap-2 font-bold"><Car className="h-4 w-4 text-brand-600" /> Vehicle</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Registration number</label>
            <input className="input uppercase" placeholder="KA 05 AB 1234" maxLength={16}
              value={vehicleForm.registrationNumber}
              onChange={(e) => setVehicleForm((v) => ({ ...v, registrationNumber: e.target.value }))} />
            <p className="mt-1 text-xs text-slate-400">Indian format, e.g. KA 05 AB 1234</p>
          </div>
          <div>
            <label className="label">Vehicle type</label>
            <select className="input" value={vehicleForm.vehicleType}
              onChange={(e) => setVehicleForm((v) => ({ ...v, vehicleType: e.target.value }))}>
              {VEHICLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Model</label>
            <input className="input" placeholder="Bajaj RE" maxLength={60}
              value={vehicleForm.model}
              onChange={(e) => setVehicleForm((v) => ({ ...v, model: e.target.value }))} />
          </div>
          <div>
            <label className="label">Seat capacity</label>
            <input className="input" type="number" min={1} max={8}
              value={vehicleForm.capacity}
              onChange={(e) => setVehicleForm((v) => ({ ...v, capacity: Number(e.target.value) }))} />
          </div>
        </div>

        {/* vehicle photo */}
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-28 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            {me.vehicle?.photoUrl
              ? <img src={me.vehicle.photoUrl} alt="vehicle" className="h-full w-full object-cover" />
              : <Camera className="h-6 w-6 text-slate-300" />}
          </div>
          <label className="btn-secondary cursor-pointer">
            <Upload className="h-4 w-4" /> {busy === 'vphoto' ? 'Uploading…' : 'Upload vehicle photo'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => uploadVehiclePhoto(e.target.files?.[0])} />
          </label>
        </div>

        <button className="btn-primary" onClick={saveVehicle} disabled={busy === 'vehicle' || !vehicleForm.registrationNumber.trim()}>
          <CheckCircle2 className="h-4 w-4" /> {busy === 'vehicle' ? 'Saving…' : 'Save vehicle'}
        </button>
      </div>

      {/* documents */}
      <div className="card space-y-4 p-5">
        <p className="flex items-center gap-2 font-bold"><FileText className="h-4 w-4 text-brand-600" /> Verification documents</p>
        <p className="text-xs text-slate-400">
          Upload your driving licence and one more ID to get verified. Rejected accounts can re-upload after fixing issues.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Document type</label>
            <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Document number (optional)</label>
            <input className="input" placeholder="e.g. licence number" maxLength={40}
              value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
          </div>
        </div>
        <label className="btn-secondary cursor-pointer">
          <Upload className="h-4 w-4" /> {busy === 'doc' ? 'Uploading…' : 'Upload document (image/PDF)'}
          <input type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => uploadDoc(e.target.files?.[0])} />
        </label>

        {/* uploaded docs */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {(me.documents || []).length === 0 && (
            <p className="py-3 text-sm text-slate-400">No documents uploaded yet.</p>
          )}
          {(me.documents || []).map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold capitalize">{d.doc_type.replace('_', ' ')}{d.doc_number ? ` · ${d.doc_number}` : ''}</p>
                <p className="text-xs text-slate-400">{fmtDateTime(d.created_at)}{d.review_note ? ` · note: ${d.review_note}` : ''}</p>
              </div>
              <StatusBadge status={d.status} />
              <a href={d.file_url} target="_blank" rel="noreferrer" className="link text-xs">view</a>
            </div>
          ))}
        </div>
      </div>

      {/* UPI */}
      <div className="card space-y-4 p-5">
        <p className="flex items-center gap-2 font-bold"><QrCode className="h-4 w-4 text-brand-600" /> Payment UPI ID</p>
        <p className="text-xs text-slate-400">
          Passengers pay the fare straight to your UPI ID — Sawaari never holds your money.
          Your ID must be verified by an admin before passengers can scan your QR code.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input" placeholder="yourname@bank" value={upiId}
            onChange={(e) => setUpiId(e.target.value.toLowerCase())} />
          <button className="btn-primary shrink-0" onClick={saveUpi} disabled={busy === 'upi' || !upiId.trim()}>
            {busy === 'upi' ? 'Saving…' : 'Save UPI ID'}
          </button>
        </div>
        <div className={`flex items-center gap-2 rounded-xl p-3 text-sm ${
          me.upiVerified
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
            : 'bg-slate-50 text-slate-500 dark:bg-slate-800'
        }`}>
          {me.upiVerified
            ? <><BadgeCheck className="h-5 w-5" /> UPI ID verified — passengers can pay you by QR.</>
            : <><Clock className="h-5 w-5" /> {me.upiId ? 'Awaiting admin verification of your UPI ID.' : 'Add your UPI ID to receive QR payments.'}</>}
        </div>
      </div>

      {/* payout info */}
      <div className="card space-y-2 p-5">
        <p className="flex items-center gap-2 font-bold"><Banknote className="h-4 w-4 text-brand-600" /> Earnings at a glance</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-400">Today</p>
            <p className="tabular font-extrabold text-emerald-600">₹{me.todayEarnings}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-400">Lifetime</p>
            <p className="tabular font-extrabold">₹{me.totalEarnings}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-400">Rides</p>
            <p className="tabular font-extrabold">{me.ridesCompleted}</p>
          </div>
        </div>
        {me.upiVerified === false && me.upiId && (
          <p className="flex items-center gap-1.5 text-xs text-amber-600"><XCircle className="h-3.5 w-3.5" /> Cash mode until your UPI ID is verified.</p>
        )}
      </div>
    </div>
  );
}
