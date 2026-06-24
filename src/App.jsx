import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

const Login       = lazy(() => import('./pages/auth/Login'));
const Register    = lazy(() => import('./pages/auth/Register'));
const Discover    = lazy(() => import('./pages/Discover'));
const Bookings    = lazy(() => import('./pages/Bookings'));
const BookingDetail = lazy(() => import('./pages/BookingDetail'));
const Profile     = lazy(() => import('./pages/Profile'));
const Settings    = lazy(() => import('./pages/Settings'));
const Onboarding  = lazy(() => import('./pages/Onboarding'));
const Insights    = lazy(() => import('./pages/Insights'));
const RecordingRoom = lazy(() => import('./pages/RecordingRoom'));

const Loader = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-background-secondary)' }}>
    <div style={{ width: 32, height: 32, border: '3px solid var(--color-border-tertiary)', borderTopColor: 'var(--color-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
  </div>
);

export default function App() {
  const { loading } = useAuth();
  if (loading) return <Loader />;

  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Public */}
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected — wrapped in Layout nav */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/discover"            element={<Discover />} />
            <Route path="/bookings"            element={<Bookings />} />
            <Route path="/bookings/:id"        element={<BookingDetail />} />
            <Route path="/bookings/:id/record" element={<RecordingRoom />} />
            <Route path="/profile/:id"         element={<Profile />} />
            <Route path="/insights"            element={<Insights />} />
            <Route path="/settings"            element={<Settings />} />
          </Route>
          {/* Onboarding — no layout nav */}
          <Route path="/onboarding" element={<Onboarding />} />
        </Route>

        <Route path="/" element={<Navigate to="/discover" replace />} />
        <Route path="*" element={<Navigate to="/discover" replace />} />
      </Routes>
    </Suspense>
  );
}
