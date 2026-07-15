import { conflict } from '../utils/errors.js';

export const SUBSCRIPTION_STATUSES = Object.freeze([
  'TRIALING', 'PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD',
  'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED',
]);

const subscriptionTransitions = {
  TRIALING: ['PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED'],
  PENDING_PAYMENT: ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED'],
  ACTIVE: ['PAST_DUE', 'GRACE_PERIOD', 'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED'],
  PAST_DUE: ['ACTIVE', 'GRACE_PERIOD', 'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED'],
  GRACE_PERIOD: ['ACTIVE', 'PAST_DUE', 'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED'],
  READ_ONLY: ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'PAUSED', 'SUSPENDED', 'CANCELED'],
  PAUSED: ['ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CANCELED'],
  SUSPENDED: ['ACTIVE', 'READ_ONLY', 'CANCELED'],
  CANCELED: ['ACTIVE'],
};

export function assertSubscriptionTransition(from, to) {
  const current = String(from || '').toUpperCase();
  const next = String(to || '').toUpperCase();
  if (current === next) return;
  if (!SUBSCRIPTION_STATUSES.includes(current) || !SUBSCRIPTION_STATUSES.includes(next) || !subscriptionTransitions[current]?.includes(next)) {
    throw conflict(`Subscription status cannot change from ${current || 'UNKNOWN'} to ${next || 'UNKNOWN'}.`, { from: current, to: next });
  }
}

export const INVOICE_STATUSES = Object.freeze(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'CREDITED']);

const invoiceTransitions = {
  DRAFT: ['ISSUED', 'VOID'],
  ISSUED: ['OVERDUE', 'VOID'],
  PARTIALLY_PAID: ['OVERDUE'],
  OVERDUE: ['VOID'],
  PAID: [],
  VOID: [],
  CREDITED: [],
};

export function assertInvoiceTransition(from, to) {
  const current = String(from || '').toUpperCase();
  const next = String(to || '').toUpperCase();
  if (current === next) return;
  if (!INVOICE_STATUSES.includes(current) || !INVOICE_STATUSES.includes(next) || !invoiceTransitions[current]?.includes(next)) {
    throw conflict(`Invoice status cannot change from ${current || 'UNKNOWN'} to ${next || 'UNKNOWN'}. Use a payment or credit-note workflow where required.`, { from: current, to: next });
  }
}
