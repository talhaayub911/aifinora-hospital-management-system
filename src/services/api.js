const DEFAULT_API_BASE_URL = 'http://localhost:3001/api';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
  /\/+$/,
  '',
);

const TOKEN_KEY = 'ai-finora.auth.token';
const PLATFORM_TOKEN_KEY = 'ai-finora.auth.platform-token';
const SUPPORT_SESSION_KEY = 'ai-finora.auth.support-session';

function getBrowserStorage(kind) {
  if (typeof window === 'undefined') return null;

  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readFromStorage(key) {
  const sessionValue = getBrowserStorage('session')?.getItem(key);
  if (sessionValue) return { value: sessionValue, persistence: 'session' };

  const localValue = getBrowserStorage('local')?.getItem(key);
  if (localValue) return { value: localValue, persistence: 'local' };

  return { value: null, persistence: null };
}

function writeToStorage(key, value, persistence = 'session') {
  const destination = getBrowserStorage(persistence);
  const other = getBrowserStorage(persistence === 'local' ? 'session' : 'local');

  other?.removeItem(key);
  if (!value) {
    destination?.removeItem(key);
    return;
  }

  destination?.setItem(key, value);
}

function removeFromStorage(key) {
  getBrowserStorage('session')?.removeItem(key);
  getBrowserStorage('local')?.removeItem(key);
}

export function getAuthToken() {
  return readFromStorage(TOKEN_KEY).value;
}

export function getTokenPersistence() {
  return readFromStorage(TOKEN_KEY).persistence || 'session';
}

export function setAuthToken(token, remember = false) {
  const persistence = remember === true || remember === 'local' ? 'local' : 'session';
  writeToStorage(TOKEN_KEY, token, persistence);
  return persistence;
}

export function clearAuthToken() {
  removeFromStorage(TOKEN_KEY);
}

export function savePlatformToken(token, persistence = getTokenPersistence()) {
  writeToStorage(PLATFORM_TOKEN_KEY, token, persistence);
}

export function getPlatformToken() {
  return readFromStorage(PLATFORM_TOKEN_KEY).value;
}

export function saveSupportSession(session, persistence = getTokenPersistence()) {
  writeToStorage(SUPPORT_SESSION_KEY, JSON.stringify(session), persistence);
}

export function getSupportSession() {
  const raw = readFromStorage(SUPPORT_SESSION_KEY).value;
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    removeFromStorage(SUPPORT_SESSION_KEY);
    return null;
  }
}

export function clearSupportSession() {
  removeFromStorage(PLATFORM_TOKEN_KEY);
  removeFromStorage(SUPPORT_SESSION_KEY);
}

export function clearAuthStorage() {
  clearAuthToken();
  clearSupportSession();
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', details = null, response = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.response = response;
  }
}

function buildUrl(path, query) {
  const rawPath = String(path || '');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = /^https?:\/\//i.test(rawPath)
    ? new URL(rawPath)
    : new URL(`${API_BASE_URL.replace(/\/+$/, '')}/${rawPath.replace(/^\/+/, '')}`, origin);

  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
}

function isBodyInit(value) {
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true;
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  return typeof value === 'string';
}

async function parseResponse(response, responseType) {
  if (response.status === 204 || response.status === 205) return null;
  if (responseType === 'blob') return response.blob();
  if (responseType === 'arrayBuffer') return response.arrayBuffer();
  if (responseType === 'text') return response.text();

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorFromResponse(response, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const nested = source.error && typeof source.error === 'object' ? source.error : {};
  const message =
    source.message ||
    nested.message ||
    (typeof source.error === 'string' ? source.error : '') ||
    `Request failed with status ${response.status}.`;

  return new ApiError(message, {
    status: response.status,
    code: source.code || nested.code || `HTTP_${response.status}`,
    details: source.details || nested.details || source.errors || null,
    response: payload,
  });
}

async function request(method, path, body, options = {}) {
  const {
    auth = true,
    token: explicitToken,
    query,
    headers: customHeaders,
    responseType,
    handleUnauthorized = true,
    ...fetchOptions
  } = options;

  const headers = new Headers(customHeaders || {});
  const token = explicitToken || (auth ? getAuthToken() : null);
  let requestBody;

  if (body !== undefined && body !== null) {
    if (isBodyInit(body)) {
      requestBody = body;
    } else {
      headers.set('Content-Type', 'application/json');
      requestBody = JSON.stringify(body);
    }
  }

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...fetchOptions,
      method,
      headers,
      body: requestBody,
      credentials: fetchOptions.credentials || 'include',
      cache: fetchOptions.cache || 'no-store',
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Unable to reach the AI Finora service. Check that the local API is running.', {
      code: 'NETWORK_ERROR',
      details: error,
    });
  }

  const payload = await parseResponse(response, responseType);
  if (!response.ok) {
    if (
      response.status === 401 &&
      token &&
      handleUnauthorized &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('ai-finora:unauthorized'));
    }
    throw errorFromResponse(response, payload);
  }

  return payload;
}

export const api = {
  get(path, options = {}) {
    return request('GET', path, undefined, options);
  },
  post(path, body, options = {}) {
    return request('POST', path, body, options);
  },
  patch(path, body, options = {}) {
    return request('PATCH', path, body, options);
  },
  delete(path, bodyOrOptions, maybeOptions) {
    if (maybeOptions !== undefined) {
      return request('DELETE', path, bodyOrOptions, maybeOptions);
    }

    const looksLikeOptions =
      bodyOrOptions &&
      typeof bodyOrOptions === 'object' &&
      !(typeof FormData !== 'undefined' && bodyOrOptions instanceof FormData) &&
      ['auth', 'token', 'query', 'headers', 'signal', 'responseType'].some((key) =>
        Object.prototype.hasOwnProperty.call(bodyOrOptions, key),
      );

    return looksLikeOptions
      ? request('DELETE', path, undefined, bodyOrOptions)
      : request('DELETE', path, bodyOrOptions, {});
  },
};

export default api;
