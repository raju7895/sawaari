/* The page a confirmation link opens.
 *
 * Supabase puts the session in the URL (the implicit flow), the client
 * picks it up on its own, and this screen waits for it and then sends the
 * visitor to the home of their role. If the link is no good it says so
 * instead of leaving the visitor on a blank page.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth, homeFor } from '../../context/AuthContext';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

export default function AuthCallback() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [problem, setProblem] = useState('');

  /* the session is there → go to the right home */
  useEffect(() => {
    if (loading || !user) return;
    if (!profile) return;                 // the profile is still being read
    navigate(homeFor(profile.role), { replace: true });
  }, [loading, user, profile, navigate]);

  /* no session after a while → the link was no good */
  useEffect(() => {
    if (loading) return undefined;
    if (user) return undefined;
    const timer = setTimeout(() => {
      setProblem('This link is not valid any more. It may have been used already, or it may have expired. Ask for a new code and we will send one — or sign in with Google.');
    }, 2500);
    return () => clearTimeout(timer);
  }, [loading, user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">Signing you in</h1>
          <p className="text-sm text-slate-500">One moment</p>
        </div>

        <div className="card space-y-4 p-6">
          <ErrorNote message={problem} />

          {!problem ? (
            <p className="flex items-center justify-center gap-2 py-6 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              {user ? 'Taking you to your dashboard…' : 'Confirming your e-mail address…'}
            </p>
          ) : (
            <>
              <Notice tone="warn">
                You can ask for a new code on the sign-in screen — it arrives by e-mail
                within a minute.
              </Notice>
              <Link to="/login" className="btn-primary w-full py-3">Go to sign in</Link>
              <Link to="/verify" className="btn-ghost w-full py-3">Enter a code</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
