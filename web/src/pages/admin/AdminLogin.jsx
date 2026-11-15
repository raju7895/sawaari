import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth, homeFor } from '../../context/AuthContext';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

export default function AdminLogin() {
  const { signIn, signOut, profile } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /* already an administrator → straight to the console */
  useEffect(() => {
    if (profile?.role === 'admin') navigate('/admin', { replace: true });
  }, [profile, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      /* the role comes from the profile, not from the token */
      const signedIn = await signIn(form.email, form.password);
      if (signedIn?.role !== 'admin') {
        await signOut();
        setError('That account is not an administrator.');
        return;
      }
      navigate(homeFor('admin'), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-extrabold text-white">
            <ShieldCheck className="h-6 w-6 text-red-400" /> Master control
          </h1>
          <p className="text-sm text-slate-400">Administrators only</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />

          <div>
            <label className="label" htmlFor="email">E-mail address</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
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
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>

          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </button>

          <p className="text-center text-xs text-slate-400">
            <Link to="/" className="link">← Back to home</Link>
          </p>
        </form>

        <Notice tone="info">
          Access is granted by <code>profiles.role = 'admin'</code> — the server checks
          it on every request, the screen does not.
        </Notice>
      </div>
    </div>
  );
}
