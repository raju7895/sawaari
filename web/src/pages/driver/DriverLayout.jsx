import { Outlet } from 'react-router-dom';
import AppShell from '../../components/AppShell';

const LINKS = [
  { to: '/driver', label: 'Dashboard', end: true },
  { to: '/driver/rides', label: 'My rides' },
  { to: '/driver/earnings', label: 'Earnings' },
  { to: '/driver/profile', label: 'Profile & documents' },
];

export default function DriverLayout() {
  return (
    <AppShell title="Sawaari — Driver" links={LINKS}>
      <Outlet />
    </AppShell>
  );
}
