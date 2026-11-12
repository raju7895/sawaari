import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Car, Wallet, Building2 } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api, fmtINR } from '../../api';
import { StarDisplay } from '../../components/StarRating';

const PIE_COLORS = ['#0d9488', '#f59e0b', '#6366f1', '#10b981', '#f43f5e'];

export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/admin/analytics').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="p-6 text-center text-sm text-red-600">{error}</div>;
  if (!data) {
    return <div className="flex h-full items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-600 border-t-transparent" />
    </div>;
  }

  const daily = (data.daily || []).map((d) => ({
    day: new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    bookings: d.bookings, completed: d.completed, cancelled: d.cancelled, revenue: d.revenue,
  }));
  const hasData = daily.length > 0;
  const pie = (data.paymentSplit || []).map((p) => ({
    name: p.method === 'upi_qr' ? 'UPI QR' : p.method === 'razorpay' ? 'Razorpay' : p.method,
    value: p.amount, count: p.count,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><BarChart3 className="h-6 w-6 text-brand-600" /> Analytics</h1>
        <p className="text-sm text-slate-500">Last 30 days of bookings, revenue and drivers</p>
      </div>

      {!hasData && (
        <div className="card p-10 text-center text-sm text-slate-400">
          No bookings in the last 30 days — charts will appear as rides happen.
        </div>
      )}

      {/* bookings trend */}
      {hasData && (
        <div className="card p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold"><TrendingUp className="h-4 w-4 text-brand-600" /> Bookings per day</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gBookings" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.25)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12 }} />
                <Area type="monotone" dataKey="bookings" stroke="#0d9488" strokeWidth={2.5} fill="url(#gBookings)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* revenue trend */}
        {hasData && (
          <div className="card p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><Wallet className="h-4 w-4 text-emerald-600" /> Completed-ride revenue (₹)</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.25)" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [fmtINR(v), 'Revenue']} contentStyle={{ borderRadius: 12 }} />
                  <Bar dataKey="revenue" fill="#10b981" radius={[5, 5, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* payment split */}
        {pie.length > 0 && (
          <div className="card p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><Wallet className="h-4 w-4 text-brand-600" /> Paid by method (₹)</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {pie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtINR(v)} contentStyle={{ borderRadius: 12 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* city stats */}
        {(data.cityStats || []).length > 0 && (
          <div className="card p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><Building2 className="h-4 w-4 text-brand-600" /> Cities (30 days)</p>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.cityStats.map((c) => (
                <div key={c.name} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-semibold">{c.name}</span>
                  <div className="text-right">
                    <p className="tabular text-sm font-extrabold">{c.bookings} bookings</p>
                    <p className="tabular text-xs text-emerald-600">{fmtINR(c.revenue)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* top drivers */}
        {(data.topDrivers || []).length > 0 && (
          <div className="card p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><Car className="h-4 w-4 text-brand-600" /> Top drivers</p>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.topDrivers.map((d, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <span className={`tabular flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold ${
                    i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400'
                  }`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.name}</p>
                    <StarDisplay value={d.rating} size={11} />
                  </div>
                  <div className="text-right">
                    <p className="tabular text-sm font-extrabold text-emerald-600">{fmtINR(d.earnings)}</p>
                    <p className="text-xs text-slate-400">{d.rides} rides</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
