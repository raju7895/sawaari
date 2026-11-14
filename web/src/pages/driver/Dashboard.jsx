import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Power, MapPin } from 'lucide-react';
import { acceptRide, listMyDriverRides, openRideRequests, setDriverOnline, updateRideStatus } from '../../lib/api';
import { subscribeToOpenRides } from '../../lib/realtime';
import { useAuth } from '../../context/AuthContext';
import { Card, Loading, Empty, ErrorNote, StatusBadge, Notice, useAsync } from '../../components/ui';
import { fmtINR } from '../../lib/format';

export default function Dashboard() {
  const { profile, refreshProfile } = useAuth();
  const requests = useAsync(() => openRideRequests(), []);
  const mine = useAsync(() => listMyDriverRides({ limit: 10 }), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const driver = profile?.driver;
  const online = Boolean(driver?.isOnline);

  /* new requests arrive live */
  useEffect(() => {
    if (!driver?.isVerified) return undefined;
    return subscribeToOpenRides(() => requests.reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.isVerified]);

  const toggle = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      await setDriverOnline(!online);
      await refreshProfile();
      setInfo(online ? 'You are offline.' : 'You are online — new requests will appear here.');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const accept = async (id) => {
    setBusy(true); setError('');
    try {
      await acceptRide(id);
      requests.reload();
      mine.reload();
      await refreshProfile();
      setInfo('You accepted the ride.');
    } catch (err) {
      setError(err.message);
      requests.reload();
    } finally { setBusy(false); }
  };

  const advance = async (id, status) => {
    setBusy(true); setError('');
    try {
      await updateRideStatus(id, status);
      mine.reload();
      requests.reload();
      await refreshProfile();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const active = (mine.data || []).find((r) => ['accepted', 'ongoing'].includes(r.status));

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {info ? <Notice tone="ok">{info}</Notice> : null}

      {!driver ? (
        <Notice tone="warn">
          This account has no driver record yet — sign up as a driver to receive rides.
        </Notice>
      ) : null}

      {driver && !driver.isVerified ? (
        <Notice tone="warn">
          Your driver account is not verified yet. An administrator has to approve it
          before you can receive rides.
        </Notice>
      ) : null}

      {driver ? (
        <Card title="You are">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold">{online ? 'Online — waiting for requests' : 'Offline'}</p>
              <p className="text-xs text-slate-500">
                {driver.ridesCompleted} rides · {fmtINR(driver.totalEarnings)} earned
              </p>
            </div>
            <button
              type="button"
              onClick={toggle}
              disabled={busy || !driver.isVerified}
              className={online ? 'btn-secondary' : 'btn-primary'}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {online ? 'Go offline' : 'Go online'}
            </button>
          </div>
        </Card>
      ) : null}

      {active ? (
        <Card title="Your current ride" action={<StatusBadge status={active.status} />}>
          <p className="font-semibold">{active.pickup?.address} → {active.drop?.address}</p>
          <p className="mt-1 text-sm text-slate-500">
            {active.riderName} · {active.ref} · {fmtINR(active.fare)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.status === 'accepted' ? (
              <button className="btn-primary" onClick={() => advance(active.id, 'ongoing')} disabled={busy}>
                Start the trip
              </button>
            ) : null}
            {active.status === 'ongoing' ? (
              <button className="btn-primary" onClick={() => advance(active.id, 'completed')} disabled={busy}>
                Complete the trip
              </button>
            ) : null}
            <button className="btn-secondary" onClick={() => advance(active.id, 'cancelled', 'Cancelled by the driver')} disabled={busy}>
              Cancel
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Open requests">
        {requests.loading ? <Loading /> : null}
        {!requests.loading && (requests.data || []).length === 0 ? (
          <Empty label={driver?.isVerified ? 'No open requests right now.' : 'Requests appear once you are verified and online.'} />
        ) : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(requests.data || []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate font-semibold">
                  <MapPin className="h-4 w-4 shrink-0 text-slate-400" /> {r.pickup?.address} → {r.drop?.address}
                </p>
                <p className="text-xs text-slate-500">
                  {r.riderName} · {r.distanceKm} km · {r.ref}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold">{fmtINR(r.fare)}</span>
                <button className="btn-primary" onClick={() => accept(r.id)} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Accept
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="My recent rides" action={<Link to="/driver/rides" className="link text-sm">See all</Link>}>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(mine.data || []).slice(0, 5).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate">{r.drop?.address}</span>
              <span className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                <b>{fmtINR(r.fare)}</b>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
