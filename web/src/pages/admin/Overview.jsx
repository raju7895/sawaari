import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Car, MapPin, Wallet, AlertTriangle, MessageSquare, TrendingUp, Download,
  Building2, ShieldCheck, Banknote, Clock, UserCheck, UserX, Radio, ReceiptIndianRupee,
  TrendingDown, UserPlus, CreditCard,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import StatCard from '../../components/StatCard';
import { api, fmtINR } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

const COLORS = ['#0d9488', '#2563eb', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981'];

export default function AdminOverview() {
  const toast = useToast();
  const can = usePermission();
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [range, setRange] = useState('30d');

  const load = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([
        api.get('/api/master/dashboard'),
        can('analytics.view') ? api.get('/api/master/analytics') : Promise.resolve(null),
      ]);
      setData(d);
      setAnalytics(a);
    } catch (e) { toast(e.message, 'error'); }
  }, [toast, can]);

  useEffect(() => { load(); }, [load]);

  const download = (type) => { window.open(`/api/admin/export/${type}`, '_blank'); };

  if (!data) {
    return <div className="flex h-full items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-600 border-t-transparent" />
    </div>;
  }

  const daily = analytics ? analytics.dailyBookings : [];
  const signups = (analytics ? analytics.driverSignups : []).map((d) => ({
    day: d.day,
    drivers: d.signups,
    passengers: (analytics.passengerSignups.find((p) => p.day === d.day) || {}).signups || 0,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Master control</h1>
          <p className="text-sm text-slate-500">
            Live snapshot of the whole platform · updated {new Date(data.generatedAt).toLocaleTimeString('en-IN')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => download('bookings')}><Download className="h-4 w-4" /> Bookings CSV</button>
          <button className="btn-secondary" onClick={() => download('users')}><Download className="h-4 w-4" /> Users CSV</button>
          <button className="btn-secondary" onClick={() => download('drivers')}><Download className="h-4 w-4" /> Drivers CSV</button>
          <button className="btn-secondary" onClick={() => download('payments')}><Download className="h-4 w-4" /> Payments CSV</button>
        </div>
      </div>

      {/* action-needed strip */}
      {(data.drivers.pending > 0 || data.payments.pending > 0 || data.reports.active > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.drivers.pending > 0 && (
            <Link to="/admin/drivers" className="card flex items-center gap-3 border-amber-300 bg-amber-50 p-4 hover:shadow-md dark:border-amber-700 dark:bg-amber-900/20">
              <Clock className="h-5 w-5 text-amber-600" />
              <p className="text-sm font-bold text-amber-800 dark:text-amber-200">{data.drivers.pending} driver(s) waiting for approval</p>
            </Link>
          )}
          {data.payments.pending > 0 && (
            <Link to="/admin/payments" className="card flex items-center gap-3 border-amber-300 bg-amber-50 p-4 hover:shadow-md dark:border-amber-700 dark:bg-amber-900/20">
              <Wallet className="h-5 w-5 text-amber-600" />
              <p className="text-sm font-bold text-amber-800 dark:text-amber-200">{data.payments.pending} payment(s) to verify</p>
            </Link>
          )}
          {data.reports.active > 0 && (
            <Link to="/admin/reports" className="card flex items-center gap-3 border-red-300 bg-red-50 p-4 hover:shadow-md dark:border-red-800 dark:bg-red-900/20">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <p className="text-sm font-bold text-red-800 dark:text-red-200">{data.reports.active} open report(s)</p>
            </Link>
          )}
        </div>
      )}

      {/* ── People ── */}
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">People</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Users} label="Registered users" value={data.users.total} tone="blue"
            sub={`${data.users.passengers} passengers · ${data.users.drivers} drivers`} />
          <StatCard icon={UserPlus} label="Admins" value={data.users.admins} tone="violet"
            sub={`${data.users.registeredToday} sign-ups today`} />
          <StatCard icon={UserCheck} label="Verified drivers" value={data.drivers.verified} tone="emerald"
            sub={`${data.drivers.pending} pending verification`} />
          <StatCard icon={Radio} label="Drivers online" value={data.drivers.online} tone="brand"
            sub={`${data.drivers.offline} currently offline`} />
        </div>
      </section>

      {/* ── Operations ── */}
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Operations</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={MapPin} label="Total bookings" value={data.bookings.total} tone="violet"
            sub={`${data.bookings.today} today`} />
          <StatCard icon={TrendingUp} label="Active rides" value={data.bookings.active} tone="amber"
            sub="searching, assigned or in progress" />
          <StatCard icon={ShieldCheck} label="Completed rides" value={data.bookings.completed} tone="emerald"
            sub={`${data.bookings.cancelled} cancelled`} />
          <StatCard icon={UserX} label="Suspended accounts" value={data.suspensions.active} tone="red"
            sub={`${data.users.blocked} currently blocked`} />
        </div>
      </section>

      {/* ── Money ── */}
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Revenue & payments</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Banknote} label="Platform revenue" value={data.revenue.total} currency tone="emerald"
            sub="commission earned, all time" />
          <StatCard icon={ReceiptIndianRupee} label="Today's revenue" value={data.revenue.today} currency tone="brand"
            sub={`this month ₹${data.revenue.month}`} />
          <StatCard icon={CreditCard} label="Transactions" value={data.payments.total} tone="blue"
            sub={`${data.payments.paid} settled · ${data.payments.collected} collected`} />
          <StatCard icon={AlertTriangle} label="Failed payments" value={data.payments.failed} tone="red"
            sub={`${data.payments.pending} awaiting verification`} />
        </div>
      </section>

      {/* ── Charts ── */}
      {analytics && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold">
              <TrendingUp className="h-4 w-4 text-brand-600" /> Booking growth (last 30 days)
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient id="gBookings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="bookings" name="Bookings" stroke="#0d9488" fill="url(#gBookings)" />
                  <Area type="monotone" dataKey="completed" name="Completed" stroke="#10b981" fillOpacity={0} />
                  <Area type="monotone" dataKey="cancelled" name="Cancelled" stroke="#ef4444" fillOpacity={0} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Banknote className="h-4 w-4 text-brand-600" /> Monthly revenue (12 months)
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.monthlyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtINR(v)} />
                  <Legend />
                  <Bar dataKey="revenue" name="Commission" fill="#0d9488" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="rides" name="Rides" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold">
              <UserPlus className="h-4 w-4 text-brand-600" /> Registrations (last 30 days)
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={signups}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="passengers" name="Passengers" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="drivers" name="Drivers" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold">
              <CreditCard className="h-4 w-4 text-brand-600" /> Payment method mix
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics.paymentMethods} dataKey="amount" nameKey="method"
                    innerRadius={50} outerRadius={85} paddingAngle={3}>
                    {analytics.paymentMethods.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${fmtINR(v)}`, n]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5 lg:col-span-2">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Building2 className="h-4 w-4 text-brand-600" /> City-wise bookings
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.cityBookings} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="city" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="bookings" name="Bookings" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="revenue" name="Revenue" fill="#0d9488" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick links ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/admin/live" className="card flex items-center gap-3 p-4 hover:shadow-md">
          <Radio className="h-5 w-5 text-brand-600" />
          <div><p className="font-bold">Live rides</p><p className="text-xs text-slate-400">{data.bookings.active} in progress</p></div>
        </Link>
        <Link to="/admin/revenue" className="card flex items-center gap-3 p-4 hover:shadow-md">
          <Banknote className="h-5 w-5 text-emerald-600" />
          <div><p className="font-bold">Revenue &amp; earnings</p><p className="text-xs text-slate-400">driver payouts, settlements</p></div>
        </Link>
        <Link to="/admin/audit" className="card flex items-center gap-3 p-4 hover:shadow-md">
          <ShieldCheck className="h-5 w-5 text-violet-600" />
          <div><p className="font-bold">Audit log</p><p className="text-xs text-slate-400">every admin action, immutable</p></div>
        </Link>
        <Link to="/admin/security" className="card flex items-center gap-3 p-4 hover:shadow-md">
          <ShieldCheck className="h-5 w-5 text-red-600" />
          <div><p className="font-bold">Security centre</p><p className="text-xs text-slate-400">sessions, lockouts, 2FA</p></div>
        </Link>
      </div>

      {analytics && (
        <p className="text-center text-xs text-slate-400">
          Ratings: {analytics.ratings.average} average from {analytics.ratings.total} reviews ·
          {' '}<Link to="/admin/analytics" className="link">Full analytics →</Link>
        </p>
      )}
    </div>
  );
}
