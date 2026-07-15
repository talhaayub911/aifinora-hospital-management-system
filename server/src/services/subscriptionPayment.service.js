import { randomUUID } from 'node:crypto';
import { conflict, badRequest, notFound } from '../utils/errors.js';
import { addBillingPeriod, decimalNumber, normalizeReference } from '../utils/format.js';
import { createNotification, writeAudit } from './audit.service.js';

const paymentReceiptNumber = () => `AF-RCP-${new Date().getUTCFullYear()}-${Date.now().toString().slice(-8)}-${randomUUID().slice(0, 4).toUpperCase()}`;

export async function withSerializableFinancialTransaction(prisma, operation, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      lastError = error;
      if (error?.code !== 'P2034') throw error;
      if (attempt === maxAttempts) {
        throw conflict('Concurrent financial updates are still being reconciled. Reload the record and try again.');
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
  throw lastError;
}

export async function applySubscriptionPayment(db, {
  invoiceId,
  hospitalId,
  provider,
  reference,
  providerTransactionId = null,
  amount,
  paidAt = new Date(),
  proofId = null,
  actor,
  ipAddress,
  notes = null,
}) {
  const invoice = await db.subscriptionInvoice.findFirst({
    where: { id: invoiceId, hospitalId },
    include: { subscription: true },
  });
  if (!invoice) throw notFound('Subscription invoice not found for this hospital.');
  if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) throw badRequest('Payments can only be applied to an open issued invoice.');
  const normalized = normalizeReference(reference);
  if (!normalized) throw badRequest('A payment reference is required.');
  const duplicate = await db.subscriptionPayment.findFirst({ where: { provider, normalizedReference: normalized } });
  if (duplicate) throw conflict('This transaction reference has already been approved.', { paymentId: duplicate.id, invoiceId: duplicate.invoiceId });

  const paymentAmount = Number(amount);
  const outstanding = Math.max(decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount), 0);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw badRequest('Payment amount must be greater than zero.');
  if (paymentAmount > outstanding + 0.001) throw badRequest('Payment amount cannot exceed the invoice balance.');

  const payment = await db.subscriptionPayment.create({
    data: {
      hospitalId,
      invoiceId,
      bankTransferProofId: proofId,
      provider,
      paymentReference: reference,
      normalizedReference: normalized,
      providerTransactionId,
      amount: paymentAmount,
      paidAt,
      receiptNumber: paymentReceiptNumber(),
      notes,
    },
  });

  const nextPaid = decimalNumber(invoice.paidAmount) + paymentAmount;
  const invoiceStatus = nextPaid + 0.001 >= decimalNumber(invoice.total) ? 'PAID' : 'PARTIALLY_PAID';
  const invoiceClaim = await db.subscriptionInvoice.updateMany({
    where: { id: invoice.id, hospitalId, status: invoice.status, paidAmount: invoice.paidAmount },
    data: { paidAmount: nextPaid, status: invoiceStatus },
  });
  if (invoiceClaim.count !== 1) throw conflict('The invoice balance changed while this payment was being recorded. Reload the invoice and try again.');

  if (invoiceStatus === 'PAID') {
    if (invoice.invoiceType === 'IMPLEMENTATION_FEE') {
      await db.hospitalSubscription.update({
        where: { id: invoice.subscriptionId },
        data: { implementationFeeStatus: 'PAID' },
      });
    } else if (['MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION'].includes(invoice.invoiceType)) {
      const otherOpenRecurringInvoices = await db.subscriptionInvoice.count({ where: {
        subscriptionId: invoice.subscriptionId,
        id: { not: invoice.id },
        invoiceType: { in: ['MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION'] },
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
      } });
      if (otherOpenRecurringInvoices === 0) {
        const periodStart = invoice.billingPeriodStart || invoice.subscription.currentPeriodStart || paidAt;
        const periodEnd = invoice.billingPeriodEnd || addBillingPeriod(periodStart, invoice.subscription.billingCycle);
        await db.hospitalSubscription.update({
          where: { id: invoice.subscriptionId },
          data: {
            status: 'ACTIVE',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            gracePeriodEndsAt: null,
          },
        });
        await db.hospital.update({ where: { id: hospitalId }, data: { accountStatus: 'ACTIVE' } });
        if (invoice.subscription.status !== 'ACTIVE') {
          await writeAudit(db, {
            hospitalId,
            actorType: actor?.type || 'SYSTEM', actorId: actor?.id, actorName: actor?.name || 'System',
            action: 'SUBSCRIPTION_ACTIVATED', entityType: 'HospitalSubscription', entityId: invoice.subscriptionId,
            previousValue: { status: invoice.subscription.status }, newValue: { status: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }, ipAddress,
          });
          await createNotification(db, {
            hospitalId, type: 'ACCOUNT_REACTIVATED', title: 'Subscription active',
            body: 'Your subscription payment was verified and normal plan access is active.', severity: 'SUCCESS',
            link: '/hospital/subscription', dedupeKey: `subscription-reactivated:${payment.id}`,
          });
        }
      }
    }
  }

  await createNotification(db, {
    hospitalId,
    type: 'SUBSCRIPTION_PAYMENT_APPROVED',
    title: 'Subscription payment approved',
    body: `${payment.receiptNumber} was recorded against ${invoice.invoiceNumber}.`,
    severity: 'SUCCESS',
    link: `/hospital/subscription`,
    dedupeKey: `payment-approved:${payment.id}`,
  });
  await writeAudit(db, {
    hospitalId,
    actorType: actor?.type || 'SYSTEM',
    actorId: actor?.id,
    actorName: actor?.name || 'System',
    action: 'SUBSCRIPTION_PAYMENT_RECORDED',
    entityType: 'SubscriptionPayment',
    entityId: payment.id,
    newValue: { invoiceId, provider, reference, amount: paymentAmount, invoiceStatus },
    ipAddress,
  });
  return { payment, invoiceStatus, paidAmount: nextPaid, outstandingBalance: Math.max(decimalNumber(invoice.total) - nextPaid, 0) };
}
