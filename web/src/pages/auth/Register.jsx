import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Loader2, ShieldCheck, CarTaxiFront, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import GoogleButton from '../../components/GoogleButton';
import LogoMark from '../../components/LogoMark';
import { ErrorNote } from '../../components/ui';

export default function Register() {
  const { signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState('rider');
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /* Google creates the account by itself — the trigger gives it a profile */
  const withGoogle = async () => {
    setBusy(true); setError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await signUp({ ...form, role });
      if (res.needsEmailConfirmation) {
        /* the address has to be confirmed first — the code is on its way */
        navigate(`/verify?mode=signup&email=${encodeURIComponent(res.email)}`, { replace: true });
        return;
      }
      navigate(role === 'driver' ? '/driver/profile' : '/passenger', { replace: true });
    } catch (err) {
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
          <h1 className="mt-3 text-2xl font-extrabold">Create your account</h1>
          <p className="text-sm text-slate-500">Riders and drivers — it takes a minute</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />

          {/* the quickest way in — Google creates the account itself */}
          <GoogleButton onClick={withGoogle} busy={busy} />

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-slate-400">or with your e-mail address</span>
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

            {/* role */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {[
                { key: 'rider', label: 'Rider', icon: User },
                { key: 'driver', label: 'Driver', icon: CarTaxiFront },
              ].map((r) => (
                <button
                  type="button"
                  key={r.key}
                  onClick={() => setRole(r.key)}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                    role === r.key
                      ? 'bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-300'
                      : 'text-slate-500'
                  }`}
                >
                  <r.icon className="h-4 w-4" /> {r.label}
                </button>
              ))}
            </div>

            <div>
              <label className="label" htmlFor="fullName">Full name</label>
              <input
                id="fullName"
                className="input"
                placeholder="Priya Sharma"
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                required
                minLength={2}
              />
            </div>

            <div>
              <label className="label" htmlFor="phone">Mobile number</label>
              <div className="flex gap-2">
                <span className="flex items-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800">+91</span>
                <input
                  id="phone"
                  className="input"
                  placeholder="98765 43210"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="email">E-mail address</label>
              <input
                id="email"
                className="input"
                type="email"
                placeholder="you@email.com"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </div>

            {role === 'driver' ? (
              <p className="flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-xs text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                After signing up you will add your vehicle and upload your licence. An
                administrator verifies them before you can accept rides.
              </p>
            ) : null}

            <button className="btn-primary w-full py-3" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create account
            </button>

            <p className="text-center text-sm text-slate-500">
              Already registered? <Link to="/login" className="link font-semibold">Sign in</Link>
            </p>
          </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/" className="link">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
