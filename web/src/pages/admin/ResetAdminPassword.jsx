import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { LogoMark } from '../../components/DashboardLayout';
import { useToast } from '../../context/ToastContext';

export default function ResetAdminPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { toast } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 12) return toast('Use at least 12 characters', 'error');
    if (password !== confirm) return toast('Passwords do not match', 'error');
    setBusy(true);
    try {
      const res = await fetch('/api/admin-auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not reset the password');
      toast(data.message || 'Password updated', 'success', 6000);
      navigate('/admin-login');
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={48} />
          <h1 className="mt-4 text-2xl font-extrabold text-white">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-400">Administrator passwords need at least 12 characters</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 border-slate-800 bg-slate-900 p-6">
          <div>
            <label className="label text-slate-300">New password</label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9 pr-10" type={show ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={12} autoComplete="new-password"
              />
              <button type="button" onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label text-slate-300">Confirm password</label>
            <input
              className="input" type={show ? 'text' : 'password'} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required minLength={12} autoComplete="new-password"
            />
          </div>
          <button className="btn-primary w-full py-3" disabled={busy || !token}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Update password
          </button>
          <p className="text-center text-xs text-slate-500">
            Changing your password signs out every device.
          </p>
          <Link to="/admin-login" className="link block text-center text-xs">Back to sign in</Link>
        </form>
      </div>
    </div>
  );
}
