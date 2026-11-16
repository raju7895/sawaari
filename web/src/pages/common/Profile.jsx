import { useRef, useState } from 'react';
import { Loader2, Upload, ShieldCheck } from 'lucide-react';
import { supabase, friendlyError } from '../../lib/supabase';
import { updateProfile } from '../../lib/api';
import { uploadFile, publicUrl } from '../../lib/storage';
import { useAuth } from '../../context/AuthContext';
import { upgradeGuest } from '../../lib/quickLogin';
import { Card, Field, ErrorNote, Notice, Loading } from '../../components/ui';

export default function Profile() {
  const { profile, refreshProfile, user } = useAuth();
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    fullName: profile?.fullName || '',
    phone: profile?.phone || '',
  });
  const [passwords, setPasswords] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [guest, setGuest] = useState({ email: '', password: '', confirm: '' });

  /* a demo account is shared — its password must not be changed, or the
     next visitor cannot get in */
  const isDemo = String(profile?.email || '').startsWith('demo.');
  const isGuest = !profile?.email;

  if (!profile) return <Loading label="Loading your profile…" />;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setOk('');
    try {
      await updateProfile({ full_name: form.fullName, phone: form.phone });
      await refreshProfile();
      setOk('Your profile was saved.');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    setBusy(true); setError(''); setOk('');
    try {
      const path = `${profile.id}/${Date.now()}-${file.name}`;
      await uploadFile('avatars', file, path);
      await updateProfile({ avatar_path: path });
      await refreshProfile();
      setOk('Your photo was updated.');
    } catch (err) {
      setError(friendlyError(err));
    } finally { setBusy(false); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (passwords.password !== passwords.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true); setError(''); setOk('');
    try {
      const { error: err } = await supabase.auth.updateUser({ password: passwords.password });
      if (err) throw new Error(friendlyError(err));
      setPasswords({ password: '', confirm: '' });
      setOk('Your password was changed.');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  /* a guest becomes a real account — the same user id, so the rides that
     were booked are kept */
  const saveGuest = async (e) => {
    e.preventDefault();
    if (guest.password !== guest.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true); setError(''); setOk('');
    try {
      await upgradeGuest(guest.email.trim().toLowerCase(), guest.password);
      setGuest({ email: '', password: '', confirm: '' });
      await refreshProfile();
      setOk('Your account is ready — sign in with your e-mail address and password from now on.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {ok ? <Notice tone="ok">{ok}</Notice> : null}

      <Card title="Your photo">
        <div className="flex items-center gap-4">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-xl font-bold dark:bg-slate-700">
              {(profile.fullName || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => uploadAvatar(e.target.files?.[0])}
            />
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose a photo
            </button>
            <p className="mt-1 text-xs text-slate-400">JPG or PNG, up to 8 MB.</p>
          </div>
        </div>
      </Card>

      <Card title="Your details">
        <form onSubmit={save} className="space-y-3">
          <Field label="Full name">
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
              minLength={2}
            />
          </Field>
          <Field label="Mobile number">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="E-mail address" hint="Your e-mail address is your sign-in name and cannot be changed here.">
            <input className="input" value={profile.email || ''} readOnly />
          </Field>
          <button className="btn-primary" disabled={busy}>Save</button>
        </form>
      </Card>

      {isGuest ? (
        <Card title="Make this account yours">
          <form onSubmit={saveGuest} className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              You are using the app as a guest. Add an e-mail address and a password
              and the rides you booked stay with this account.
            </p>
            <Field label="E-mail address">
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={guest.email}
                onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={guest.password}
                onChange={(e) => setGuest({ ...guest, password: e.target.value })}
                required
                minLength={8}
              />
            </Field>
            <Field label="Repeat the password">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={guest.confirm}
                onChange={(e) => setGuest({ ...guest, confirm: e.target.value })}
                required
                minLength={8}
              />
            </Field>
            <button className="btn-primary" disabled={busy}>Save my account</button>
          </form>
        </Card>
      ) : null}

      {isDemo ? (
        <Card title="Demo account">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This is a shared demo account. Its password cannot be changed here —
            if it stops working, an administrator can reset it under
            Authentication → Users.
          </p>
        </Card>
      ) : (
        <Card title="Change your password">
          <form onSubmit={changePassword} className="space-y-3">
            <Field label="New password">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwords.password}
                onChange={(e) => setPasswords({ ...passwords, password: e.target.value })}
                required
                minLength={8}
              />
            </Field>
            <Field label="Repeat the new password">
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwords.confirm}
                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                required
                minLength={8}
              />
            </Field>
            <button className="btn-primary" disabled={busy}>Change the password</button>
          </form>
        </Card>
      )}
    </div>
  );
}
