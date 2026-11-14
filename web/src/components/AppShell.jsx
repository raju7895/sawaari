/* The shell every signed-in screen sits in: a header, the navigation for
 * the person's role, and the sign-out button. */
import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LogOut, Menu, X, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AppShell({ title, links, children, badge }) {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const linkClass = ({ isActive }) =>
    `rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
      isActive
        ? 'bg-brand-700 text-white dark:bg-brand-600'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
    }`;

  const leave = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            className="rounded-lg p-2 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{title}</p>
            <p className="truncate text-xs text-slate-500">
              {profile?.name || 'Signed in'}
              {badge ? ` · ${badge}` : ''}
            </p>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          {role === 'admin' ? (
            <span className="hidden items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700 md:inline-flex dark:bg-red-900/40 dark:text-red-200">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin
            </span>
          ) : null}

          <button type="button" onClick={leave} className="btn-ghost flex items-center gap-1 text-sm">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>

        {open ? (
          <nav className="flex flex-wrap gap-1 border-t border-slate-200 px-4 py-2 md:hidden dark:border-slate-800">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  );
}
