import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';

export default function ForgotPassword() {
  const [step, setStep] = useState('phone'); // phone → otp → done
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState(null);
  const [otp, setOtp] = useState('');
  const [otpOk, setOtpOk] = useState(false);
  const [pw, setPw] = useState({ a: '', b: '' });
  const { toast } = useToast();
  const navigate = useNavigate();

  const sendOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/api/auth/forgot-password', { phone: phone.replace(/\D/g, '') });
      setDevCode(res.devCode || null);
      setStep('otp');
      toast('If the number is registered, an OTP was sent', 'info');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  const checkOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/api/auth/verify-otp', {
        phone: phone.replace(/\D/g, ''), code: otp, purpose: 'password_reset',
      });
      if (res.resetAllowed) { setOtpOk(true); toast('OTP verified — set a new password', 'success'); }
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (pw.a !== pw.b) return toast('Passwords do not match', 'error');
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', {
        phone: phone.replace(/\D/g, ''), code: otp, password: pw.a,
      });
      toast('Password updated — log in with your new password', 'success');
      navigate('/login');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold">Reset password</h1>
          <p className="text-sm text-slate-500">We'll verify your mobile with an OTP</p>
        </div>
        <div className="card space-y-4 p-6">
          {step === 'phone' && (
            <form onSubmit={sendOtp} className="space-y-4">
              <div>
                <label className="label">Registered mobile number</label>
                <input className="input" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </div>
              <button className="btn-primary w-full py-3" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Send OTP
              </button>
            </form>
          )}
          {step === 'otp' && (
            <form onSubmit={checkOtp} className="space-y-4">
              {devCode && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  Dev mode OTP: <b className="tabular">{devCode}</b>
                </p>
              )}
              <div>
                <label className="label">6-digit OTP</label>
                <input className="input tabular tracking-[0.4em]" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
              </div>
              <button className="btn-primary w-full py-3" disabled={busy || otp.length !== 6}>Verify OTP</button>
              <button type="button" className="btn-ghost w-full" onClick={() => setStep('phone')}>Change number</button>
            </form>
          )}
          {step === 'otp' && otpOk && (
            <form onSubmit={reset} className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <div>
                <label className="label">New password</label>
                <input className="input" type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} minLength={8} required />
              </div>
              <div>
                <label className="label">Confirm</label>
                <input className="input" type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required />
              </div>
              <button className="btn-primary w-full py-3" disabled={busy}>Set new password</button>
            </form>
          )}
          <p className="text-center text-sm text-slate-500">
            <Link to="/login" className="link">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
