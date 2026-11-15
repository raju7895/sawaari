import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, homeFor } from './context/AuthContext';
import { isSupabaseConfigured, CONFIG_ERROR } from './lib/supabase';

import Landing from './pages/Landing';
import TrackPublic from './pages/TrackPublic';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import VerifyEmail from './pages/auth/VerifyEmail';
import AuthCallback from './pages/auth/AuthCallback';

import PassengerLayout from './pages/passenger/PassengerLayout';
import PassengerDashboard from './pages/passenger/Dashboard';
import BookRide from './pages/passenger/BookRide';
import RideTracking from './pages/passenger/RideTracking';
import RideHistory from './pages/passenger/RideHistory';
import PassengerPayments from './pages/passenger/Payments';
import SavedPlaces from './pages/passenger/Locations';
import Profile from './pages/common/Profile';

import DriverLayout from './pages/driver/DriverLayout';
import DriverDashboard from './pages/driver/Dashboard';
import DriverRides from './pages/driver/Rides';
import DriverEarnings from './pages/driver/Earnings';
import DriverProfile from './pages/driver/Profile';

import AdminLayout from './pages/admin/AdminLayout';
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/Overview';
import AdminUsers from './pages/admin/Users';
import AdminDrivers from './pages/admin/Drivers';
import AdminRides from './pages/admin/Bookings';
import AdminPayments from './pages/admin/Payments';
import AdminRatings from './pages/admin/Ratings';
import AdminSettings from './pages/admin/Settings';
import AdminActivity from './pages/admin/AuditLogs';

import { Loading } from './components/ui';

/** Guards a branch of the app by role. */
function Require({ roles, children }) {
  const { session, profile, loading, role } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (profile?.is_blocked) return <Navigate to="/login" replace />;
  if (roles.length && !roles.includes(role)) return <Navigate to={homeFor(role)} replace />;
  return children;
}

export default function App() {
  /* A missing configuration is a deployment mistake, not a crash — show the
     operator exactly what to fix instead of a blank page. */
  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="card w-full max-w-lg p-6">
          <h1 className="text-lg font-bold">Sawaari is not connected yet</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{CONFIG_ERROR}</p>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/track/:token" element={<TrackPublic />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify" element={<VerifyEmail />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* passenger */}
        <Route path="/passenger" element={<Require roles={['rider']}><PassengerLayout /></Require>}>
          <Route index element={<PassengerDashboard />} />
          <Route path="book" element={<BookRide />} />
          <Route path="ride/:id" element={<RideTracking />} />
          <Route path="rides" element={<RideHistory />} />
          <Route path="payments" element={<PassengerPayments />} />
          <Route path="places" element={<SavedPlaces />} />
          <Route path="profile" element={<Profile />} />
        </Route>

        {/* driver */}
        <Route path="/driver" element={<Require roles={['driver']}><DriverLayout /></Require>}>
          <Route index element={<DriverDashboard />} />
          <Route path="rides" element={<DriverRides />} />
          <Route path="earnings" element={<DriverEarnings />} />
          <Route path="profile" element={<DriverProfile />} />
        </Route>

        {/* administrator */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<Require roles={['admin']}><AdminLayout /></Require>}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="drivers" element={<AdminDrivers />} />
          <Route path="rides" element={<AdminRides />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="ratings" element={<AdminRatings />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="activity" element={<AdminActivity />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
