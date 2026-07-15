import { addBillingPeriod, addDays, dateKey } from '../utils/format.js';
import { createNotification, writeAudit } from './audit.service.js';
import { createSubscriptionInvoice } from './subscriptionInvoice.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTOMATED_ACCESS_SEVERITY = Object.freeze({
  TRIALING: 0,
  PENDING_PAYMENT: 0,
  ACTIVE: 0,
  PAST_DUE: 1,
  GRACE_PERIOD: 2,
  READ_ONLY: 3,
});
const utcDay = (value) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const calendarDays = (from, to) => Math.round((utcDay(to) - utcDay(from)) / DAY_MS);

const transitionNotice = (status, graceEnd) => ({
  type: status === 'READ_ONLY' ? 'READ_ONLY_MODE_ACTIVATED' : status === 'GRACE_PERIOD' ? 'GRACE_PERIOD_STARTED' : status === 'PENDING_PAYMENT' ? 'TRIAL_ENDED' : 'PAYMENT_OVERDUE',
  title: status === 'READ_ONLY' ? 'Read-only mode activated' : status === 'GRACE_PERIOD' ? 'Subscription grace period started' : status === 'PENDING_PAYMENT' ? 'Trial period ended' : 'Subscription payment overdue',
  body: status === 'READ_ONLY'
    ? 'Existing records remain available, but operational writes are blocked until payment is verified.'
    : status === 'GRACE_PERIOD'
      ? `Payment remains overdue. The grace period ends ${dateKey(graceEnd)}.`
      : status === 'PENDING_PAYMENT'
        ? 'Your trial has ended. Subscription billing and data export remain available while payment is pending.'
        : `Payment is overdue. The grace period ends ${dateKey(graceEnd)}.`,
});

export async function processSubscriptions(prisma, asOf = new Date(), actor = null, ipAddress = null) {
  const date = new Date(asOf);
  const today = utcDay(date);
  const [subscriptions, processingSettings] = await Promise.all([
    prisma.hospitalSubscription.findMany({
      where: { isCurrent: true, status: { notIn: ['CANCELED'] } },
      include: { planVersion: { include: { plan: true } } },
    }),
    prisma.platformSetting.findMany({ where: { key: { in: ['renewalInvoiceDaysBefore', 'reminderDaysBefore'] } } }),
  ]);
  const settingMap = Object.fromEntries(processingSettings.map((setting) => [setting.key, Number(setting.value)]));
  const renewalInvoiceDaysBefore = Number.isInteger(settingMap.renewalInvoiceDaysBefore) && settingMap.renewalInvoiceDaysBefore >= 1 && settingMap.renewalInvoiceDaysBefore <= 90 ? settingMap.renewalInvoiceDaysBefore : 7;
  const configuredReminderDays = Number.isInteger(settingMap.reminderDaysBefore) && settingMap.reminderDaysBefore >= 0 && settingMap.reminderDaysBefore <= 90 ? settingMap.reminderDaysBefore : 3;
  const reminderDaysBefore = Math.min(configuredReminderDays, renewalInvoiceDaysBefore);
  const result = { asOf: date, createdInvoices: [], transitions: [], notifications: [], eligibleForSuspension: [] };

  for (const subscription of subscriptions) {
    await prisma.$transaction(async (tx) => {
      const nextBilling = subscription.nextBillingDate ? new Date(subscription.nextBillingDate) : null;
      if (nextBilling && calendarDays(today, nextBilling) <= renewalInvoiceDaysBefore) {
        const periodStart = nextBilling;
        const periodEnd = addBillingPeriod(periodStart, subscription.billingCycle);
        const key = `renewal:${subscription.id}:${dateKey(periodStart)}`;
        const existed = await tx.subscriptionInvoice.findUnique({ where: { idempotencyKey: key } });
        if (!existed) {
          const invoice = await createSubscriptionInvoice(tx, {
            hospitalId: subscription.hospitalId,
            subscriptionId: subscription.id,
            type: subscription.billingCycle === 'ANNUAL' ? 'ANNUAL_SUBSCRIPTION' : 'MONTHLY_SUBSCRIPTION',
            issueDate: addDays(periodStart, -renewalInvoiceDaysBefore),
            dueDate: periodStart,
            periodStart,
            periodEnd,
            items: [{ description: `${subscription.planVersion.plan.name} renewal`, quantity: 1, unitAmount: subscription.price }],
            discount: subscription.discount,
            taxRate: subscription.taxRate,
            idempotencyKey: key,
          });
          result.createdInvoices.push(invoice.id);
          await createNotification(tx, {
            hospitalId: subscription.hospitalId,
            type: 'RENEWAL_APPROACHING',
            title: 'Subscription renewal approaching',
            body: `${invoice.invoiceNumber} is due on ${dateKey(periodStart)}.`,
            severity: 'WARNING',
            link: '/hospital/subscription',
            dedupeKey: `renewal-notice:${key}`,
          });
          result.notifications.push(`renewal-notice:${key}`);
        }
      }

      const openInvoices = await tx.subscriptionInvoice.findMany({
        where: {
          subscriptionId: subscription.id,
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
          total: { gt: 0 },
        },
        orderBy: { dueDate: 'asc' },
      });

      for (const invoice of openInvoices) {
        const daysUntilDue = calendarDays(today, invoice.dueDate);
        if (daysUntilDue > 0 && daysUntilDue <= reminderDaysBefore) {
          const key = `invoice-reminder:${reminderDaysBefore}-day:${invoice.id}:${dateKey(invoice.dueDate)}`;
          await createNotification(tx, {
            hospitalId: subscription.hospitalId,
            type: 'SUBSCRIPTION_INVOICE_REMINDER',
            title: 'Subscription payment reminder',
            body: `${invoice.invoiceNumber} is due on ${dateKey(invoice.dueDate)}.`,
            severity: 'WARNING', link: '/hospital/subscription', dedupeKey: key,
          });
          result.notifications.push(key);
        } else if (daysUntilDue === 0) {
          const key = `invoice-reminder:due:${invoice.id}:${dateKey(invoice.dueDate)}`;
          await createNotification(tx, {
            hospitalId: subscription.hospitalId,
            type: 'SUBSCRIPTION_INVOICE_DUE',
            title: 'Subscription invoice due today',
            body: `${invoice.invoiceNumber} is due today.`,
            severity: 'WARNING', link: '/hospital/subscription', dedupeKey: key,
          });
          result.notifications.push(key);
        }
      }

      const overdueInvoices = openInvoices.filter((invoice) => calendarDays(invoice.dueDate, today) >= 1);
      if (overdueInvoices.some((invoice) => invoice.status !== 'OVERDUE')) {
        await tx.subscriptionInvoice.updateMany({
          where: { id: { in: overdueInvoices.filter((invoice) => invoice.status !== 'OVERDUE').map((invoice) => invoice.id) } },
          data: { status: 'OVERDUE' },
        });
      }

      const lifecycleOverdueInvoices = overdueInvoices.filter((invoice) => ['MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION'].includes(invoice.invoiceType));
      const protectedManualStatus = ['PAUSED', 'SUSPENDED'].includes(subscription.status);
      const trialStillActive = subscription.status === 'TRIALING' && (!subscription.trialEndsAt || utcDay(subscription.trialEndsAt) > today);
      let nextStatus = subscription.status;
      let graceEnd = subscription.gracePeriodEndsAt;
      if (!protectedManualStatus && !trialStillActive) {
        if (lifecycleOverdueInvoices.length) {
          const oldestDue = lifecycleOverdueInvoices[0].dueDate;
          const daysOverdue = calendarDays(oldestDue, today);
          graceEnd = addDays(oldestDue, subscription.gracePeriodDays);
          if (daysOverdue > subscription.gracePeriodDays) nextStatus = 'READ_ONLY';
          else if (daysOverdue > 1) nextStatus = 'GRACE_PERIOD';
          else nextStatus = 'PAST_DUE';

          if (daysOverdue > subscription.suspensionAfterDays) result.eligibleForSuspension.push(subscription.id);
        } else if (subscription.status === 'TRIALING' && subscription.trialEndsAt && utcDay(subscription.trialEndsAt) <= today) {
          nextStatus = 'PENDING_PAYMENT';
        }
      }

      const currentSeverity = AUTOMATED_ACCESS_SEVERITY[subscription.status] ?? 0;
      const nextSeverity = AUTOMATED_ACCESS_SEVERITY[nextStatus] ?? currentSeverity;
      if (nextSeverity < currentSeverity) {
        nextStatus = subscription.status;
        graceEnd = subscription.gracePeriodEndsAt;
      }

      if (nextStatus !== subscription.status) {
        await tx.hospitalSubscription.update({ where: { id: subscription.id }, data: { status: nextStatus, gracePeriodEndsAt: graceEnd } });
        await tx.hospital.update({ where: { id: subscription.hospitalId }, data: { accountStatus: nextStatus } });
        result.transitions.push({ subscriptionId: subscription.id, from: subscription.status, to: nextStatus });
        const notice = transitionNotice(nextStatus, graceEnd || today);
        const noticeKey = `subscription-status:${subscription.id}:${nextStatus}:${dateKey(graceEnd || today)}`;
        await createNotification(tx, {
          hospitalId: subscription.hospitalId,
          ...notice,
          severity: nextStatus === 'READ_ONLY' ? 'ERROR' : 'WARNING',
          link: '/hospital/subscription',
          dedupeKey: noticeKey,
        });
        result.notifications.push(noticeKey);
        await writeAudit(tx, {
          hospitalId: subscription.hospitalId,
          actorType: actor ? 'PLATFORM_USER' : 'SYSTEM',
          actorId: actor?.id,
          actorName: actor?.fullName || 'Subscription Processing Service',
          action: `SUBSCRIPTION_${nextStatus}`,
          entityType: 'HospitalSubscription',
          entityId: subscription.id,
          previousValue: { status: subscription.status },
          newValue: { status: nextStatus, gracePeriodEndsAt: graceEnd },
          ipAddress,
        });
      }
    });
  }
  return result;
}
