import { Building2, HeartPulse, LockKeyhole, ShieldCheck } from 'lucide-react';
import '../../styles/auth.css';

export function AuthShell({ eyebrow, title, description, children, footer }) {
  return (
    <div className="auth-page">
      <aside className="auth-brand-panel" aria-label="AI Finora product information">
        <div className="auth-brand">
          <div className="auth-brand-mark"><HeartPulse size={28} aria-hidden="true" /></div>
          <div>
            <strong>AI Finora</strong>
            <span>Hospital Management SaaS</span>
          </div>
        </div>

        <div className="auth-brand-copy">
          <span className="auth-brand-eyebrow">CONNECTED HOSPITAL OPERATIONS</span>
          <h1>One secure workspace for every hospital team.</h1>
          <p>
            Tenant-aware access keeps operational workflows, subscription controls, and hospital
            records in the right hands.
          </p>
        </div>

        <div className="auth-trust-list">
          <div><Building2 size={19} aria-hidden="true" /><span>Hospital-specific workspaces</span></div>
          <div><ShieldCheck size={19} aria-hidden="true" /><span>Role and plan-aware access</span></div>
          <div><LockKeyhole size={19} aria-hidden="true" /><span>Secure authenticated API sessions</span></div>
        </div>

        <small>AI Finora local SaaS demonstration · Pakistan</small>
      </aside>

      <main className="auth-main">
        <section className="auth-card">
          <div className="auth-mobile-brand" aria-hidden="true">
            <div className="auth-brand-mark"><HeartPulse size={23} /></div>
            <strong>AI Finora</strong>
          </div>
          <header className="auth-card-header">
            <span>{eyebrow}</span>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </header>
          {children}
          {footer && <footer className="auth-card-footer">{footer}</footer>}
        </section>
        <p className="auth-page-note">Protected by AI Finora account and tenant access controls.</p>
      </main>
    </div>
  );
}

export default AuthShell;
