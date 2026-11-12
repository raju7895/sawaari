import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

/* The context value is callable AND carries a `.toast` self-reference, so both
   `const toast = useToast()` and `const { toast } = useToast()` work. */
const noop = () => {};
noop.toast = noop;
const ToastContext = createContext(noop);

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  const toast = useCallback((message, type = 'info', timeout = 4500) => {
    const id = ++idCounter;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => dismiss(id), timeout);
  }, []);

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: <AlertTriangle className="h-5 w-5 text-red-500" />,
    info: <Info className="h-5 w-5 text-brand-600" />,
  };
  const styles = {
    success: 'border-emerald-200 dark:border-emerald-900',
    error: 'border-red-200 dark:border-red-900',
    info: 'border-slate-200 dark:border-slate-700',
  };

  const value = useMemo(() => {
    const fn = (...args) => toast(...args);
    fn.toast = fn;
    return fn;
  }, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3.5 shadow-lg animate-slide-up dark:bg-slate-900 ${styles[t.type]}`}
            role="status"
          >
            {icons[t.type]}
            <p className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
