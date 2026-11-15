import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogIn, Loader2, KeyRound, Mail } from 'lucide-react';
import { useAuth, homeFor } from '../../context/AuthContext';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

export default function Login() {
  const { signIn, sendCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [withPassword, setWithPassword] = useState(true);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      if (withPassword) {
        const user = await signIn(form.email, form.password);
        const from = location.state?.from;
        navigate(from && from !== '/admin' ? from : homeFor(user?.role), { replace: true });
        return;
      }

      /* no password: send a 6-digit code to the address */
      await sendCode(form.email, { shouldCreateUser: false });
      navigate(`/verify?mode=magic&email=${encodeURIComponent(form.email.trim().toLowerCase())}`, { replace: true });
    } catch (err) {
      /* the address was never confirmed — send them to the code screen and
         ask for a new code on the way */
      if (err.code === 'email_not_confirmed') {
        const address = form.email.trim().toLowerCase();
        navigate(`/verify?mode=signup&email=${encodeURIComponent(address)}&resend=1`, { replace: true });
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">Welcome back</h1>
          <p className="text-sm text-slate-500">Sign in to book a ride</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />
          {ok ? <Notice tone="ok">{ok}</Notice> : null}

          <div>
            <label className="label" htmlFor="email">E-mail address</label>
            <input
              id="email"
              className="input"
              type="email"
              placeholder="you@email.com"
              autoComplete="username"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>

          {withPassword ? (
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
          ) : (
            <Notice tone="info">
              We will send a 6-digit code to your e-mail address. Type it on the next
              screen to sign in — no password needed.
            </Notice>
          )}

          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" />
              : withPassword ? <LogIn className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            {withPassword ? 'Sign in' : 'Send me a code'}
          </button>

          <button
            type="button"
            className="link flex w-full items-center justify-center gap-1.5 text-sm"
            onClick={() => { setWithPassword((v) => !v); setError(''); setOk(''); }}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {withPassword ? 'Sign in with a code instead of a password' : 'Use my password instead'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="link">Forgot password?</Link>
            <Link to="/register" className="link font-semibold">Create an account</Link>
          </div>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/" className="link">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
