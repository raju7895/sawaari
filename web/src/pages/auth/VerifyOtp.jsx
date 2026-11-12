import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api';
import { LogoMark } from '../../components/DashboardLayout';

export default function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { verifyOtp } = useAuth();
  const [phone, setPhone] = useState(location.state?.phone || '');
  const [purpose] = useState(location.state?.purpose || 'register');
  const [devCode, setDevCode] = useState(location.state?.devCode || null);
  const [digits, setDigits] = useState(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const inputsRef = useRef([]);

  useEffect(() => {
    if (!phone) navigate('/register');
    inputsRef.current[0]?.focus();
  }, [phone, navigate]);

  const setDigit = (i, v) => {
    const c = v.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = c;
    setDigits(next);
    if (c && i < 5) inputsRef.current[i + 1]?.focus();
  };
  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputsRef.current[i - 1]?.focus();
  };
  const onPaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) { setDigits(text.split('')); inputsRef.current[5]?.focus(); }
  };

  const submit = async (e) => {
    e?.preventDefault();
    const code = digits.join('');
    if (code.length !== 6) return toast('Enter all 6 digits', 'error');
    setBusy(true);
    try {
      const res = await verifyOtp(phone.replace(/\D/g, ''), code, purpose);
      if (res.resetAllowed) {
        toast('OTP verified — set your new password', 'success');
        navigate('/forgot-password', { state: { step: 'reset', phone } });
      } else {
        toast('Phone verified! Welcome to Sawaari 🎉', 'success');
        navigate(res.user?.role === 'driver' ? '/driver/profile' : '/app');
      }
    } catch (err) {
      toast(err.message, 'error');
      setDigits(Array(6).fill(''));
      inputsRef.current[0]?.focus();
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setResending(true);
    try {
      const res = await api.post('/api/auth/resend-otp', { phone: phone.replace(/\D/g, ''), purpose });
      setDevCode(res.devCode);
      toast('A fresh OTP has been sent', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setResending(false); }
  };

  useEffect(() => { if (digits.every((d) => d) && !busy) submit(); }, [digits]); // eslint-disable-line

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">Verify your mobile</h1>
          <p className="text-sm text-slate-500">
            OTP sent to <span className="font-semibold text-slate-700 dark:text-slate-200">+91 {phone}</span>
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-5 p-6">
          <div className="flex justify-center gap-2" onPaste={onPaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => (inputsRef.current[i] = el)}
                className="h-14 w-12 rounded-xl border-2 border-slate-200 bg-white text-center text-2xl font-bold focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                value={d}
                inputMode="numeric" maxLength={1}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
              />
            ))}
          </div>

          {devCode && (
            <p className="rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <b>Development mode:</b> SMS provider not configured — your OTP is{' '}
              <span className="tabular font-extrabold tracking-widest">{devCode}</span>.
              Configure an SMS provider in <code>server/.env</code> to send real SMS.
            </p>
          )}

          <button className="btn-primary w-full py-3" disabled={busy || digits.join('').length !== 6}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Verify
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={resend} className="link flex items-center gap-1.5" disabled={resending}>
              {resending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Resend OTP
            </button>
            <Link to="/login" className="link">Back to login</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
