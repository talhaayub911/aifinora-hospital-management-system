import { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  LoaderCircle,
  Mail,
  Send,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../services/api.js';
import AuthShell from './AuthShell.jsx';

export function ForgotPasswordPage() {
  const [hospitalCode, setHospitalCode] = useState('');
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('Enter the email address associated with your account.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.post(
        '/auth/forgot-password',
        { hospitalCode: hospitalCode.trim() || undefined, email: normalizedEmail },
        { auth: false, handleUnauthorized: false },
      );
      setSubmittedEmail(normalizedEmail);
      setSuccess(true);
    } catch (requestError) {
      // A missing account receives the same response to avoid exposing registered addresses.
      if (requestError?.status === 404) {
        setSubmittedEmail(normalizedEmail);
        setSuccess(true);
      } else {
        setError(requestError?.message || 'The reset request could not be submitted. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSuccess(false);
    setSubmittedEmail('');
    setError('');
  };

  return (
    <AuthShell
      eyebrow="ACCOUNT RECOVERY"
      title="Reset your password"
      description="Request secure password-reset instructions for your account."
      footer={<><span>Remembered your password?</span><Link to="/login">Return to sign in</Link></>}
    >
      {success ? (
        <div className="auth-result-state auth-result-success" role="status" aria-live="polite">
          <div className="auth-result-icon"><CheckCircle2 size={30} aria-hidden="true" /></div>
          <h3>Check your reset instructions</h3>
          <p>
            If an eligible account exists for <strong>{submittedEmail}</strong>, password-reset
            instructions have been created. Email delivery may be simulated in this local demo.
          </p>
          <Link className="auth-submit-button" to="/login"><ArrowLeft size={18} /> Back to sign in</Link>
          <button type="button" className="auth-text-button" onClick={resetForm}>
            Try a different account
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {error && (
            <div className="auth-alert auth-alert-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="auth-guidance">
            For hospital accounts, include the hospital code used on the sign-in page. Super Admin
            accounts can leave it blank.
          </div>

          <div className="auth-field">
            <label htmlFor="reset-hospital-code">Hospital code <small>Optional for Super Admin</small></label>
            <div className="auth-input-wrap">
              <Building2 size={18} aria-hidden="true" />
              <input
                id="reset-hospital-code"
                value={hospitalCode}
                onChange={(event) => { setHospitalCode(event.target.value); setError(''); }}
                placeholder="e.g. akram-medical"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="reset-email">Email address</label>
            <div className="auth-input-wrap">
              <Mail size={18} aria-hidden="true" />
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setError(''); }}
                placeholder="you@hospital.com"
                autoComplete="email"
                inputMode="email"
                required
                disabled={submitting}
              />
            </div>
          </div>

          <button type="submit" className="auth-submit-button" disabled={submitting}>
            {submitting ? (
              <><LoaderCircle className="auth-spinner" size={18} /> Submitting…</>
            ) : (
              <><Send size={18} /> Send reset instructions</>
            )}
          </button>

          <p className="auth-security-note">
            For security, this page does not reveal whether an email address is registered.
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export default ForgotPasswordPage;
