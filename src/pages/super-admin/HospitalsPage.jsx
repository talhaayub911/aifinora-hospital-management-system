import { useMemo, useState } from 'react';
import {
  Building2,
  Eye,
  FileText,
  Filter,
  KeyRound,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  WalletCards,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
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
  unwrapApi,
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

function hospitalPlan(hospital) {
  return hospital.planName || hospital.plan?.name || hospital.currentSubscription?.plan?.name || hospital.subscription?.plan?.name || '—';
}

function hospitalStatus(hospital) {
  return String(hospital.subscriptionStatus || hospital.currentSubscription?.status || hospital.subscription?.status || hospital.status || 'unknown').toLowerCase();
}

export default function HospitalsPage() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [editHospital, setEditHospital] = useState(null);
  const [accessAction, setAccessAction] = useState(null);
  const [supportHospital, setSupportHospital] = useState(null);
  const [supportWarningAccepted, setSupportWarningAccepted] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { startSupportAccess } = useAuth();
  const { notify } = useAdminToast();

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (plan) params.set('plan', plan);
    const suffix = params.toString();
    return `${ADMIN_API_ROOT}/hospitals${suffix ? `?${suffix}` : ''}`;
  }, [search, status, plan]);

  const resource = useAdminResource(path);
  const planResource = useAdminResource(`${ADMIN_API_ROOT}/plans`);
  const settingsResource = useAdminResource(`${ADMIN_API_ROOT}/settings`);
  const hospitals = asArray(resource.data, ['hospitals', 'items']);
  const plans = asArray(planResource.data, ['plans', 'items']);
  const configuredSupportDuration = Number(settingsResource.data?.settings?.defaultSupportAccessMinutes);
  const supportDurationMinutes = Number.isInteger(configuredSupportDuration) && configuredSupportDuration >= 5 && configuredSupportDuration <= 240 ? configuredSupportDuration : 60;

  const submitSearch = (event) => {
    event.preventDefault();
    setSearch(query.trim());
  };

  const resetFilters = () => {
    setQuery('');
    setSearch('');
    setStatus('');
    setPlan('');
  };

  const saveHospital = async (event) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api.patch(`${ADMIN_API_ROOT}/hospitals/${editHospital.id}`, Object.fromEntries(form.entries()));
      notify(`${editHospital.name} was updated.`);
      setEditHospital(null);
      resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'Hospital update failed.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeAccessState = async () => {
    if (!reason.trim()) {
      notify('A reason is required for access-changing actions.', 'warning');
      return;
    }
    setBusy(true);
    try {
      await api.post(`${ADMIN_API_ROOT}/hospitals/${accessAction.hospital.id}/access-state`, {
        status: accessAction.status.toUpperCase(),
        reason: reason.trim(),
      });
      notify(`${accessAction.hospital.name} is now ${accessAction.status.replace('_', ' ')}.`);
      setAccessAction(null);
      setReason('');
      resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'Unable to change hospital access.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const beginSupportAccess = async () => {
    if (reason.trim().length < 5) {
      notify('Enter a support reason of at least five characters before continuing.', 'warning');
      return;
    }
    if (!supportWarningAccepted) {
      notify('Confirm the visible support-access warning before continuing.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const result = await startSupportAccess({ hospitalId: supportHospital.id, reason: reason.trim(), warningAccepted: true });
      const session = unwrapApi(result);
      notify(`Audited support access started for ${supportHospital.name}.`, 'warning');
      setSupportHospital(null);
      setSupportWarningAccepted(false);
      setReason('');
      navigate(`/hospital${session?.hospitalId ? `?supportSession=${session.id || ''}` : ''}`);
    } catch (error) {
      notify(apiErrorMessage(error, 'Support access could not be started.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Hospitals" description="Search tenants, inspect subscriptions, and control access without exposing clinical records.">
        <Link className="sa-button sa-button--primary" to="/super-admin/hospitals/new"><Plus size={16} />Add hospital</Link>
      </PageHeader>

      <section className="sa-panel">
        <form className="sa-toolbar" onSubmit={submitSearch}>
          <label className="sa-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hospital, code, contact, email, or city" aria-label="Search hospitals" /><button type="submit">Search</button></label>
          <div className="sa-toolbar__filters">
            <Filter size={16} aria-hidden="true" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by subscription status">
              <option value="">All statuses</option>
              {['trialing', 'pending_payment', 'active', 'past_due', 'grace_period', 'read_only', 'paused', 'suspended', 'canceled'].map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
            </select>
            <select value={plan} onChange={(event) => setPlan(event.target.value)} aria-label="Filter by plan">
              <option value="">All plans</option>
              {plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {(search || status || plan) && <button className="sa-button sa-button--quiet sa-button--small" type="button" onClick={resetFilters}><RotateCcw size={14} />Reset</button>}
          </div>
        </form>

        {resource.loading && <LoadingState label="Loading hospital accounts…" />}
        {!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}
        {!resource.loading && !resource.error && !hospitals.length && <EmptyState icon={Building2} title="No hospitals found" description={search || status || plan ? 'Try broadening your search or clearing filters.' : 'Create the first hospital tenant to get started.'} action={<Link className="sa-button sa-button--primary" to="/super-admin/hospitals/new"><Plus size={16} />Add hospital</Link>} />}
        {!resource.loading && !resource.error && hospitals.length > 0 && (
          <TableShell>
            <table className="sa-table">
              <thead><tr><th>Hospital</th><th>Primary contact</th><th>Location & capacity</th><th>Plan</th><th>Status</th><th>Renewal</th><th>Outstanding</th><th>Created</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {hospitals.map((hospital) => {
                  const subscription = hospital.currentSubscription || hospital.subscription || {};
                  return (
                    <tr key={hospital.id}>
                      <td><Link className="sa-table__title" to={`/super-admin/hospitals/${hospital.id}`}>{hospital.name}</Link><span>{hospital.code || hospital.slug}</span></td>
                      <td><strong>{hospital.primaryContactName || hospital.contactPerson || '—'}</strong><span>{hospital.email || hospital.primaryContactEmail || '—'}<br />{hospital.phone || hospital.primaryContactMobile || ''}</span></td>
                      <td><strong>{hospital.city || '—'}, {hospital.province || 'Pakistan'}</strong><span>{hospital.numberOfBeds ?? hospital.bedCount ?? 0} beds · {hospital.numberOfBranches ?? hospital._count?.branches ?? 1} branches</span></td>
                      <td><strong>{hospitalPlan(hospital)}</strong><span>{subscription.billingCycle || hospital.billingCycle || '—'}</span></td>
                      <td><StatusBadge status={hospitalStatus(hospital)} /></td>
                      <td><strong>{formatDate(subscription.nextBillingDate || hospital.nextBillingDate)}</strong><span>{subscription.contractRenewalDate ? `Contract ${formatDate(subscription.contractRenewalDate)}` : ''}</span></td>
                      <td><strong className={Number(hospital.outstandingAmount || subscription.outstandingAmount) > 0 ? 'sa-text-danger' : ''}>{formatPkr(hospital.outstandingAmount || subscription.outstandingAmount)}</strong></td>
                      <td>{formatDate(hospital.createdAt)}</td>
                      <td>
                        <ActionMenu>
                          <Link to={`/super-admin/hospitals/${hospital.id}`}><Eye size={15} />View hospital</Link>
                          <button type="button" onClick={() => setEditHospital(hospital)}><Pencil size={15} />Edit hospital</button>
                          <button type="button" onClick={() => navigate(`/super-admin/subscriptions?hospital=${hospital.id}`)}><CircleDollarSignIcon />Manage subscription</button>
                          <button type="button" onClick={() => navigate(`/super-admin/invoices?hospital=${hospital.id}`)}><FileText size={15} />View invoices</button>
                          <button type="button" onClick={() => navigate(`/super-admin/invoices?hospital=${hospital.id}&recordPayment=1`)}><WalletCards size={15} />Record payment</button>
                          <button type="button" onClick={() => navigate(`/super-admin/payment-verification?hospital=${hospital.id}`)}><WalletCards size={15} />Verify bank payment</button>
                          <button type="button" onClick={() => { setReason(''); setSupportWarningAccepted(false); setSupportHospital(hospital); }}><KeyRound size={15} />Start support access</button>
                          {hospitalStatus(hospital) !== 'read_only' && <button type="button" onClick={() => { setReason(''); setAccessAction({ hospital, status: 'read_only' }); }}><Eye size={15} />Make read-only</button>}
                          {hospitalStatus(hospital) !== 'suspended' && <button className="sa-menu-danger" type="button" onClick={() => { setReason(''); setAccessAction({ hospital, status: 'suspended' }); }}><ShieldAlert size={15} />Suspend account</button>}
                          {!['active', 'trialing'].includes(hospitalStatus(hospital)) && <button type="button" onClick={() => { setReason(''); setAccessAction({ hospital, status: 'active' }); }}><RotateCcw size={15} />Reactivate account</button>}
                        </ActionMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}
      </section>

      {editHospital && (
        <Modal title={`Edit ${editHospital.name}`} description="Update account details. Subscription changes are managed separately." onClose={() => setEditHospital(null)} footer={(
          <><button className="sa-button sa-button--secondary" type="button" onClick={() => setEditHospital(null)}>Cancel</button><button className="sa-button sa-button--primary" type="submit" form="sa-edit-hospital" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></>
        )}>
          <form id="sa-edit-hospital" className="sa-form-grid" onSubmit={saveHospital}>
            <Field label="Hospital name"><input name="name" defaultValue={editHospital.name} required /></Field>
            <Field label="Hospital code"><input name="code" defaultValue={editHospital.code || editHospital.slug} required /></Field>
            <Field label="Email"><input name="email" type="email" defaultValue={editHospital.email} required /></Field>
            <Field label="Phone"><input name="phone" defaultValue={editHospital.phone} required /></Field>
            <Field label="City"><input name="city" defaultValue={editHospital.city} required /></Field>
            <Field label="Province"><input name="province" defaultValue={editHospital.province} required /></Field>
            <Field label="Primary contact"><input name="primaryContactName" defaultValue={editHospital.primaryContactName || editHospital.contactPerson} /></Field>
            <Field label="Primary contact mobile"><input name="primaryContactMobile" defaultValue={editHospital.primaryContactMobile} /></Field>
          </form>
        </Modal>
      )}

      {accessAction && (
        <Modal title={`${accessAction.status === 'active' ? 'Reactivate' : accessAction.status === 'suspended' ? 'Suspend' : 'Apply read-only mode to'} ${accessAction.hospital.name}?`} description="This changes what hospital users can do and creates an immutable audit entry." onClose={() => !busy && setAccessAction(null)} footer={(
          <><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setAccessAction(null)}>Cancel</button><button className={`sa-button ${accessAction.status === 'suspended' ? 'sa-button--danger' : 'sa-button--primary'}`} type="button" disabled={busy} onClick={changeAccessState}>{busy ? 'Applying…' : 'Confirm change'}</button></>
        )}>
          <div className="sa-warning-box"><ShieldAlert size={20} /><p><strong>Access-changing action</strong><span>Existing hospital and patient data will not be deleted. The account owner will see the appropriate access notice.</span></p></div>
          <Field label="Reason (required)"><textarea rows="4" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this change is being made" /></Field>
        </Modal>
      )}

      {supportHospital && (
        <Modal title={`Start support access for ${supportHospital.name}?`} description="Support access is visible to the hospital and every action is logged." onClose={() => !busy && setSupportHospital(null)} footer={(
          <><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setSupportHospital(null)}>Cancel</button><button className="sa-button sa-button--warning" type="button" disabled={busy || !supportWarningAccepted || reason.trim().length < 5} onClick={beginSupportAccess}>{busy ? 'Starting…' : `Start ${supportDurationMinutes}-minute session`}</button></>
        )}>
          <div className="sa-warning-box"><KeyRound size={20} /><p><strong>Audited, time-limited access</strong><span>Only use support access with an explicit reason. A persistent banner will remain visible for the session.</span></p></div>
          <Field label="Support reason (required)"><textarea rows="4" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: Investigating invoice posting issue reported in ticket SUP-104" /></Field>
          <label className="sa-checkbox-card sa-checkbox-card--inline"><input type="checkbox" checked={supportWarningAccepted} onChange={(event) => setSupportWarningAccepted(event.target.checked)} /><span><strong>I understand and accept the support-access warning</strong><small>The session is visible, read-only, time-limited, and audited. I have an authorised support reason.</small></span></label>
        </Modal>
      )}
    </>
  );
}

function CircleDollarSignIcon() {
  return <span className="sa-inline-currency" aria-hidden="true">₨</span>;
}
