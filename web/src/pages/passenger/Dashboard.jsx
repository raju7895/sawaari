import { Link } from 'react-router-dom';
import { CarTaxiFront, MapPin, History, Plus } from 'lucide-react';
import { activeRide, listMyRides } from '../../lib/api';
import { Card, Loading, Empty, ErrorNote, StatusBadge, useAsync } from '../../components/ui';
import { fmtINR } from '../../lib/format';

export default function Dashboard() {
  const rides = useAsync(() => listMyRides({ limit: 5 }), []);
  const current = useAsync(() => activeRide(), []);

  return (
    <div className="space-y-4">
      {current.loading ? <Loading /> : null}

      {current.data ? (
        <Card title="Your ride right now">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold">{current.data.pickup?.address} → {current.data.drop?.address}</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <StatusBadge status={current.data.status} />
                <span>{current.data.ref}</span>
                <span>{fmtINR(current.data.fare)}</span>
              </p>
            </div>
            <Link to={`/passenger/ride/${current.data.id}`} className="btn-primary">Track the ride</Link>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to="/passenger/book" className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            <span className="rounded-lg bg-brand-700 p-2 text-white"><CarTaxiFront className="h-5 w-5" /></span>
            <span>
              <span className="block font-bold">Book a ride</span>
              <span className="text-xs text-slate-500">Tell us where to pick you up</span>
            </span>
          </Link>
          <Link to="/passenger/places" className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            <span className="rounded-lg bg-slate-700 p-2 text-white"><MapPin className="h-5 w-5" /></span>
            <span>
              <span className="block font-bold">Saved places</span>
              <span className="text-xs text-slate-500">Home, work, favourite spots</span>
            </span>
          </Link>
        </div>
      </Card>

      <Card title="Recent rides" action={<Link to="/passenger/rides" className="link text-sm">See all</Link>}>
        <ErrorNote message={rides.error} onRetry={rides.reload} />
        {rides.loading ? <Loading /> : null}
        {!rides.loading && !rides.error && (rides.data || []).length === 0 ? (
          <Empty
            label="No rides yet."
            action={<Link to="/passenger/book" className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Book your first ride</Link>}
          />
        ) : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(rides.data || []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.pickup?.address} → {r.drop?.address}</p>
                <p className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleString('en-IN')} · {r.ref}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                <span className="text-sm font-bold">{fmtINR(r.fare)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
