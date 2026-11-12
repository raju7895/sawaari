import { useEffect, useState } from 'react';
import { Server, Save, RotateCcw, CheckCircle2, AlertTriangle, Loader2, Wifi } from 'lucide-react';
import Modal from './Modal';
import { apiBase, setApiBase, clearApiBase, describeApiBase } from '../serverConfig';
import { useToast } from '../context/ToastContext';

/**
 * Lets the operator point an installed app (Android / desktop / PWA) at
 * the API server that hosts their database. On the web this is normally
 * the same origin and nothing needs to change.
 */
export default function ServerSettings({ open, onClose }) {
  const { toast } = useToast();
  const [url, setUrl] = useState(apiBase());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { setUrl(apiBase()); setResult(null); }, [open]);

  const test = async () => {
    setTesting(true);
    setResult(null);
    const base = url.trim().replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/api/health`, { method: 'GET' });
      const body = await res.json();
      if (res.ok && body.ok) {
        setResult({ ok: true, message: `Connected — API v${body.service}, database ${body.integrations?.database ? 'online' : 'offline'}` });
      } else {
        setResult({ ok: false, message: body.error || `HTTP ${res.status}` });
      }
    } catch (err) {
      setResult({ ok: false, message: `Cannot reach the server: ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    try {
      const saved = setApiBase(url);
      toast(saved ? `Server set to ${saved}` : 'Using the same origin', 'success');
      setResult(null);
      onClose?.();
      // reload so every module picks up the new base URL
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const reset = () => {
    clearApiBase();
    setUrl('');
    toast('Reset to the built-in address', 'success');
    setTimeout(() => window.location.reload(), 600);
  };

  return (
    <Modal open={open} onClose={onClose} title="Server settings">
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Server className="mt-0.5 h-4 w-4 shrink-0" />
          The installed app needs the address of the server that holds your data.
          Currently using <b className="break-all">{describeApiBase()}</b>.
        </p>

        <div>
          <label className="label">API server address</label>
          <input
            className="input"
            placeholder="http://192.168.1.5:4000"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <p className="mt-1 text-xs text-slate-400">
            Leave empty to use the same address the app was opened from.
          </p>
        </div>

        {result && (
          <p className={`flex items-start gap-2 rounded-xl p-3 text-xs ${
            result.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
            {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            {result.message}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Test connection
          </button>
          <button className="btn-primary flex-1" onClick={save}>
            <Save className="h-4 w-4" /> Save &amp; reload
          </button>
          <button className="btn-ghost" onClick={reset}>
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        </div>
      </div>
    </Modal>
  );
}
