import { Navigate, Route, Routes } from 'react-router-dom';
import { getAccountHome, useAuth } from './context/AuthContext.jsx';
import ProtectedRoute, { AuthLoading } from './guards/ProtectedRoute.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx';
import ChangePasswordPage from './pages/auth/ChangePasswordPage.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import PaymentStatusPage from './pages/auth/PaymentStatusPage.jsx';
import HospitalPortal from './pages/hospital/HospitalPortal.jsx';
import SuperAdminRoutes from './pages/super-admin/SuperAdminRoutes.jsx';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <AuthLoading />;
  return <Navigate to={user ? getAccountHome(user) : '/login'} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/change-password"
        element={(
          <ProtectedRoute allowedAccountTypes={['hospital']}>
            <ChangePasswordPage />
          </ProtectedRoute>
        )}
      />
      <Route path="/payment-status" element={<PaymentStatusPage />} />
      <Route
        path="/super-admin/*"
        element={(
          <ProtectedRoute requireSuperAdmin unauthorizedTo="/hospital">
            <SuperAdminRoutes />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/hospital/*"
        element={(
          <ProtectedRoute allowedAccountTypes={['hospital', 'support']} unauthorizedTo="/super-admin">
            <HospitalPortal />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

export default App;
