import { FlaskConical, UserRoundCheck } from 'lucide-react';

export const DEMO_ACCOUNTS_ENABLED = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

const configuredAccount = (label, role, hospitalCode, email, password) => ({
  label,
  role,
  hospitalCode: String(hospitalCode || '').trim(),
  email: String(email || '').trim(),
  password: String(password || ''),
});

export const DEMO_ACCOUNTS = Object.freeze(DEMO_ACCOUNTS_ENABLED ? [
  configuredAccount(
    'Super Admin',
    'AI Finora platform access',
    '',
    import.meta.env.VITE_DEMO_SUPER_ADMIN_EMAIL,
    import.meta.env.VITE_DEMO_SUPER_ADMIN_PASSWORD,
  ),
  configuredAccount(
    'Hospital Admin',
    'Demonstration hospital',
    import.meta.env.VITE_DEMO_HOSPITAL_CODE,
    import.meta.env.VITE_DEMO_HOSPITAL_ADMIN_EMAIL,
    import.meta.env.VITE_DEMO_HOSPITAL_ADMIN_PASSWORD,
  ),
  configuredAccount(
    'Receptionist',
    'Demonstration hospital',
    import.meta.env.VITE_DEMO_HOSPITAL_CODE,
    import.meta.env.VITE_DEMO_RECEPTIONIST_EMAIL,
    import.meta.env.VITE_DEMO_RECEPTIONIST_PASSWORD,
  ),
  configuredAccount(
    'Billing Officer',
    'Demonstration hospital',
    import.meta.env.VITE_DEMO_HOSPITAL_CODE,
    import.meta.env.VITE_DEMO_BILLING_EMAIL,
    import.meta.env.VITE_DEMO_BILLING_PASSWORD,
  ),
  configuredAccount(
    'Accountant',
    'Demonstration hospital',
    import.meta.env.VITE_DEMO_HOSPITAL_CODE,
    import.meta.env.VITE_DEMO_ACCOUNTANT_EMAIL,
    import.meta.env.VITE_DEMO_ACCOUNTANT_PASSWORD,
  ),
].filter((account) => account.email && account.password) : []);

export function DemoAccountHelper({ onSelect }) {
  return (
    <details className="auth-demo-accounts">
      <summary>
        <span className="auth-demo-icon"><FlaskConical size={17} aria-hidden="true" /></span>
        <span><strong>Use a demonstration account</strong><small>Credentials are for local demo data only.</small></span>
      </summary>
      <div className="auth-demo-list">
        {DEMO_ACCOUNTS.map((account) => (
          <button
            type="button"
            className="auth-demo-account"
            key={account.email}
            onClick={() => onSelect(account)}
          >
            <span>
              <strong>{account.label}</strong>
              <small>{account.role}</small>
            </span>
            <span className="auth-demo-use"><UserRoundCheck size={15} aria-hidden="true" /> Use</span>
          </button>
        ))}
      </div>
      <p>Never reuse these passwords outside this local demonstration.</p>
    </details>
  );
}

export default DemoAccountHelper;
