import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Mail,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAccountHome, isSuperAdminUser, useAuth } from '../../context/AuthContext.jsx';
import AuthShell from './AuthShell.jsx';
import DemoAccountHelper, { DEMO_ACCOUNTS, DEMO_ACCOUNTS_ENABLED } from './DemoAccountHelper.jsx';

function safeDestination(user, from) {
  const home = getAccountHome(user);
  if (user?.mustChangePassword) return home;
  const pathname = typeof from?.pathname === 'string' ? from.pathname : '';
  const belongsToAccount = isSuperAdminUser(user)
    ? pathname === '/super-admin' || pathname.startsWith('/super-admin/')
    : pathname === '/hospital' || pathname.startsWith('/hospital/');

  if (!belongsToAccount) return home;
  return `${pathname}${from.search || ''}${from.hash || ''}`;
}

function loginErrorMessage(error) {
  if (error?.status === 401) return 'The hospital code, email address, or password is incorrect.';
  if (error?.status === 429) return 'Too many login attempts. Please wait before trying again.';
  if (error?.status === 403) {
    return error.message || 'This account cannot sign in in its current subscription state.';
  }
  return error?.message || 'Sign-in could not be completed. Please try again.';
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({
    hospitalCode: '',
    email: '',
    password: '',
    remember: false,
  });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && user) {
      navigate(safeDestination(user, location.state?.from), { replace: true });
    }
  }, [loading, location.state, navigate, user]);

  const updateField = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    if (error) setError('');
  };

  const selectDemoAccount = (account) => {
    setForm((current) => ({
      ...current,
      hospitalCode: account.hospitalCode,
      email: account.email,
      password: account.password,
    }));
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const credentials = {
        hospitalCode: form.hospitalCode.trim() || undefined,
        email: form.email.trim(),
        password: form.password,
      };
      const result = await login(credentials, form.remember);
      navigate(safeDestination(result.user, location.state?.from), { replace: true });
    } catch (requestError) {
      setError(loginErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="SECURE ACCOUNT ACCESS"
      title="Welcome back"
      description="Sign in with your AI Finora or hospital account."
      footer={<><span>Checking a Safepay or bank payment?</span><Link to="/payment-status">View payment status</Link></>}
    >
      {loading ? (
        <div className="auth-inline-state" role="status">
          <LoaderCircle className="auth-spinner" size={25} aria-hidden="true" />
          <strong>Checking your session…</strong>
        </div>
      ) : (
        <>
          <form className="auth-form" onSubmit={submit}>
            {error && (
              <div className="auth-alert auth-alert-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="login-hospital-code">Hospital code <small>Not required for Super Admin</small></label>
              <div className="auth-input-wrap">
                <Building2 size={18} aria-hidden="true" />
                <input
                  id="login-hospital-code"
                  name="hospitalCode"
                  value={form.hospitalCode}
                  onChange={updateField}
                  placeholder="e.g. akram-medical"
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="login-email">Email address</label>
              <div className="auth-input-wrap">
                <Mail size={18} aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={updateField}
                  placeholder="you@hospital.com"
                  autoComplete="username"
                  inputMode="email"
                  required
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="login-password">Password</label>
              <div className="auth-input-wrap">
                <LockKeyhole size={18} aria-hidden="true" />
                <input
                  id="login-password"
                  type={passwordVisible ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={updateField}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="auth-input-action"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={passwordVisible}
                >
                  {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="auth-form-options">
              <label className="auth-checkbox">
                <input
                  type="checkbox"
                  name="remember"
                  checked={form.remember}
                  onChange={updateField}
                  disabled={submitting}
                />
                <span>Remember me on this device</span>
              </label>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <button type="submit" className="auth-submit-button" disabled={submitting}>
              {submitting ? (
                <><LoaderCircle className="auth-spinner" size={18} /> Signing in…</>
              ) : (
                <><LogIn size={18} /> Sign in securely</>
              )}
            </button>
          </form>

          {DEMO_ACCOUNTS_ENABLED && DEMO_ACCOUNTS.length > 0 && (
            <>
              <div className="auth-divider"><span>LOCAL DEMONSTRATION</span></div>
              <DemoAccountHelper onSelect={selectDemoAccount} />
            </>
          )}
        </>
      )}
    </AuthShell>
  );
}

export default LoginPage;
