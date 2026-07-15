import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, {
  ApiError,
  clearAuthStorage,
  clearSupportSession,
  getAuthToken,
  getPlatformToken,
  getSupportSession,
  getTokenPersistence,
  savePlatformToken,
  saveSupportSession,
  setAuthToken,
} from '../services/api.js';

export const AuthContext = createContext(undefined);

function unwrapPayload(response) {
  if (!response || typeof response !== 'object') return response;
  return response.data && typeof response.data === 'object' ? response.data : response;
}

function extractToken(response, support = false) {
  const payload = unwrapPayload(response) || {};
  if (support) {
    return (
      payload.supportToken ||
      payload.supportAccessToken ||
      payload.accessToken ||
      payload.token ||
      null
    );
  }
  return payload.accessToken || payload.token || payload.jwt || null;
}

function extractUser(response) {
  const payload = unwrapPayload(response);
  if (!payload || typeof payload !== 'object') return null;

  const candidate = payload.user || payload.account || payload.profile;
  if (!candidate || typeof candidate !== 'object') return null;

  return {
    ...candidate,
    ...(payload.kind && !candidate.authKind ? { authKind: payload.kind } : {}),
    ...(payload.accountType && !candidate.accountType ? { accountType: payload.accountType } : {}),
    ...(payload.hospital && !candidate.hospital ? { hospital: payload.hospital } : {}),
    ...(payload.subscription && !candidate.subscription
      ? { subscription: payload.subscription }
      : {}),
    ...(payload.permissions && !candidate.permissions ? { permissions: payload.permissions } : {}),
    ...(payload.features && !candidate.features ? { features: payload.features } : {}),
  };
}

function extractSupportSession(response, hospitalId) {
  const payload = unwrapPayload(response) || {};
  const session = payload.session || payload.supportAccessSession || payload.supportSession || {};
  return {
    id: session.id || payload.sessionId || payload.supportAccessSessionId || null,
    hospitalId: session.hospitalId || payload.hospitalId || hospitalId,
    hospitalName: session.hospitalName || payload.hospital?.name || null,
    reason: session.reason || payload.reason || null,
    startedAt: session.startedAt || payload.startedAt || new Date().toISOString(),
    expiresAt: session.expiresAt || payload.expiresAt || null,
  };
}

function applyStoredSupportIdentity(currentUser) {
  const session = getSupportSession();
  if (!currentUser || !session || !getPlatformToken()) return currentUser;
  return {
    ...currentUser,
    authKind: 'support',
    accountType: 'SUPPORT',
    isSupportAccess: true,
    supportAccessSessionId: session.id,
    supportAccessSession: session,
  };
}

export function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function getUserRoles(user) {
  if (!user) return [];
  const values = Array.isArray(user.roles) ? user.roles : [user.role || user.roleName];
  return values
    .map((role) => (typeof role === 'object' ? role.name || role.key || role.code : role))
    .filter(Boolean)
    .map(normalizeRole);
}

export function isSuperAdminUser(user) {
  if (!user) return false;
  const authKind = normalizeRole(user.authKind || user.kind);
  if (user.isSupportAccess === true || authKind === 'support') return false;
  const accountType = normalizeRole(user.accountType || user.userType || user.type || authKind);
  const roles = getUserRoles(user);
  return (
    user.isSuperAdmin === true ||
    ['platform', 'platform user', 'super admin', 'superadmin'].includes(accountType) ||
    roles.some((role) => ['super admin', 'superadmin', 'platform admin'].includes(role))
  );
}

export function getAccountHome(user) {
  if (user?.mustChangePassword && !isSuperAdminUser(user)) return '/change-password';
  return isSuperAdminUser(user) ? '/super-admin' : '/hospital';
}

async function fetchUser(token) {
  const response = await api.get('/auth/me', { token, handleUnauthorized: false });
  const currentUser = extractUser(response);
  if (!currentUser) {
    throw new ApiError('The session response did not include a user account.', {
      code: 'INVALID_SESSION_RESPONSE',
      response,
    });
  }
  return currentUser;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getAuthToken());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [supportAccess, setSupportAccess] = useState(() => getSupportSession());

  const clearSession = useCallback(() => {
    clearAuthStorage();
    setToken(null);
    setUser(null);
    setSupportAccess(null);
    setAuthError(null);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    const activeToken = getAuthToken();
    clearSession();
    if (!activeToken) return;
    try {
      await api.post('/auth/logout', {}, {
        token: activeToken,
        handleUnauthorized: false,
      });
    } catch {
      // Local credentials are already cleared; the endpoint may be unavailable in demo mode.
    }
  }, [clearSession]);

  const refreshUser = useCallback(async (tokenOverride) => {
    const activeToken = tokenOverride || getAuthToken();
    if (!activeToken) {
      setUser(null);
      return null;
    }

    try {
      const currentUser = applyStoredSupportIdentity(await fetchUser(activeToken));
      setUser(currentUser);
      setToken(activeToken);
      setAuthError(null);
      return currentUser;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        clearAuthStorage();
        setToken(null);
        setUser(null);
        setSupportAccess(null);
      }
      setAuthError(error);
      throw error;
    }
  }, []);

  const login = useCallback(async (credentials, remember = false) => {
    setAuthError(null);
    const response = await api.post('/auth/login', { ...credentials, rememberMe: Boolean(remember) }, {
      auth: false,
      handleUnauthorized: false,
    });
    const nextToken = extractToken(response);

    if (!nextToken) {
      throw new ApiError('The login response did not include an access token.', {
        code: 'INVALID_LOGIN_RESPONSE',
        response,
      });
    }

    clearSupportSession();
    setAuthToken(nextToken, remember);

    try {
      const nextUser = extractUser(response) || (await fetchUser(nextToken));
      setToken(nextToken);
      setUser(nextUser);
      setSupportAccess(null);
      setAuthError(null);

      const payload = unwrapPayload(response);
      return {
        ...(payload && typeof payload === 'object' ? payload : {}),
        token: nextToken,
        user: nextUser,
      };
    } catch (error) {
      clearAuthStorage();
      setToken(null);
      setUser(null);
      setAuthError(error);
      throw error;
    }
  }, []);

  const changePassword = useCallback(async ({ currentPassword, newPassword }) => {
    const activeToken = getAuthToken();
    if (!activeToken) {
      throw new ApiError('Your session has expired. Sign in again to change your password.', {
        status: 401,
        code: 'SESSION_REQUIRED',
      });
    }

    const response = await api.post('/auth/change-password', { currentPassword, newPassword }, {
      token: activeToken,
      handleUnauthorized: false,
    });
    const nextToken = extractToken(response) || activeToken;
    const persistence = getTokenPersistence();
    setAuthToken(nextToken, persistence === 'local');
    const nextUser = extractUser(response) || (await fetchUser(nextToken));
    setToken(nextToken);
    setUser(nextUser);
    setAuthError(null);
    return { ...unwrapPayload(response), token: nextToken, user: nextUser };
  }, []);

  const startSupportAccess = useCallback(async (input, legacyReason) => {
    const options = typeof input === 'object' && input !== null ? input : {};
    const hospitalId = options.hospitalId || (typeof input === 'string' ? input : null);
    const reason = options.reason || legacyReason;

    if (!hospitalId || String(reason || '').trim().length < 5) {
      throw new ApiError('A hospital and support-access reason of at least five characters are required.', {
        code: 'SUPPORT_ACCESS_DETAILS_REQUIRED',
      });
    }

    if (options.warningAccepted !== true) {
      throw new ApiError('The visible support-access warning must be accepted before a session can start.', {
        code: 'SUPPORT_ACCESS_WARNING_REQUIRED',
      });
    }

    const platformToken = getAuthToken();
    if (!platformToken || !isSuperAdminUser(user)) {
      throw new ApiError('Only an authenticated AI Finora Super Admin can start support access.', {
        status: 403,
        code: 'SUPPORT_ACCESS_FORBIDDEN',
      });
    }

    if (getPlatformToken()) {
      throw new ApiError('End the current support-access session before starting another.', {
        code: 'SUPPORT_ACCESS_ALREADY_ACTIVE',
      });
    }

    const response = await api.post(
      `/super-admin/hospitals/${encodeURIComponent(hospitalId)}/support-access`,
      { reason: String(reason).trim(), durationMinutes: options.durationMinutes, warningAccepted: true },
      { token: platformToken },
    );
    const supportToken = extractToken(response, true);
    if (!supportToken) {
      throw new ApiError('Support access was created without a support token.', {
        code: 'INVALID_SUPPORT_ACCESS_RESPONSE',
        response,
      });
    }

    const persistence = getTokenPersistence();
    const session = extractSupportSession(response, hospitalId);
    if (!session.id) {
      throw new ApiError('Support access was created without a session identifier.', {
        code: 'INVALID_SUPPORT_ACCESS_RESPONSE',
        response,
      });
    }
    savePlatformToken(platformToken, persistence);
    setAuthToken(supportToken, persistence === 'local');
    saveSupportSession(session, persistence);

    try {
      const resolvedSupportUser = extractUser(response) || (await fetchUser(supportToken));
      const supportUser = {
        ...resolvedSupportUser,
        authKind: 'support',
        accountType: 'SUPPORT',
        isSupportAccess: true,
        supportAccessSessionId: session.id,
        supportAccessSession: session,
      };
      setToken(supportToken);
      setUser(supportUser);
      setSupportAccess(session);
      setAuthError(null);
      return { ...unwrapPayload(response), token: supportToken, user: supportUser, session };
    } catch (error) {
      setToken(supportToken);
      setUser(null);
      setSupportAccess(session);
      setAuthError(error);
      throw error;
    }
  }, [user]);

  const endSupportAccess = useCallback(async (input) => {
    const activeSupportToken = getAuthToken();
    const originalPlatformToken = getPlatformToken();
    const storedSession = getSupportSession();
    const sessionId =
      (typeof input === 'object' && input !== null ? input.sessionId || input.id : input) ||
      storedSession?.id;

    if (!activeSupportToken || !originalPlatformToken || !sessionId) {
      throw new ApiError('No restorable support-access session was found.', {
        code: 'SUPPORT_ACCESS_NOT_ACTIVE',
      });
    }

    const response = await api.post(
      `/super-admin/support-access/${encodeURIComponent(sessionId)}/end`,
      {},
      { token: originalPlatformToken },
    );
    const persistence = getTokenPersistence();
    setAuthToken(originalPlatformToken, persistence === 'local');
    clearSupportSession();
    setToken(originalPlatformToken);
    setSupportAccess(null);

    try {
      const platformUser = await fetchUser(originalPlatformToken);
      setUser(platformUser);
      setAuthError(null);
      return { ...unwrapPayload(response), token: originalPlatformToken, user: platformUser };
    } catch (error) {
      setUser(null);
      setAuthError(error);
      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const existingToken = getAuthToken();

    async function hydrate() {
      if (!existingToken) {
        if (active) setLoading(false);
        return;
      }

      try {
        const currentUser = applyStoredSupportIdentity(await fetchUser(existingToken));
        if (!active) return;
        setToken(existingToken);
        setUser(currentUser);
        setSupportAccess(getSupportSession());
        setAuthError(null);
      } catch (error) {
        if (!active) return;
        if (error?.status === 401 || error?.status === 403) {
          clearAuthStorage();
          setToken(null);
          setUser(null);
          setSupportAccess(null);
        }
        setAuthError(error);
      } finally {
        if (active) setLoading(false);
      }
    }

    hydrate();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleUnauthorized = () => clearSession();
    window.addEventListener('ai-finora:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('ai-finora:unauthorized', handleUnauthorized);
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      login,
      changePassword,
      logout,
      refreshUser,
      startSupportAccess,
      endSupportAccess,
      supportAccess,
      authError,
      isAuthenticated: Boolean(user && token),
    }),
    [
      authError,
      endSupportAccess,
      loading,
      login,
      changePassword,
      logout,
      refreshUser,
      startSupportAccess,
      supportAccess,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return context;
}

export default AuthProvider;
