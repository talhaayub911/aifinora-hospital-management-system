import { useMemo, useState } from 'react';
import {
  CircleDollarSign,
  CreditCard,
  Eye,
  FilePlus2,
  FileText,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
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
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

const invoiceTypes = [
  'IMPLEMENTATION_FEE',
  'MONTHLY_SUBSCRIPTION',
  'ANNUAL_SUBSCRIPTION',
  'ADDITIONAL_USER_CHARGES',
  'ADDITIONAL_BRANCH_CHARGES',
  'ADD_ON_MODULE_CHARGES',
  'CUSTOMISATION_CHARGES',
  'TRAINING_CHARGES',
  'SUPPORT_CHARGES',
];

const openStatuses = new Set(['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (value, days) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const emptyLine = () => ({ description: '', quantity: 1, unitAmount: '' });
const normalizedStatus = (invoice) => String(invoice.status || '').toUpperCase();
const invoiceBalance = (invoice) => Math.max(Number(invoice.outstandingBalance ?? Number(invoice.total || 0) - Number(invoice.paidAmount || 0)), 0);

export default function InvoicesPage() {
  const [searchParams] = useSearchParams();
  const hospitalFilter = searchParams.get('hospital') || '';
  const resource = useAdminResource(`${ADMIN_API_ROOT}/invoices`);
  const hospitalsResource = useAdminResource(`${ADMIN_API_ROOT}/hospitals`);
  const { notify } = useAdminToast();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [creditInvoice, setCreditInvoice] = useState(null);
  const [transition, setTransition] = useState(null);
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);

  const allInvoices = asArray(resource.data, ['invoices', 'items']);
  const hospitals = asArray(hospitalsResource.data, ['hospitals', 'items']);
  const visibleInvoices = useMemo(() => allInvoices.filter((invoice) => {
    const needle = query.trim().toLowerCase();
    const searchable = [invoice.invoiceNumber, invoice.hospitalName, invoice.hospitalCode, invoice.type, invoice.invoiceType].join(' ').toLowerCase();
    const matchesHospital = !hospitalFilter || String(invoice.hospitalId) === hospitalFilter;
    const matchesStatus = !statusFilter || normalizedStatus(invoice) === statusFilter;
    const matchesType = !typeFilter || String(invoice.invoiceType || invoice.type).toUpperCase() === typeFilter;
    return matchesHospital && matchesStatus && matchesType && (!needle || searchable.includes(needle));
  }), [allInvoices, hospitalFilter, query, statusFilter, typeFilter]);

  const refresh = async () => {
    await Promise.all([resource.reload(), hospitalsResource.reload()]);
  };

  const runAction = async (request, success, close) => {
    setBusy(true);
    try {
      await request();
      notify(success);
      close();
      await resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'The invoice could not be updated.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const createInvoice = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const usableLines = lines.map((line) => ({
      description: line.description.trim(),
      quantity: Number(line.quantity),
      unitAmount: Number(line.unitAmount),
    })).filter((line) => line.description && line.quantity > 0 && line.unitAmount >= 0);
    if (usableLines.length !== lines.length) {
      notify('Complete every invoice line with a description, positive quantity, and valid amount.', 'warning');
      return;
    }
    const issueDate = form.get('issueDate');
    const dueDate = form.get('dueDate');
    if (dueDate < issueDate) {
      notify('The due date cannot be before the issue date.', 'warning');
      return;
    }
    const payload = {
      hospitalId: form.get('hospitalId'),
      invoiceType: form.get('invoiceType'),
      issueDate,
      dueDate,
      billingPeriodStart: form.get('billingPeriodStart') || null,
      billingPeriodEnd: form.get('billingPeriodEnd') || null,
      discount: Number(form.get('discount') || 0),
      taxRate: Number(form.get('taxRate') || 0),
      status: form.get('status'),
      paymentInstructions: form.get('paymentInstructions') || undefined,
      items: usableLines,
    };
    await runAction(
      () => api.post(`${ADMIN_API_ROOT}/invoices`, payload),
      'Subscription invoice created successfully.',
      () => { setCreateOpen(false); setLines([emptyLine()]); },
    );
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount'));
    if (amount <= 0 || amount > invoiceBalance(paymentInvoice)) {
      notify('Payment must be positive and no greater than the outstanding balance.', 'warning');
      return;
    }
    await runAction(
      () => api.post(`${ADMIN_API_ROOT}/invoices/${paymentInvoice.id}/payments`, {
        amount,
        provider: form.get('provider'),
        reference: form.get('reference'),
        paidAt: form.get('paidAt'),
        notes: form.get('notes') || undefined,
      }),
      'Payment recorded and invoice balance recalculated.',
      () => setPaymentInvoice(null),
    );
  };

  const createCredit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount'));
    if (amount <= 0 || amount > invoiceBalance(creditInvoice)) {
      notify('Credit must be positive and no greater than the outstanding balance.', 'warning');
      return;
    }
    await runAction(
      () => api.post(`${ADMIN_API_ROOT}/invoices/${creditInvoice.id}/credit-notes`, {
        amount,
        reason: form.get('reason'),
      }),
      'Credit note created and applied to the source invoice.',
      () => setCreditInvoice(null),
    );
  };

  const updateStatus = async (event) => {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    await runAction(
      () => api.patch(`${ADMIN_API_ROOT}/invoices/${transition.invoice.id}/status`, {
        status: transition.status,
        reason: reason || undefined,
      }),
      `Invoice changed to ${titleCase(transition.status)}.`,
      () => setTransition(null),
    );
  };

  return (
    <>
      <PageHeader title="Subscription invoices" description="Issue SaaS invoices, record verified offline payments, apply credits, and preserve a controlled billing history.">
        <button className="sa-button sa-button--secondary" type="button" onClick={refresh}><RefreshCw size={16} />Refresh</button>
        <button className="sa-button sa-button--primary" type="button" onClick={() => setCreateOpen(true)}><FilePlus2 size={16} />Create invoice</button>
      </PageHeader>

      <section className="sa-panel">
        {hospitalFilter && <div className="sa-filter-notice"><FileText size={16} /><span>Showing invoices for one hospital.</span><Link to="/super-admin/invoices">Clear hospital filter</Link></div>}
        <div className="sa-toolbar">
          <label className="sa-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Invoice, hospital, code, or type" aria-label="Search subscription invoices" /></label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter invoices by status">
            <option value="">All statuses</option>
            {['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'VOID', 'CREDITED'].map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
          </select>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter invoices by type">
            <option value="">All invoice types</option>
            {invoiceTypes.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}
          </select>
        </div>

        {resource.loading && <LoadingState label="Loading subscription invoices…" />}
        {!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}
        {!resource.loading && !resource.error && !visibleInvoices.length && <EmptyState icon={FileText} title="No subscription invoices found" description="Create an invoice or adjust the current filters." />}
        {!resource.loading && !resource.error && visibleInvoices.length > 0 && (
          <TableShell>
            <table className="sa-table">
              <thead><tr><th>Invoice</th><th>Hospital</th><th>Type</th><th>Issue / due</th><th>Total</th><th>Paid / balance</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>{visibleInvoices.map((invoice) => {
                const status = normalizedStatus(invoice);
                const balance = invoiceBalance(invoice);
                return <tr key={invoice.id}>
                  <td><button className="sa-table__link" type="button" onClick={() => setSelected(invoice)}>{invoice.invoiceNumber}</button><span>{invoice.billingPeriod || 'One-time charge'}</span></td>
                  <td><Link className="sa-table__title" to={`/super-admin/hospitals/${invoice.hospitalId}`}>{invoice.hospitalName || invoice.hospital?.name || 'Hospital'}</Link><span>{invoice.hospitalCode || invoice.hospital?.code}</span></td>
                  <td>{titleCase(invoice.invoiceType || invoice.type)}</td>
                  <td>{formatDate(invoice.issueDate)}<span>Due {formatDate(invoice.dueDate)}</span></td>
                  <td><strong>{formatPkr(invoice.total)}</strong></td>
                  <td>{formatPkr(invoice.paidAmount)}<span>{formatPkr(balance)} outstanding</span></td>
                  <td><StatusBadge status={status} /></td>
                  <td><ActionMenu>
                    <button type="button" onClick={() => setSelected(invoice)}><Eye size={15} />View invoice</button>
                    {openStatuses.has(status) && balance > 0 && <button type="button" onClick={() => setPaymentInvoice(invoice)}><CreditCard size={15} />Record payment</button>}
                    {openStatuses.has(status) && balance > 0 && <button type="button" onClick={() => setCreditInvoice(invoice)}><CircleDollarSign size={15} />Apply credit note</button>}
                    {status === 'DRAFT' && <button type="button" onClick={() => setTransition({ invoice, status: 'ISSUED' })}>Issue invoice</button>}
                    {['ISSUED', 'PARTIALLY_PAID'].includes(status) && <button type="button" onClick={() => setTransition({ invoice, status: 'OVERDUE' })}>Mark overdue</button>}
                    {['DRAFT', 'ISSUED', 'OVERDUE'].includes(status) && Number(invoice.paidAmount || 0) === 0 && <button type="button" onClick={() => setTransition({ invoice, status: 'VOID' })}>Void invoice</button>}
                  </ActionMenu></td>
                </tr>;
              })}</tbody>
            </table>
          </TableShell>
        )}
      </section>

      {createOpen && <Modal
        size="large"
        title="Create subscription invoice"
        description="Create a one-time or recurring SaaS charge for a hospital's current subscription."
        onClose={() => !busy && setCreateOpen(false)}
        footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</button><button className="sa-button sa-button--primary" form="create-subscription-invoice" disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button></>}
      >
        <form id="create-subscription-invoice" onSubmit={createInvoice}>
          <div className="sa-form-grid sa-form-grid--three">
            <Field label="Hospital"><select name="hospitalId" defaultValue={hospitalFilter} required><option value="" disabled>Select a hospital</option>{hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name} ({hospital.code})</option>)}</select></Field>
            <Field label="Invoice type"><select name="invoiceType" defaultValue="ADD_ON_MODULE_CHARGES">{invoiceTypes.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}</select></Field>
            <Field label="Initial status"><select name="status" defaultValue="ISSUED"><option value="ISSUED">Issued</option><option value="DRAFT">Draft</option></select></Field>
            <Field label="Issue date"><input name="issueDate" type="date" defaultValue={today()} required /></Field>
            <Field label="Due date"><input name="dueDate" type="date" defaultValue={addDays(today(), 7)} required /></Field>
            <Field label="Discount (PKR)"><input name="discount" type="number" min="0" defaultValue="0" /></Field>
            <Field label="Billing period start"><input name="billingPeriodStart" type="date" /></Field>
            <Field label="Billing period end"><input name="billingPeriodEnd" type="date" /></Field>
            <Field label="Tax rate (%)"><input name="taxRate" type="number" min="0" step="0.01" defaultValue="0" /></Field>
          </div>
          <h3 className="sa-subheading">Invoice lines</h3>
          <div className="sa-form-stack">
            {lines.map((line, index) => <div className="sa-form-grid sa-form-grid--three" key={`line-${index}`}>
              <Field className="sa-field--span-2" label={`Description ${index + 1}`}><input value={line.description} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} required /></Field>
              <div className="sa-inline-fields"><Field label="Quantity"><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} required /></Field><Field label="Unit amount"><input type="number" min="0" step="0.01" value={line.unitAmount} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitAmount: event.target.value } : item))} required /></Field><button className="sa-icon-button" type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove invoice line ${index + 1}`}><Trash2 size={17} /></button></div>
            </div>)}
          </div>
          <button className="sa-button sa-button--quiet" type="button" onClick={() => setLines([...lines, emptyLine()])}><Plus size={16} />Add invoice line</button>
          <Field label="Payment instructions"><textarea name="paymentInstructions" rows="3" placeholder="Optional bank-transfer or remittance instructions" /></Field>
        </form>
      </Modal>}

      {selected && <Modal
        size="large"
        title={selected.invoiceNumber}
        description={`${selected.hospitalName || selected.hospital?.name || 'Hospital'} · ${titleCase(selected.invoiceType || selected.type)}`}
        onClose={() => setSelected(null)}
        footer={<><button className="sa-button sa-button--secondary" type="button" onClick={() => window.print()}><Printer size={16} />Print</button><button className="sa-button sa-button--primary" type="button" onClick={() => setSelected(null)}>Close</button></>}
      ><InvoicePreview invoice={selected} /></Modal>}

      {paymentInvoice && <Modal title={`Record payment for ${paymentInvoice.invoiceNumber}`} description={`Outstanding balance: ${formatPkr(invoiceBalance(paymentInvoice))}`} onClose={() => !busy && setPaymentInvoice(null)} footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setPaymentInvoice(null)}>Cancel</button><button className="sa-button sa-button--primary" form="record-subscription-payment" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button></>}>
        <form id="record-subscription-payment" className="sa-form-grid" onSubmit={recordPayment}>
          <Field label="Payment method"><select name="provider" defaultValue="MANUAL_BANK_TRANSFER"><option value="MANUAL_BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="ADJUSTMENT">Accounting adjustment</option></select></Field>
          <Field label="Amount (PKR)"><input name="amount" type="number" min="0.01" max={invoiceBalance(paymentInvoice)} step="0.01" defaultValue={invoiceBalance(paymentInvoice)} required /></Field>
          <Field label="Transaction reference"><input name="reference" minLength="3" required /></Field>
          <Field label="Payment date"><input name="paidAt" type="date" defaultValue={today()} required /></Field>
          <Field className="sa-field--span-2" label="Notes"><textarea name="notes" rows="3" /></Field>
        </form>
      </Modal>}

      {creditInvoice && <Modal title={`Apply credit to ${creditInvoice.invoiceNumber}`} description="A separate immutable credit note will be created and linked through the audit history." onClose={() => !busy && setCreditInvoice(null)} footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setCreditInvoice(null)}>Cancel</button><button className="sa-button sa-button--primary" form="apply-subscription-credit" disabled={busy}>{busy ? 'Applying…' : 'Create credit note'}</button></>}>
        <form id="apply-subscription-credit" className="sa-form-grid" onSubmit={createCredit}>
          <Field label="Credit amount (PKR)"><input name="amount" type="number" min="0.01" max={invoiceBalance(creditInvoice)} step="0.01" required /></Field>
          <Field className="sa-field--span-2" label="Reason"><textarea name="reason" rows="4" minLength="3" required /></Field>
        </form>
      </Modal>}

      {transition && <Modal title={`${titleCase(transition.status)} ${transition.invoice.invoiceNumber}?`} description={transition.status === 'VOID' ? 'Voiding is terminal and is only available when no payment has been recorded.' : 'This controlled status change will be written to the platform audit log.'} onClose={() => !busy && setTransition(null)} footer={<><button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={() => setTransition(null)}>Cancel</button><button className={`sa-button ${transition.status === 'VOID' ? 'sa-button--danger' : 'sa-button--primary'}`} form="transition-subscription-invoice" disabled={busy}>{busy ? 'Saving…' : `Confirm ${titleCase(transition.status)}`}</button></>}>
        <form id="transition-subscription-invoice" onSubmit={updateStatus}><Field label={transition.status === 'VOID' ? 'Reason (required)' : 'Reason (optional)'}><textarea name="reason" rows="4" minLength={transition.status === 'VOID' ? 3 : undefined} required={transition.status === 'VOID'} /></Field></form>
      </Modal>}
    </>
  );
}

function InvoicePreview({ invoice }) {
  const items = asArray(invoice.items, ['items']);
  const billingPeriod = invoice.billingPeriod
    || (invoice.billingPeriodStart && invoice.billingPeriodEnd
      ? `${formatDate(invoice.billingPeriodStart)} to ${formatDate(invoice.billingPeriodEnd)}`
      : invoice.billingPeriodStart
        ? `From ${formatDate(invoice.billingPeriodStart)}`
        : invoice.billingPeriodEnd
          ? `Through ${formatDate(invoice.billingPeriodEnd)}`
          : 'One-time charge / not applicable');
  const dtoBankDetails = invoice.bankInstructions || invoice.bankDetails || {};
  const publicBankDetails = [
    ['Bank', invoice.bankName || dtoBankDetails.bankName || dtoBankDetails.name],
    ['Account title', invoice.bankAccountTitle || invoice.accountTitle || dtoBankDetails.accountTitle],
    ['IBAN', invoice.iban || dtoBankDetails.iban],
    ['Branch code', invoice.branchCode || dtoBankDetails.branchCode],
  ].filter(([, value]) => String(value || '').trim());
  return <article className="sa-invoice-preview">
    <header><div><strong>AI Finora</strong><span>Hospital SaaS subscription billing</span></div><div><h2>INVOICE</h2><StatusBadge status={invoice.status} /></div></header>
    <section><div><span>BILL TO</span><strong>{invoice.hospitalName || invoice.hospital?.name || 'Hospital'}</strong><p>{invoice.hospitalCode || invoice.hospital?.code || ''}</p></div><div><span>INVOICE DETAILS</span><strong>{invoice.invoiceNumber}</strong><p>Issued {formatDate(invoice.issueDate)}<br />Due {formatDate(invoice.dueDate)}<br />{titleCase(invoice.invoiceType || invoice.type)}<br />Billing period: {billingPeriod}</p></div></section>
    <TableShell><table className="sa-table"><thead><tr><th>Description</th><th>Quantity</th><th>Unit amount</th><th>Line total</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id || index}><td>{item.description}</td><td>{Number(item.quantity || 0)}</td><td>{formatPkr(item.unitAmount ?? item.unitPrice)}</td><td>{formatPkr(item.lineTotal ?? item.amount)}</td></tr>)}</tbody></table></TableShell>
    <div className="sa-invoice-totals"><div><span>Subtotal</span><strong>{formatPkr(invoice.subtotal)}</strong></div><div><span>Discount</span><strong>- {formatPkr(invoice.discount)}</strong></div><div><span>Tax</span><strong>{formatPkr(invoice.tax)}</strong></div><div><span>Total</span><strong>{formatPkr(invoice.total)}</strong></div><div><span>Paid / credited</span><strong>{formatPkr(invoice.paidAmount)}</strong></div><div className="sa-invoice-totals__balance"><span>Balance due</span><strong>{formatPkr(invoiceBalance(invoice))}</strong></div></div>
    <div className="sa-invoice-payment-details" role="group" aria-label="Payment and bank-transfer details">
      <section><h3>Payment instructions</h3><p>{invoice.paymentInstructions || 'Use the payment method agreed with AI Finora and include this invoice number as the reference.'}</p></section>
      <section><h3>Bank details</h3>{publicBankDetails.length
        ? <dl>{publicBankDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        : <p>Bank details are configured by the platform billing administrator and are not embedded in this invoice. Confirm the active account in Platform Settings before sharing it.</p>}</section>
    </div>
    <footer><strong>Verification</strong><p>Manual bank transfers require AI Finora verification before subscription access is activated or renewed.</p></footer>
  </article>;
}
