import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileSearch,
  LoaderCircle,
  ReceiptText,
  RefreshCcw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../services/api.js';
import AuthShell from './AuthShell.jsx';

const money = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

function unwrapStatus(response) {
  const payload = response?.data && typeof response.data === 'object' ? response.data : response;
  if (!payload || typeof payload !== 'object') return null;
  const payment = payload.payment || payload.transaction || payload.proof || payload;
  return {
    ...payment,
    reference:
      payment.reference ||
      payment.transactionReference ||
      payment.providerReference ||
      payload.reference,
    invoiceNumber:
      payment.invoiceNumber || payment.invoice?.number || payment.invoiceId || payload.invoiceNumber,
    hospitalName: payment.hospitalName || payment.hospital?.name || payload.hospitalName,
    amount: payment.amount ?? payment.claimedAmount ?? payload.amount,
    status: payment.status || payload.status || 'unknown',
    updatedAt: payment.updatedAt || payment.processedAt || payload.updatedAt,
    message: payment.message || payload.message,
  };
}

function statusPresentation(status) {
  const normalized = String(status || 'unknown').toLowerCase().replace(/[\s-]+/g, '_');
  if (['paid', 'completed', 'approved', 'success', 'succeeded'].includes(normalized)) {
    return { tone: 'success', label: normalized === 'approved' ? 'Approved' : 'Payment confirmed', icon: CheckCircle2 };
  }
  if (['pending', 'processing', 'under_review', 'submitted'].includes(normalized)) {
    return { tone: 'pending', label: normalized === 'under_review' ? 'Under review' : 'Verification pending', icon: Clock3 };
  }
  if (['failed', 'cancelled', 'canceled', 'rejected', 'expired', 'duplicate'].includes(normalized)) {
    return { tone: 'failed', label: normalized.charAt(0).toUpperCase() + normalized.slice(1).replaceAll('_', ' '), icon: XCircle };
  }
  return { tone: 'neutral', label: 'Status unavailable', icon: FileSearch };
}

export function PaymentStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlReference =
    searchParams.get('reference') ||
    searchParams.get('transaction_reference') ||
    searchParams.get('payment_id') ||
    searchParams.get('invoice') ||
    '';
  const urlInvoice = searchParams.get('invoice') || '';
  const [reference, setReference] = useState(urlReference);
  const [result, setResult] = useState(null);
  const [state, setState] = useState(urlReference ? 'loading' : 'idle');
  const [error, setError] = useState('');
  const requestRef = useRef({ id: 0, controller: null });

  const presentation = useMemo(
    () => (result ? statusPresentation(result.status) : null),
    [result],
  );

  const cancelStatusCheck = useCallback(() => {
    requestRef.current.id += 1;
    requestRef.current.controller?.abort();
    requestRef.current.controller = null;
  }, []);

  const checkStatus = useCallback(async (value, invoiceReference = '') => {
    const normalizedReference = String(value || '').trim();
    if (!normalizedReference) {
      cancelStatusCheck();
      setResult(null);
      setState('error');
      setError('Enter a payment or bank-transfer reference to check its status.');
      return;
    }

    const requestId = requestRef.current.id + 1;
    requestRef.current.controller?.abort();
    const controller = new AbortController();
    requestRef.current = { id: requestId, controller };
    setState('loading');
    setError('');

    try {
      const response = await api.get('/payments/status', {
        auth: false,
        handleUnauthorized: false,
        signal: controller.signal,
        query: {
          reference: normalizedReference,
          invoice: invoiceReference === normalizedReference ? invoiceReference : undefined,
        },
      });
      const payment = unwrapStatus(response);
      if (!payment) throw new Error('The service returned an empty payment status.');
      if (requestRef.current.id !== requestId) return;
      setResult(payment);
      setState('ready');
    } catch (requestError) {
      if (requestError?.name === 'AbortError' || requestRef.current.id !== requestId) return;
      setResult(null);
      setState('error');
      setError(
        requestError?.status === 404
          ? 'No payment was found for that reference. Check it and try again.'
          : requestError?.message || 'Payment status is temporarily unavailable.',
      );
    } finally {
      if (
        requestRef.current.id === requestId &&
        requestRef.current.controller === controller
      ) {
        requestRef.current.controller = null;
      }
    }
  }, [cancelStatusCheck]);

  useEffect(() => {
    setReference(urlReference);
    if (urlReference) {
      checkStatus(urlReference, urlInvoice);
    } else {
      cancelStatusCheck();
      setResult(null);
      setState('idle');
      setError('');
    }

    return cancelStatusCheck;
  }, [cancelStatusCheck, checkStatus, urlInvoice, urlReference]);

  const submit = (event) => {
    event.preventDefault();
    const normalizedReference = reference.trim();
    if (!normalizedReference) {
      checkStatus('');
      return;
    }

    if (normalizedReference === urlReference && !urlInvoice) {
      checkStatus(normalizedReference);
      return;
    }

    setSearchParams({ reference: normalizedReference }, { replace: true });
  };

  return (
    <AuthShell
      eyebrow="PAYMENT VERIFICATION"
      title="Check payment status"
      description="View the server-verified status of a subscription payment or bank-transfer proof."
      footer={<><Link to="/login"><ArrowLeft size={15} /> Return to sign in</Link></>}
    >
      <form className="auth-status-search" onSubmit={submit}>
        <div className="auth-field">
          <label htmlFor="payment-reference">Payment reference</label>
          <div className="auth-input-wrap">
            <ReceiptText size={18} aria-hidden="true" />
            <input
              id="payment-reference"
              value={reference}
              onChange={(event) => { setReference(event.target.value); setError(''); }}
              placeholder="Transaction or payment reference"
              autoCapitalize="characters"
              autoCorrect="off"
              required
              disabled={state === 'loading'}
            />
          </div>
        </div>
        <button type="submit" className="auth-submit-button" disabled={state === 'loading'}>
          {state === 'loading' ? (
            <><LoaderCircle className="auth-spinner" size={18} /> Checking…</>
          ) : (
            <><Search size={18} /> Check status</>
          )}
        </button>
      </form>

      <div className="auth-payment-result" aria-live="polite">
        {state === 'idle' && (
          <div className="auth-empty-state">
            <FileSearch size={33} aria-hidden="true" />
            <strong>No payment selected</strong>
            <span>Enter the reference shown on your invoice, transfer submission, or payment link.</span>
          </div>
        )}

        {state === 'loading' && (
          <div className="auth-empty-state" role="status">
            <LoaderCircle className="auth-spinner" size={31} aria-hidden="true" />
            <strong>Verifying with the server</strong>
            <span>This page never activates a subscription from redirect information alone.</span>
          </div>
        )}

        {state === 'error' && (
          <div className="auth-empty-state auth-empty-error" role="alert">
            <AlertCircle size={32} aria-hidden="true" />
            <strong>We could not confirm this payment</strong>
            <span>{error}</span>
            <button type="button" className="auth-secondary-button" onClick={() => checkStatus(reference)}>
              <RefreshCcw size={16} /> Try again
            </button>
          </div>
        )}

        {state === 'ready' && result && presentation && (() => {
          const StatusIcon = presentation.icon;
          return (
            <div className={`auth-status-card ${presentation.tone}`}>
              <div className="auth-status-heading">
                <div><StatusIcon size={25} aria-hidden="true" /></div>
                <span><small>Current status</small><strong>{presentation.label}</strong></span>
              </div>
              <dl className="auth-status-details">
                <div><dt>Reference</dt><dd>{result.reference || reference}</dd></div>
                {result.invoiceNumber && <div><dt>Invoice</dt><dd>{result.invoiceNumber}</dd></div>}
                {result.hospitalName && <div><dt>Hospital</dt><dd>{result.hospitalName}</dd></div>}
                {result.amount !== undefined && result.amount !== null && <div><dt>Amount</dt><dd>{money(result.amount)}</dd></div>}
              </dl>
              {result.message && <p className="auth-status-message">{result.message}</p>}
              <button type="button" className="auth-secondary-button" onClick={() => checkStatus(reference)}>
                <RefreshCcw size={16} /> Refresh status
              </button>
            </div>
          );
        })()}
      </div>

      <div className="auth-verification-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>Only a verified backend payment or approved bank proof can update a subscription.</span>
      </div>
    </AuthShell>
  );
}

export default PaymentStatusPage;
