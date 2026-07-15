import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Check,
  Eye,
  FileText,
  Save,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import {
  ADMIN_API_ROOT,
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
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

const tabs = [
  ['overview', 'Overview'],
  ['subscription', 'Subscription'],
  ['modules', 'Modules'],
  ['users', 'Users'],
  ['branches', 'Branches'],
  ['invoices', 'Subscription invoices'],
  ['payments', 'Subscription payments'],
  ['proofs', 'Bank-transfer proofs'],
  ['logs', 'Activity logs'],
  ['notes', 'Support notes'],
];

const allModules = [
  'dashboard', 'patient_registration', 'appointments', 'admissions', 'doctors', 'departments',
  'charge_master', 'opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing',
  'laboratory_billing', 'insurance_billing', 'corporate_billing', 'payments', 'refunds', 'receipts',
  'financial_reports', 'pharmacy_inventory', 'multi_branch_management', 'api_access',
];

function valueFrom(hospital, ...paths) {
  for (const path of paths) {
    let value = hospital;
    for (const key of path.split('.')) value = value?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

export default function HospitalDetailPage() {
  const { hospitalId } = useParams();
  const [activeTab, setActiveTab] = useState('overview');
  const [accessModal, setAccessModal] = useState(null);
  const [reason, setReason] = useState('');
  const [moduleChange, setModuleChange] = useState(null);
  const [moduleReason, setModuleReason] = useState('');
  const [busy, setBusy] = useState(false);
  const resource = useAdminResource(`${ADMIN_API_ROOT}/hospitals/${hospitalId}`);
  const { notify } = useAdminToast();
  const hospital = resource.data?.hospital || resource.data || {};
  const subscription = hospital.currentSubscription || hospital.subscription || hospital.subscriptions?.find((item) => item.isCurrent) || hospital.subscriptions?.[0] || {};
  const plan = subscription.plan || subscription.planVersion?.plan || hospital.plan || {};
  const status = String(subscription.status || hospital.subscriptionStatus || hospital.status || 'unknown').toLowerCase();

  const enabledModules = useMemo(() => {
    const source = hospital.enabledModules || hospital.features || subscription.features || plan.features || [];
    return new Set(source.map((item) => typeof item === 'string' ? item : item.key || item.code || item.name));
  }, [hospital.enabledModules, hospital.features, subscription.features, plan.features]);

  const changeAccess = async () => {
    if (!reason.trim()) {
      notify('A reason is required.', 'warning');
      return;
    }
    setBusy(true);
    try {
      await api.post(`${ADMIN_API_ROOT}/hospitals/${hospitalId}/access-state`, { status: accessModal.toUpperCase(), reason: reason.trim() });
      notify(`Hospital access changed to ${titleCase(accessModal)}.`);
      setAccessModal(null);
      setReason('');
      resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'Unable to update access state.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleModule = async () => {
    const moduleKey = moduleChange?.key;
    if (!moduleKey || moduleReason.trim().length < 3) return;
    setBusy(true);
    const next = new Set(enabledModules);
    if (next.has(moduleKey)) next.delete(moduleKey); else next.add(moduleKey);
    try {
      await api.patch(`${ADMIN_API_ROOT}/hospitals/${hospitalId}`, { enabledModules: [...next], reason: moduleReason.trim() });
      notify(`${titleCase(moduleKey)} ${next.has(moduleKey) ? 'enabled' : 'disabled'} for ${hospital.name}.`);
      setModuleChange(null);
      setModuleReason('');
      resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'Module permission could not be changed.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (resource.loading) return <LoadingState label="Loading hospital account…" />;
  if (resource.error) return <ErrorState message={resource.error} onRetry={resource.reload} />;

  return (
    <>
      <PageHeader eyebrow="TENANT ACCOUNT" title={hospital.name || 'Hospital detail'} description={`${hospital.code || hospital.slug || 'No code'} · ${hospital.city || 'Pakistan'}, ${hospital.province || ''}`}>
        <Link className="sa-button sa-button--secondary" to="/super-admin/hospitals"><ArrowLeft size={16} />All hospitals</Link>
        {status !== 'read_only' && <button className="sa-button sa-button--warning" type="button" onClick={() => { setReason(''); setAccessModal('read_only'); }}><Eye size={16} />Read-only</button>}
        {status === 'suspended' || status === 'read_only' ? <button className="sa-button sa-button--primary" type="button" onClick={() => { setReason(''); setAccessModal('active'); }}><Check size={16} />Reactivate</button> : <button className="sa-button sa-button--danger" type="button" onClick={() => { setReason(''); setAccessModal('suspended'); }}><ShieldAlert size={16} />Suspend</button>}
      </PageHeader>

      <section className="sa-hospital-hero">
        <span className="sa-hospital-hero__mark"><Building2 size={26} /></span>
        <div><span>Hospital account</span><h2>{hospital.name}</h2><p>{hospital.legalBusinessName || hospital.address || 'AI Finora hospital tenant'}</p></div>
        <div className="sa-hospital-hero__meta"><StatusBadge status={status} /><strong>{plan.name || hospital.planName || 'No plan assigned'}</strong><span>{titleCase(subscription.billingCycle || hospital.billingCycle || '')}</span></div>
      </section>

      <div className="sa-tabs" role="tablist" aria-label="Hospital account sections">
        {tabs.map(([key, label]) => <button type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'sa-tabs__active' : ''} key={key} onClick={() => setActiveTab(key)}>{label}</button>)}
      </div>

      {activeTab === 'overview' && <OverviewTab hospital={hospital} subscription={subscription} plan={plan} />}
      {activeTab === 'subscription' && <SubscriptionTab subscription={subscription} plan={plan} hospital={hospital} />}
      {activeTab === 'modules' && <ModulesTab enabledModules={enabledModules} onToggle={(moduleKey) => { setModuleReason(''); setModuleChange({ key: moduleKey, enabling: !enabledModules.has(moduleKey) }); }} />}
      {activeTab === 'users' && <EntityTable title="Hospital users" items={asArray(hospital.users, ['items'])} columns={[['name', 'Name'], ['email', 'Email'], ['role', 'Role'], ['status', 'Status']]} icon={Users} />}
      {activeTab === 'branches' && <EntityTable title="Branches" items={asArray(hospital.branches, ['items'])} columns={[['name', 'Branch'], ['code', 'Code'], ['city', 'City'], ['bedCount', 'Beds'], ['status', 'Status']]} icon={Building2} />}
      {activeTab === 'invoices' && <EntityTable title="Subscription invoices" items={asArray(hospital.subscriptionInvoices || hospital.invoices, ['items'])} columns={[['invoiceNumber', 'Invoice'], ['type', 'Type'], ['issueDate', 'Issued'], ['dueDate', 'Due'], ['total', 'Total'], ['status', 'Status']]} icon={FileText} currencyKeys={['total']} dateKeys={['issueDate', 'dueDate']} />}
      {activeTab === 'payments' && <EntityTable title="Subscription payments" items={asArray(hospital.subscriptionPayments || hospital.payments, ['items'])} columns={[['reference', 'Reference'], ['method', 'Method'], ['amount', 'Amount'], ['paidAt', 'Paid'], ['status', 'Status']]} currencyKeys={['amount']} dateKeys={['paidAt']} />}
      {activeTab === 'proofs' && <EntityTable title="Bank-transfer proofs" items={asArray(hospital.bankTransferProofs || hospital.paymentProofs, ['items'])} columns={[['transactionReference', 'Reference'], ['bankName', 'Bank'], ['claimedAmount', 'Claimed'], ['transferDate', 'Transfer date'], ['status', 'Status']]} currencyKeys={['claimedAmount']} dateKeys={['transferDate']} />}
      {activeTab === 'logs' && <EntityTable title="Hospital activity logs" items={asArray(hospital.auditLogs || hospital.activityLogs, ['items'])} columns={[['action', 'Action'], ['actorName', 'Actor'], ['reason', 'Reason'], ['createdAt', 'Date']]} dateKeys={['createdAt']} />}
      {activeTab === 'notes' && <SupportNotes hospital={hospital} hospitalId={hospitalId} onSaved={resource.reload} />}

      {moduleChange && (
        <Modal title={`${moduleChange.enabling ? 'Enable' : 'Disable'} ${titleCase(moduleChange.key)}?`} description="This changes the hospital's effective module access and will be written to the audit log." onClose={() => !busy && setModuleChange(null)} footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setModuleChange(null)}>Cancel</button><button className={`sa-button ${moduleChange.enabling ? 'sa-button--primary' : 'sa-button--danger'}`} type="button" disabled={busy || moduleReason.trim().length < 3} onClick={toggleModule}>{busy ? 'Applying…' : 'Confirm access change'}</button></>}>
          <Field label="Reason (required)"><textarea rows="4" value={moduleReason} onChange={(event) => setModuleReason(event.target.value)} /></Field>
        </Modal>
      )}

      {accessModal && (
        <Modal title={`${accessModal === 'active' ? 'Reactivate' : accessModal === 'suspended' ? 'Suspend' : 'Make read-only'} ${hospital.name}?`} description="This action affects hospital access immediately and will be written to the audit log." onClose={() => !busy && setAccessModal(null)} footer={(
          <><button className="sa-button sa-button--secondary" type="button" onClick={() => setAccessModal(null)} disabled={busy}>Cancel</button><button className={`sa-button ${accessModal === 'suspended' ? 'sa-button--danger' : 'sa-button--primary'}`} type="button" onClick={changeAccess} disabled={busy}>{busy ? 'Applying…' : 'Confirm'}</button></>
        )}>
          <div className="sa-warning-box"><ShieldAlert size={20} /><p><strong>Hospital records are retained</strong><span>This workflow never deletes hospital or patient data.</span></p></div>
          <Field label="Reason (required)"><textarea rows="4" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        </Modal>
      )}
    </>
  );
}

function OverviewTab({ hospital, subscription, plan }) {
  const items = [
    ['Hospital name', hospital.name],
    ['Hospital code', hospital.code || hospital.slug],
    ['Current plan', plan.name || hospital.planName],
    ['Subscription status', <StatusBadge status={subscription.status || hospital.subscriptionStatus} />],
    ['Billing cycle', titleCase(subscription.billingCycle || hospital.billingCycle)],
    ['Implementation fee', titleCase(subscription.implementationFeeStatus || hospital.implementationFeeStatus || 'pending')],
    ['Current period', `${formatDate(subscription.currentPeriodStart)} — ${formatDate(subscription.currentPeriodEnd)}`],
    ['Next billing date', formatDate(subscription.nextBillingDate || hospital.nextBillingDate)],
    ['Grace period ends', formatDate(subscription.gracePeriodEndDate || subscription.gracePeriodEndsAt)],
    ['Outstanding amount', formatPkr(subscription.outstandingAmount || hospital.outstandingAmount)],
  ];
  const usage = [
    ['Users', valueFrom(hospital, 'usage.users', '_count.users', 'userCount') || 0, valueFrom(hospital, 'limits.maxUsers', 'maxUsers', 'plan.maxUsers')],
    ['Branches', valueFrom(hospital, 'usage.branches', '_count.branches', 'branchCount') || 0, valueFrom(hospital, 'limits.maxBranches', 'maxBranches', 'plan.maxBranches')],
    ['Beds', valueFrom(hospital, 'usage.beds', 'numberOfBeds', 'bedCount') || 0, valueFrom(hospital, 'limits.maxBeds', 'maxBeds', 'plan.maxBeds')],
    ['Storage (GB)', valueFrom(hospital, 'usage.storageGb', 'storageUsedGb') || 0, valueFrom(hospital, 'limits.storageGb', 'storageLimitGb', 'plan.storageLimitGb')],
  ];
  return (
    <div className="sa-detail-layout">
      <section className="sa-panel"><div className="sa-panel__head"><div><h2>Account summary</h2><p>Commercial and access details</p></div></div><div className="sa-detail-grid">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div></section>
      <section className="sa-panel"><div className="sa-panel__head"><div><h2>Plan usage</h2><p>Current use against assigned limits</p></div></div><div className="sa-usage-list">{usage.map(([label, current, limit]) => { const numericLimit = Number(limit) || 0; const percentage = numericLimit ? Math.min((Number(current) / numericLimit) * 100, 100) : 0; return <div key={label}><div><span>{label}</span><strong>{current} / {numericLimit || 'Custom'}</strong></div><div className="sa-progress"><span style={{ width: `${percentage}%` }} /></div></div>; })}</div></section>
    </div>
  );
}

function SubscriptionTab({ subscription, plan, hospital }) {
  const details = [
    ['Plan', plan.name || hospital.planName], ['Status', titleCase(subscription.status || hospital.subscriptionStatus)],
    ['Billing cycle', titleCase(subscription.billingCycle)], ['Subscription price', formatPkr(subscription.price || subscription.subscriptionPrice)],
    ['Start date', formatDate(subscription.startDate)], ['Current period start', formatDate(subscription.currentPeriodStart)],
    ['Current period end', formatDate(subscription.currentPeriodEnd)], ['Next billing date', formatDate(subscription.nextBillingDate)],
    ['Invoice due days', subscription.invoiceDueDays], ['Grace-period days', subscription.gracePeriodDays],
    ['Contract renewal', formatDate(subscription.contractRenewalDate)], ['Implementation fee', formatPkr(subscription.implementationFee)],
  ];
  return <section className="sa-panel"><div className="sa-panel__head"><div><h2>Subscription configuration</h2><p>Current commercial terms and renewal schedule</p></div></div><div className="sa-detail-grid sa-detail-grid--three">{details.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div></section>;
}

function ModulesTab({ enabledModules, onToggle }) {
  return <section className="sa-panel"><div className="sa-panel__head"><div><h2>Enabled modules</h2><p>Access also remains subject to each hospital user’s role and subscription state.</p></div></div><div className="sa-module-grid">{allModules.map((moduleKey) => <label className="sa-toggle-card" key={moduleKey}><span><strong>{titleCase(moduleKey)}</strong><small>{enabledModules.has(moduleKey) ? 'Available to permitted roles' : 'Hidden and blocked by API'}</small></span><input type="checkbox" checked={enabledModules.has(moduleKey)} onChange={() => onToggle(moduleKey)} /><i /></label>)}</div></section>;
}

function EntityTable({ title, items, columns, icon: Icon, currencyKeys = [], dateKeys = [] }) {
  return <section className="sa-panel"><div className="sa-panel__head"><div><h2>{title}</h2><p>Hospital-scoped records visible to platform administrators</p></div></div>{items.length ? <TableShell><table className="sa-table"><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={item.id || index}>{columns.map(([key]) => { let value = item[key] ?? item.actor?.name ?? '—'; if (currencyKeys.includes(key)) value = formatPkr(value); if (dateKeys.includes(key)) value = formatDate(value, key === 'createdAt'); if (key === 'status') return <td key={key}><StatusBadge status={value} /></td>; return <td key={key}>{typeof value === 'object' ? JSON.stringify(value) : value}</td>; })}</tr>)}</tbody></table></TableShell> : <EmptyState icon={Icon} title={`No ${title.toLowerCase()}`} description="Records will appear here when available." />}</section>;
}

function SupportNotes({ hospital, hospitalId, onSaved }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useAdminToast();
  const notes = asArray(hospital.supportNotes, ['items']);
  const save = async (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.patch(`${ADMIN_API_ROOT}/hospitals/${hospitalId}`, { supportNote: note.trim() });
      notify('Support note added to the hospital account.');
      setNote('');
      onSaved();
    } catch (error) { notify(apiErrorMessage(error, 'Unable to save support note.'), 'error'); } finally { setBusy(false); }
  };
  return <section className="sa-panel"><div className="sa-panel__head"><div><h2>Support notes</h2><p>Internal operational notes; never store clinical data here.</p></div></div><form className="sa-note-composer" onSubmit={save}><Field label="New support note"><textarea rows="4" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add non-clinical account context…" /></Field><button className="sa-button sa-button--primary" type="submit" disabled={busy || !note.trim()}><Save size={16} />{busy ? 'Saving…' : 'Add note'}</button></form>{notes.length ? <div className="sa-note-list">{notes.map((item, index) => <article key={item.id || index}><p>{item.note || item.content}</p><span>{item.authorName || item.author?.name || 'Platform Admin'} · {formatDate(item.createdAt, true)}</span></article>)}</div> : <EmptyState title="No support notes" description="Account notes added by the support team will appear here." />}</section>;
}
