import { listMyPayments } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Card, Loading, Empty, ErrorNote, StatusBadge, useAsync } from '../../components/ui';
import { fmtINR, fmtDate } from '../../lib/format';

export default function Earnings() {
  const { profile } = useAuth();
  const payments = useAsync(() => listMyPayments(), []);

  const rows = (payments.data || []).filter((p) => p.method !== 'cash' || true);
  const earned = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
  const byDay = {};
  rows.forEach((p) => {
    const day = fmtDate(p.createdAt);
    byDay[day] = (byDay[day] || 0) + Number(p.amount || 0);
  });
  const max = Math.max(1, ...Object.values(byDay));

  return (
    <div className="space-y-4">
      <Card title="Summary">
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-slate-500">Total earned</p>
            <p className="text-2xl font-extrabold">{fmtINR(profile?.driver?.totalEarnings ?? earned)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Rides completed</p>
            <p className="text-2xl font-extrabold">{profile?.driver?.ridesCompleted ?? rows.length}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Rating</p>
            <p className="text-2xl font-extrabold">
              {Number(profile?.driver?.ratingAvg || 0).toFixed(1)}
              <span className="text-sm text-slate-400"> / 5 ({profile?.driver?.ratingCount || 0})</span>
            </p>
          </div>
        </div>
      </Card>

      <Card title="Last 14 days">
        {payments.loading ? <Loading /> : null}
        {!payments.loading && Object.keys(byDay).length === 0 ? <Empty label="No earnings yet." /> : null}
        <div className="flex h-32 items-end gap-1">
          {Object.entries(byDay).map(([day, amount]) => (
            <div key={day} className="flex flex-1 flex-col items-center gap-1" title={`${day}: ${fmtINR(amount)}`}>
              <div
                className="w-full rounded-t bg-brand-600"
                style={{ height: `${Math.max(4, (amount / max) * 100)}%` }}
              />
              <span className="text-[9px] text-slate-400">{day.slice(0, 6)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Every ride">
        {payments.loading ? <Loading /> : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate">{p.ref || 'Ride'} · {fmtDate(p.createdAt)}</span>
              <span className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                <b>{fmtINR(p.amount)}</b>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
