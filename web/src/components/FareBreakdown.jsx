import { fmtINR } from '../api';

export default function FareBreakdown({ fare, title = 'Fare breakdown' }) {
  if (!fare) return null;
  const raw = fare.breakdown ?? fare;
  const items = Array.isArray(raw) ? raw : [];
  const total = fare.total ?? items.reduce((s, i) => s + Number(i.amount || 0), 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/50">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-300">{it.label}</span>
            <span className="tabular font-medium">{fmtINR(it.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-baseline justify-between border-t border-slate-200 pt-2.5 dark:border-slate-700">
        <span className="text-sm font-bold">Total</span>
        <span className="tabular text-lg font-extrabold text-brand-700 dark:text-brand-300">{fmtINR(total)}</span>
      </div>
    </div>
  );
}
