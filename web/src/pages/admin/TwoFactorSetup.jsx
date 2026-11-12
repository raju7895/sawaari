import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2, Copy, CheckCircle2, KeyRound, AlertTriangle } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';
import { LogoMark } from '../../components/DashboardLayout';

/**
 * Mandatory two-factor enrolment. Shows the TOTP secret + a scannable
 * QR code, confirms with a live code, then reveals the single-use
 * backup codes exactly once.
 */
export default function TwoFactorSetup() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.post('/api/admin-auth/2fa/setup', {});
        setSetup(res);
      } catch (err) {
        toast(err.message, 'error', 6000);
        if (err.status === 409) navigate('/admin', { replace: true });
      }
    })();
  }, [toast, navigate]);

  const confirm = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return toast('Enter the 6-digit code', 'error');
    setBusy('confirm');
    try {
      const res = await api.post('/api/admin-auth/2fa/confirm', { code });
      setBackupCodes(res.backupCodes);
      toast('Two-factor authentication enabled', 'success');
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      setBusy('');
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy to the clipboard — type the secret manually', 'error');
    }
  };

  /* QR code for the otpauth:// URI (rendered locally, no third party) */
  const qrUrl = setup
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(setup.uri)}`
    : null;

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={48} />
          <h1 className="mt-4 text-2xl font-extrabold text-white">Set up two-factor authentication</h1>
          <p className="mt-1 text-sm text-slate-400">Required for every administrator account</p>
        </div>

        <div className="card space-y-5 border-slate-800 bg-slate-900 p-6">
          {!setup && !backupCodes && (
            <div className="flex items-center justify-center gap-3 py-8 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" /> Preparing your secure secret…
            </div>
          )}

          {setup && !backupCodes && (
            <>
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                {qrUrl && (
                  <img src={qrUrl} alt="Authenticator QR code" className="h-44 w-44 rounded-xl bg-white p-2" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm text-slate-300">
                    Scan this code with Google Authenticator, Authy or 1Password, or enter the key manually.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="tabular flex-1 break-all rounded-lg bg-slate-800 px-3 py-2 text-sm tracking-widest text-brand-300">
                      {setup.secret}
                    </code>
                    <button type="button" className="btn-ghost" onClick={copySecret}>
                      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <form onSubmit={confirm} className="space-y-3 border-t border-slate-800 pt-5">
                <label className="label text-slate-300">Code from your app</label>
                <input
                  className="input text-center text-3xl font-extrabold tracking-[0.4em]"
                  inputMode="numeric" maxLength={6} placeholder="000000" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <button className="btn-primary w-full py-3" disabled={busy === 'confirm' || code.length !== 6}>
                  {busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Confirm and enable
                </button>
              </form>
            </>
          )}

          {backupCodes && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
                <p className="font-bold">Two-factor authentication is active</p>
              </div>
              <p className="text-sm text-slate-300">
                Store these single-use backup codes somewhere safe. Each one works once if you lose your device.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-800 p-3">
                {backupCodes.map((c) => (
                  <code key={c} className="tabular text-center text-sm tracking-wider text-slate-200">{c}</code>
                ))}
              </div>
              <button className="btn-primary w-full py-3" onClick={() => navigate('/admin', { replace: true })}>
                <KeyRound className="h-4 w-4" /> Continue to the console
              </button>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The secret is shown once and stored encrypted. It is never sent anywhere else.
          </p>
        </div>
      </div>
    </div>
  );
}
