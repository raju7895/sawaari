/* The page the password-reset link opens.
 *
 * Supabase sends a link with the recovery token in the URL; the client
 * turns it into a session, and this screen is where the new password is
 * chosen. Without it the link would drop the visitor on the sign-in page
 * with nothing they can do.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { supabase, friendlyError } from '../../lib/supabase';
import { useAuth, homeFor } from '../../context/AuthContext';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

export default function ResetPassword() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  /* a person who opens the page without the link has nothing to reset */
  useEffect(() => {
    if (!loading && !user && !done) {
      setError('This link is not valid any more. Ask for a new reset link and open it on this device.');
    }
  }, [loading, user, done]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true); setError('');
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw new Error(friendlyError(err));
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">Choose a new password</h1>
          <p className="text-sm text-slate-500">Then you are signed in with it</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />

          {done ? (
            <>
              <Notice tone="ok">Your password was changed.</Notice>
              <button
                type="button"
                className="btn-primary w-full py-3"
                onClick={() => navigate(profile?.role ? homeFor(profile.role) : '/')}
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="password">New password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div>
                <label className="label" htmlFor="confirm">Repeat the new password</label>
                <input
                  id="confirm"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <button className="btn-primary w-full py-3" disabled={busy || loading || !user}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Save the new password
              </button>
              <p className="text-center text-sm text-slate-500">
                <Link to="/login" className="link font-semibold">Back to sign in</Link>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
