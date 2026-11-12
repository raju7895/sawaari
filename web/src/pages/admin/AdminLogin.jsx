import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShieldCheck, KeyRound, Loader2, Mail, ArrowLeft, Smartphone, Eye, EyeOff, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { LogoMark } from '../../components/DashboardLayout';

export default function AdminLogin() {
  const { adminLogin, verifyAdminTwoFactor, user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState('credentials'); // credentials | twofactor
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (user && ['super_admin', 'admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator'].includes(user.role)) {
      navigate('/admin', { replace: true });
    }
  }, [user, navigate]);

  const submitCredentials = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setHint('');
    try {
      const res = await adminLogin(identifier.trim(), password);
      if (res.requiresTwoFactor) {
        setChallenge(res.challenge);
        setStep('twofactor');
        toast('Password verified — now enter your authenticator code', 'info');
      } else if (res.token) {
        toast('Signed in to the admin console', 'success');
        navigate(res.requireTwoFactorSetup ? '/admin/2fa-setup' : '/admin', { replace: true });
      }
    } catch (err) {
      // keep the reason on screen — a toast alone disappears too quickly
      setError(err.message || 'Sign-in failed.');
      if (err.extra && err.extra.needEmailVerification) {
        setHint('A verification link was sent to your email address. Open it, then sign in again.');
      } else if (err.status === 429) {
        setHint('This is a temporary throttle after several failed attempts. Wait 15 minutes and try again.');
      } else if (err.status === 423) {
        setHint('The account is temporarily locked. Wait for the lock to expire, then sign in again.');
      }
      toast(err.message, 'error', 6000);
    } finally {
      setBusy(false);
    }
  };

  const submitTwoFactor = async (e) => {
    e.preventDefault();
    if (code.length !== 6) return toast('Enter the 6-digit code', 'error');
    setBusy(true);
    setError('');
    setHint('');
    try {
      const res = await verifyAdminTwoFactor(challenge, code);
      toast('Two-factor verified — welcome', 'success');
      navigate(res.requireTwoFactorSetup ? '/admin/2fa-setup' : '/admin', { replace: true });
    } catch (err) {
      setError(err.message || 'That code was not accepted.');
      if (err.status === 429) setHint('Too many invalid codes. Request a fresh sign-in and try again.');
      toast(err.message, 'error', 6000);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={48} />
          <h1 className="mt-4 text-2xl font-extrabold text-white">Master Control</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
            <ShieldCheck className="h-4 w-4 text-brand-400" /> Sawaari administration console
          </p>
        </div>

        <div className="card border-slate-800 bg-slate-900 p-6 shadow-2xl">
          {step === 'credentials' ? (
            <form onSubmit={submitCredentials} className="space-y-4">
              <div>
                <label className="label text-slate-300">Administrator email</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    className="input pl-9"
                    type="email"
                    autoComplete="username"
                    placeholder="you@example.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="label text-slate-300">Password</label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    className="input pl-9 pr-10"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button className="btn-primary w-full py-3" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Continue
              </button>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-900/20">
                  <p className="flex items-start gap-1.5 font-semibold text-red-700 dark:text-red-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </p>
                  {hint && <p className="mt-1 pl-6 text-xs text-red-600 dark:text-red-300">{hint}</p>}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-slate-400">
                <Link to="/admin-reset-password" className="link">Forgot password?</Link>
                <button
                  type="button"
                  className="link"
                  onClick={async () => {
                    if (!identifier.includes('@')) return toast('Enter your administrator email first', 'error');
                    try {
                      await fetch('/api/admin-auth/request-email-verification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: identifier.trim() }),
                      });
                      toast('If the address belongs to an administrator, a verification link has been sent', 'info', 6000);
                    } catch {
                      toast('Could not send the verification email right now', 'error');
                    }
                  }}
                >
                  Resend email verification
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitTwoFactor} className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl bg-brand-500/10 p-3 text-sm text-brand-200">
                <Smartphone className="h-5 w-5 shrink-0" />
                <span>Enter the 6-digit code from your authenticator app.</span>
              </div>
              <input
                className="input text-center text-3xl font-extrabold tracking-[0.4em]"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <button className="btn-primary w-full py-3" disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Verify &amp; sign in
              </button>
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-900/20">
                  <p className="flex items-start gap-1.5 font-semibold text-red-700 dark:text-red-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </p>
                  {hint && <p className="mt-1 pl-6 text-xs text-red-600 dark:text-red-300">{hint}</p>}
                </div>
              )}
              <button type="button" className="btn-ghost w-full" onClick={() => { setStep('credentials'); setCode(''); }}>
                <ArrowLeft className="h-4 w-4" /> Back to credentials
              </button>
              <p className="flex items-start gap-1.5 text-xs text-slate-500">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Lost your device? Use a single-use backup code, or ask the Super Admin to reset your two-factor setup.
              </p>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link to="/" className="link">← Back to Sawaari</Link>
        </p>
      </div>
    </div>
  );
}
