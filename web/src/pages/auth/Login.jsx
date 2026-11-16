import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogIn, Loader2, KeyRound, Mail, MessageSquare, UserRound, CarTaxiFront } from 'lucide-react';
import { useAuth, homeFor } from '../../context/AuthContext';
import { formatPhone, toE164 } from '../../lib/phone';
import { PHONE_OTP_ENABLED, EMAIL_OTP_ENABLED } from '../../lib/flags';
import { demoLogin, guestLogin, demoAccountsReady, guestLoginEnabled } from '../../lib/quickLogin';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

/* E-mail and password always work. The other two are only offered when
 * the provider they need is really set up — see lib/flags.js. */
const METHODS = [
  { key: 'password', label: 'Password', icon: LogIn },
  ...(EMAIL_OTP_ENABLED ? [{ key: 'email', label: 'E-mail code', icon: Mail }] : []),
  ...(PHONE_OTP_ENABLED ? [{ key: 'phone', label: 'Mobile OTP', icon: MessageSquare }] : []),
];

export default function Login() {
  const { signIn, sendCode, sendPhoneCode, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [method, setMethod] = useState('password');
  const [form, setForm] = useState({ email: '', password: '', phone: '', fullName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      if (method === 'password') {
        /* the profile carries the role (rider / driver / admin) */
        const profile = await signIn(form.email, form.password);
        const from = location.state?.from;
        navigate(from && from !== '/admin' ? from : homeFor(profile?.role), { replace: true });
        return;
      }

      if (method === 'email') {
        /* no password: send a 6-digit code to the address */
        await sendCode(form.email, { shouldCreateUser: false });
        navigate(`/verify?mode=magic&email=${encodeURIComponent(form.email.trim().toLowerCase())}`, { replace: true });
        return;
      }

      /* mobile: send a 6-digit code by SMS */
      const number = await sendPhoneCode(form.phone, {
        shouldCreateUser: true,
        data: form.fullName ? { full_name: form.fullName.trim() } : undefined,
      });
      navigate(`/phone-otp?phone=${encodeURIComponent(number)}`, { replace: true });
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

  /* the shared demo accounts — the addresses and the passwords come from
     the build environment, never from the source */
  const useDemo = async (role) => {
    setBusy(true); setError(''); setOk('');
    try {
      await demoLogin(role);
      const profile = await refreshProfile();
      navigate(homeFor(profile?.role), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /* a guest account: no address, no password, just a way to look around */
  const asGuest = async () => {
    setBusy(true); setError(''); setOk('');
    try {
      await guestLogin();
      const profile = await refreshProfile();
      navigate(homeFor(profile?.role), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const title = method === 'phone' ? 'Sign in with your mobile'
    : method === 'email' ? 'Sign in with a code'
      : 'Welcome back';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">{title}</h1>
          <p className="text-sm text-slate-500">
            {method === 'phone' ? 'We send a 6-digit code by SMS'
              : method === 'email' ? 'We send a 6-digit code by e-mail'
                : 'Sign in to book a ride'}
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />
          {ok ? <Notice tone="ok">{ok}</Notice> : null}

          {/* the ways in — the e-mail one always works, the others only
              when their provider is set up */}
          {METHODS.length > 1 ? (
            <div className={`grid gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 ${METHODS.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => { setMethod(m.key); setError(''); setOk(''); }}
                  className={`flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-semibold transition-all ${
                    method === m.key
                      ? 'bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-300'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  <m.icon className="h-4 w-4" />
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}

          {method === 'phone' ? (
            <>
              <div>
                <label className="label" htmlFor="phone">Mobile number</label>
                <div className="flex gap-2">
                  <span className="flex items-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800">+91</span>
                  <input
                    id="phone"
                    className="input"
                    type="tel"
                    inputMode="tel"
                    placeholder="98765 43210"
                    autoComplete="tel-national"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  We send it to {formatPhone(form.phone) || 'your number'} — that is the
                  number the code goes to.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="fullName">Your name — for a new account</label>
                <input
                  id="fullName"
                  className="input"
                  placeholder="Priya Sharma"
                  autoComplete="name"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
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

              {method === 'password' ? (
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
                  We will send a 6-digit code to your e-mail address. Type it on the
                  next screen to sign in — no password needed.
                </Notice>
              )}
            </>
          )}

          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" />
              : method === 'phone' ? <MessageSquare className="h-4 w-4" />
                : method === 'email' ? <Mail className="h-4 w-4" />
                  : <LogIn className="h-4 w-4" />}
            {method === 'phone' ? 'Send me a code by SMS'
              : method === 'email' ? 'Send me a code by e-mail'
                : 'Sign in'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="link">Forgot password?</Link>
            <Link to="/register" className="link font-semibold">Create an account</Link>
          </div>

          {/* the ways in that need no account */}
          {(demoAccountsReady() || guestLoginEnabled()) ? (
            <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-center text-xs text-slate-400">
                or look around first
              </p>
              <div className="flex flex-wrap gap-2">
                {demoAccountsReady() ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary flex-1 py-2 text-xs"
                      disabled={busy}
                      onClick={() => useDemo('rider')}
                    >
                      <UserRound className="h-4 w-4" />
                      Demo Passenger
                    </button>
                    <button
                      type="button"
                      className="btn-secondary flex-1 py-2 text-xs"
                      disabled={busy}
                      onClick={() => useDemo('driver')}
                    >
                      <CarTaxiFront className="h-4 w-4" />
                      Demo Driver
                    </button>
                  </>
                ) : null}
                {guestLoginEnabled() ? (
                  <button
                    type="button"
                    className="btn-secondary w-full py-2 text-xs"
                    disabled={busy}
                    onClick={asGuest}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                    Continue as Guest
                  </button>
                ) : null}
              </div>
              <p className="text-center text-xs text-slate-400">
                A guest can browse and book a ride, but cannot sign in again later.
              </p>
            </div>
          ) : null}

          {method === 'phone' ? (
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
              If no SMS arrives, use the e-mail options instead — they always work.
            </p>
          ) : null}
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/" className="link">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
