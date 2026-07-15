import { useMemo, useState } from 'react';
import { CreditCard, Eye, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import {
  ADMIN_API_ROOT,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  TableShell,
  asArray,
  formatDate,
  formatPkr,
  titleCase,
  useAdminResource,
} from '../../components/super-admin/AdminUI.jsx';

export default function SafepayTransactionsPage() {
  const resource = useAdminResource(`${ADMIN_API_ROOT}/safepay-transactions`);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const payload = resource.data || {};
  const allTransactions = asArray(payload, ['transactions', 'items', 'payments']);
  const provider = payload.provider || payload.configuration || {};
  const configured = payload.configured ?? payload.safepayConfigured ?? provider.credentialsConfigured ?? false;
  const demoMode = payload.demoMode ?? provider.demoMode ?? !configured;
  const transactions = useMemo(() => allTransactions.filter((transaction) => {
    const needle = query.toLowerCase();
    return (!needle || [transaction.hospitalName, transaction.hospital?.name, transaction.providerReference, transaction.invoiceNumber].some((value) => String(value || '').toLowerCase().includes(needle))) && (!status || String(transaction.status || '').toLowerCase() === status);
  }), [allTransactions, query, status]);

  return <>
    <PageHeader title="Safepay transactions" description="Hosted-checkout activity and verified webhook processing for optional Safepay payments."><button className="sa-button sa-button--secondary" type="button" onClick={resource.reload}><RefreshCw size={16} />Refresh status</button></PageHeader>
    <div className={`sa-provider-banner ${configured ? 'sa-provider-banner--configured' : ''}`}><span><CreditCard size={22} /></span><div><strong>{configured ? 'Safepay provider configured' : 'Safepay Demo — no merchant credentials configured'}</strong><p>{configured ? 'Payment links are created by the backend. Only a verified webhook can activate or extend a subscription.' : 'Demo checkout may be simulated, but no real charge or payment completion is claimed.'}</p></div><StatusBadge status={demoMode ? 'demo' : 'sandbox'} /></div>
    <section className="sa-panel"><div className="sa-toolbar"><label className="sa-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hospital, invoice, or Safepay reference" aria-label="Search Safepay transactions" /></label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['created', 'pending', 'completed', 'failed', 'refunded', 'demo'].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></div>
      {resource.loading && <LoadingState label="Loading Safepay transactions…" />}{!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}{!resource.loading && !resource.error && !transactions.length && <EmptyState icon={CreditCard} title="No Safepay transactions" description={configured ? 'Hosted checkout transactions will appear here.' : 'Enable demo mode or configure valid sandbox credentials to create a payment link.'} />}
      {!resource.loading && !resource.error && transactions.length > 0 && <TableShell><table className="sa-table"><thead><tr><th>Provider reference</th><th>Hospital</th><th>Invoice</th><th>Amount</th><th>Environment</th><th>Webhook</th><th>Status</th><th>Created</th><th aria-label="Actions" /></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><strong>{item.providerReference || item.reference}</strong><span>{item.providerEventId || ''}</span></td><td>{item.hospitalName || item.hospital?.name}</td><td>{item.invoiceNumber || item.invoice?.invoiceNumber}</td><td>{formatPkr(item.amount)}</td><td><StatusBadge status={item.environment || (demoMode ? 'demo' : 'sandbox')} /></td><td>{item.webhookProcessedAt ? <span className="sa-verified"><ShieldCheck size={14} />Verified</span> : 'Awaiting'}</td><td><StatusBadge status={item.status} /></td><td>{formatDate(item.createdAt, true)}</td><td><button className="sa-button sa-button--quiet sa-button--small" type="button" onClick={() => setSelected(item)}><Eye size={14} />Details</button></td></tr>)}</tbody></table></TableShell>}
    </section>
    {selected && <Modal title={selected.providerReference || 'Safepay transaction'} description="Provider and webhook processing detail" onClose={() => setSelected(null)} footer={<button className="sa-button sa-button--secondary" type="button" onClick={() => setSelected(null)}>Close</button>}><div className="sa-detail-grid">{[['Hospital', selected.hospitalName || selected.hospital?.name], ['Invoice', selected.invoiceNumber || selected.invoice?.invoiceNumber], ['Amount', formatPkr(selected.amount)], ['Provider status', titleCase(selected.status)], ['Provider event ID', selected.providerEventId], ['Webhook processing', selected.webhookProcessedAt ? `Verified ${formatDate(selected.webhookProcessedAt, true)}` : 'Not processed'], ['Idempotency key', selected.idempotencyKey || selected.providerEventId], ['Created', formatDate(selected.createdAt, true)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div><div className="sa-security-callout"><ShieldCheck size={21} /><div><strong>Server-authoritative payment state</strong><span>A frontend success redirect never activates a subscription. Webhook signatures and duplicate event IDs are checked by the backend.</span></div></div></Modal>}
  </>;
}
