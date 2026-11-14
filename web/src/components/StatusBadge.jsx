const STATUS_STYLES = {
  requested: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  accepted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ongoing: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  refunded: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  rider: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  driver: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cash: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  online: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  offline: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const LABELS = {
  requested: 'Requested',
  accepted: 'Accepted',
  ongoing: 'Ongoing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  verified: 'Verified',
  rejected: 'Rejected',
  rider: 'Rider',
  driver: 'Driver',
  admin: 'Admin',
  cash: 'Cash',
  online: 'Online',
  offline: 'Offline',
};

export default function StatusBadge({ status, className = '' }) {
  const style = STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  const label = LABELS[status] || String(status || '—').replace(/_/g, ' ');
  return <span className={`badge ${style} ${className}`}>{label}</span>;
}
