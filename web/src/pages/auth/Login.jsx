import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, Loader2, Server } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { LogoMark } from '../../components/DashboardLayout';
import ServerSettings from '../../components/ServerSettings';
import { safeInternalPath } from '../../api';

export default function Login() {
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [needOtp, setNeedOtp] = useState(null);
  const [serverOpen, setServerOpen] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setNeedOtp(null);
    try {
      const user = await login(form.identifier.trim(), form.password);
      toast(`Welcome back, ${user.name.split(' ')[0]}!`, 'success');
      const from = safeInternalPath(location.state?.from);
      const ADMIN_ROLES = ['super_admin', 'admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator'];
      navigate(from || (ADMIN_ROLES.includes(user.role) ? '/admin' : user.role === 'driver' ? '/driver' : '/app'));
    } catch (err) {
      if (err.extra?.adminLogin) {
        toast('Administrator accounts sign in through the admin console', 'info', 6000);
        setTimeout(() => navigate('/admin-login'), 900);
      } else if (err.extra?.needOtp) {
        setNeedOtp({ phone: err.extra.phone, devCode: err.extra.devCode });
        toast('Your phone is not verified. Sending you to OTP verification…', 'info', 6000);
        setTimeout(() => navigate('/verify-otp', {
          state: { phone: err.extra.phone, devCode: err.extra.devCode, purpose: 'register' },
        }), 1500);
      } else {
        toast(err.message, 'error');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">Welcome back</h1>
          <p className="text-sm text-slate-500">Log in to book autos or drive</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="label">Mobile number or email</label>
            <input
              className="input" placeholder="98765 43210" autoComplete="username"
              value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input" type="password" placeholder="••••••••" autoComplete="current-password"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>
          {needOtp && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              This account's phone needs OTP verification — redirecting…
            </p>
          )}
          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Log in
          </button>
          <div className="flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="link">Forgot password?</Link>
            <Link to="/register" className="link font-semibold">Create account</Link>
          </div>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/" className="link">← Back to home</Link>
        </p>
        <p className="mt-2 text-center text-xs text-slate-400">
          <button type="button" onClick={() => setServerOpen(true)} className="link flex items-center justify-center gap-1">
            <Server className="h-3.5 w-3.5" /> Server settings
          </button>
        </p>
      </div>
      <ServerSettings open={serverOpen} onClose={() => setServerOpen(false)} />
    </div>
  );
}
