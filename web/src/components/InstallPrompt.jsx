import { useEffect, useState } from 'react';
import { Download, X, Share, PlusSquare } from 'lucide-react';

/**
 * PWA install affordance.
 * Chrome/Edge fire `beforeinstallprompt`; on iOS Safari the app is added
 * through Share → Add to Home Screen, so that case is explained instead.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('sawaari-install-dismissed') === '1'
  );
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (standalone) return undefined;

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    setIos(isIos && !window.matchMedia('(display-mode: standalone)').matches);
    window.addEventListener('appinstalled', () => setDeferred(null));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') setDeferred(null);
  };

  const dismiss = () => {
    localStorage.setItem('sawaari-install-dismissed', '1');
    setDismissed(true);
  };

  if (dismissed) return null;
  if (!deferred && !ios) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[9000] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl animate-slide-up dark:border-slate-700 dark:bg-slate-900 sm:left-auto sm:right-6 sm:mx-0">
      <button onClick={dismiss} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
      <p className="flex items-center gap-2 font-bold">
        <Download className="h-5 w-5 text-brand-600" />
        Install Sawaari
      </p>
      {deferred ? (
        <>
          <p className="mt-1 text-sm text-slate-500">
            Add the app to your home screen for full-screen booking and offline access to the app shell.
          </p>
          <button className="btn-primary mt-3 w-full" onClick={install}>
            <Download className="h-4 w-4" /> Install app
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">
            On iPhone: tap <Share className="inline h-3.5 w-3.5" /> Share, then{' '}
            <PlusSquare className="inline h-3.5 w-3.5" /> “Add to Home Screen”.
          </p>
        </>
      )}
    </div>
  );
}
