import { adminDashboard } from '../../lib/api';
import { Card, Loading, ErrorNote, StatCard, useAsync } from '../../components/ui';
import { fmtINR } from '../../lib/format';

export default function Overview() {
  const dash = useAsync(() => adminDashboard(), []);

  const d = dash.data;
  const statuses = d ? Object.entries(d.byStatus) : [];

  return (
    <div className="space-y-4">
      <ErrorNote message={dash.error} onRetry={dash.reload} />
      {dash.loading ? <Loading /> : null}

      {d ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="People" value={d.users} />
            <StatCard label="Drivers" value={d.drivers} />
            <StatCard label="Rides" value={d.rides} />
            <StatCard label="Sign-ups today" value={d.signupsToday} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Payments" value={d.payments} />
            <StatCard label="Revenue" value={fmtINR(d.revenue)} />
            <StatCard label="Rides today" value={d.byStatus?.requested || 0} />
            <StatCard label="Completed" value={d.byStatus?.completed || 0} />
          </div>

          <Card title="Rides by status">
            {statuses.length === 0 ? (
              <p className="text-sm text-slate-500">No rides yet.</p>
            ) : (
              <ul className="space-y-2">
                {statuses.map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{status}</span>
                    <b>{count}</b>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
