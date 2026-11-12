import { useCallback, useEffect, useState } from 'react';
import { Wallet, TrendingUp, Receipt, Percent } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import StatCard from '../../components/StatCard';
import { api, fmtINR, fmtDate } from '../../api';

const RANGES = [
  ['day', 'Today'],
  ['week', 'This week'],
  ['month', '30 days'],
];

export default function DriverEarnings() {
  const [range, setRange] = useState('week');
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/api/driver/earnings?range=${range}`));
    } catch { setData(null); }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const chart = (data?.daily || []).map((d) => ({
    day: new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    net: d.net,
    rides: d.rides,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Wallet className="h-6 w-6 text-brand-600" /> Earnings</h1>
          <p className="text-sm text-slate-500">Your payout is the fare minus the platform commission</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map(([key, label]) => (
            <button key={key} onClick={() => setRange(key)}
              className={`badge px-3 py-1.5 ${range === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Wallet} label="Net earnings" value={data.summary.net} currency tone="emerald"
            sub={`${data.summary.rides} completed rides`} />
          <StatCard icon={Receipt} label="Gross fares" value={data.summary.gross} currency tone="blue" />
          <StatCard icon={Percent} label="Platform fee" value={data.summary.commission} currency tone="amber"
            sub="commission deducted" />
          <StatCard icon={TrendingUp} label="Avg per ride" value={data.summary.rides ? Math.round(data.summary.net / data.summary.rides) : 0} currency tone="violet" />
        </div>
      )}

      {/* daily chart */}
      <div className="card p-4">
        <p className="mb-3 text-sm font-bold">Net earnings · last 30 days</p>
        <div className="h-56">
          {chart.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              No completed rides in the last 30 days yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.25)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v) => [fmtINR(v), 'Net']}
                  contentStyle={{ borderRadius: 12, border: '1px solid rgb(148 163 184 / 0.3)' }}
                />
                <Bar dataKey="net" fill="#0d9488" radius={[6, 6, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ledger */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3">
          <p className="text-sm font-bold">Ledger</p>
        </div>
        {(data?.records || []).length === 0 && (
          <p className="px-4 pb-5 pt-2 text-sm text-slate-400">No rides in this period.</p>
        )}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {(data?.records || []).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {r.from?.split(',')[0]} <span className="text-slate-400">→</span> {r.to?.split(',')[0]}
                </p>
                <p className="text-xs text-slate-400">{r.ref} · {fmtDate(r.completedAt)}</p>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-extrabold text-emerald-600">{fmtINR(r.net)}</p>
                <p className="tabular text-[11px] text-slate-400">{fmtINR(r.gross)} − {fmtINR(r.commission)} fee</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
