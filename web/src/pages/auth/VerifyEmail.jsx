/* The "verify your e-mail" screen.
 *
 * Supabase sends a 6-digit code to the address. The visitor types it here
 * and the account is confirmed — no link to click, nothing to lose.
 *
 * The screen is reached from three places:
 *   /verify?mode=signup&email=…   after creating an account
 *   /verify?mode=magic&email=…    after asking for a sign-in code
 *   /verify?mode=signup&email=…   when a sign-in says "e-mail not confirmed"
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2, MailCheck, RefreshCw } from 'lucide-react';
import { useAuth, homeFor } from '../../context/AuthContext';
import LogoMark from '../../components/LogoMark';
import { ErrorNote, Notice } from '../../components/ui';

const RESEND_COOLDOWN = 60;

/** Remembers when the last code was asked for, so a refresh does not
 *  hand the visitor another e-mail straight away. */
function cooldownKey(email, mode) {
  return `sawaari:code-sent:${mode}:${email}`;
}

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, profile, loading, resendCode, sendCode, sendResetLink, verifyCode } = useAuth();

  const email = (params.get('email') || '').trim().toLowerCase();
  const mode = params.get('mode') || 'signup';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [seconds, setSeconds] = useState(() => {
    const left = Math.ceil((Number(localStorage.getItem(cooldownKey(email, mode)) || 0) - Date.now()) / 1000);
    return left > 0 ? left : 0;
  });
  const inputRef = useRef(null);

  /* the countdown */
  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  /* focus the code box straight away */
  useEffect(() => { inputRef.current?.focus(); }, []);

  /* arriving from a sign-in that said "e-mail not confirmed": ask for a
     fresh code right away, so the visitor does not have to press anything */
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current) return;
    if (params.get('resend') !== '1') return;
    if (!email) return;
    const left = Math.ceil((Number(localStorage.getItem(cooldownKey(email, mode)) || 0) - Date.now()) / 1000);
    if (left > 0) return;
    askedRef.current = true;
    resend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, mode, params]);

  /* the code was right: the session is there, so go to the right home */
  useEffect(() => {
    if (loading || !user) return;
    if (!profile) {
      /* the profile could not be read - give it a moment, then go anyway */
      const timer = setTimeout(() => navigate('/passenger', { replace: true }), 3000);
      return () => clearTimeout(timer);
    }
    if (mode === 'recovery') {
      /* the code was the one from the password reset e-mail */
      navigate('/reset-password', { replace: true });
      return;
    }
    navigate(homeFor(profile.role), { replace: true });
  }, [loading, user, profile, mode, navigate]);

  const heading = useMemo(() => {
    if (mode === 'magic') return 'Sign in with a code';
    if (mode === 'recovery') return 'Confirm your reset code';
    return 'Verify your e-mail';
  }, [mode]);

  const explain = useMemo(() => {
    if (mode === 'magic') {
      return `We sent a 6-digit code to ${email || 'your e-mail address'}. Type it here to sign in.`;
    }
    if (mode === 'recovery') {
      return `We sent a 6-digit code to ${email || 'your e-mail address'}. Type it here and you can choose a new password.`;
    }
    return `We sent a 6-digit code to ${email || 'your e-mail address'}. Type it here to finish creating your account.`;
  }, [mode, email]);

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
      await verifyCode(email, token, 'email');
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
      if (mode === 'magic') {
        /* the sign-in code is sent again as a whole e-mail — GoTrue's
           "resend" only knows the sign-up code */
        await sendCode(email, { shouldCreateUser: false });
      } else if (mode === 'recovery') {
        /* the password reset e-mail is sent again as a whole */
        await sendResetLink(email);
      } else {
        await resendCode(email, 'signup');
      }
      localStorage.setItem(cooldownKey(email, mode), String(Date.now() + RESEND_COOLDOWN * 1000));
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
          <h1 className="mt-3 text-2xl font-extrabold">{heading}</h1>
          <p className="text-sm text-slate-500">One code, one minute</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorNote message={error} />
          {ok ? <Notice tone="ok">{ok}</Notice> : null}

          <p className="text-sm text-slate-600 dark:text-slate-300">{explain}</p>

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
            <Link to="/login" className="link">Use a password instead</Link>
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            No code? Check the spam folder, or ask for a new one above. The code is
            only good for one hour.
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/" className="link">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
