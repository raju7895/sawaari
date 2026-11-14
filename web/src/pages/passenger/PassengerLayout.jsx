import { Outlet } from 'react-router-dom';
import AppShell from '../../components/AppShell';

const LINKS = [
  { to: '/passenger', label: 'Home', end: true },
  { to: '/passenger/book', label: 'Book a ride' },
  { to: '/passenger/rides', label: 'My rides' },
  { to: '/passenger/payments', label: 'Payments' },
  { to: '/passenger/places', label: 'Saved places' },
  { to: '/passenger/profile', label: 'Profile' },
];

export default function PassengerLayout() {
  return (
    <AppShell title="Sawaari — Passenger" links={LINKS}>
      <Outlet />
    </AppShell>
  );
}
