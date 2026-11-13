import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, MapPin, History, CreditCard, Heart, User, LifeBuoy, Bell, Moon, Sun,
  LogOut, Menu, X, Car, Wallet, Star, ShieldCheck, Users, Building2, Settings,
  BarChart3, AlertTriangle, CarTaxiFront, MessageSquare, Megaphone, Radio, RotateCcw,
  UserCog, Receipt, ScrollText, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSocket } from '../context/SocketContext';
import { api, timeAgo, safeInternalPath } from '../api';
import Avatar from './Avatar';

const NAV = {
  passenger: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/book', label: 'Book an Auto', icon: CarTaxiFront },
    { to: '/app/history', label: 'My Rides', icon: History },
    { to: '/app/payments', label: 'Payments', icon: CreditCard },
    { to: '/app/locations', label: 'Saved Places', icon: Heart },
    { to: '/app/support', label: 'Help & Support', icon: LifeBuoy },
    { to: '/app/profile', label: 'Profile', icon: User },
  ],
  driver: [
    { to: '/driver', label: 'Drive', icon: LayoutDashboard, end: true },
    { to: '/driver/rides', label: 'My Rides', icon: History },
    { to: '/driver/earnings', label: 'Earnings', icon: Wallet },
    { to: '/driver/reviews', label: 'Reviews', icon: Star },
    { to: '/driver/support', label: 'Help & Support', icon: LifeBuoy },
    { to: '/driver/profile', label: 'Profile & Vehicle', icon: User },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, permission: 'analytics.view' },
    { to: '/admin/users', label: 'Users', icon: Users, permission: 'users.view' },
    { to: '/admin/drivers-directory', label: 'Drivers', icon: Car, permission: 'drivers.view' },
    { to: '/admin/drivers', label: 'Driver Verification', icon: ShieldCheck, badge: 'drivers', permission: 'drivers.view' },
    { to: '/admin/bookings', label: 'Bookings', icon: MapPin, permission: 'bookings.view' },
    { to: '/admin/live', label: 'Live Rides', icon: Radio, permission: 'bookings.view' },
    { to: '/admin/payments', label: 'Payments', icon: CreditCard, permission: 'payments.view' },
    { to: '/admin/revenue', label: 'Revenue & Earnings', icon: Wallet, permission: 'finance.view' },
    { to: '/admin/refunds', label: 'Refunds', icon: RotateCcw, permission: 'payments.view' },
    { to: '/admin/reports', label: 'Reports & Complaints', icon: AlertTriangle, permission: 'reports.view' },
    { to: '/admin/tickets', label: 'Support', icon: MessageSquare, permission: 'tickets.view' },
    { to: '/admin/admins', label: 'Admin Management', icon: UserCog, permission: 'admins.view' },
    { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.view' },
    { to: '/admin/cities', label: 'Cities & Locations', icon: Building2, permission: 'cities.view' },
    { to: '/admin/pricing', label: 'Pricing Management', icon: Receipt, permission: 'finance.settings' },
    { to: '/admin/notifications', label: 'Notifications', icon: Megaphone, permission: 'settings.view' },
    { to: '/admin/audit', label: 'Audit Logs', icon: ScrollText, permission: 'audit.view' },
    { to: '/admin/settings', label: 'Platform Settings', icon: Settings, permission: 'settings.view' },
    { to: '/admin/security', label: 'Security Settings', icon: ShieldAlert, permission: 'settings.view' },
  ],
};

const ROLE_LABEL = {
  passenger: 'Passenger', driver: 'Driver', admin: 'Admin',
  super_admin: 'Super Admin', finance_admin: 'Finance Admin', support_admin: 'Support Admin',
  driver_manager: 'Driver Manager', moderator: 'Moderator',
};

const ADMIN_ROLES = ['super_admin', 'admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator'];

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const { subscribe } = useSocket();
  const navigate = useNavigate();
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/notifications');
      setItems(res.notifications);
      setUnread(res.unread);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const off = subscribe('notification:new', (n) => {
      setItems((cur) => [n, ...cur].slice(0, 50));
      setUnread((u) => u + 1);
    });
    return off;
  }, [subscribe]);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open && unread) { api.post('/api/notifications/read-all').then(load); } }}
        className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-80 overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <p className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Notifications</p>
          {items.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-slate-400">No notifications yet</p>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setOpen(false);
                const target = safeInternalPath(n.data?.url);
                if (target) navigate(target);
              }}
              className="w-full rounded-xl p-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <p className="text-sm font-semibold">{n.title}</p>
              {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{n.body}</p>}
              <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.created_at)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const isAdminRole = ADMIN_ROLES.includes(user?.role);
  /* Administrators only see the sections their role may actually use.
     The server checks every action again — this is presentation only. */
  const navSource = isAdminRole ? NAV.admin : (NAV[user?.role] || NAV.passenger);
  const nav = navSource.filter(
    (item) => !item.permission
      || user?.role === 'super_admin'
      || (user?.permissions || []).includes(item.permission)
  );

  const doLogout = () => {
    if (isAdminRole) {
      api.post('/api/admin-auth/logout', {}).catch(() => {});
      logout();
      navigate('/admin-login');
      return;
    }
    logout();
    navigate('/login');
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 pb-5 pt-6">
        <LogoMark />
        <div>
          <p className="text-lg font-extrabold leading-none">Sawaari</p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-brand-600 dark:text-brand-400">
            {ROLE_LABEL[user?.role]} console
          </p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-3 rounded-xl p-2">
          <Avatar src={user?.avatarUrl} name={user?.name} size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-slate-500">{user?.email || user?.phone}</p>
          </div>
        </div>
        <button onClick={doLogout} className="btn-ghost mt-1 w-full justify-start text-red-600 dark:text-red-400">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        {sidebar}
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white dark:bg-slate-900 animate-slide-up">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 p-1 text-slate-400">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-500 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <button
            onClick={toggle}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <NotificationBell />
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function LogoMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#0d9488" />
      <circle cx="9.5" cy="21" r="2.6" fill="#fff" />
      <circle cx="22.5" cy="21" r="2.6" fill="#fff" />
      <path d="M6 18v-3.5L9 9h9.5l3 5.5H24V18H6Z" fill="#fff" />
      <path d="M8.5 14.5h11" stroke="#0d9488" strokeWidth="1.4" />
      <path d="M12 9l1.5-3h4L19 9" fill="#fff" />
    </svg>
  );
}
