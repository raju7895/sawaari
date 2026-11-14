import { useState } from 'react';
import { CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { adminListDrivers, adminVerifyDriver } from '../../lib/api';
import { signedUrl } from '../../lib/storage';
import { Card, Loading, Empty, ErrorNote, StatusBadge, Notice, useAsync } from '../../components/ui';
import { fmtINR } from '../../lib/format';

export default function Drivers() {
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const drivers = useAsync(() => adminListDrivers({ status: filter, limit: 50 }), [filter]);

  const verify = async (driver, verified) => {
    setBusy(true); setError(''); setOk('');
    try {
      await adminVerifyDriver(driver.id, verified);
      setOk(`${driver.name || 'The driver'} was ${verified ? 'verified' : 'rejected'}.`);
      drivers.reload();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const openDoc = async (path) => {
    try {
      const url = await signedUrl('driver-documents', path);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (err) { setError(err.message); }
  };

  const rows = drivers.data?.rows || [];

  return (
    <div className="space-y-4">
      <ErrorNote message={error || drivers.error} onRetry={drivers.reload} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <div className="flex gap-2">
        {[['', 'All'], ['verified', 'Verified'], ['unverified', 'Not verified']].map(([k, label]) => (
          <button
            key={k || 'all'}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === k ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card title={`Drivers (${drivers.data?.total ?? 0})`}>
        {drivers.loading ? <Loading /> : null}
        {!drivers.loading && rows.length === 0 ? <Empty label="No drivers yet." /> : null}

        <div className="space-y-3">
          {rows.map((d) => {
            const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
            return (
              <div key={d.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{profile?.full_name || 'Driver'}</p>
                    <p className="text-xs text-slate-500">{profile?.phone} · {profile?.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={d.is_verified ? 'verified' : 'pending'} />
                    <span className="text-xs text-slate-500">
                      {d.rides_completed || 0} rides · {fmtINR(d.total_earnings || 0)}
                    </span>
                    <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => verify(d, !d.is_verified)}>
                      {d.is_verified ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      {d.is_verified ? 'Reject' : 'Verify'}
                    </button>
                  </div>
                </div>

                {d.vehicles?.length ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Vehicle: {d.vehicles[0].registration_number} · {d.vehicles[0].vehicle_type} · {d.vehicles[0].model || '—'}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-600">No vehicle on file yet.</p>
                )}

                {d.driver_documents?.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {d.driver_documents.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                        {doc.doc_type} · {doc.status}
                        <button type="button" className="link" onClick={() => openDoc(doc.file_path)}>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
