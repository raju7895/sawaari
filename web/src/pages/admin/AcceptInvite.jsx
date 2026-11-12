import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2, ShieldCheck, UserPlus, Eye, EyeOff } from 'lucide-react';
import { LogoMark } from '../../components/DashboardLayout';
import { useToast } from '../../context/ToastContext';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '', password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast('Passwords do not match', 'error');
    if (form.password.length < 12) return toast('Use at least 12 characters', 'error');
    setBusy(true);
    try {
      const res = await fetch('/api/admin-auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, name: form.name.trim(), phone: form.phone.trim(), password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not accept the invitation');
      toast(data.message || 'Administrator account created', 'success', 6000);
      navigate('/admin-login');
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={48} />
          <h1 className="mt-4 text-2xl font-extrabold text-white">Accept administrator invitation</h1>
          <p className="mt-1 text-sm text-slate-400">Create your console account</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 border-slate-800 bg-slate-900 p-6">
          <div>
            <label className="label text-slate-300">Full name</label>
            <input className="input" value={form.name} onChange={set('name')} required minLength={2} placeholder="Your name" />
          </div>
          <div>
            <label className="label text-slate-300">Mobile number</label>
            <input className="input" value={form.phone} onChange={set('phone')} required placeholder="98765 43210" inputMode="tel" />
          </div>
          <div>
            <label className="label text-slate-300">Password</label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input className="input pl-9 pr-10" type={show ? 'text' : 'password'} value={form.password}
                onChange={set('password')} required minLength={12} autoComplete="new-password" />
              <button type="button" onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label text-slate-300">Confirm password</label>
            <input className="input" type={show ? 'text' : 'password'} value={form.confirm}
              onChange={set('confirm')} required minLength={12} autoComplete="new-password" />
          </div>
          <button className="btn-primary w-full py-3" disabled={busy || !token}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create administrator account
          </button>
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Two-factor authentication is required and must be set up at your first sign-in.
          </p>
          <Link to="/admin-login" className="link block text-center text-xs">Back to sign in</Link>
        </form>
      </div>
    </div>
  );
}
