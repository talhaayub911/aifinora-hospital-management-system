import { useState } from 'react';
import {
  BadgeDollarSign,
  Check,
  Layers3,
  Pencil,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from '../../services/api.js';
import {
  ADMIN_API_ROOT,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  apiErrorMessage,
  asArray,
  formatPkr,
  titleCase,
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

const modules = [
  'dashboard', 'patient_registration', 'appointments', 'admissions', 'doctors', 'departments', 'charge_master',
  'opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing', 'laboratory_billing',
  'insurance_billing', 'corporate_billing', 'payments', 'refunds', 'receipts', 'financial_reports',
  'pharmacy_inventory', 'multi_branch_management', 'api_access',
];

const blankPlan = { name: '', code: '', description: '', monthlyPrice: 0, annualPrice: 0, defaultImplementationFee: 0, maxUsers: 10, maxBranches: 1, maxBeds: 30, storageLimitMb: 10240, features: [], addOns: [], isActive: true };

function normalizePlan(plan = blankPlan) {
  const version = plan.currentVersion || plan;
  const rawFeatures = version.features || plan.features || [];
  return {
    id: plan.id,
    name: plan.name || '', code: plan.code || '', description: plan.description || '', isActive: plan.isActive !== false,
    monthlyPrice: Number(version.monthlyPrice ?? plan.monthlyPrice ?? 0), annualPrice: Number(version.annualPrice ?? plan.annualPrice ?? 0),
    defaultImplementationFee: Number(version.defaultImplementationFee ?? 0), maxUsers: version.maxUsers ?? plan.maxUsers ?? '',
    maxBranches: version.maxBranches ?? plan.maxBranches ?? '', maxBeds: version.maxBeds ?? plan.maxBeds ?? '', storageLimitMb: version.storageLimitMb ?? plan.storageLimitMb ?? '',
    features: rawFeatures.filter((item) => typeof item === 'string' || (item.enabled !== false && !item.isAddOn)).map((item) => typeof item === 'string' ? item : item.featureKey).filter(Boolean),
    addOns: rawFeatures.filter((item) => typeof item !== 'string' && item.isAddOn).map((item) => item.featureKey).filter(Boolean),
  };
}

export default function PlansPage() {
  const resource = useAdminResource(`${ADMIN_API_ROOT}/plans`);
  const [editing, setEditing] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useAdminToast();
  const plans = asArray(resource.data, ['plans', 'items']);

  const savePlan = async (event) => {
    event.preventDefault();
    setBusy(true);
    const payload = {
      ...editing,
      monthlyPrice: Number(editing.monthlyPrice), annualPrice: Number(editing.annualPrice), defaultImplementationFee: Number(editing.defaultImplementationFee),
      maxUsers: editing.maxUsers === '' ? null : Number(editing.maxUsers), maxBranches: editing.maxBranches === '' ? null : Number(editing.maxBranches),
      maxBeds: editing.maxBeds === '' ? null : Number(editing.maxBeds), storageLimitMb: editing.storageLimitMb === '' ? null : Number(editing.storageLimitMb),
    };
    payload.features = [
      ...editing.features.map((featureKey) => ({ featureKey, enabled: true, isAddOn: false })),
      ...editing.addOns.filter((featureKey) => !editing.features.includes(featureKey)).map((featureKey) => ({ featureKey, enabled: true, isAddOn: true })),
    ];
    delete payload.id;
    delete payload.addOns;
    try {
      if (editing.id) await api.patch(`${ADMIN_API_ROOT}/plans/${editing.id}`, payload); else await api.post(`${ADMIN_API_ROOT}/plans`, payload);
      notify(`${editing.name} ${editing.id ? 'updated' : 'created'}. Existing hospital data and prior plan versions remain intact.`);
      setEditing(null);
      resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'Plan could not be saved.'), 'error');
    } finally { setBusy(false); }
  };

  const toggleActive = async () => {
    setBusy(true);
    try {
      await api.patch(`${ADMIN_API_ROOT}/plans/${confirmToggle.id}`, { isActive: !confirmToggle.isActive });
      notify(`${confirmToggle.name} was ${confirmToggle.isActive ? 'deactivated' : 'activated'}.`);
      setConfirmToggle(null);
      resource.reload();
    } catch (error) { notify(apiErrorMessage(error, 'Plan status could not be changed.'), 'error'); } finally { setBusy(false); }
  };

  return <>
    <PageHeader title="Subscription plans" description="Configure pricing, limits, modules, and add-ons without removing historical hospital entitlements."><button className="sa-button sa-button--primary" type="button" onClick={() => setEditing({ ...blankPlan })}><Plus size={16} />Add plan</button></PageHeader>
    {resource.loading && <LoadingState label="Loading subscription plans…" />}
    {!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}
    {!resource.loading && !resource.error && !plans.length && <EmptyState icon={BadgeDollarSign} title="No subscription plans" description="Create a plan to begin onboarding hospitals." action={<button className="sa-button sa-button--primary" type="button" onClick={() => setEditing({ ...blankPlan })}><Plus size={16} />Create plan</button>} />}
    {!resource.loading && !resource.error && plans.length > 0 && <div className="sa-plans-grid">{plans.map((plan) => { const normalized = normalizePlan(plan); return <article className={`sa-plan-card ${!normalized.isActive ? 'sa-plan-card--inactive' : ''}`} key={plan.id}>
      <header><div><StatusBadge status={normalized.isActive ? 'active' : 'inactive'} /><h2>{normalized.name}</h2><p>{normalized.description || 'Configurable AI Finora subscription plan'}</p></div><span className="sa-plan-card__code">{normalized.code}</span></header>
      <div className="sa-plan-prices"><div><span>Monthly</span><strong>{formatPkr(normalized.monthlyPrice)}</strong></div><div><span>Annual</span><strong>{formatPkr(normalized.annualPrice)}</strong></div></div>
      <div className="sa-plan-limits"><div><Users size={16} /><span>Users</span><strong>{normalized.maxUsers || 'Custom'}</strong></div><div><Layers3 size={16} /><span>Branches</span><strong>{normalized.maxBranches || 'Custom'}</strong></div><div><ShieldCheck size={16} /><span>Beds</span><strong>{normalized.maxBeds || 'Custom'}</strong></div></div>
      <div className="sa-plan-features"><strong>{normalized.features.length} enabled modules</strong><div>{normalized.features.slice(0, 6).map((feature) => <span key={feature}><Check size={12} />{titleCase(feature)}</span>)}{normalized.features.length > 6 && <span>+{normalized.features.length - 6} more</span>}</div></div>
      <footer><button className="sa-button sa-button--secondary sa-button--small" type="button" onClick={() => setEditing(normalized)}><Pencil size={14} />Edit plan</button><button className={`sa-button sa-button--small ${normalized.isActive ? 'sa-button--quiet-danger' : 'sa-button--quiet'}`} type="button" onClick={() => setConfirmToggle(normalized)}>{normalized.isActive ? 'Deactivate' : 'Activate'}</button></footer>
    </article>; })}</div>}

    {editing && <Modal size="large" title={editing.id ? `Edit ${editing.name}` : 'Create subscription plan'} description="Saving creates a new commercial configuration while assigned hospitals retain their history." onClose={() => !busy && setEditing(null)} footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="sa-button sa-button--primary" type="submit" form="sa-plan-form" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button></>}>
      <form id="sa-plan-form" onSubmit={savePlan}><div className="sa-form-grid sa-form-grid--three">
        <Field label="Plan name"><input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="Code"><input required value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })} /></Field><Field label="Status"><select value={editing.isActive ? 'active' : 'inactive'} onChange={(e) => setEditing({ ...editing, isActive: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
        <Field className="sa-field--span-3" label="Description"><textarea rows="3" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
        <Field label="Monthly price"><input type="number" min="0" required value={editing.monthlyPrice} onChange={(e) => setEditing({ ...editing, monthlyPrice: e.target.value })} /></Field><Field label="Annual price"><input type="number" min="0" required value={editing.annualPrice} onChange={(e) => setEditing({ ...editing, annualPrice: e.target.value })} /></Field><Field label="Default implementation fee"><input type="number" min="0" value={editing.defaultImplementationFee} onChange={(e) => setEditing({ ...editing, defaultImplementationFee: e.target.value })} /></Field>
        <Field label="Maximum users" hint="Leave blank for custom"><input type="number" min="1" value={editing.maxUsers} onChange={(e) => setEditing({ ...editing, maxUsers: e.target.value })} /></Field><Field label="Maximum branches"><input type="number" min="1" value={editing.maxBranches} onChange={(e) => setEditing({ ...editing, maxBranches: e.target.value })} /></Field><Field label="Maximum beds"><input type="number" min="0" value={editing.maxBeds} onChange={(e) => setEditing({ ...editing, maxBeds: e.target.value })} /></Field><Field label="Storage limit (MB)"><input type="number" min="1" value={editing.storageLimitMb} onChange={(e) => setEditing({ ...editing, storageLimitMb: e.target.value })} /></Field>
      </div><h3 className="sa-subheading">Included modules</h3><div className="sa-module-grid">{modules.map((moduleKey) => <label className="sa-toggle-card" key={moduleKey}><span><strong>{titleCase(moduleKey)}</strong><small>{editing.features.includes(moduleKey) ? 'Included' : 'Not included'}</small></span><input type="checkbox" checked={editing.features.includes(moduleKey)} onChange={() => { const next = new Set(editing.features); if (next.has(moduleKey)) next.delete(moduleKey); else next.add(moduleKey); setEditing({ ...editing, features: [...next] }); }} /><i /></label>)}</div><h3 className="sa-subheading">Optional add-ons</h3><div className="sa-addon-grid">{['pharmacy_inventory', 'multi_branch_management', 'api_access', 'priority_support'].map((addon) => <label className="sa-checkbox-card" key={addon}><input type="checkbox" checked={editing.addOns.includes(addon)} onChange={() => { const next = new Set(editing.addOns); if (next.has(addon)) next.delete(addon); else next.add(addon); setEditing({ ...editing, addOns: [...next] }); }} /><span><strong>{titleCase(addon)}</strong><small>Available as an optional add-on</small></span></label>)}</div></form>
    </Modal>}

    <ConfirmDialog open={Boolean(confirmToggle)} title={`${confirmToggle?.isActive ? 'Deactivate' : 'Activate'} ${confirmToggle?.name}?`} description={confirmToggle?.isActive ? 'New hospitals will no longer be able to select this plan. Existing subscriptions and historical data are retained.' : 'The plan will become available for new subscriptions.'} confirmLabel={confirmToggle?.isActive ? 'Deactivate plan' : 'Activate plan'} tone={confirmToggle?.isActive ? 'danger' : 'primary'} busy={busy} onCancel={() => setConfirmToggle(null)} onConfirm={toggleActive} />
  </>;
}
