import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import { Loader2 } from 'lucide-react';

import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import VerifyOtp from './pages/auth/VerifyOtp';
import ForgotPassword from './pages/auth/ForgotPassword';
import TrackPublic from './pages/TrackPublic';

import PassengerDashboard from './pages/passenger/Dashboard';
import BookRide from './pages/passenger/BookRide';
import RideTracking from './pages/passenger/RideTracking';
import RideHistory from './pages/passenger/RideHistory';
import PassengerPayments from './pages/passenger/Payments';
import SavedLocations from './pages/passenger/Locations';
import ProfilePage from './pages/common/Profile';
import SupportPage from './pages/common/Support';

import DriverDashboard from './pages/driver/Dashboard';
import DriverRides from './pages/driver/Rides';
import DriverEarnings from './pages/driver/Earnings';
import DriverProfilePage from './pages/driver/Profile';
import DriverReviews from './pages/driver/Reviews';

import AdminOverview from './pages/admin/Overview';
import AdminDrivers from './pages/admin/Drivers';
import AdminUsers from './pages/admin/Users';
import AdminBookings from './pages/admin/Bookings';
import AdminPayments from './pages/admin/Payments';
import AdminAnalytics from './pages/admin/Analytics';
import AdminCities from './pages/admin/Cities';
import AdminSettings from './pages/admin/Settings';
import AdminTickets from './pages/admin/Tickets';
import AdminReports from './pages/admin/Reports';
import AdminLogin from './pages/admin/AdminLogin';
import VerifyAdminEmail from './pages/admin/VerifyAdminEmail';
import ResetAdminPassword from './pages/admin/ResetAdminPassword';
import AcceptInvite from './pages/admin/AcceptInvite';
import TwoFactorSetup from './pages/admin/TwoFactorSetup';
import DriversDirectory from './pages/admin/DriversDirectory';
import LiveRides from './pages/admin/LiveRides';
import Revenue from './pages/admin/Revenue';
import Refunds from './pages/admin/Refunds';
import AdminManagement from './pages/admin/Admins';
import Pricing from './pages/admin/Pricing';
import Notifications from './pages/admin/Notifications';
import AuditLogs from './pages/admin/AuditLogs';
import Security from './pages/admin/Security';
import BackButtonHandler from './components/BackButtonHandler';

const ADMIN_ROLES = ['super_admin', 'admin', 'finance_admin', 'support_admin', 'driver_manager', 'moderator'];

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
    </div>
  );
}

function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) {
    const home = ADMIN_ROLES.includes(user.role)
      ? '/admin'
      : user.role === 'driver' ? '/driver' : '/app';
    return <Navigate to={home} replace />;
  }
  return children;
}

export default function App() {
  return (
    <>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-otp" element={<VerifyOtp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/track/:token" element={<TrackPublic />} />

      {/* Administrator console (public auth screens) */}
      <Route path="/admin-login" element={<AdminLogin />} />
      <Route path="/verify-admin-email" element={<VerifyAdminEmail />} />
      <Route path="/admin-reset-password" element={<ResetAdminPassword />} />
      <Route path="/admin-invite" element={<AcceptInvite />} />

      {/* Passenger */}
      <Route path="/app" element={<Protected roles={['passenger']}><DashboardLayout /></Protected>}>
        <Route index element={<PassengerDashboard />} />
        <Route path="book" element={<BookRide />} />
        <Route path="ride/:id" element={<RideTracking />} />
        <Route path="history" element={<RideHistory />} />
        <Route path="payments" element={<PassengerPayments />} />
        <Route path="locations" element={<SavedLocations />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="support" element={<SupportPage />} />
      </Route>

      {/* Driver */}
      <Route path="/driver" element={<Protected roles={['driver']}><DashboardLayout /></Protected>}>
        <Route index element={<DriverDashboard />} />
        <Route path="rides" element={<DriverRides />} />
        <Route path="earnings" element={<DriverEarnings />} />
        <Route path="reviews" element={<DriverReviews />} />
        <Route path="profile" element={<DriverProfilePage />} />
        <Route path="support" element={<SupportPage />} />
      </Route>

      {/* Admin */}
      <Route path="/admin" element={<Protected roles={ADMIN_ROLES}><DashboardLayout /></Protected>}>
        <Route index element={<AdminOverview />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="drivers" element={<AdminDrivers />} />
        <Route path="drivers-directory" element={<DriversDirectory />} />
        <Route path="bookings" element={<AdminBookings />} />
        <Route path="live" element={<LiveRides />} />
        <Route path="payments" element={<AdminPayments />} />
        <Route path="revenue" element={<Revenue />} />
        <Route path="refunds" element={<Refunds />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="tickets" element={<AdminTickets />} />
        <Route path="admins" element={<AdminManagement />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="cities" element={<AdminCities />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="audit" element={<AuditLogs />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="security" element={<Security />} />
        <Route path="2fa-setup" element={<TwoFactorSetup />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <BackButtonHandler />
    </>
  );
}
