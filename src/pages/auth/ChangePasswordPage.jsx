import { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import AuthShell from './AuthShell.jsx';

export default function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const update = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.newPassword.length < 8) return setError('Your new password must contain at least 8 characters.');
    if (form.newPassword !== form.confirmPassword) return setError('The new passwords do not match.');
    if (form.currentPassword === form.newPassword) return setError('Choose a new password that differs from the temporary password.');
    setSubmitting(true);
    setError('');
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      navigate('/hospital', { replace: true });
    } catch (requestError) {
      setError(requestError?.message || 'Your password could not be changed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="FIRST SIGN-IN SECURITY"
      title="Create your permanent password"
      description="The temporary password issued during onboarding must be replaced before hospital data can be opened."
      footer={<button className="auth-text-button" type="button" onClick={logout}>Sign out and use another account</button>}
    >
      <div className="auth-alert auth-guidance">
        <CheckCircle2 size={18} aria-hidden="true" />
        <span>Use at least 8 characters and do not reuse the temporary password.</span>
      </div>
      {error && <div className="auth-alert auth-alert-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      <form className="auth-form" onSubmit={submit}>
        {[
          ['currentPassword', 'Temporary password', 'current-password'],
          ['newPassword', 'New password', 'new-password'],
          ['confirmPassword', 'Confirm new password', 'new-password'],
        ].map(([name, label, autoComplete]) => (
          <div className="auth-field" key={name}>
            <label htmlFor={`password-${name}`}>{label}</label>
            <div className="auth-input-wrap">
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                id={`password-${name}`}
                name={name}
                type={visible ? 'text' : 'password'}
                value={form[name]}
                onChange={update}
                autoComplete={autoComplete}
                minLength={name === 'currentPassword' ? undefined : 8}
                required
                disabled={submitting}
              />
              {name === 'newPassword' && (
                <button type="button" className="auth-input-action" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Hide passwords' : 'Show passwords'}>
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              )}
            </div>
          </div>
        ))}
        <button type="submit" className="auth-submit-button" disabled={submitting}>
          {submitting ? <><LoaderCircle className="auth-spinner" size={18} />Updating password…</> : <><LockKeyhole size={18} />Set password and continue</>}
        </button>
      </form>
    </AuthShell>
  );
}
