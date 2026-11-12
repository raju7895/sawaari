import { useEffect, useState } from 'react';
import { User, Mail, Lock, Camera, BadgeCheck, Save, Shield } from 'lucide-react';
import Avatar from '../../components/Avatar';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { StarDisplay } from '../../components/StarRating';
import { fmtDate } from '../../api';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [saving, setSaving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (user) setForm({ name: user.name || '', email: user.email || '' });
  }, [user?.id]);

  const save = async () => {
    if (!form.name.trim()) return toast('Name cannot be empty', 'error');
    setSaving(true);
    try {
      await api.patch('/api/users/me', {
        name: form.name.trim(),
        email: form.email.trim() || '',
      });
      await refreshUser();
      toast('Profile updated', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (pw.newPassword.length < 8) return toast('New password must be at least 8 characters', 'error');
    setChangingPw(true);
    try {
      await api.patch('/api/users/me', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      setPw({ currentPassword: '', newPassword: '' });
      toast('Password changed', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setChangingPw(false); }
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Image must be under 5 MB', 'error');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload('/api/users/me/avatar', fd);
      await refreshUser();
      toast('Photo updated', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setUploading(false); }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 lg:p-6">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold"><User className="h-6 w-6 text-brand-600" /> My profile</h1>

      {/* identity card */}
      <div className="card flex items-center gap-5 p-5">
        <div className="relative">
          <Avatar src={user?.avatarUrl} name={user?.name} size={76} />
          <label
            className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-brand-600 text-white shadow-md transition-transform hover:scale-110"
            title="Change photo"
          >
            {uploading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Camera className="h-4 w-4" />}
            <input
              type="file" accept="image/*" className="hidden"
              onChange={(e) => uploadAvatar(e.target.files?.[0])}
            />
          </label>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-extrabold">{user?.name}</p>
          <p className="flex items-center gap-1.5 text-sm text-slate-500">
            <span className="tabular">+91 {user?.phone}</span>
            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600">
              <BadgeCheck className="h-3.5 w-3.5" /> Verified
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {user?.role === 'passenger' ? 'Passenger' : user?.role === 'driver' ? 'Driver' : 'Admin'} · joined {fmtDate(user?.joinedAt)}
          </p>
          {user?.rating && user.rating.count > 0 && (
            <div className="mt-1.5"><StarDisplay value={user.rating.avg} count={user.rating.count} /></div>
          )}
        </div>
      </div>

      {/* basic info */}
      <div className="card space-y-4 p-5">
        <p className="flex items-center gap-2 font-bold"><Mail className="h-4 w-4 text-brand-600" /> Basic information</p>
        <div>
          <label className="label">Full name</label>
          <input
            className="input" value={form.name} maxLength={80}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Email (optional)</label>
          <input
            className="input" type="email" value={form.email} placeholder="you@example.com"
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <p className="mt-1 text-xs text-slate-400">Your phone number is your login and cannot be changed here — contact support to change it.</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* password */}
      <div className="card space-y-4 p-5">
        <p className="flex items-center gap-2 font-bold"><Lock className="h-4 w-4 text-brand-600" /> Change password</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Current password</label>
            <input
              className="input" type="password" value={pw.currentPassword}
              onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">New password</label>
            <input
              className="input" type="password" value={pw.newPassword}
              onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))}
            />
          </div>
        </div>
        <button className="btn-secondary" onClick={changePassword} disabled={changingPw || !pw.currentPassword || !pw.newPassword}>
          <Lock className="h-4 w-4" /> {changingPw ? 'Updating…' : 'Update password'}
        </button>
      </div>

      <div className="card flex items-start gap-3 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
        <Shield className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          Your password is hashed with bcrypt, your login session uses a signed JWT, and your phone number is verified with an OTP.
          We never store payment credentials — UPI payments settle directly between you and the driver.
        </p>
      </div>
    </div>
  );
}
