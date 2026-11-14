import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, CarTaxiFront, Loader2, UserPlus, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { LogoMark } from '../../components/DashboardLayout';

export default function Register() {
  const [role, setRole] = useState('passenger');
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast('Passwords do not match', 'error');
    if (!/^\d{10}$/.test(form.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')))
      return toast('Enter a valid 10-digit Indian mobile number', 'error');
    if (!form.email.trim())
      return toast('Enter an e-mail address — it is how you sign in', 'error');
    setBusy(true);
    try {
      const res = await register({
        role, name: form.name.trim(), phone: form.phone.trim(),
        email: form.email.trim(), password: form.password,
      });
      if (res?.needsEmailConfirmation) {
        toast(res.message, 'success');
        navigate('/login', { state: { registered: true } });
        return;
      }
      toast(res.message || 'Welcome to Sawaari!', 'success');
      navigate(role === 'driver' ? '/driver/profile' : '/app');
    } catch (err) {
      toast(err.message, 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-2xl font-extrabold">Create your account</h1>
          <p className="text-sm text-slate-500">Mobile OTP verification keeps Sawaari safe</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {/* role toggle */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[
              { key: 'passenger', label: 'Passenger', icon: User },
              { key: 'driver', label: 'Driver', icon: CarTaxiFront },
            ].map((r) => (
              <button
                type="button" key={r.key}
                onClick={() => setRole(r.key)}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                  role === r.key ? 'bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500'
                }`}
              >
                <r.icon className="h-4 w-4" /> {r.label}
              </button>
            ))}
          </div>

          <div>
            <label className="label">Full name</label>
            <input className="input" placeholder="Priya Sharma" value={form.name} onChange={set('name')} required minLength={2} />
          </div>
          <div>
            <label className="label">Mobile number</label>
            <div className="flex gap-2">
              <span className="flex items-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800">+91</span>
              <input className="input" placeholder="98765 43210" inputMode="tel" value={form.phone} onChange={set('phone')} required />
            </div>
          </div>
          <div>
            <label className="label">Email <span className="normal-case text-slate-400">(optional)</span></label>
            <input className="input" type="email" placeholder="you@email.com" value={form.email} onChange={set('email')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" placeholder="8+ characters" value={form.password} onChange={set('password')} required minLength={8} />
            </div>
            <div>
              <label className="label">Confirm</label>
              <input className="input" type="password" placeholder="Repeat" value={form.confirm} onChange={set('confirm')} required />
            </div>
          </div>

          {role === 'driver' && (
            <p className="flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-xs text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              After registering you'll add your vehicle, licence and documents. An admin verifies them before you can accept public rides.
            </p>
          )}

          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create account
          </button>
          <p className="text-center text-sm text-slate-500">
            Already registered? <Link to="/login" className="link font-semibold">Log in</Link>
          </p>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400"><Link to="/" className="link">← Back to home</Link></p>
      </div>
    </div>
  );
}
