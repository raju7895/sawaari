import { useEffect, useMemo, useState } from 'react';
import {
  Settings, Percent, Clock, MapPin, Wallet, LifeBuoy, ShieldAlert, Save, RotateCcw, Mail,
  Globe, FileText, Lock, Megaphone, KeyRound, Wrench, ToggleLeft, ToggleRight, Image,
  ScrollText, Info, BadgePercent,
} from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';
import { usePermission } from '../../components/PermissionGate';

const SCHEMA = [
  {
    category: 'branding', title: 'Branding', icon: Image,
    fields: [
      ['app_name', 'Application name', 'text', 'Shown in the app header and emails'],
      ['app_logo_url', 'Logo URL', 'text', 'Square image URL used as the logo'],
      ['website_title', 'Website title', 'text', 'Browser tab title and share title'],
      ['website_description', 'Website description', 'textarea', 'Meta description for search engines and link previews'],
    ],
  },
  {
    category: 'contact', title: 'Contact & support', icon: LifeBuoy,
    fields: [
      ['contact_email', 'Contact email', 'text', 'Public contact address'],
      ['support_phone', 'Support phone', 'text', 'Shown on the support page'],
      ['support_hours', 'Support hours', 'text', 'e.g. Mon–Sat, 9am–9pm'],
      ['sos_number', 'Emergency number', 'text', 'Called from the SOS screen (usually 112)'],
      ['support_address', 'Registered address', 'text', 'Postal address for legal notices'],
    ],
  },
  {
    category: 'rules', title: 'Booking rules', icon: Clock,
    fields: [
      ['commission_percent', 'Platform commission (%)', 'number', 'Deducted from driver earnings on every completed ride', { min: 0, max: 50, step: 0.5 }],
      ['driver_request_timeout_sec', 'Driver request timeout (sec)', 'number', 'How long a ride search waits before expiring', { min: 30, max: 900, step: 10 }],
      ['search_radius_km', 'Driver search radius (km)', 'number', 'Max distance a driver can be from the pickup point', { min: 1, max: 50, step: 1 }],
      ['cancellation_fee_after_accept', 'Cancellation fee (₹)', 'number', 'Charged when a passenger cancels after a driver accepts', { min: 0, max: 500, step: 5 }],
      ['max_advance_booking_days', 'Advance booking window (days)', 'number', 'How far ahead a scheduled ride may be booked', { min: 1, max: 90, step: 1 }],
    ],
  },
  {
    category: 'notifications', title: 'Notifications', icon: Megaphone,
    fields: [
      ['notify_admin_new_driver', 'Notify admins of new driver sign-ups', 'bool', ''],
      ['notify_driver_new_booking', 'Notify drivers of nearby requests', 'bool', ''],
      ['notify_payment_verified', 'Notify passengers when a payment is verified', 'bool', ''],
      ['notify_sos_alerts', 'Notify admins on SOS alerts', 'bool', ''],
    ],
  },
  {
    category: 'otp', title: 'OTP configuration', icon: KeyRound,
    fields: [
      ['otp_length', 'OTP length', 'number', 'Digits in the verification code', { min: 4, max: 8, step: 1 }],
      ['otp_expiry_minutes', 'OTP expiry (minutes)', 'number', 'How long a code stays valid', { min: 2, max: 30, step: 1 }],
      ['otp_max_attempts', 'Maximum OTP attempts', 'number', 'Attempts before the code is blocked', { min: 1, max: 10, step: 1 }],
    ],
  },
  {
    category: 'policy', title: 'Policies & legal', icon: ScrollText,
    fields: [
      ['terms_and_conditions', 'Terms and conditions', 'textarea', 'Plain text shown to riders and drivers at sign-up'],
      ['privacy_policy', 'Privacy policy', 'textarea', 'How rider and driver data is handled'],
      ['cancellation_policy', 'Cancellation policy', 'textarea', 'Free-cancellation window and fee rules'],
    ],
  },
  {
    category: 'promotions', title: 'Promotional offers', icon: BadgePercent,
    fields: [
      ['promo_enabled', 'Promotions enabled', 'bool', ''],
      ['promo_code', 'Promo code', 'text', 'Code riders can apply (informational)'],
      ['promo_description', 'Offer description', 'text', 'Short description of the running offer'],
    ],
  },
];

const TOGGLES = [
  ['maintenance_mode', 'Maintenance mode', 'Take the passenger app offline while you work on the platform. Administrators keep full access.'],
];

export default function AdminSettings() {
  const toast = useToast();
  const can = usePermission();
  const [settings, setSettings] = useState(null);
  const [gateway, setGateway] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/api/master/settings')
    .then((res) => {
      setSettings(res.settings || {});
      setGateway(res.gateway || {});
      setForm({ ...res.settings });
    })
    .catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => SCHEMA.map((g) => ({
    ...g,
    fields: g.fields.map(([key, label, type, help, opts]) => ({
      key, label, type, help, opts,
      value: form[key] !== undefined ? form[key] : (settings && settings[key] !== undefined ? settings[key] : ''),
    })),
  })), [form, settings]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      const payload = {};
      for (const group of SCHEMA) {
        for (const [key, , type] of group.fields) {
          let value = form[key];
          if (value === undefined || value === null || value === '') continue;
          if (type === 'number') value = Number(value);
          if (type === 'bool') value = Boolean(value);
          payload[key] = value;
        }
      }
      const res = await api.put('/api/master/settings', { settings: payload });
      toast(res.message || 'Settings saved', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (!settings) {
    return <div className="flex h-full items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-600 border-t-transparent" />
    </div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><Settings className="h-6 w-6 text-brand-600" /> Platform settings</h1>
        <p className="text-sm text-slate-500">Branding, rules, policies and service availability — effective immediately</p>
      </div>

      {/* service availability */}
      <div className="card space-y-3 p-5">
        <p className="flex items-center gap-2 text-sm font-bold"><Wrench className="h-4 w-4 text-brand-600" /> Service availability</p>
        {TOGGLES.map(([key, label, help]) => {
          const on = Boolean(form[key] ?? settings[key]);
          return (
            <div key={key} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <button
                type="button"
                disabled={!can('settings.edit')}
                onClick={() => setField(key, !on)}
                className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}>
                  {on ? <ToggleRight className="h-3.5 w-3.5 text-red-500" /> : <ToggleLeft className="h-3.5 w-3.5 text-slate-400" />}
                </span>
              </button>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-slate-400">{help}</p>
                {on && <p className="mt-1 text-xs font-semibold text-red-600">Maintenance mode is ON — riders cannot book right now.</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* grouped settings */}
      {grouped.map((group) => (
        <div key={group.category} className="card space-y-4 p-5">
          <p className="flex items-center gap-2 text-sm font-bold">
            <group.icon className="h-4 w-4 text-brand-600" /> {group.title}
          </p>
          {group.fields.map((f) => (
            <div key={f.key}>
              <label className="label flex items-center gap-1.5">
                {f.type === 'bool' && <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={Boolean(f.value)} disabled={!can('settings.edit')}
                  onChange={(e) => setField(f.key, e.target.checked)} />}
                {f.label}
              </label>
              {f.type === 'bool' ? (
                f.help && <p className="text-xs text-slate-400">{f.help}</p>
              ) : f.type === 'textarea' ? (
                <textarea className="input min-h-24" value={f.value} disabled={!can('settings.edit')}
                  onChange={(e) => setField(f.key, e.target.value)} placeholder={f.help} />
              ) : f.type === 'number' ? (
                <input className="input" type="number" value={f.value} disabled={!can('settings.edit')}
                  min={f.opts?.min} max={f.opts?.max} step={f.opts?.step}
                  onChange={(e) => setField(f.key, e.target.value)} />
              ) : (
                <input className="input" value={f.value} disabled={!can('settings.edit')}
                  onChange={(e) => setField(f.key, e.target.value)} placeholder={f.help} />
              )}
              {f.type !== 'bool' && f.help && <p className="mt-1 text-xs text-slate-400">{f.help}</p>}
            </div>
          ))}
        </div>
      ))}

      {/* integrations */}
      <div className="card space-y-3 p-5">
        <p className="flex items-center gap-2 text-sm font-bold"><Lock className="h-4 w-4 text-brand-600" /> Integration status</p>
        <p className="text-xs text-slate-400">
          Payment gateway, SMS, email and web-push credentials are read from environment variables on the API
          server. They are never stored in the database and never returned to this console.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['Payment gateway (Razorpay)', gateway.razorpayConfigured, gateway.razorpayKeyId],
            ['Gateway webhooks', gateway.webhookConfigured, null],
            ['Transactional email (SMTP)', gateway.smtpConfigured, null],
            ['Web push (VAPID)', gateway.pushConfigured, null],
            ['SMS OTP provider', gateway.smsConfigured, null],
          ].map(([label, ok, detail]) => (
            <div key={label} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
              <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="text-xs text-slate-400">{ok ? (detail || 'configured') : 'not configured'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={save} disabled={busy || !can('settings.edit')}>
          <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save settings'}
        </button>
        <button className="btn-secondary" onClick={() => setForm({ ...settings })} disabled={busy}>
          <RotateCcw className="h-4 w-4" /> Reset
        </button>
      </div>
      {!can('settings.edit') && (
        <p className="text-center text-xs text-amber-600">Your role can view settings but not change them.</p>
      )}
    </div>
  );
}
