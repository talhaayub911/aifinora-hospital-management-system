import { useState } from 'react';
import { AlertTriangle, LoaderCircle, RotateCcw, ShieldX } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  getAccountHome,
  getUserRoles,
  isSuperAdminUser,
  normalizeRole,
  useAuth,
} from '../context/AuthContext.jsx';
import '../styles/auth.css';

function normalizeList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean).map(normalizeRole);
}

function getAccountType(user) {
  if (isSuperAdminUser(user)) return 'platform';
  const value = normalizeRole(
    user?.accountType || user?.userType || user?.type || user?.authKind || 'hospital',
  );
  if (value.includes('hospital')) return 'hospital';
  if (value.includes('platform') || value.includes('super admin')) return 'platform';
  return value;
}

function hasRequiredPermission(user, requiredPermissions) {
  const required = normalizeList(requiredPermissions);
  if (!required.length) return true;

  const source = user?.permissions;
  if (Array.isArray(source)) {
    const granted = source.map((permission) =>
      normalizeRole(
        typeof permission === 'object'
          ? permission.key || permission.code || permission.name
          : permission,
      ),
    );
    return required.every((permission) => granted.includes(permission));
  }

  if (source && typeof source === 'object') {
    const granted = Object.entries(source)
      .filter(([, enabled]) => {
        if (!enabled || typeof enabled !== 'object') return Boolean(enabled);
        return Boolean(enabled.enabled || enabled.read || enabled.write || enabled.manage);
      })
      .map(([permission]) => normalizeRole(permission));
    return required.every((permission) => granted.includes(permission));
  }

  return false;
}

export function AuthLoading({ label = 'Verifying your secure session…' }) {
  return (
    <div className="auth-route-state" role="status" aria-live="polite">
      <LoaderCircle className="auth-spinner" size={28} aria-hidden="true" />
      <strong>{label}</strong>
      <span>Please wait a moment.</span>
    </div>
  );
}

function SessionError({ error, retry, logout }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retry();
    } catch {
      // The context retains the actionable error for the next render.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="auth-route-state auth-route-error" role="alert">
      <AlertTriangle size={30} aria-hidden="true" />
      <strong>We could not verify your session</strong>
      <span>{error?.message || 'The authentication service is currently unavailable.'}</span>
      <div className="auth-route-actions">
        <button type="button" className="auth-secondary-button" onClick={logout}>
          Sign out
        </button>
        <button
          type="button"
          className="auth-primary-button"
          disabled={retrying}
          onClick={handleRetry}
        >
          <RotateCcw size={16} aria-hidden="true" />
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    </div>
  );
}

function AccessDenied({ home }) {
  const navigate = useNavigate();
  return (
    <div className="auth-route-state auth-route-error" role="alert">
      <ShieldX size={31} aria-hidden="true" />
      <strong>Access is not available for this account</strong>
      <span>Your signed-in role does not have permission to open this area.</span>
      <button type="button" className="auth-primary-button" onClick={() => navigate(home)}>
        Return to your dashboard
      </button>
    </div>
  );
}

export function ProtectedRoute({
  children,
  allowedRoles,
  roles,
  allowedAccountTypes,
  accountTypes,
  requiredPermissions,
  requireSuperAdmin = false,
  redirectTo = '/login',
  unauthorizedTo,
  loadingFallback,
}) {
  const { user, token, loading, authError, refreshUser, logout } = useAuth();
  const location = useLocation();

  if (loading) return loadingFallback || <AuthLoading />;

  if (!user || !token) {
    if (authError && token) {
      return <SessionError error={authError} retry={refreshUser} logout={logout} />;
    }
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  const acceptedRoles = normalizeList(allowedRoles || roles);
  const currentRoles = getUserRoles(user);
  const roleAllowed =
    !acceptedRoles.length || acceptedRoles.some((accepted) => currentRoles.includes(accepted));

  const acceptedAccountTypes = normalizeList(allowedAccountTypes || accountTypes).map((type) => {
    if (['super admin', 'superadmin', 'platform user'].includes(type)) return 'platform';
    return type;
  });
  const currentAccountType = getAccountType(user);
  const accountAllowed =
    !acceptedAccountTypes.length || acceptedAccountTypes.includes(currentAccountType);
  const superAdminAllowed = !requireSuperAdmin || isSuperAdminUser(user);
  const permissionAllowed = hasRequiredPermission(user, requiredPermissions);

  if (!roleAllowed || !accountAllowed || !superAdminAllowed || !permissionAllowed) {
    const home = unauthorizedTo || getAccountHome(user);
    const currentPath = location.pathname.replace(/\/$/, '') || '/';
    const targetPath = home.replace(/\/$/, '') || '/';
    if (currentPath !== targetPath) return <Navigate to={home} replace />;
    return <AccessDenied home={home} />;
  }

  return children || <Outlet />;
}

export default ProtectedRoute;
