import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Loader2, MailCheck, AlertTriangle } from 'lucide-react';
import { LogoMark } from '../../components/DashboardLayout';

export default function VerifyAdminEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState(token ? 'verifying' : 'missing');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch('/api/admin-auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (res.ok) {
          setState('done');
          setMessage(data.message || 'Email verified.');
        } else {
          setState('error');
          setMessage(data.error || 'This verification link is invalid or has expired.');
        }
      } catch {
        setState('error');
        setMessage('Could not reach the server. Please try again.');
      }
    })();
  }, [token]);

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={48} />
          <h1 className="mt-4 text-2xl font-extrabold text-white">Email verification</h1>
        </div>
        <div className="card border-slate-800 bg-slate-900 p-6">
          {state === 'verifying' && (
            <div className="flex flex-col items-center gap-3 py-6 text-slate-300">
              <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
              <p className="text-sm">Verifying your email address…</p>
            </div>
          )}
          {state === 'done' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <MailCheck className="h-10 w-10 text-emerald-400" />
              <p className="text-sm text-slate-200">{message}</p>
              <Link to="/admin-login" className="btn-primary mt-2">Continue to sign in</Link>
            </div>
          )}
          {(state === 'error' || state === 'missing') && (
            <div className="flex flex-col items-center gap-3 py-4">
              <AlertTriangle className="h-10 w-10 text-amber-400" />
              <p className="text-sm text-slate-200">
                {state === 'missing' ? 'This link is missing its verification token.' : message}
              </p>
              <Link to="/admin-login" className="btn-secondary mt-2">Back to sign in</Link>
            </div>
          )}
        </div>
        <p className="mt-6 text-xs text-slate-500">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
          Administrator access requires a verified email address.
        </p>
      </div>
    </div>
  );
}
