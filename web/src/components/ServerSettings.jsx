import { useEffect, useState } from 'react';
import { Server, Save, RotateCcw, CheckCircle2, AlertTriangle, Loader2, Wifi } from 'lucide-react';
import Modal from './Modal';
import { apiBase, setApiBase, clearApiBase, describeApiBase, apiDiagnostics, isMixedContent } from '../serverConfig';
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
    const target = base || (typeof window !== 'undefined' ? window.location.origin : '');
    if (base && isMixedContent(base)) {
      setResult({
        ok: false,
        message: 'Blocked by the browser: this page is https:// but the address is http://. Use an https:// address.',
      });
      setTesting(false);
      return;
    }
    try {
      const res = await fetch(`${target}/api/health`, { method: 'GET', cache: 'no-store' });
      const type = res.headers.get('content-type') || '';
      const body = type.includes('application/json') ? await res.json() : { error: await res.text() };
      if (res.ok && body.ok) {
        setResult({ ok: true, message: `Connected — API ${body.service}, database ${body.integrations?.database ? 'online' : 'offline'}` });
      } else if (res.status === 503) {
        setResult({ ok: false, message: 'The API answered, but its database is not reachable (HTTP 503).' });
      } else {
        setResult({ ok: false, message: body.error || `HTTP ${res.status}` });
      }
    } catch (err) {
      const cause = (err && (err.cause?.message || err.message)) || 'unknown error';
      console.error('[server-settings] connection test failed', { target, cause });
      setResult({
        ok: false,
        message: `Could not reach ${target}. The address may be wrong, the API may be down, or the browser blocked the reply because the API does not allow this origin (CORS). Details: ${cause}`,
      });
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
          <br />
          <span className="text-slate-400">
            source: {apiDiagnostics().source} · page: {apiDiagnostics().pageOrigin}
          </span>
        </p>

        {isMixedContent(apiBase()) && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            This page is https:// but the API address is http:// — the browser blocks
            that. Use an https:// address.
          </p>
        )}

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
            On a deployed site this must be the API address, e.g.
            https://sawaari-api.onrender.com
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
