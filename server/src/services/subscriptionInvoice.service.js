import { randomUUID } from 'node:crypto';
import { addDays, decimalNumber } from '../utils/format.js';

export const invoiceNumber = (prefix = 'AF') => `${prefix}-${new Date().getUTCFullYear()}-${Date.now().toString().slice(-8)}-${randomUUID().slice(0, 4).toUpperCase()}`;

export function calculateInvoiceTotals(items, discount = 0, taxRate = 0) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity ?? 1) * Number(item.unitAmount), 0);
  const safeDiscount = Math.max(0, Math.min(Number(discount || 0), subtotal));
  const taxable = subtotal - safeDiscount;
  const tax = taxable * Math.max(0, Number(taxRate || 0)) / 100;
  return { subtotal, discount: safeDiscount, tax, total: taxable + tax };
}

export async function createSubscriptionInvoice(db, {
  hospitalId,
  subscriptionId,
  type,
  issueDate = new Date(),
  dueDays = 7,
  dueDate,
  periodStart = null,
  periodEnd = null,
  items,
  discount = 0,
  taxRate = 0,
  idempotencyKey,
  status = 'ISSUED',
  paymentInstructions,
  number,
}) {
  const existing = await db.subscriptionInvoice.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  const settings = await db.platformSetting.findMany({ where: { key: { in: ['invoicePrefix', 'paymentInstructions'] } } });
  const settingMap = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
  const configuredPrefix = String(settingMap.invoicePrefix || '').trim().toUpperCase();
  const subscriptionPrefix = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(configuredPrefix) && configuredPrefix.length <= 24 ? configuredPrefix : 'AF-SUB';
  const resolvedInstructions = paymentInstructions ?? settingMap.paymentInstructions ?? 'Transfer funds to the AI Finora demonstration bank account and upload proof for verification.';
  const totals = calculateInvoiceTotals(items, discount, taxRate);
  return db.subscriptionInvoice.create({
    data: {
      hospitalId,
      subscriptionId,
      invoiceNumber: number || invoiceNumber(type === 'IMPLEMENTATION_FEE' ? 'AF-IMP' : subscriptionPrefix),
      invoiceType: type,
      issueDate,
      dueDate: dueDate || addDays(issueDate, dueDays),
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      status,
      issuedAt: status === 'ISSUED' ? issueDate : null,
      paymentInstructions: resolvedInstructions,
      idempotencyKey,
      items: {
        create: items.map((item) => ({
          hospitalId,
          description: item.description,
          quantity: item.quantity ?? 1,
          unitAmount: item.unitAmount,
          lineTotal: Number(item.quantity ?? 1) * Number(item.unitAmount),
        })),
      },
    },
    include: { items: true },
  });
}

export function subscriptionInvoiceDto(invoice) {
  return {
    ...invoice,
    type: invoice.type || invoice.invoiceType,
    billingPeriod: invoice.billingPeriod || (
      invoice.billingPeriodStart && invoice.billingPeriodEnd
        ? `${new Date(invoice.billingPeriodStart).toISOString().slice(0, 10)} to ${new Date(invoice.billingPeriodEnd).toISOString().slice(0, 10)}`
        : null
    ),
    subtotal: decimalNumber(invoice.subtotal),
    discount: decimalNumber(invoice.discount),
    tax: decimalNumber(invoice.tax),
    total: decimalNumber(invoice.total),
    paidAmount: decimalNumber(invoice.paidAmount),
    outstandingBalance: Math.max(decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount), 0),
    items: invoice.items?.map((item) => ({
      ...item,
      quantity: decimalNumber(item.quantity),
      unitAmount: decimalNumber(item.unitAmount),
      lineTotal: decimalNumber(item.lineTotal),
      unitPrice: decimalNumber(item.unitAmount),
      amount: decimalNumber(item.lineTotal),
    })),
  };
}
