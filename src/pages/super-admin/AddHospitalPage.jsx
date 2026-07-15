import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Layers3,
  LoaderCircle,
  Printer,
  UserCog,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import {
  ADMIN_API_ROOT,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
  apiErrorMessage,
  asArray,
  formatDate,
  formatPkr,
  titleCase,
  unwrapApi,
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

const steps = [
  ['Hospital details', Building2],
  ['Subscription', CreditCard],
  ['Limits & modules', Layers3],
  ['Administrator', UserCog],
  ['Review & create', ClipboardCheck],
];

const moduleOptions = [
  'dashboard', 'patient_registration', 'appointments', 'admissions', 'doctors', 'departments',
  'charge_master', 'opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing',
  'laboratory_billing', 'insurance_billing', 'corporate_billing', 'payments', 'refunds', 'receipts',
  'financial_reports', 'pharmacy_inventory', 'multi_branch_management', 'api_access',
];

const strongTemporaryPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{10,128}$/;

const initialForm = {
  hospital: {
    name: '', code: '', legalBusinessName: '', ntn: '', email: '', phone: '', address: '', city: '', province: 'Punjab',
    numberOfBeds: 30, numberOfBranches: 1, primaryContactName: '', primaryContactDesignation: '', primaryContactMobile: '', primaryContactEmail: '',
  },
  subscription: {
    planId: '', billingCycle: 'monthly', startDate: new Date().toISOString().slice(0, 10), trialDays: 0,
    implementationFee: 150000, subscriptionPrice: 0, discount: 0, taxRate: 0, invoiceDueDays: 7,
    gracePeriodDays: 7, contractRenewalDate: '', notes: '',
  },
  limits: { maxUsers: 10, maxBranches: 1, maxBeds: 30, storageLimitGb: 10, enabledModules: ['dashboard', 'patient_registration', 'appointments', 'opd_billing', 'payments', 'receipts'], optionalAddons: [] },
  administrator: { fullName: '', email: '', mobile: '', temporaryPassword: '', role: 'HOSPITAL_ADMIN', requirePasswordChange: true },
};

const requiredByStep = {
  0: [['hospital', 'name'], ['hospital', 'code'], ['hospital', 'legalBusinessName'], ['hospital', 'email'], ['hospital', 'phone'], ['hospital', 'address'], ['hospital', 'city'], ['hospital', 'province'], ['hospital', 'primaryContactName'], ['hospital', 'primaryContactMobile'], ['hospital', 'primaryContactEmail']],
  1: [['subscription', 'planId'], ['subscription', 'billingCycle'], ['subscription', 'startDate']],
  3: [['administrator', 'fullName'], ['administrator', 'email'], ['administrator', 'mobile'], ['administrator', 'temporaryPassword']],
};

export default function AddHospitalPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const { notify } = useAdminToast();
  const navigate = useNavigate();
  const plansResource = useAdminResource(`${ADMIN_API_ROOT}/plans`);
  const featuresResource = useAdminResource(`${ADMIN_API_ROOT}/features`);
  const plans = asArray(plansResource.data, ['plans', 'items']).filter((item) => item.isActive !== false && item.active !== false);
  const features = asArray(featuresResource.data, ['features', 'items']);
  const selectedPlan = plans.find((plan) => plan.id === form.subscription.planId);

  const totals = useMemo(() => {
    const base = Number(form.subscription.implementationFee || 0) + Number(form.subscription.subscriptionPrice || 0);
    const discount = Number(form.subscription.discount || 0);
    const taxable = Math.max(base - discount, 0);
    const tax = taxable * (Number(form.subscription.taxRate || 0) / 100);
    return { base, discount, tax, total: taxable + tax };
  }, [form.subscription]);

  const update = (section, key, value) => {
    setForm((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
    setErrors((current) => ({ ...current, [`${section}.${key}`]: '' }));
  };

  const choosePlan = (planId) => {
    const plan = plans.find((item) => item.id === planId);
    const price = form.subscription.billingCycle === 'annual' ? plan?.annualPrice : plan?.monthlyPrice;
    const rawPlanFeatures = asArray(plan?.currentVersion?.features || plan?.features, ['items']);
    const planFeatures = rawPlanFeatures.filter((feature) => typeof feature === 'string' || (feature.enabled !== false && !feature.isAddOn && !feature.isAddon)).map((feature) => typeof feature === 'string' ? feature : feature.key || feature.code || feature.featureKey).filter(Boolean);
    setForm((current) => ({
      ...current,
      subscription: { ...current.subscription, planId, subscriptionPrice: Number(price || 0) },
      limits: {
        ...current.limits,
        maxUsers: plan?.maxUsers ?? current.limits.maxUsers,
        maxBranches: plan?.maxBranches ?? current.limits.maxBranches,
        maxBeds: plan?.maxBeds ?? current.limits.maxBeds,
        storageLimitGb: plan?.storageLimitMb ? Math.max(Math.round(Number(plan.storageLimitMb) / 1024), 1) : (plan?.storageLimitGb ?? plan?.storageLimit ?? current.limits.storageLimitGb),
        enabledModules: planFeatures.length ? planFeatures : current.limits.enabledModules,
      },
    }));
  };

  const chooseBillingCycle = (billingCycle) => {
    update('subscription', 'billingCycle', billingCycle);
    const price = billingCycle === 'annual' ? selectedPlan?.annualPrice : selectedPlan?.monthlyPrice;
    if (selectedPlan) update('subscription', 'subscriptionPrice', Number(price || 0));
  };

  const validateStep = () => {
    const nextErrors = {};
    (requiredByStep[step] || []).forEach(([section, key]) => {
      if (!String(form[section][key] ?? '').trim()) nextErrors[`${section}.${key}`] = 'This field is required.';
    });
    if (step === 0 && form.hospital.code && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.hospital.code)) nextErrors['hospital.code'] = 'Use lowercase letters, numbers, and single hyphens only.';
    if (step === 3 && !strongTemporaryPassword.test(form.administrator.temporaryPassword)) nextErrors['administrator.temporaryPassword'] = 'Use 10–128 characters with uppercase, lowercase, a number, and a special character.';
    if (step === 2 && !form.limits.enabledModules.length) nextErrors['limits.enabledModules'] = 'Enable at least one module.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      notify('Please complete the highlighted fields.', 'warning');
      return false;
    }
    return true;
  };

  const nextStep = () => {
    if (validateStep()) setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const toggleModule = (moduleKey) => {
    const enabled = new Set(form.limits.enabledModules);
    if (enabled.has(moduleKey)) enabled.delete(moduleKey); else enabled.add(moduleKey);
    update('limits', 'enabledModules', [...enabled]);
  };

  const toggleAddon = (addonKey) => {
    const enabled = new Set(form.limits.optionalAddons);
    if (enabled.has(addonKey)) enabled.delete(addonKey); else enabled.add(addonKey);
    update('limits', 'optionalAddons', [...enabled]);
  };

  const createHospital = async () => {
    setSubmitting(true);
    try {
      const response = await api.post(`${ADMIN_API_ROOT}/hospitals`, {
        hospital: { ...form.hospital, numberOfBeds: Number(form.hospital.numberOfBeds), numberOfBranches: Number(form.hospital.numberOfBranches) },
        subscription: {
          ...form.subscription,
          billingCycle: form.subscription.billingCycle.toUpperCase(),
          trialDays: Number(form.subscription.trialDays), implementationFee: Number(form.subscription.implementationFee),
          subscriptionPrice: Number(form.subscription.subscriptionPrice), discount: Number(form.subscription.discount),
          taxRate: Number(form.subscription.taxRate), invoiceDueDays: Number(form.subscription.invoiceDueDays), gracePeriodDays: Number(form.subscription.gracePeriodDays),
        },
        limits: {
          maxUsers: Number(form.limits.maxUsers), maxBranches: Number(form.limits.maxBranches), maxBeds: Number(form.limits.maxBeds),
          storageLimitMb: Number(form.limits.storageLimitGb) * 1024,
          enabledModules: form.limits.enabledModules,
          addOns: form.limits.optionalAddons,
        },
        administrator: {
          fullName: form.administrator.fullName,
          email: form.administrator.email,
          mobile: form.administrator.mobile,
          temporaryPassword: form.administrator.temporaryPassword,
          roleKey: 'hospital_admin',
          mustChangePassword: form.administrator.requirePasswordChange,
        },
      });
      const payload = unwrapApi(response);
      setResult(payload);
      notify(`${form.hospital.name} was onboarded successfully.`);
    } catch (error) {
      const message = apiErrorMessage(error, 'Hospital onboarding failed.');
      notify(message, 'error');
      setErrors({ submit: message });
    } finally {
      setSubmitting(false);
    }
  };

  if (plansResource.loading) return <LoadingState label="Preparing hospital onboarding…" />;
  if (plansResource.error) return <ErrorState message={plansResource.error} onRetry={plansResource.reload} />;
  if (result) return <OnboardingConfirmation result={result} form={form} onView={() => navigate(`/super-admin/hospitals/${result.hospital?.id || result.id}`)} />;

  return (
    <>
      <PageHeader eyebrow="HOSPITAL ONBOARDING" title="Add hospital" description="Create a secure tenant, administrator, subscription, limits, and initial invoices in one guided workflow.">
        <Link className="sa-button sa-button--secondary" to="/super-admin/hospitals"><ArrowLeft size={16} />Cancel</Link>
      </PageHeader>

      <ol className="sa-stepper" aria-label="Hospital onboarding progress">
        {steps.map(([label, Icon], index) => <li key={label} className={`${index === step ? 'sa-stepper__active' : ''} ${index < step ? 'sa-stepper__complete' : ''}`}><span>{index < step ? <Check size={16} /> : <Icon size={16} />}</span><div><small>Step {index + 1}</small><strong>{label}</strong></div></li>)}
      </ol>

      <section className="sa-panel sa-onboarding-card">
        {step === 0 && <HospitalDetails form={form.hospital} errors={errors} update={update} />}
        {step === 1 && <SubscriptionDetails form={form.subscription} errors={errors} plans={plans} selectedPlan={selectedPlan} choosePlan={choosePlan} chooseBillingCycle={chooseBillingCycle} update={update} totals={totals} />}
        {step === 2 && <LimitsModules form={form.limits} errors={errors} features={features} selectedPlan={selectedPlan} update={update} toggleModule={toggleModule} toggleAddon={toggleAddon} />}
        {step === 3 && <AdministratorDetails form={form.administrator} errors={errors} update={update} hospitalEmail={form.hospital.primaryContactEmail || form.hospital.email} />}
        {step === 4 && <Review form={form} plan={selectedPlan} totals={totals} submitError={errors.submit} />}
        <footer className="sa-onboarding-actions">
          <button className="sa-button sa-button--secondary" type="button" disabled={step === 0 || submitting} onClick={() => setStep((current) => current - 1)}><ArrowLeft size={16} />Back</button>
          <span>Step {step + 1} of {steps.length}</span>
          {step < steps.length - 1 ? <button className="sa-button sa-button--primary" type="button" onClick={nextStep}>Continue<ArrowRight size={16} /></button> : <button className="sa-button sa-button--primary" type="button" disabled={submitting} onClick={createHospital}>{submitting ? <><LoaderCircle className="sa-spin" size={16} />Creating hospital…</> : <><CheckCircle2 size={16} />Create hospital</>}</button>}
        </footer>
      </section>
    </>
  );
}

function SectionHeading({ title, description }) { return <div className="sa-section-heading"><h2>{title}</h2><p>{description}</p></div>; }

function HospitalDetails({ form, errors, update }) {
  return <><SectionHeading title="Hospital details" description="Legal identity, capacity, and the primary commercial contact." /><div className="sa-form-grid sa-form-grid--three">
    <Field label="Hospital name" error={errors['hospital.name']}><input value={form.name} onChange={(e) => update('hospital', 'name', e.target.value)} required /></Field>
    <Field label="Hospital code / slug" error={errors['hospital.code']} hint="Used at login; for example, akram-medical"><input value={form.code} onChange={(e) => update('hospital', 'code', e.target.value.toLowerCase().replace(/\s+/g, '-'))} required /></Field>
    <Field label="Legal business name" error={errors['hospital.legalBusinessName']}><input value={form.legalBusinessName} onChange={(e) => update('hospital', 'legalBusinessName', e.target.value)} required /></Field>
    <Field label="NTN"><input value={form.ntn} onChange={(e) => update('hospital', 'ntn', e.target.value)} /></Field>
    <Field label="Hospital email" error={errors['hospital.email']}><input type="email" value={form.email} onChange={(e) => update('hospital', 'email', e.target.value)} required /></Field>
    <Field label="Hospital phone" error={errors['hospital.phone']}><input value={form.phone} onChange={(e) => update('hospital', 'phone', e.target.value)} placeholder="042-12345678" required /></Field>
    <Field className="sa-field--span-3" label="Address" error={errors['hospital.address']}><input value={form.address} onChange={(e) => update('hospital', 'address', e.target.value)} required /></Field>
    <Field label="City" error={errors['hospital.city']}><input value={form.city} onChange={(e) => update('hospital', 'city', e.target.value)} required /></Field>
    <Field label="Province" error={errors['hospital.province']}><select value={form.province} onChange={(e) => update('hospital', 'province', e.target.value)}>{['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu and Kashmir'].map((value) => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Number of beds"><input type="number" min="0" value={form.numberOfBeds} onChange={(e) => update('hospital', 'numberOfBeds', e.target.value)} /></Field>
    <Field label="Number of branches"><input type="number" min="1" value={form.numberOfBranches} onChange={(e) => update('hospital', 'numberOfBranches', e.target.value)} /></Field>
    <Field label="Primary contact name" error={errors['hospital.primaryContactName']}><input value={form.primaryContactName} onChange={(e) => update('hospital', 'primaryContactName', e.target.value)} required /></Field>
    <Field label="Contact designation"><input value={form.primaryContactDesignation} onChange={(e) => update('hospital', 'primaryContactDesignation', e.target.value)} /></Field>
    <Field label="Contact mobile" error={errors['hospital.primaryContactMobile']}><input value={form.primaryContactMobile} onChange={(e) => update('hospital', 'primaryContactMobile', e.target.value)} required /></Field>
    <Field label="Contact email" error={errors['hospital.primaryContactEmail']}><input type="email" value={form.primaryContactEmail} onChange={(e) => update('hospital', 'primaryContactEmail', e.target.value)} required /></Field>
  </div></>;
}

function SubscriptionDetails({ form, errors, plans, selectedPlan, choosePlan, chooseBillingCycle, update, totals }) {
  return <><SectionHeading title="Subscription configuration" description="Set the recurring commercial terms separately from the one-time implementation fee." />
    <div className="sa-plan-selector">{plans.map((plan) => <button type="button" className={form.planId === plan.id ? 'sa-plan-option sa-plan-option--active' : 'sa-plan-option'} key={plan.id} onClick={() => choosePlan(plan.id)}><span>{plan.name}</span><strong>{formatPkr(plan.monthlyPrice)}<small>/month</small></strong><small>{plan.description || `${plan.maxUsers || 'Custom'} users · ${plan.maxBranches || 'Custom'} branches`}</small>{form.planId === plan.id && <CheckCircle2 size={18} />}</button>)}</div>
    {errors['subscription.planId'] && <p className="sa-form-error">{errors['subscription.planId']}</p>}
    <div className="sa-form-grid sa-form-grid--three">
      <Field label="Billing cycle"><select value={form.billingCycle} onChange={(e) => chooseBillingCycle(e.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></Field>
      <Field label="Subscription start date" error={errors['subscription.startDate']}><input type="date" value={form.startDate} onChange={(e) => update('subscription', 'startDate', e.target.value)} /></Field>
      <Field label="Trial period (days)"><input type="number" min="0" max="90" value={form.trialDays} onChange={(e) => update('subscription', 'trialDays', e.target.value)} /></Field>
      <Field label="One-time implementation fee"><input type="number" min="0" value={form.implementationFee} onChange={(e) => update('subscription', 'implementationFee', e.target.value)} /></Field>
      <Field label={`${titleCase(form.billingCycle)} subscription price`}><input type="number" min="0" value={form.subscriptionPrice} onChange={(e) => update('subscription', 'subscriptionPrice', e.target.value)} /></Field>
      <Field label="Discount (PKR)"><input type="number" min="0" value={form.discount} onChange={(e) => update('subscription', 'discount', e.target.value)} /></Field>
      <Field label="Tax rate (%)"><input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(e) => update('subscription', 'taxRate', e.target.value)} /></Field>
      <Field label="Invoice due days"><input type="number" min="0" value={form.invoiceDueDays} onChange={(e) => update('subscription', 'invoiceDueDays', e.target.value)} /></Field>
      <Field label="Grace-period days"><input type="number" min="0" value={form.gracePeriodDays} onChange={(e) => update('subscription', 'gracePeriodDays', e.target.value)} /></Field>
      <Field label="Contract renewal date"><input type="date" value={form.contractRenewalDate} onChange={(e) => update('subscription', 'contractRenewalDate', e.target.value)} /></Field>
      <Field className="sa-field--span-2" label="Commercial notes"><textarea rows="3" value={form.notes} onChange={(e) => update('subscription', 'notes', e.target.value)} /></Field>
    </div>
    <div className="sa-cost-preview"><div><span>Implementation fee</span><strong>{formatPkr(form.implementationFee)}</strong></div><div><span>First {form.billingCycle} subscription</span><strong>{formatPkr(form.subscriptionPrice)}</strong></div><div><span>Discount & tax</span><strong>{formatPkr(totals.tax - totals.discount)}</strong></div><div className="sa-cost-preview__total"><span>Initial invoiced total</span><strong>{formatPkr(totals.total)}</strong></div><small>The implementation fee and subscription charge are generated as separate invoices.</small></div>
    {selectedPlan && <p className="sa-inline-note"><CheckCircle2 size={15} />{selectedPlan.name} defaults have been applied; you can override limits and modules in the next step.</p>}
  </>;
}

function LimitsModules({ form, errors, features, selectedPlan, update, toggleModule, toggleAddon }) {
  const planFeatures = asArray(selectedPlan?.currentVersion?.features || selectedPlan?.addOns, ['items']);
  const addons = planFeatures.filter((item) => typeof item !== 'string' && (item.isAddOn || item.isAddon || item.type === 'addon'));
  const availableModules = features.length
    ? features.map((item) => typeof item === 'string' ? item : item.key || item.code || item.featureKey).filter(Boolean)
    : moduleOptions;
  return <><SectionHeading title="Limits and modules" description="Plan permissions are configurable. Hospital roles apply an additional permission layer." /><div className="sa-form-grid sa-form-grid--four sa-limits-grid">
    <Field label="Maximum users"><input type="number" min="1" value={form.maxUsers} onChange={(e) => update('limits', 'maxUsers', e.target.value)} /></Field>
    <Field label="Maximum branches"><input type="number" min="1" value={form.maxBranches} onChange={(e) => update('limits', 'maxBranches', e.target.value)} /></Field>
    <Field label="Maximum beds"><input type="number" min="0" value={form.maxBeds} onChange={(e) => update('limits', 'maxBeds', e.target.value)} /></Field>
    <Field label="Storage limit (GB)"><input type="number" min="1" value={form.storageLimitGb} onChange={(e) => update('limits', 'storageLimitGb', e.target.value)} /></Field>
  </div><h3 className="sa-subheading">Enabled modules</h3>{errors['limits.enabledModules'] && <p className="sa-form-error">{errors['limits.enabledModules']}</p>}<div className="sa-module-grid">{availableModules.map((key) => <label className="sa-toggle-card" key={key}><span><strong>{titleCase(key)}</strong><small>{form.enabledModules.includes(key) ? 'Enabled for this hospital' : 'Not included'}</small></span><input type="checkbox" checked={form.enabledModules.includes(key)} onChange={() => toggleModule(key)} /><i /></label>)}</div>
    {addons.length > 0 && <><h3 className="sa-subheading">Optional add-ons</h3><div className="sa-addon-grid">{addons.map((addon) => { const key = addon.featureKey || addon.key || addon.code || addon.id; return <label className="sa-checkbox-card" key={key}><input type="checkbox" checked={form.optionalAddons.includes(key)} onChange={() => toggleAddon(key)} /><span><strong>{addon.name || titleCase(key)}</strong><small>{addon.description || 'Optional paid add-on'}</small></span></label>; })}</div></>}
  </>;
}

function AdministratorDetails({ form, errors, update, hospitalEmail }) {
  return <><SectionHeading title="Hospital administrator" description="Create the tenant’s first administrator. The temporary password is hashed by the backend and must be changed at first login." /><div className="sa-security-callout"><UserCog size={22} /><div><strong>Secure account creation</strong><span>Do not send the temporary password over an insecure channel. AI Finora never stores it as plain text.</span></div></div><div className="sa-form-grid">
    <Field label="Full name" error={errors['administrator.fullName']}><input value={form.fullName} onChange={(e) => update('administrator', 'fullName', e.target.value)} required /></Field>
    <Field label="Email" error={errors['administrator.email']} hint={hospitalEmail ? `Hospital contact: ${hospitalEmail}` : ''}><input type="email" value={form.email} onChange={(e) => update('administrator', 'email', e.target.value)} required /></Field>
    <Field label="Mobile" error={errors['administrator.mobile']}><input value={form.mobile} onChange={(e) => update('administrator', 'mobile', e.target.value)} required /></Field>
    <Field label="Temporary password" error={errors['administrator.temporaryPassword']} hint="10–128 characters with uppercase, lowercase, a number, and a special character."><input type="password" autoComplete="new-password" minLength="10" maxLength="128" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{10,128}" value={form.temporaryPassword} onChange={(e) => update('administrator', 'temporaryPassword', e.target.value)} required /></Field>
    <Field label="Role"><select value={form.role} onChange={(e) => update('administrator', 'role', e.target.value)}><option value="HOSPITAL_ADMIN">Hospital Admin</option></select></Field>
    <label className="sa-checkbox-card sa-checkbox-card--inline"><input type="checkbox" checked={form.requirePasswordChange} onChange={(e) => update('administrator', 'requirePasswordChange', e.target.checked)} /><span><strong>Require password change at first login</strong><small>Recommended for every newly created account</small></span></label>
  </div></>;
}

function Review({ form, plan, totals, submitError }) {
  const sections = [
    ['Hospital', [['Name', form.hospital.name], ['Code', form.hospital.code], ['Legal business', form.hospital.legalBusinessName], ['Location', `${form.hospital.city}, ${form.hospital.province}`], ['Capacity', `${form.hospital.numberOfBeds} beds · ${form.hospital.numberOfBranches} branches`], ['Primary contact', `${form.hospital.primaryContactName} · ${form.hospital.primaryContactEmail}`]]],
    ['Subscription', [['Plan', plan?.name], ['Billing cycle', titleCase(form.subscription.billingCycle)], ['Starts', formatDate(form.subscription.startDate)], ['Trial', `${form.subscription.trialDays} days`], ['Implementation fee', formatPkr(form.subscription.implementationFee)], ['Subscription price', formatPkr(form.subscription.subscriptionPrice)], ['Initial total', formatPkr(totals.total)]]],
    ['Limits & access', [['Users', form.limits.maxUsers], ['Branches', form.limits.maxBranches], ['Beds', form.limits.maxBeds], ['Storage', `${form.limits.storageLimitGb} GB`], ['Enabled modules', form.limits.enabledModules.length], ['Add-ons', form.limits.optionalAddons.length || 'None']]],
    ['Administrator', [['Name', form.administrator.fullName], ['Email', form.administrator.email], ['Mobile', form.administrator.mobile], ['Role', titleCase(form.administrator.role)], ['Password change', form.administrator.requirePasswordChange ? 'Required' : 'Not required']]],
  ];
  return <><SectionHeading title="Review and create" description="Confirm the tenant, administrator, subscription, invoice, and permission settings." /><div className="sa-review-grid">{sections.map(([title, rows]) => <article className="sa-review-card" key={title}><h3>{title}</h3>{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</article>)}</div><div className="sa-review-checklist"><CheckCircle2 size={20} /><div><strong>On creation, AI Finora will:</strong><span>Create the tenant and hospital administrator, assign plan features and limits, create the subscription, generate separate implementation-fee and subscription invoices when applicable, send in-app notifications, and write an immutable audit log.</span></div></div>{submitError && <p className="sa-submit-error" role="alert">{submitError}</p>}</>;
}

function OnboardingConfirmation({ result, form, onView }) {
  const invoices = asArray(result.invoices, ['items']);
  return <div className="sa-confirmation-page"><div className="sa-confirmation-icon"><CheckCircle2 size={36} /></div><span className="sa-eyebrow">ONBOARDING COMPLETE</span><h1>{form.hospital.name} is ready</h1><p>The hospital tenant, first administrator, subscription, feature permissions, invoices, notifications, and audit entry were created.</p><div className="sa-confirmation-summary"><div><span>Hospital code</span><strong>{form.hospital.code}</strong></div><div><span>Administrator</span><strong>{form.administrator.email}</strong></div><div><span>Subscription status</span><StatusBadge status={result.subscription?.status || (form.subscription.trialDays > 0 ? 'trialing' : 'pending_payment')} /></div><div><span>Invoices generated</span><strong>{invoices.length || result.invoiceCount || 0}</strong></div></div>{invoices.length > 0 && <div className="sa-confirmation-invoices">{invoices.map((invoice) => <div key={invoice.id}><span>{invoice.invoiceNumber || invoice.number} · {titleCase(invoice.type)}</span><strong>{formatPkr(invoice.total)}</strong></div>)}</div>}<div className="sa-confirmation-actions"><button className="sa-button sa-button--secondary" type="button" onClick={() => window.print()}><Printer size={16} />Print onboarding details</button><button className="sa-button sa-button--primary" type="button" onClick={onView}>Open hospital account<ArrowRight size={16} /></button></div><small>For security, the temporary password is not shown on this confirmation. Share it through an approved secure channel.</small></div>;
}
