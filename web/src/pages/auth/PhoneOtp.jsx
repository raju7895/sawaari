/* The screen where the code that arrived by SMS is typed.
 *
 * The number is shown the way the person wrote it, but it is always kept
 * in the international form underneath — the same string is used to send
 * the code and to check it, because Supabase compares the two.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { useAuth, homeFor } from '../../context/AuthContext';
import { formatPhone, toE164 } from '../../lib/phone';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

const RESEND_COOLDOWN = 60;

function cooldownKey(phone) {
  return `sawaari:sms-sent:${phone}`;
}

export default function PhoneOtp() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, profile, loading, resendPhoneCode, verifyPhoneCode } = useAuth();

  const phone = toE164(params.get('phone') || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [seconds, setSeconds] = useState(() => {
    const left = Math.ceil((Number(localStorage.getItem(cooldownKey(phone)) || 0) - Date.now()) / 1000);
    return left > 0 ? left : 0;
  });
  const inputRef = useRef(null);

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  /* the code was right → the session is there → go to the right home */
  useEffect(() => {
    if (loading || !user) return;
    if (!profile) {
      const timer = setTimeout(() => navigate('/passenger', { replace: true }), 3000);
      return () => clearTimeout(timer);
    }
    navigate(homeFor(profile.role), { replace: true });
  }, [loading, user, profile, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) {
      setError('The code has 6 digits.');
      inputRef.current?.focus();
      return;
    }
    setBusy(true); setError(''); setOk('');
    try {
      await verifyPhoneCode(phone, token);
      setOk('That is the right code. Signing you in…');
    } catch (err) {
      setError(err.message);
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (sending || seconds > 0) return;
    setSending(true); setError(''); setOk('');
    try {
      await resendPhoneCode(phone);
      localStorage.setItem(cooldownKey(phone), String(Date.now() + RESEND_COOLDOWN * 1000));
      setSeconds(RESEND_COOLDOWN);
      setOk('A new code is on its way.');
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">Enter the code</h1>
          <p className="text-sm text-slate-500">We sent it by SMS</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />
          {ok ? <Notice tone="ok">{ok}</Notice> : null}

          <p className="text-sm text-slate-600 dark:text-slate-300">
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {formatPhone(phone) || 'your mobile number'}
            </span>
            .
          </p>

          <div>
            <label className="label" htmlFor="code">6-digit code</label>
            <input
              id="code"
              ref={inputRef}
              className="input text-center text-2xl font-bold tracking-[0.5em]"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </div>

          <button className="btn-primary w-full py-3" disabled={busy || loading}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Verify and continue
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="link flex items-center gap-1.5"
              onClick={resend}
              disabled={sending || seconds > 0}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}
            </button>
            <Link to="/login" className="link">Use an e-mail instead</Link>
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
            No code? Check the messages on your phone, or ask for a new one above. The
            code is only good for one hour.
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/" className="link">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
