import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCheck2,
  Flag,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { Link, useSearchParams } from 'react-router-dom';
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

function ProofPreview({ proof }) {
  const url = proof.proofUrl || proof.receiptUrl || proof.fileUrl;
  if (!url) return <div><FileCheck2 size={36} /><strong>{proof.originalFileName || proof.fileName || 'Receipt uploaded'}</strong><span>Open through the authenticated evidence endpoint.</span></div>;
  const isPdf = String(proof.mimeType || '').toLowerCase().includes('pdf') || String(proof.originalFileName || '').toLowerCase().endsWith('.pdf');
  if (isPdf) return <object data={url} type="application/pdf" aria-label={`Bank transfer proof for ${proof.transactionReference}`}><a href={url} target="_blank" rel="noreferrer">Open PDF payment evidence</a></object>;
  return <img src={url} alt={`Bank transfer proof for ${proof.transactionReference}`} />;
}

export default function PaymentVerificationPage() {
  const [searchParams] = useSearchParams();
  const hospitalFilter = searchParams.get('hospital') || '';
  const resource = useAdminResource(`${ADMIN_API_ROOT}/payment-proofs`);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useAdminToast();
  const allProofs = asArray(resource.data, ['paymentProofs', 'proofs', 'items']);
  const proofs = useMemo(() => allProofs.filter((proof) => {
    const needle = query.toLowerCase();
    const matches = !needle || [proof.hospitalName, proof.hospital?.name, proof.invoiceNumber, proof.invoice?.invoiceNumber, proof.transactionReference, proof.bankName].some((value) => String(value || '').toLowerCase().includes(needle));
    const matchesHospital = !hospitalFilter || String(proof.hospitalId || proof.hospital?.id) === hospitalFilter;
    return matchesHospital && matches && (!status || String(proof.status).toLowerCase() === status);
  }), [allProofs, hospitalFilter, query, status]);

  const act = async (nextAction, proof = selected) => {
    if (['reject', 'duplicate', 'request-info'].includes(nextAction) && !reason.trim()) { notify('A reason or information request is required for this action.', 'warning'); return; }
    setBusy(true);
    try {
      const payload = nextAction === 'request-info' ? { message: reason.trim() } : ['reject', 'duplicate'].includes(nextAction) ? { reason: reason.trim() } : {};
      await api.post(`${ADMIN_API_ROOT}/payment-proofs/${proof.id}/${nextAction}`, payload);
      const messages = { 'under-review': 'Payment proof marked under review.', approve: 'Payment approved. Invoice, receipt, subscription, notification, and audit log were updated.', reject: 'Payment proof rejected. The hospital can resubmit.', duplicate: 'Payment proof flagged as a possible duplicate.', 'request-info': 'The hospital was asked for additional payment information.' };
      notify(messages[nextAction] || 'Payment proof updated.', nextAction === 'reject' || nextAction === 'duplicate' ? 'warning' : 'success');
      setAction(null); setReason(''); setSelected(null); resource.reload();
    } catch (error) { notify(apiErrorMessage(error, 'Payment proof could not be updated.'), 'error'); } finally { setBusy(false); }
  };

  const selectedStatus = String(selected?.status || '').toLowerCase();

  return <>
    <PageHeader title="Payment verification" description="Review manual bank-transfer evidence before any invoice or subscription is activated."><span className="sa-queue-count"><FileCheck2 size={17} />{allProofs.filter((proof) => ['pending', 'under_review'].includes(String(proof.status).toLowerCase())).length} awaiting decision</span></PageHeader>
    <section className="sa-panel">
      {hospitalFilter && <div className="sa-filter-notice"><FileCheck2 size={16} /><span>Showing payment proofs for one hospital.</span><Link to="/super-admin/payment-verification">Clear hospital filter</Link></div>}
      <div className="sa-toolbar"><label className="sa-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hospital, invoice, bank, or transaction reference" aria-label="Search payment proofs" /></label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['pending', 'under_review', 'approved', 'rejected', 'duplicate'].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></div>
      {resource.loading && <LoadingState label="Loading bank-transfer proofs…" />}{!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}{!resource.loading && !resource.error && !proofs.length && <EmptyState icon={FileCheck2} title="Verification queue is clear" description="Submitted bank-transfer proofs will appear here." />}
      {!resource.loading && !resource.error && proofs.length > 0 && <TableShell><table className="sa-table"><thead><tr><th>Hospital / invoice</th><th>Claimed</th><th>Invoice balance</th><th>Bank / reference</th><th>Transfer date</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead><tbody>{proofs.map((proof) => <tr key={proof.id}><td><strong>{proof.hospitalName || proof.hospital?.name}</strong><span>{proof.invoiceNumber || proof.invoice?.invoiceNumber}</span></td><td><strong>{formatPkr(proof.claimedAmount || proof.amount)}</strong></td><td>{formatPkr(proof.invoiceBalance ?? proof.invoice?.outstandingBalance)}</td><td><strong>{proof.bankName}</strong><span>{proof.transactionReference}</span></td><td>{formatDate(proof.transferDate)}</td><td>{formatDate(proof.submittedAt || proof.createdAt, true)}</td><td><StatusBadge status={proof.status} /></td><td><div className="sa-row-actions"><button className="sa-button sa-button--quiet sa-button--small" type="button" onClick={() => setSelected(proof)}><Eye size={14} />Review</button>{String(proof.status).toLowerCase() === 'pending' && <button className="sa-button sa-button--quiet sa-button--small" type="button" onClick={() => act('under-review', proof)}>Take review</button>}</div></td></tr>)}</tbody></table></TableShell>}
    </section>

    {selected && <Modal size="large" title={`Review ${selected.transactionReference}`} description={`${selected.hospitalName || selected.hospital?.name} · ${selected.invoiceNumber || selected.invoice?.invoiceNumber}`} onClose={() => !busy && setSelected(null)} footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setSelected(null)}>Close</button>{selectedStatus === 'pending' && <button className="sa-button sa-button--warning" type="button" disabled={busy} onClick={() => act('under-review')}><ShieldCheck size={16} />Mark under review</button>}{['pending', 'under_review'].includes(selectedStatus) && <><button className="sa-button sa-button--warning" type="button" disabled={busy} onClick={() => { setReason(''); setAction('request-info'); }}><AlertTriangle size={16} />Request information</button><button className="sa-button sa-button--quiet-danger" type="button" disabled={busy} onClick={() => { setReason(''); setAction('duplicate'); }}><Flag size={16} />Possible duplicate</button><button className="sa-button sa-button--danger" type="button" disabled={busy} onClick={() => { setReason(''); setAction('reject'); }}><XCircle size={16} />Reject</button><button className="sa-button sa-button--primary" type="button" disabled={busy} onClick={() => setAction('approve')}><CheckCircle2 size={16} />Approve payment</button></>}</>}>
      <div className="sa-proof-layout"><div className="sa-proof-details">{[['Hospital', selected.hospitalName || selected.hospital?.name], ['Invoice', selected.invoiceNumber || selected.invoice?.invoiceNumber], ['Claimed amount', formatPkr(selected.claimedAmount || selected.amount)], ['Invoice balance', formatPkr(selected.invoiceBalance ?? selected.invoice?.outstandingBalance)], ['Bank', selected.bankName], ['Transaction reference', selected.transactionReference], ['Transfer date', formatDate(selected.transferDate)], ['Submitted', formatDate(selected.submittedAt || selected.createdAt, true)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div><div className="sa-proof-image"><span>Protected payment evidence</span><ProofPreview proof={selected} /><small>This file is not stored as an unrestricted public asset.</small></div></div>
      {selected.rejectionReason && <div className="sa-warning-box"><AlertTriangle size={20} /><p><strong>Previous rejection reason</strong><span>{selected.rejectionReason}</span></p></div>}
    </Modal>}

    {action && <Modal
      title={action === 'approve' ? 'Approve this bank payment?' : action === 'reject' ? 'Reject this payment proof?' : action === 'request-info' ? 'Request additional information?' : 'Flag as possible duplicate?'}
      description={action === 'approve' ? 'Approval records a subscription payment, recalculates the invoice, activates or extends the subscription as applicable, creates a receipt and notification, and writes an audit log.' : action === 'request-info' ? 'The hospital will receive an in-app notification and the proof will remain under review.' : 'The subscription will not be extended by this proof.'}
      onClose={() => !busy && setAction(null)}
      footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</button><button className={`sa-button ${action === 'approve' ? 'sa-button--primary' : action === 'request-info' ? 'sa-button--warning' : 'sa-button--danger'}`} type="button" disabled={busy} onClick={() => act(action)}>{busy ? 'Processing…' : action === 'approve' ? 'Approve and apply payment' : action === 'reject' ? 'Reject proof' : action === 'request-info' ? 'Send information request' : 'Flag duplicate'}</button></>}
    >
      {action === 'approve' ? <div className="sa-approval-summary"><CheckCircle2 size={26} /><div><strong>{formatPkr(selected?.claimedAmount || selected?.amount)}</strong><span>Reference {selected?.transactionReference}</span></div><p>The backend prevents this transaction reference from being approved more than once.</p></div> : <Field label={action === 'request-info' ? 'Information requested (required)' : 'Reason (required)'}><textarea rows="4" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action === 'reject' ? 'Explain what is missing or invalid so the hospital can resubmit.' : action === 'request-info' ? 'Describe the additional receipt details or clarification needed.' : 'Describe the duplicate transaction reference or matching payment.'} /></Field>}
    </Modal>}
  </>;
}
