import { Outlet } from 'react-router-dom';
import AppShell from '../../components/AppShell';

const LINKS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/drivers', label: 'Drivers' },
  { to: '/admin/rides', label: 'Rides' },
  { to: '/admin/payments', label: 'Payments' },
  { to: '/admin/ratings', label: 'Ratings' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/activity', label: 'Activity log' },
];

export default function AdminLayout() {
  return (
    <AppShell title="Sawaari — Master control" links={LINKS} badge="admin">
      <Outlet />
    </AppShell>
  );
}
