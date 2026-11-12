const STATUS_STYLES = {
  scheduled: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  searching: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  assigned: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  arriving: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  arrived: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  in_progress: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  expired: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  awaiting_verification: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  refunded: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  unpaid: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  in_progress_ticket: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  acknowledged: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  reviewing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  dismissed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const LABELS = {
  searching: 'Finding driver', assigned: 'Driver assigned', arriving: 'Driver arriving',
  arrived: 'Driver arrived', in_progress: 'Ride in progress', completed: 'Completed',
  cancelled: 'Cancelled', expired: 'No drivers', scheduled: 'Scheduled',
  pending: 'Pending', awaiting_verification: 'Verifying', paid: 'Paid', failed: 'Failed',
  refunded: 'Refunded', unpaid: 'Unpaid', approved: 'Approved', rejected: 'Rejected',
  verified: 'Verified', open: 'Open', resolved: 'Resolved',
  online: 'Online', upi_qr: 'UPI QR', cash: 'Cash', razorpay: 'Online',
};

export default function StatusBadge({ status, className = '' }) {
  const style = STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  const label = LABELS[status] || status.replace(/_/g, ' ');
  return <span className={`badge ${style} ${className}`}>{label}</span>;
}
