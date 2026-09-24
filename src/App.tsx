import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { LoadingState } from './components/ui/StateComponents';
import { useAuth } from './context/AuthContext';

import Login from './pages/Login';
const Landing        = lazy(() => import('./pages/Landing'));
const CommandCenter  = lazy(() => import('./pages/CommandCenter'));
const Monitoring     = lazy(() => import('./pages/Monitoring'));
const Detections     = lazy(() => import('./pages/Detections'));
const DetectionDetail= lazy(() => import('./pages/DetectionDetail'));
const Hotspots       = lazy(() => import('./pages/Hotspots'));
const EnvironmentalAI= lazy(() => import('./pages/EnvironmentalAI'));
const Cleanup        = lazy(() => import('./pages/Cleanup'));
const CleanupDetail  = lazy(() => import('./pages/CleanupDetail'));
const DataIngestion  = lazy(() => import('./pages/DataIngestion'));
const MissionReplay  = lazy(() => import('./pages/MissionReplay'));
const Sensors        = lazy(() => import('./pages/Sensors'));
const Reports        = lazy(() => import('./pages/Reports'));
const Admin          = lazy(() => import('./pages/Admin'));
const Settings       = lazy(() => import('./pages/Settings'));

// Fallback shown while a lazy page chunk is loading.
const PageLoader = () => (
  <div className="flex h-full items-center justify-center">
    <LoadingState message="Loading sector..." size="md" />
  </div>
);

// Sends "/" to /command when signed in, /login otherwise.
function RootRedirect() {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? '/command' : '/login'} replace />;
}

/** Route table: public routes, legacy redirects (/sonar-3d, /ai-models), and the
 *  protected layout nest with a role-gated /admin. */
export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public Authentication Route */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/portal" element={<Landing />} />

        {/* Protected Navigation Matrix (Sectors 00-12) */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/command"    element={<CommandCenter />} />
          <Route path="/monitoring" element={<Monitoring />} />
          {/* Legacy demo routes: the standalone demo page was removed; the main
              monitoring workspace is the single 3D survey surface. */}
          <Route path="/demo-3d"         element={<Navigate to="/monitoring" replace />} />
          <Route path="/monitoring-demo" element={<Navigate to="/monitoring" replace />} />
          <Route path="/sonar-3d"        element={<Navigate to="/monitoring" replace />} />
          <Route path="/detections" element={<Detections />} />
          <Route path="/detections/:id" element={<DetectionDetail />} />
          <Route path="/hotspots"   element={<Hotspots />} />
          <Route path="/ai"         element={<EnvironmentalAI />} />
          <Route path="/cleanup"    element={<Cleanup />} />
          <Route path="/cleanup/:id" element={<CleanupDetail />} />
          <Route path="/data"       element={<DataIngestion />} />
          <Route path="/replay"     element={<MissionReplay />} />
          <Route path="/sensors"    element={<Sensors />} />
          <Route path="/ai-models"  element={<Navigate to="/data" replace />} />
          <Route path="/reports"    element={<Reports />} />
          <Route path="/admin"      element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <Admin />
            </ProtectedRoute>
          } />
          <Route path="/settings"   element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
