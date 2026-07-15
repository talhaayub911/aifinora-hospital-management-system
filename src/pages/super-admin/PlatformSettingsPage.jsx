import { useEffect, useState } from 'react';
import {
  Banknote,
  Bell,
  Building2,
  CreditCard,
  Save,
  Settings,
  ShieldCheck,
  TimerReset,
} from 'lucide-react';
import { api } from '../../services/api.js';
import {
  ADMIN_API_ROOT,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
  apiErrorMessage,
  unwrapApi,
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

const defaults = {
  platformName: 'AI Finora',
  supportEmail: 'support@aifinora.com',
  supportPhone: '',
  timezone: 'Asia/Karachi',
  currency: 'PKR',
  bankName: '',
  bankAccountTitle: '',
  iban: '',
  branchCode: '',
  paymentInstructions: '',
  invoicePrefix: 'AF-SUB',
  renewalInvoiceDaysBefore: 7,
  reminderDaysBefore: 3,
  defaultGracePeriodDays: 7,
  suspensionThresholdDays: 30,
  requireSuspensionReview: true,
  safepayEnabled: false,
  safepayDemoMode: true,
  inAppNotificationsEnabled: true,
  emailSimulationEnabled: false,
  defaultSupportAccessMinutes: 60,
  dataRetentionDays: 2555,
  bankSource: 'Not configured',
  bankDemoOnly: false,
};

function parseObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeValue(key, value) {
  if (typeof defaults[key] === 'boolean') return value === true || String(value).toLowerCase() === 'true';
  if (typeof defaults[key] === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : defaults[key];
  }
  return value;
}

function normalizeSettings(payload, current = defaults) {
  const source = payload?.settings || payload || {};
  const normalized = Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => Object.prototype.hasOwnProperty.call(defaults, key))
      .map(([key, value]) => [key, normalizeValue(key, value)]),
  );
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const safepay = providers.find((item) => item.provider === 'SAFEPAY');
  const manualProvider = providers.find((item) => item.provider === 'MANUAL_BANK_TRANSFER');
  const providerBank = parseObject(manualProvider?.publicConfigJson);
  const legacyBank = parseObject(source['billing.bankInstructions']);
  const hasDirectBank = Boolean(source.bankName || source.bankAccountTitle || source.iban || source.branchCode || source.paymentInstructions);
  const hasProviderBank = Boolean(providerBank.bankName || providerBank.accountTitle || providerBank.iban);

  return {
    ...current,
    ...normalized,
    timezone: source.timezone || source['platform.timezone'] || current.timezone,
    currency: source.currency || source['platform.currency'] || current.currency,
    bankName: source.bankName || providerBank.bankName || legacyBank.bankName || legacyBank.bank || '',
    bankAccountTitle: source.bankAccountTitle || providerBank.accountTitle || legacyBank.accountTitle || '',
    iban: source.iban || providerBank.iban || legacyBank.iban || '',
    branchCode: source.branchCode || providerBank.branchCode || legacyBank.branchCode || '',
    paymentInstructions: source.paymentInstructions || providerBank.paymentInstructions || legacyBank.paymentInstructions || '',
    bankSource: hasDirectBank ? 'Platform runtime override' : hasProviderBank ? 'Manual-provider fallback' : Object.keys(legacyBank).length ? 'Legacy demo fallback' : 'Not configured',
    bankDemoOnly: Boolean(manualProvider?.demoMode || legacyBank.demoOnly),
    ...(safepay ? { safepayEnabled: Boolean(safepay.enabled), safepayDemoMode: Boolean(safepay.demoMode) } : {}),
  };
}

export default function PlatformSettingsPage() {
  const resource = useAdminResource(`${ADMIN_API_ROOT}/settings`);
  const [form, setForm] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const { notify } = useAdminToast();

  useEffect(() => {
    if (!resource.data) return;
    setForm((current) => normalizeSettings(resource.data, current));
  }, [resource.data]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const invoicePrefix = form.invoicePrefix.trim().toUpperCase();
      if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(invoicePrefix) || invoicePrefix.length > 24) {
        notify('Invoice prefix must contain uppercase letters, numbers, or single hyphens and be no longer than 24 characters.', 'warning');
        return;
      }
      const renewalInvoiceDaysBefore = Number(form.renewalInvoiceDaysBefore);
      const reminderDaysBefore = Number(form.reminderDaysBefore);
      const defaultSupportAccessMinutes = Number(form.defaultSupportAccessMinutes);
      if (!Number.isInteger(renewalInvoiceDaysBefore) || renewalInvoiceDaysBefore < 1 || renewalInvoiceDaysBefore > 90) {
        notify('Renewal invoice timing must be a whole number from 1 to 90 days.', 'warning');
        return;
      }
      if (!Number.isInteger(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 90) {
        notify('Pre-due reminder timing must be a whole number from 0 to 90 days.', 'warning');
        return;
      }
      if (reminderDaysBefore > renewalInvoiceDaysBefore) {
        notify('Pre-due reminder timing cannot exceed the renewal invoice creation window.', 'warning');
        return;
      }
      if (!Number.isInteger(defaultSupportAccessMinutes) || defaultSupportAccessMinutes < 5 || defaultSupportAccessMinutes > 240) {
        notify('Default support access must be a whole number from 5 to 240 minutes.', 'warning');
        return;
      }
      const response = await api.patch(`${ADMIN_API_ROOT}/settings`, {
        settings: {
          bankName: form.bankName.trim(),
          bankAccountTitle: form.bankAccountTitle.trim(),
          iban: form.iban.trim(),
          branchCode: form.branchCode.trim(),
          paymentInstructions: form.paymentInstructions.trim(),
          invoicePrefix,
          renewalInvoiceDaysBefore,
          reminderDaysBefore,
          defaultSupportAccessMinutes,
        },
        safepay: {
          enabled: form.safepayEnabled,
          demoMode: form.safepayDemoMode,
        },
      });
      const saved = unwrapApi(response);
      if (saved) setForm((current) => normalizeSettings(saved, current));
      notify('Operational platform settings saved and audit log created.');
    } catch (error) {
      notify(apiErrorMessage(error, 'Operational platform settings could not be saved.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (resource.loading) return <LoadingState label="Loading platform settings…" />;
  if (resource.error) return <ErrorState message={resource.error} onRetry={resource.reload} />;

  return (
    <form onSubmit={save}>
      <PageHeader
        title="Platform settings"
        description="Manage payment, invoice automation, and support-access settings that are consumed at runtime, while keeping future integration metadata clearly read-only."
      >
        <button className="sa-button sa-button--primary" type="submit" disabled={busy}>
          <Save size={16} />{busy ? 'Saving…' : 'Save operational settings'}
        </button>
      </PageHeader>

      <div className="sa-settings-layout">
        <SettingsSection
          icon={Banknote}
          title="Bank-transfer instructions"
          description="Operational. These global values are read by the hospital Subscription & Billing page at runtime; hospital-specific values take precedence."
          mode="operational"
        >
          <div className="sa-provider-status">
            <div><span>Current source</span><strong>{form.bankSource}</strong></div>
            <div><span>Mode</span><StatusBadge status={form.bankDemoOnly ? 'demo_only' : 'runtime'} /></div>
          </div>
          <div className="sa-form-grid">
            <Field label="Bank name"><input value={form.bankName} onChange={(event) => update('bankName', event.target.value)} /></Field>
            <Field label="Account title"><input value={form.bankAccountTitle} onChange={(event) => update('bankAccountTitle', event.target.value)} /></Field>
            <Field label="IBAN"><input value={form.iban} onChange={(event) => update('iban', event.target.value)} /></Field>
            <Field label="Branch code"><input value={form.branchCode} onChange={(event) => update('branchCode', event.target.value)} /></Field>
            <Field className="sa-field--span-2" label="Payment instructions"><textarea rows="4" maxLength="2000" value={form.paymentInstructions} onChange={(event) => update('paymentInstructions', event.target.value)} /></Field>
          </div>
          <div className="sa-security-callout"><ShieldCheck size={21} /><div><strong>Operational runtime configuration</strong><span>Saving creates platform-level overrides. Replace the seeded demo account before any production payment workflow is enabled.</span></div></div>
        </SettingsSection>

        <SettingsSection
          icon={TimerReset}
          title="Subscription invoice automation"
          description="Operational. These values control numbering and the idempotent subscription-processing worker for newly generated invoices and reminders."
          mode="operational"
        >
          <div className="sa-form-grid sa-form-grid--three">
            <Field label="Subscription invoice prefix" hint="New non-implementation invoices only; implementation invoices retain AF-IMP"><input value={form.invoicePrefix} maxLength="24" pattern="[A-Z0-9]+(?:-[A-Z0-9]+)*" onChange={(event) => update('invoicePrefix', event.target.value.toUpperCase())} required /></Field>
            <Field label="Renewal invoice days before" hint="Creation horizon and issue date; 1–90 days"><input type="number" min="1" max="90" step="1" value={form.renewalInvoiceDaysBefore} onChange={(event) => update('renewalInvoiceDaysBefore', event.target.value)} required /></Field>
            <Field label="Pre-due reminder days" hint="0 disables pre-due reminders; cannot exceed the renewal window; due-today notices still run"><input type="number" min="0" max={Math.min(90, Number(form.renewalInvoiceDaysBefore) || 90)} step="1" value={form.reminderDaysBefore} onChange={(event) => update('reminderDaysBefore', event.target.value)} required /></Field>
          </div>
          <div className="sa-security-callout"><ShieldCheck size={21} /><div><strong>Applies to future processing runs</strong><span>Existing invoice numbers and historical notifications are never rewritten. Idempotency still prevents duplicate renewal invoices and reminders.</span></div></div>
        </SettingsSection>

        <SettingsSection
          icon={Settings}
          title="Support-access policy"
          description="Operational. This duration is used when a Super Admin starts an audited support session without choosing an explicit override."
          mode="operational"
        >
          <div className="sa-form-grid">
            <Field label="Default support-access duration (minutes)" hint="Allowed range: 5–240 minutes"><input type="number" min="5" max="240" step="1" value={form.defaultSupportAccessMinutes} onChange={(event) => update('defaultSupportAccessMinutes', event.target.value)} required /></Field>
          </div>
          <div className="sa-security-callout"><ShieldCheck size={21} /><div><strong>Warning acceptance remains mandatory</strong><span>Changing the duration does not bypass the visible confirmation, read-only enforcement, expiry, or audit trail.</span></div></div>
        </SettingsSection>

        <SettingsSection
          icon={CreditCard}
          title="Safepay provider switches"
          description="Operational switches. Merchant secrets and adapter readiness remain deployment-managed and are not exposed by this API."
          mode="operational"
        >
          <div className="sa-provider-status">
            <div><span>Credentials</span><StatusBadge status="server_managed" /></div>
            <div><span>Environment</span><strong>Deployment configuration</strong></div>
          </div>
          <ToggleSetting
            label="Enable Safepay payment links"
            description="Updates the provider switch. Real links still require server-side credentials, verified checkout integration, and webhook configuration."
            checked={form.safepayEnabled}
            onChange={(value) => update('safepayEnabled', value)}
          />
          <ToggleSetting
            label="Safepay Demo mode"
            description="Enables the clearly labelled local simulation where allowed. Production mode rejects this setting."
            checked={form.safepayDemoMode}
            onChange={(value) => update('safepayDemoMode', value)}
          />
          <div className="sa-security-callout"><ShieldCheck size={21} /><div><strong>Webhook verification remains mandatory</strong><span>A browser redirect never records money. Credential and production-adapter readiness must be verified through deployment checks and an end-to-end provider test.</span></div></div>
        </SettingsSection>

        <SettingsSection
          icon={Building2}
          title="Platform profile metadata"
          description="Stored reference values only. Current invoice rendering, email delivery, currency calculation, and timezone formatting do not consume them."
          mode="stored_only"
        >
          <div className="sa-form-grid">
            <Field label="Platform name" hint="Future template integration"><input value={form.platformName} disabled /></Field>
            <Field label="Support email" hint="Future notification integration"><input type="email" value={form.supportEmail} disabled /></Field>
            <Field label="Support phone" hint="Future notification integration"><input value={form.supportPhone} disabled /></Field>
            <Field label="Timezone" hint="Formatting is currently application-defined"><input value={form.timezone} disabled /></Field>
            <Field label="Currency" hint="Invoices currently use their persisted PKR value"><input value={form.currency} disabled /></Field>
          </div>
          <ReadOnlyNotice />
        </SettingsSection>

        <SettingsSection
          icon={TimerReset}
          title="Subscription policy reference"
          description="Stored reference values only. The processing worker reads each hospital subscription's own invoice, grace, and suspension terms."
          mode="stored_only"
        >
          <div className="sa-form-grid">
            <Field label="Default grace-period days" hint="Set per subscription during onboarding"><input type="number" value={form.defaultGracePeriodDays} disabled /></Field>
            <Field label="Suspension threshold days" hint="Set per subscription"><input type="number" value={form.suspensionThresholdDays} disabled /></Field>
          </div>
          <ToggleSetting
            label="Require Super Admin review before suspension"
            description="Current processing reports suspension eligibility but does not read this stored toggle."
            checked={form.requireSuspensionReview}
            disabled
          />
          <ReadOnlyNotice copy="Change effective grace and suspension terms on the hospital onboarding or Subscriptions screens. These global reference values remain future work." />
        </SettingsSection>

        <SettingsSection
          icon={Bell}
          title="Notification and retention integration metadata"
          description="Read-only planning metadata. These values do not currently enable email, suppress in-app notices, or delete retained data."
          mode="stored_only"
        >
          <ToggleSetting label="Enable in-app notifications" description="Notifications are currently created by explicit backend workflows, independent of this value." checked={form.inAppNotificationsEnabled} disabled />
          <ToggleSetting label="Simulate email delivery locally" description="A non-delivering simulation adapter exists, but this stored setting does not select it and no workflow dispatch pipeline is wired." checked={form.emailSimulationEnabled} disabled />
          <div className="sa-form-grid"><Field label="Data retention (days)" hint="No deletion job consumes this metadata"><input type="number" value={form.dataRetentionDays} disabled /></Field></div>
          <ReadOnlyNotice copy="Add a real provider behind the email interface, a durable outbox/worker, notification preferences, and a reviewed retention job before making these controls editable." />
        </SettingsSection>
      </div>
    </form>
  );
}

function ReadOnlyNotice({ copy = 'These fields are intentionally read-only until a runtime consumer and corresponding tests are implemented.' }) {
  return <div className="sa-security-callout"><Settings size={20} /><div><strong>Stored metadata — no runtime effect</strong><span>{copy}</span></div></div>;
}

function SettingsSection({ icon: Icon = Settings, title, description, mode, children }) {
  return <section className="sa-panel sa-settings-section"><header><span><Icon size={20} /></span><div><h2>{title}</h2><p>{description}</p></div>{mode && <div className="sa-settings-mode"><StatusBadge status={mode} /></div>}</header>{children}</section>;
}

function ToggleSetting({ label, description, checked, onChange = () => {}, disabled = false }) {
  return <label className={`sa-setting-toggle ${disabled ? 'sa-setting-toggle--disabled' : ''}`}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}
