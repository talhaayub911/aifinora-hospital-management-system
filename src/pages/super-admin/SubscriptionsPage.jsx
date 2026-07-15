import { useMemo, useState } from 'react';
import {
  CalendarClock,
  Play,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import {
  ADMIN_API_ROOT,
  ActionMenu,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  TableShell,
  apiErrorMessage,
  asArray,
  formatDate,
  formatPkr,
  titleCase,
  unwrapApi,
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

const statuses = ['trialing', 'pending_payment', 'active', 'past_due', 'grace_period', 'read_only', 'paused', 'suspended', 'canceled'];
const subscriptionModules = ['patient_registration', 'appointments', 'admissions', 'doctors', 'departments', 'charge_master', 'opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing', 'laboratory_billing', 'insurance_billing', 'corporate_billing', 'payments', 'refunds', 'receipts', 'financial_reports', 'pharmacy_inventory', 'multi_branch_management', 'api_access'];

export default function SubscriptionsPage() {
  const [searchParams] = useSearchParams();
  const hospitalFilter = searchParams.get('hospital') || '';
  const [statusFilter, setStatusFilter] = useState('');
  const [processOpen, setProcessOpen] = useState(false);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState(null);
  const [editing, setEditing] = useState(null);
  const [reason, setReason] = useState('');
  const resource = useAdminResource(`${ADMIN_API_ROOT}/subscriptions`);
  const plansResource = useAdminResource(`${ADMIN_API_ROOT}/plans`);
  const { notify } = useAdminToast();
  const allSubscriptions = asArray(resource.data, ['subscriptions', 'items']);
  const plans = asArray(plansResource.data, ['plans', 'items']).filter((plan) => plan.isActive !== false);
  const subscriptions = useMemo(() => allSubscriptions.filter((item) => {
    const matchesHospital = !hospitalFilter || String(item.hospitalId || item.hospital?.id) === hospitalFilter;
    return matchesHospital && (!statusFilter || String(item.status).toLowerCase() === statusFilter);
  }), [allSubscriptions, hospitalFilter, statusFilter]);

  const runProcessing = async () => {
    setProcessing(true);
    try {
      const response = await api.post(`${ADMIN_API_ROOT}/subscriptions/process`, { asOf });
      const result = unwrapApi(response) || {};
      setProcessResult(result);
      notify('Subscription processing completed. Duplicate renewal invoices were prevented.');
      resource.reload();
    } catch (error) { notify(apiErrorMessage(error, 'Subscription processing failed.'), 'error'); } finally { setProcessing(false); }
  };

  const updateSubscription = async () => {
    if (!reason.trim()) { notify('Enter a reason for this subscription change.', 'warning'); return; }
    setProcessing(true);
    try {
      await api.patch(`${ADMIN_API_ROOT}/subscriptions/${editing.id}`, {
        status: editing.nextStatus.toUpperCase(),
        planId: editing.planId || editing.planVersion?.plan?.id,
        billingCycle: String(editing.billingCycle).toUpperCase(),
        price: Number(editing.price || 0),
        invoiceDueDays: Number(editing.invoiceDueDays || 0),
        gracePeriodDays: Number(editing.gracePeriodDays || 0),
        maxUsers: editing.maxUsers == null || editing.maxUsers === '' ? null : Number(editing.maxUsers),
        maxBranches: editing.maxBranches == null || editing.maxBranches === '' ? null : Number(editing.maxBranches),
        maxBeds: editing.maxBeds == null || editing.maxBeds === '' ? null : Number(editing.maxBeds),
        storageLimitMb: editing.storageLimitMb == null || editing.storageLimitMb === '' ? null : Number(editing.storageLimitMb),
        enabledModules: editing.enabledModules || [],
        reason: reason.trim(),
      });
      notify(`${editing.hospitalName || editing.hospital?.name} subscription changed to ${titleCase(editing.nextStatus)}.`);
      setEditing(null); setReason(''); resource.reload();
    } catch (error) { notify(apiErrorMessage(error, 'Subscription could not be updated.'), 'error'); } finally { setProcessing(false); }
  };

  return <>
    <PageHeader title="Subscriptions" description="Monitor recurring terms, renewals, grace periods, and account access transitions.">
      <button className="sa-button sa-button--secondary" type="button" onClick={resource.reload}><RefreshCw size={16} />Refresh</button>
      <button className="sa-button sa-button--primary" type="button" onClick={() => { setProcessResult(null); setProcessOpen(true); }}><Play size={16} />Run subscription processing</button>
    </PageHeader>
    <section className="sa-panel">
      {hospitalFilter && <div className="sa-filter-notice"><CalendarClock size={16} /><span>Showing the current subscription for one hospital.</span><Link to="/super-admin/subscriptions">Clear hospital filter</Link></div>}
      <div className="sa-toolbar"><div className="sa-filter-tabs">{['', ...statuses].map((value) => <button type="button" className={statusFilter === value ? 'sa-filter-tab--active' : ''} key={value || 'all'} onClick={() => setStatusFilter(value)}>{value ? titleCase(value) : 'All'}{value && <span>{allSubscriptions.filter((item) => String(item.status).toLowerCase() === value).length}</span>}</button>)}</div></div>
      {resource.loading && <LoadingState label="Loading subscriptions…" />}{!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}
      {!resource.loading && !resource.error && !subscriptions.length && <EmptyState icon={CalendarClock} title="No subscriptions found" description="No subscriptions match this access state." />}
      {!resource.loading && !resource.error && subscriptions.length > 0 && <TableShell><table className="sa-table"><thead><tr><th>Hospital</th><th>Plan</th><th>Cycle</th><th>Current period</th><th>Next billing</th><th>Price</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{subscriptions.map((subscription) => <tr key={subscription.id}><td><Link className="sa-table__title" to={`/super-admin/hospitals/${subscription.hospitalId || subscription.hospital?.id}`}>{subscription.hospitalName || subscription.hospital?.name || 'Hospital'}</Link><span>{subscription.hospitalCode || subscription.hospital?.code}</span></td><td><strong>{subscription.planName || subscription.plan?.name || subscription.planVersion?.plan?.name}</strong><span>v{subscription.planVersion?.version || subscription.plan?.version || 1}</span></td><td>{titleCase(subscription.billingCycle)}</td><td>{formatDate(subscription.currentPeriodStart)}<span>to {formatDate(subscription.currentPeriodEnd)}</span></td><td>{formatDate(subscription.nextBillingDate)}</td><td>{formatPkr(subscription.price || subscription.subscriptionPrice)}</td><td><StatusBadge status={subscription.status} /></td><td><ActionMenu><button type="button" onClick={() => setEditing({ ...subscription, nextStatus: String(subscription.status).toLowerCase(), planId: subscription.planId || subscription.planVersion?.plan?.id || '', enabledModules: subscription.enabledModules || [] })}><Settings2 size={15} />Change status</button><Link to={`/super-admin/invoices?hospital=${subscription.hospitalId || subscription.hospital?.id}`}>View invoices</Link></ActionMenu></td></tr>)}</tbody></table></TableShell>}
    </section>

    {processOpen && <Modal title="Run subscription processing" description="Simulate the daily renewal and access-state service. Re-running the same date is idempotent." onClose={() => !processing && setProcessOpen(false)} footer={<><button className="sa-button sa-button--secondary" type="button" disabled={processing} onClick={() => setProcessOpen(false)}>Close</button><button className="sa-button sa-button--primary" type="button" disabled={processing} onClick={runProcessing}>{processing ? 'Processing…' : <><Play size={16} />Run processing</>}</button></>}>
      <Field label="Process subscriptions as of"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      <div className="sa-process-rules"><strong>Simulation rules</strong><span>7 days before renewal: invoice and notice</span><span>1 day overdue: past due</span><span>After grace period: read-only</span><span>Suspension always requires Super Admin review</span></div>
      {processResult && <div className="sa-process-result"><CheckResult label="Renewal invoices created" value={asArray(processResult.createdInvoices, ['items']).length || processResult.createdInvoiceCount || 0} /><CheckResult label="Access transitions" value={asArray(processResult.transitions, ['items']).length || processResult.transitionCount || 0} /><CheckResult label="Notifications created" value={asArray(processResult.notifications, ['items']).length || processResult.notificationCount || 0} /></div>}
    </Modal>}

    {editing && <Modal
      size="large"
      title={`Manage ${editing.hospitalName || editing.hospital?.name} subscription`}
      description="Commercial terms, plan limits, module access, and status changes take effect immediately and are recorded in the audit log."
      onClose={() => !processing && setEditing(null)}
      footer={<><button className="sa-button sa-button--secondary" type="button" disabled={processing} onClick={() => setEditing(null)}>Cancel</button><button className="sa-button sa-button--primary" type="button" disabled={processing} onClick={updateSubscription}>{processing ? 'Saving…' : 'Apply subscription changes'}</button></>}
    >
      <div className="sa-form-grid sa-form-grid--three">
        <Field label="Subscription status"><select value={editing.nextStatus} onChange={(event) => setEditing({ ...editing, nextStatus: event.target.value })}>{statuses.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></Field>
        <Field label="Plan"><select value={editing.planId || ''} onChange={(event) => setEditing({ ...editing, planId: event.target.value })}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field>
        <Field label="Billing cycle"><select value={String(editing.billingCycle || 'MONTHLY').toLowerCase()} onChange={(event) => setEditing({ ...editing, billingCycle: event.target.value })}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></Field>
        <Field label="Subscription price (PKR)"><input type="number" min="0" value={editing.price ?? 0} onChange={(event) => setEditing({ ...editing, price: event.target.value })} /></Field>
        <Field label="Invoice due days"><input type="number" min="0" value={editing.invoiceDueDays ?? 7} onChange={(event) => setEditing({ ...editing, invoiceDueDays: event.target.value })} /></Field>
        <Field label="Grace-period days"><input type="number" min="0" value={editing.gracePeriodDays ?? 7} onChange={(event) => setEditing({ ...editing, gracePeriodDays: event.target.value })} /></Field>
        <Field label="Maximum users"><input type="number" min="1" value={editing.maxUsers ?? ''} onChange={(event) => setEditing({ ...editing, maxUsers: event.target.value })} /></Field>
        <Field label="Maximum branches"><input type="number" min="1" value={editing.maxBranches ?? ''} onChange={(event) => setEditing({ ...editing, maxBranches: event.target.value })} /></Field>
        <Field label="Maximum beds"><input type="number" min="1" value={editing.maxBeds ?? ''} onChange={(event) => setEditing({ ...editing, maxBeds: event.target.value })} /></Field>
        <Field label="Storage limit (MB)"><input type="number" min="1" value={editing.storageLimitMb ?? ''} onChange={(event) => setEditing({ ...editing, storageLimitMb: event.target.value })} /></Field>
        <Field className="sa-field--span-3" label="Reason (required)"><textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </div>
      <h3 className="sa-subheading">Hospital module access</h3>
      <div className="sa-module-grid">{subscriptionModules.map((moduleKey) => <label className="sa-toggle-card" key={moduleKey}><span><strong>{titleCase(moduleKey)}</strong><small>{editing.enabledModules?.includes(moduleKey) ? 'Enabled' : 'Disabled'}</small></span><input type="checkbox" checked={Boolean(editing.enabledModules?.includes(moduleKey))} onChange={() => { const next = new Set(editing.enabledModules || []); if (next.has(moduleKey)) next.delete(moduleKey); else next.add(moduleKey); setEditing({ ...editing, enabledModules: [...next] }); }} /><i /></label>)}</div>
    </Modal>}
  </>;
}

function CheckResult({ label, value }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
