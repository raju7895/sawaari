import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { supabase, friendlyError } from '../../lib/supabase';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/login`,
      });
      if (err) throw new Error(friendlyError(err));
      setSent(true);
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
          <h1 className="mt-3 text-2xl font-extrabold">Reset your password</h1>
          <p className="text-sm text-slate-500">We will e-mail you a reset link</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />

          {sent ? (
            <Notice tone="ok">
              If an account exists for {email}, a reset link is on its way. Open it on
              this device and you can choose a new password.
            </Notice>
          ) : (
            <div>
              <label className="label" htmlFor="email">E-mail address</label>
              <input
                id="email"
                className="input"
                type="email"
                placeholder="you@email.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          )}

          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Send the reset link
          </button>

          <p className="text-center text-sm text-slate-500">
            <Link to="/login" className="link font-semibold">Back to sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
