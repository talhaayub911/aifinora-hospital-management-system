import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { createNotification } from '../services/audit.service.js';
import { SafepayProvider } from '../services/payments/SafepayProvider.js';
import { applySubscriptionPayment, withSerializableFinancialTransaction } from '../services/subscriptionPayment.service.js';
import { asyncHandler, badRequest, conflict, unauthorized } from '../utils/errors.js';
import { decimalNumber } from '../utils/format.js';

function sanitizedPayload(value) {
  const blockedTerms = ['secret', 'token', 'authorization', 'card', 'cvv', 'password', 'signature'];
  const clean = (item) => {
    if (Array.isArray(item)) return item.map(clean);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, blockedTerms.some((term) => key.toLowerCase().includes(term)) ? '[REDACTED]' : clean(child)]));
    return item;
  };
  return JSON.stringify(clean(value)).slice(0, 100_000);
}

const successEvents = new Set(['payment.succeeded', 'payment_success', 'payment_succeeded', 'checkout.completed']);
const failureEvents = new Set(['payment.failed', 'payment_failure', 'payment_failed', 'checkout.failed']);
const moneyEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.005;

export function createWebhookRouter() {
  const router = Router();
  router.post('/safepay', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const provider = new SafepayProvider();
    const signature = req.get('x-safepay-signature') || req.get('x-sfpy-signature');
    if (!provider.verifyWebhook(req.rawBody, signature)) throw unauthorized('Safepay webhook signature verification failed.');
    const payload = req.body || {};
    const providerEventId = String(payload.id || payload.event_id || payload.eventId || '');
    const eventType = String(payload.type || payload.event_type || payload.event || 'unknown').toLowerCase();
    if (!providerEventId) throw badRequest('Safepay webhook event ID is required.');

    let event = await db.webhookEvent.findUnique({ where: { provider_providerEventId: { provider: 'SAFEPAY', providerEventId } } });
    if (event && event.processingStatus !== 'FAILED') {
      return res.status(200).json({ data: { received: true, duplicate: true, eventId: event.id, processingStatus: event.processingStatus } });
    }
    if (event) {
      event = await db.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'PROCESSING', errorMessage: null, processedAt: null } });
    } else {
      try {
        event = await db.webhookEvent.create({ data: { provider: 'SAFEPAY', providerEventId, eventType, sanitizedPayload: sanitizedPayload(payload), signatureVerified: true, processingStatus: 'PROCESSING' } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return res.status(200).json({ data: { received: true, duplicate: true } });
        }
        throw error;
      }
    }

    const data = payload.data || payload.payload || {};
    const tracker = String(data.tracker || data.payment_tracker || payload.tracker || '');

    if (failureEvents.has(eventType)) {
      const intent = tracker ? await db.paymentIntent.findUnique({ where: { provider_providerReference: { provider: 'SAFEPAY', providerReference: tracker } } }) : null;
      await db.$transaction(async (tx) => {
        if (intent && intent.status !== 'COMPLETED') {
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'FAILED' } });
          await createNotification(tx, { hospitalId: intent.hospitalId, type: 'SAFEPAY_PAYMENT_FAILED', title: 'Safepay payment failed', body: 'Safepay did not complete the subscription payment. No subscription access was changed.', severity: 'ERROR', link: '/hospital/subscription', dedupeKey: `safepay-failed:${event.id}` });
        }
        await tx.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'PROCESSED', processedAt: new Date() } });
      });
      return res.status(200).json({ data: { received: true, processed: true, paymentCompleted: false, eventId: event.id } });
    }

    if (!successEvents.has(eventType)) {
      await db.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'IGNORED', processedAt: new Date() } });
      return res.status(200).json({ data: { received: true, ignored: true, eventId: event.id } });
    }

    try {
      if (!tracker) throw badRequest('Safepay payment tracker is required for a successful payment event.');
      let intent = await db.paymentIntent.findUnique({ where: { provider_providerReference: { provider: 'SAFEPAY', providerReference: tracker } } });

      // Local/test demo webhooks exercise the reconciliation structure without
      // pretending to be Safepay's production signature contract. Production
      // requires an intent created before redirecting to hosted checkout.
      if (!intent && env.demoMode && env.nodeEnv !== 'production') {
        const demoInvoiceId = data.metadata?.invoiceId || data.invoiceId || payload.metadata?.invoiceId;
        const demoInvoice = demoInvoiceId ? await db.subscriptionInvoice.findUnique({ where: { id: String(demoInvoiceId) } }) : null;
        if (!demoInvoice) throw badRequest('The demo webhook is not bound to a subscription invoice.');
        if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(demoInvoice.status)) throw badRequest('The demo webhook invoice is not open for payment.');
        const demoAmount = Number(data.amount ?? payload.amount);
        if (!Number.isFinite(demoAmount) || !moneyEqual(demoAmount, decimalNumber(demoInvoice.total) - decimalNumber(demoInvoice.paidAmount))) throw badRequest('Safepay amount does not match the invoice balance.');
        const demoCurrency = String(data.currency || payload.currency || demoInvoice.currency).toUpperCase();
        if (demoCurrency !== String(demoInvoice.currency).toUpperCase()) throw badRequest('Safepay currency does not match the invoice.');
        intent = await db.paymentIntent.create({ data: { hospitalId: demoInvoice.hospitalId, invoiceId: demoInvoice.id, provider: 'SAFEPAY', providerReference: tracker, amount: demoAmount, currency: demoCurrency, status: 'CREATED' } });
      }
      if (!intent) throw badRequest('No invoice-bound Safepay payment intent matches this tracker.');
      if (intent.status === 'COMPLETED') {
        await db.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'DUPLICATE', processedAt: new Date() } });
        return res.status(200).json({ data: { received: true, duplicate: true, eventId: event.id } });
      }

      const invoice = await db.subscriptionInvoice.findUnique({ where: { id: intent.invoiceId } });
      if (!invoice || invoice.hospitalId !== intent.hospitalId) throw badRequest('The payment intent invoice is invalid.');
      const metadataInvoiceId = data.metadata?.invoiceId || data.invoiceId || payload.metadata?.invoiceId;
      if (metadataInvoiceId && String(metadataInvoiceId) !== invoice.id) throw badRequest('Safepay invoice metadata does not match the payment intent.');
      const amount = Number(data.amount ?? payload.amount);
      const currency = String(data.currency || payload.currency || (env.demoMode && env.nodeEnv !== 'production' ? invoice.currency : '')).toUpperCase();
      if (!Number.isFinite(amount) || !moneyEqual(amount, intent.amount)) throw badRequest('Safepay amount does not match the payment intent.');
      if (!currency || currency !== String(intent.currency).toUpperCase() || currency !== String(invoice.currency).toUpperCase()) throw badRequest('Safepay currency does not match the payment intent.');
      const outstanding = decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount);
      if (!moneyEqual(amount, outstanding)) throw badRequest('Safepay amount does not match the current invoice balance.');

      const result = await withSerializableFinancialTransaction(db, async (tx) => {
        const claimed = await tx.paymentIntent.updateMany({ where: { id: intent.id, status: { in: ['CREATED', 'FAILED'] } }, data: { status: 'PROCESSING' } });
        if (claimed.count !== 1) throw conflict('Safepay payment intent is already being processed.');
        const payment = await applySubscriptionPayment(tx, {
          invoiceId: invoice.id, hospitalId: invoice.hospitalId, provider: 'SAFEPAY', reference: tracker,
          providerTransactionId: tracker, amount, paidAt: new Date(), actor: { type: 'SYSTEM', name: 'Safepay Webhook' }, ipAddress: req.ip,
        });
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        await tx.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'PROCESSED', processedAt: new Date() } });
        return payment;
      });
      return res.status(200).json({ data: { received: true, processed: true, eventId: event.id, paymentId: result.payment.id } });
    } catch (error) {
      await db.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'FAILED', errorMessage: String(error.message).slice(0, 500), processedAt: new Date() } });
      throw error;
    }
  }));
  return router;
}
