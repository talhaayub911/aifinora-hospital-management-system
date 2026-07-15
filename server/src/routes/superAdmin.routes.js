import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../config/env.js';
import { signAuthToken } from '../middleware/auth.js';
import { FEATURE_KEYS } from '../services/access.service.js';
import { createNotification, writeAudit } from '../services/audit.service.js';
import { assertInvoiceTransition, assertSubscriptionTransition } from '../services/billingState.service.js';
import { onboardHospital } from '../services/onboarding.service.js';
import { SafepayProvider } from '../services/payments/SafepayProvider.js';
import { isPlatformAuditVisible, platformAuditDto, platformAuditWhere } from '../services/platformAudit.service.js';
import { applySubscriptionPayment, withSerializableFinancialTransaction } from '../services/subscriptionPayment.service.js';
import { createSubscriptionInvoice, subscriptionInvoiceDto } from '../services/subscriptionInvoice.service.js';
import { processSubscriptions } from '../services/subscriptionProcessing.service.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { addDays, decimalNumber, normalizeCode } from '../utils/format.js';

const adminActor = (req) => ({ type: 'PLATFORM_USER', id: req.auth.user.id, name: req.auth.user.fullName });
const upperEnum = (values) => z.string().transform((value) => value.toUpperCase()).pipe(z.enum(values));
const auditAdmin = (req, data) => writeAudit(req.app.locals.prisma, {
  actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName, ipAddress: req.ip, ...data,
});
const hospitalUserDto = (user) => ({
  id: user.id, hospitalId: user.hospitalId, fullName: user.fullName, name: user.fullName, email: user.email, mobile: user.mobile,
  roleId: user.roleId, role: user.role?.name || user.role?.key, roleName: user.role?.name, roleKey: user.role?.key, isActive: user.isActive,
  status: user.isActive ? 'ACTIVE' : 'DISABLED', mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt, updatedAt: user.updatedAt,
});

const hospitalSchema = z.object({
  hospital: z.object({
    name: z.string().min(2), code: z.string().min(2), legalBusinessName: z.string().optional(), ntn: z.string().optional(),
    email: z.string().email(), phone: z.string().min(3), address: z.string().optional(), city: z.string().min(2), province: z.string().min(2),
    numberOfBeds: z.coerce.number().int().min(0), numberOfBranches: z.coerce.number().int().min(1).default(1),
    primaryContactName: z.string().optional(), primaryContactDesignation: z.string().optional(), primaryContactMobile: z.string().optional(), primaryContactEmail: z.string().email().optional(),
  }),
  subscription: z.object({
    planId: z.string(), billingCycle: upperEnum(['MONTHLY', 'ANNUAL']), startDate: z.string(), trialDays: z.coerce.number().int().min(0).optional(),
    implementationFee: z.coerce.number().min(0).optional(), subscriptionPrice: z.coerce.number().min(0).optional(), discount: z.coerce.number().min(0).optional(),
    taxRate: z.coerce.number().min(0).optional(), invoiceDueDays: z.coerce.number().int().min(0).optional(), gracePeriodDays: z.coerce.number().int().min(0).optional(),
    contractRenewalDate: z.string().optional(), notes: z.string().optional(),
  }),
  limits: z.object({
    maxUsers: z.coerce.number().int().positive().nullable().optional(), maxBranches: z.coerce.number().int().positive().nullable().optional(),
    maxBeds: z.coerce.number().int().positive().nullable().optional(), storageLimitMb: z.coerce.number().int().positive().nullable().optional(),
    enabledModules: z.array(z.string()).optional(), addOns: z.array(z.string()).optional(),
  }).optional(),
  administrator: z.object({
    fullName: z.string().min(2), email: z.string().email(), mobile: z.string().optional(),
    temporaryPassword: z.string().min(10).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
    roleKey: z.string().optional(), mustChangePassword: z.boolean().optional(),
  }),
});

function planDto(plan) {
  const currentVersion = plan.versions?.[0] || plan.currentVersion;
  const version = currentVersion ? {
    ...currentVersion,
    monthlyPrice: decimalNumber(currentVersion.monthlyPrice), annualPrice: decimalNumber(currentVersion.annualPrice),
    defaultImplementationFee: decimalNumber(currentVersion.defaultImplementationFee),
    features: currentVersion.features || [],
  } : null;
  return {
    id: plan.id, code: plan.code, name: plan.name, description: plan.description, isActive: plan.isActive,
    currentVersion: version,
    monthlyPrice: version?.monthlyPrice ?? 0, annualPrice: version?.annualPrice ?? 0,
    maxUsers: version?.maxUsers ?? null, maxBranches: version?.maxBranches ?? null, maxBeds: version?.maxBeds ?? null,
    storageLimitMb: version?.storageLimitMb ?? null,
    features: version?.features.filter((feature) => feature.enabled && !feature.isAddOn).map((feature) => feature.featureKey) || [],
    addOns: version?.features.filter((feature) => feature.enabled && feature.isAddOn) || [],
  };
}

function hospitalListDto(hospital) {
  const subscription = hospital.subscriptions?.[0] || null;
  const outstanding = (hospital.subscriptionInvoices || []).reduce((sum, invoice) => sum + Math.max(decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount), 0), 0);
  return {
    id: hospital.id, name: hospital.name, code: hospital.code, legalBusinessName: hospital.legalBusinessName, ntn: hospital.ntn,
    contactPerson: hospital.primaryContactName, email: hospital.email, phone: hospital.phone, address: hospital.address,
    city: hospital.city, province: hospital.province, numberOfBeds: hospital.numberOfBeds,
    numberOfBranches: hospital._count?.branches ?? hospital.declaredBranches, accountStatus: hospital.accountStatus,
    createdAt: hospital.createdAt, subscription,
    planName: subscription?.planVersion?.plan?.name || null, planId: subscription?.planVersion?.plan?.id || null,
    billingCycle: subscription?.billingCycle || null, subscriptionStatus: subscription?.status || null,
    nextBillingDate: subscription?.nextBillingDate || null, outstandingAmount: outstanding,
    enabledUsers: hospital._count?.users ?? 0,
  };
}

export function createSuperAdminRouter() {
  const router = Router();

  const overview = asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const now = new Date();
    const revenueStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const [hospitals, subscriptions, invoices, pendingProofs, enabledUsers, recentPayments, revenuePayments] = await Promise.all([
      db.hospital.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      db.hospitalSubscription.findMany({ where: { isCurrent: true }, include: { hospital: true, planVersion: { include: { plan: true } } } }),
      db.subscriptionInvoice.findMany({ include: { hospital: true }, orderBy: { issueDate: 'desc' } }),
      db.bankTransferProof.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } } }),
      db.hospitalUser.count({ where: { isActive: true } }),
      db.subscriptionPayment.findMany({ include: { hospital: true, invoice: true }, orderBy: { paidAt: 'desc' }, take: 10 }),
      db.subscriptionPayment.findMany({ where: { paidAt: { gte: revenueStart } }, select: { paidAt: true, amount: true } }),
    ]);
    const statusDistribution = Object.entries(subscriptions.reduce((map, item) => ({ ...map, [item.status]: (map[item.status] || 0) + 1 }), {})).map(([status, count]) => ({ status, count }));
    const statusDistributionMap = Object.fromEntries(statusDistribution.map((item) => [item.status, item.count]));
    const monthlyRecurringRevenue = subscriptions.filter((item) => item.status === 'ACTIVE').reduce((sum, item) => {
      const netPrice = Math.max(decimalNumber(item.price) - decimalNumber(item.discount), 0);
      return sum + (item.billingCycle === 'ANNUAL' ? netPrice / 12 : netPrice);
    }, 0);
    const annualRecurringRevenue = subscriptions.filter((item) => item.status === 'ACTIVE').reduce((sum, item) => {
      const netPrice = Math.max(decimalNumber(item.price) - decimalNumber(item.discount), 0);
      return sum + (item.billingCycle === 'ANNUAL' ? netPrice : netPrice * 12);
    }, 0);
    const outstanding = invoices.filter((item) => !['VOID', 'CREDITED', 'PAID'].includes(item.status)).reduce((sum, item) => sum + Math.max(decimalNumber(item.total) - decimalNumber(item.paidAmount), 0), 0);
    const in30Days = addDays(now, 30);
    const metrics = {
      totalHospitals: await db.hospital.count(), activeHospitals: subscriptions.filter((item) => item.status === 'ACTIVE').length,
      trialHospitals: subscriptions.filter((item) => item.status === 'TRIALING').length,
      pastDueHospitals: subscriptions.filter((item) => ['PAST_DUE', 'GRACE_PERIOD'].includes(item.status)).length,
      readOnlyHospitals: subscriptions.filter((item) => ['READ_ONLY', 'PAUSED'].includes(item.status)).length,
      suspendedHospitals: subscriptions.filter((item) => item.status === 'SUSPENDED').length,
      monthlyRecurringRevenue, annualRecurringRevenue, outstandingSubscriptionInvoices: outstanding,
      paymentsAwaitingVerification: pendingProofs,
      renewingNext30Days: subscriptions.filter((item) => item.nextBillingDate && item.nextBillingDate >= now && item.nextBillingDate <= in30Days).length,
      totalEnabledUsers: enabledUsers,
    };
    const months = Array.from({ length: 6 }, (_, offset) => {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - offset), 1));
      const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
      return { month: month.toISOString().slice(0, 7), revenue: revenuePayments.filter((payment) => payment.paidAt >= month && payment.paidAt < next).reduce((sum, payment) => sum + decimalNumber(payment.amount), 0) };
    });
    res.json({ data: {
      ...metrics, metrics,
      recentHospitalSignups: hospitals.map((hospital) => ({
        ...hospital,
        subscriptionStatus: subscriptions.find((subscription) => subscription.hospitalId === hospital.id)?.status || null,
      })),
      recentSubscriptionPayments: recentPayments.map((payment) => ({ ...payment, amount: decimalNumber(payment.amount) })),
      recentSignups: hospitals,
      recentPayments: recentPayments.map((payment) => ({ ...payment, amount: decimalNumber(payment.amount) })),
      statusDistribution, statusDistributionMap, monthlySubscriptionRevenue: months, monthlyRevenue: months,
    } });
  });
  router.get('/overview', overview);
  router.get('/dashboard', overview);

  router.get('/features', (_req, res) => res.json({ data: FEATURE_KEYS }));

  router.get('/hospitals', asyncHandler(async (req, res) => {
    const search = z.string().trim().max(100).parse(req.query.search ?? '');
    const rows = await req.app.locals.prisma.hospital.findMany({
      where: search ? { OR: [
        { name: { contains: search } },
        { code: { contains: search } },
        { primaryContactName: { contains: search } },
        { primaryContactEmail: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
        { primaryContactMobile: { contains: search } },
        { city: { contains: search } },
        { province: { contains: search } },
      ] } : undefined,
      include: {
        subscriptions: { where: { isCurrent: true }, take: 1, orderBy: { createdAt: 'desc' }, include: { planVersion: { include: { plan: true } } } },
        subscriptionInvoices: { select: { total: true, paidAmount: true, status: true } },
        _count: { select: { users: { where: { isActive: true } }, branches: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    let data = rows.map(hospitalListDto);
    if (req.query.status) data = data.filter((row) => row.subscriptionStatus === String(req.query.status).toUpperCase());
    if (req.query.plan) data = data.filter((row) => row.planId === req.query.plan || row.planName === req.query.plan);
    res.json({ data });
  }));

  router.post('/hospitals', asyncHandler(async (req, res) => {
    const input = hospitalSchema.parse(req.body);
    const result = await onboardHospital(req.app.locals.prisma, input, req.auth.user, req.ip);
    res.status(201).json({ data: result });
  }));

  router.get('/hospitals/:id', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const hospital = await db.hospital.findUnique({
      where: { id: req.params.id },
      include: {
        branches: true, users: { include: { role: true } }, settings: true,
        subscriptions: { orderBy: { createdAt: 'desc' }, include: { planVersion: { include: { plan: true, features: true } }, featureOverrides: true } },
        subscriptionInvoices: { include: { items: true }, orderBy: { issueDate: 'desc' } },
        subscriptionPayments: { orderBy: { paidAt: 'desc' } }, bankTransferProofs: { orderBy: { submittedAt: 'desc' } },
        auditLogs: { where: platformAuditWhere(), orderBy: { createdAt: 'desc' }, take: 100 }, supportRequests: { orderBy: { createdAt: 'desc' } },
        _count: { select: { patients: true, users: true, branches: true } },
      },
    });
    if (!hospital) throw notFound('Hospital not found.');
    const [activeUsers, activeBranches, proofStorage] = await Promise.all([
      db.hospitalUser.count({ where: { hospitalId: hospital.id, isActive: true } }),
      db.hospitalBranch.count({ where: { hospitalId: hospital.id, isActive: true } }),
      db.bankTransferProof.aggregate({ where: { hospitalId: hospital.id }, _sum: { fileSize: true } }),
    ]);
    const currentSubscription = hospital.subscriptions.find((item) => item.isCurrent) || hospital.subscriptions[0];
    const baseFeatures = new Set(currentSubscription?.planVersion.features.filter((feature) => feature.enabled).map((feature) => feature.featureKey) || []);
    const now = new Date();
    for (const override of currentSubscription?.featureOverrides || []) {
      if (override.expiresAt && override.expiresAt <= now) continue;
      override.enabled ? baseFeatures.add(override.featureKey) : baseFeatures.delete(override.featureKey);
    }
    const supportSetting = hospital.settings.find((setting) => setting.key === 'support_note');
    const currentSubscriptionDto = currentSubscription ? { ...currentSubscription, plan: currentSubscription.planVersion.plan, planName: currentSubscription.planVersion.plan.name } : null;
    const storageLimitMb = currentSubscription?.storageLimitMb ?? currentSubscription?.planVersion.storageLimitMb ?? null;
    const outstandingAmount = hospital.subscriptionInvoices
      .filter((invoice) => !['VOID', 'CREDITED'].includes(invoice.status))
      .reduce((sum, invoice) => sum + Math.max(decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount), 0), 0);
    res.json({ data: {
      ...hospital,
      users: hospital.users.map(hospitalUserDto),
      branches: hospital.branches.map((branch) => ({ ...branch, status: branch.isActive === false ? 'DISABLED' : 'ACTIVE' })),
      bankTransferProofs: hospital.bankTransferProofs.map((proof) => ({ ...proof, claimedAmount: decimalNumber(proof.amount) })),
      enabledModules: [...baseFeatures],
      usage: {
        users: activeUsers,
        branches: activeBranches,
        beds: hospital.numberOfBeds || 0,
        storageMb: Number(((proofStorage._sum.fileSize || 0) / (1024 * 1024)).toFixed(2)),
        storageGb: Number(((proofStorage._sum.fileSize || 0) / (1024 * 1024 * 1024)).toFixed(4)),
      },
      limits: {
        maxUsers: currentSubscription?.maxUsers ?? currentSubscription?.planVersion.maxUsers ?? null,
        maxBranches: currentSubscription?.maxBranches ?? currentSubscription?.planVersion.maxBranches ?? null,
        maxBeds: currentSubscription?.maxBeds ?? currentSubscription?.planVersion.maxBeds ?? null,
        storageLimitMb,
        storageGb: storageLimitMb === null ? null : Number(storageLimitMb) / 1024,
      },
      supportNote: supportSetting?.value || '',
      supportNotes: supportSetting ? [{ id: supportSetting.id, note: supportSetting.value, createdAt: supportSetting.updatedAt }] : [],
      currentSubscription: currentSubscriptionDto,
      subscription: currentSubscriptionDto,
      outstandingAmount,
      subscriptionInvoices: hospital.subscriptionInvoices.map(subscriptionInvoiceDto),
      subscriptionPayments: hospital.subscriptionPayments.map((payment) => ({
        ...payment,
        amount: decimalNumber(payment.amount),
        reference: payment.paymentReference,
        method: payment.provider,
        status: 'COMPLETED',
      })),
      auditLogs: hospital.auditLogs.filter(isPlatformAuditVisible).map(platformAuditDto),
    } });
  }));

  router.patch('/hospitals/:id', asyncHandler(async (req, res) => {
    const input = z.object({
      name: z.string().min(2).optional(), code: z.string().min(2).optional(), legalBusinessName: z.string().optional(), ntn: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(),
      address: z.string().optional(), city: z.string().optional(), province: z.string().optional(), numberOfBeds: z.coerce.number().int().min(0).optional(),
      primaryContactName: z.string().optional(), primaryContactDesignation: z.string().optional(), primaryContactMobile: z.string().optional(), primaryContactEmail: z.string().email().optional(),
      enabledModules: z.array(z.string()).optional(), supportNote: z.string().optional(), reason: z.string().min(3).optional(),
    }).parse(req.body);
    const db = req.app.locals.prisma;
    const previous = await db.hospital.findUnique({ where: { id: req.params.id } });
    if (!previous) throw notFound('Hospital not found.');
    const { enabledModules, supportNote, reason, ...details } = input;
    if (details.code) details.code = normalizeCode(details.code);
    const hospital = await db.$transaction(async (tx) => {
      const updated = await tx.hospital.update({ where: { id: previous.id }, data: details });
      if (enabledModules) {
        const subscription = await tx.hospitalSubscription.findFirst({ where: { hospitalId: previous.id, isCurrent: true }, orderBy: { createdAt: 'desc' } });
        if (!subscription) throw notFound('Current hospital subscription not found.');
        const selected = new Set(enabledModules);
        for (const key of FEATURE_KEYS) {
          if (['dashboard', 'subscription_billing', 'user_management', 'data_export', 'support'].includes(key)) continue;
          await tx.hospitalFeatureOverride.upsert({
            where: { hospitalId_featureKey: { hospitalId: previous.id, featureKey: key } },
            create: { hospitalId: previous.id, subscriptionId: subscription.id, featureKey: key, enabled: selected.has(key), reason: reason || 'Super Admin hospital module configuration', changedByPlatformUserId: req.auth.user.id },
            update: { subscriptionId: subscription.id, enabled: selected.has(key), reason: reason || 'Super Admin hospital module configuration', changedByPlatformUserId: req.auth.user.id },
          });
        }
      }
      if (supportNote !== undefined) await tx.hospitalSetting.upsert({ where: { hospitalId_key: { hospitalId: previous.id, key: 'support_note' } }, create: { hospitalId: previous.id, key: 'support_note', value: supportNote }, update: { value: supportNote } });
      await writeAudit(tx, { hospitalId: previous.id, actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName,
        action: enabledModules ? 'HOSPITAL_MODULES_CHANGED' : supportNote !== undefined ? 'HOSPITAL_SUPPORT_NOTE_CHANGED' : 'HOSPITAL_DETAILS_CHANGED',
        entityType: 'Hospital', entityId: previous.id, previousValue: previous, newValue: input, reason, ipAddress: req.ip });
      return updated;
    });
    res.json({ data: { ...hospital, enabledModules, supportNote } });
  }));

  router.get('/plans', asyncHandler(async (req, res) => {
    const plans = await req.app.locals.prisma.subscriptionPlan.findMany({ include: { versions: { where: { isPublished: true }, orderBy: { version: 'desc' }, take: 1, include: { features: true } } }, orderBy: { name: 'asc' } });
    res.json({ data: plans.map(planDto) });
  }));

  const planInputSchema = z.object({
    code: z.string().optional(), name: z.string().min(2).optional(), description: z.string().optional(), isActive: z.boolean().optional(),
    monthlyPrice: z.coerce.number().min(0).optional(), annualPrice: z.coerce.number().min(0).optional(), defaultImplementationFee: z.coerce.number().min(0).optional(),
    maxUsers: z.coerce.number().int().positive().nullable().optional(), maxBranches: z.coerce.number().int().positive().nullable().optional(),
    maxBeds: z.coerce.number().int().positive().nullable().optional(), storageLimitMb: z.coerce.number().int().positive().nullable().optional(),
    features: z.array(z.union([z.string(), z.object({ featureKey: z.string(), enabled: z.boolean().optional(), isAddOn: z.boolean().optional() })])).optional(),
  });
  router.post('/plans', asyncHandler(async (req, res) => {
    const input = planInputSchema.extend({ code: z.string().min(2), name: z.string().min(2), monthlyPrice: z.coerce.number().min(0), annualPrice: z.coerce.number().min(0) }).parse(req.body);
    const features = input.features || [];
    const plan = await req.app.locals.prisma.subscriptionPlan.create({ data: {
      code: normalizeCode(input.code), name: input.name, description: input.description, isActive: input.isActive ?? true,
      versions: { create: { version: 1, monthlyPrice: input.monthlyPrice, annualPrice: input.annualPrice, defaultImplementationFee: input.defaultImplementationFee || 0,
        maxUsers: input.maxUsers, maxBranches: input.maxBranches, maxBeds: input.maxBeds, storageLimitMb: input.storageLimitMb,
        features: { create: features.map((feature) => typeof feature === 'string' ? { featureKey: feature } : { featureKey: feature.featureKey, enabled: feature.enabled ?? true, isAddOn: feature.isAddOn ?? false }) },
      } },
    }, include: { versions: { include: { features: true } } } });
    await auditAdmin(req, { action: 'SUBSCRIPTION_PLAN_CREATED', entityType: 'SubscriptionPlan', entityId: plan.id, newValue: input });
    res.status(201).json({ data: planDto({ ...plan, versions: [plan.versions[0]] }) });
  }));

  router.patch('/plans/:id', asyncHandler(async (req, res) => {
    const input = planInputSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const previous = await db.subscriptionPlan.findUnique({ where: { id: req.params.id }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { features: true } } } });
    if (!previous) throw notFound('Subscription plan not found.');
    await db.$transaction(async (tx) => {
      await tx.subscriptionPlan.update({ where: { id: previous.id }, data: { name: input.name, description: input.description, isActive: input.isActive } });
      const versionKeys = ['monthlyPrice', 'annualPrice', 'defaultImplementationFee', 'maxUsers', 'maxBranches', 'maxBeds', 'storageLimitMb', 'features'];
      if (versionKeys.some((key) => input[key] !== undefined)) {
        const current = previous.versions[0];
        const features = input.features || current.features.map((feature) => ({ featureKey: feature.featureKey, enabled: feature.enabled, isAddOn: feature.isAddOn }));
        await tx.subscriptionPlanVersion.create({ data: {
          planId: previous.id, version: current.version + 1,
          monthlyPrice: input.monthlyPrice ?? current.monthlyPrice, annualPrice: input.annualPrice ?? current.annualPrice,
          defaultImplementationFee: input.defaultImplementationFee ?? current.defaultImplementationFee,
          maxUsers: input.maxUsers === undefined ? current.maxUsers : input.maxUsers,
          maxBranches: input.maxBranches === undefined ? current.maxBranches : input.maxBranches,
          maxBeds: input.maxBeds === undefined ? current.maxBeds : input.maxBeds,
          storageLimitMb: input.storageLimitMb === undefined ? current.storageLimitMb : input.storageLimitMb,
          features: { create: features.map((feature) => typeof feature === 'string' ? { featureKey: feature } : { featureKey: feature.featureKey, enabled: feature.enabled ?? true, isAddOn: feature.isAddOn ?? false }) },
        } });
      }
      await writeAudit(tx, { actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName, action: 'SUBSCRIPTION_PLAN_CHANGED', entityType: 'SubscriptionPlan', entityId: previous.id, previousValue: planDto(previous), newValue: input, ipAddress: req.ip });
    });
    const plan = await db.subscriptionPlan.findUnique({ where: { id: previous.id }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { features: true } } } });
    res.json({ data: planDto(plan) });
  }));

  router.post('/hospitals/:id/access-state', asyncHandler(async (req, res) => {
    const input = z.object({ status: upperEnum(['TRIALING', 'PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED']), reason: z.string().min(3) }).parse(req.body);
    const db = req.app.locals.prisma;
    const subscription = await db.hospitalSubscription.findFirst({ where: { hospitalId: req.params.id, isCurrent: true }, orderBy: { createdAt: 'desc' } });
    if (!subscription) throw notFound('Current hospital subscription not found.');
    assertSubscriptionTransition(subscription.status, input.status);
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.hospitalSubscription.update({ where: { id: subscription.id }, data: {
        status: input.status,
        gracePeriodEndsAt: input.status === 'ACTIVE' ? null : undefined,
        canceledAt: input.status === 'CANCELED' ? new Date() : input.status === 'ACTIVE' ? null : undefined,
      } });
      await tx.hospital.update({ where: { id: subscription.hospitalId }, data: { accountStatus: input.status } });
      await createNotification(tx, {
        hospitalId: subscription.hospitalId, type: `SUBSCRIPTION_${input.status}`, title: `Subscription status: ${input.status.replaceAll('_', ' ').toLowerCase()}`,
        body: input.reason, severity: ['ACTIVE', 'TRIALING'].includes(input.status) ? 'SUCCESS' : 'WARNING', link: '/hospital/subscription',
        dedupeKey: `manual-status:${subscription.id}:${input.status}:${Date.now()}`,
      });
      await writeAudit(tx, { hospitalId: subscription.hospitalId, actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName,
        action: input.status === 'ACTIVE' ? 'HOSPITAL_REACTIVATED' : `SUBSCRIPTION_${input.status}`, entityType: 'HospitalSubscription', entityId: subscription.id,
        previousValue: { status: subscription.status }, newValue: { status: input.status }, reason: input.reason, ipAddress: req.ip });
      return row;
    });
    res.json({ data: updated });
  }));

  router.get('/subscriptions', asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.hospitalSubscription.findMany({
      where: { isCurrent: true }, include: { hospital: true, planVersion: { include: { plan: true, features: true } }, featureOverrides: true }, orderBy: { createdAt: 'desc' },
    });
    res.json({ data: rows.map((row) => ({
      ...row, price: decimalNumber(row.price), discount: decimalNumber(row.discount), taxRate: decimalNumber(row.taxRate), implementationFee: decimalNumber(row.implementationFee),
      hospitalName: row.hospital.name, hospitalCode: row.hospital.code, planId: row.planVersion.plan.id, planName: row.planVersion.plan.name,
      enabledModules: row.planVersion.features.filter((feature) => feature.enabled).map((feature) => feature.featureKey).filter((key) => !row.featureOverrides.some((override) => override.featureKey === key && !override.enabled)).concat(row.featureOverrides.filter((override) => override.enabled).map((override) => override.featureKey)).filter((key, index, array) => array.indexOf(key) === index),
    })) });
  }));

  router.patch('/subscriptions/:id', asyncHandler(async (req, res) => {
    const input = z.object({
      planId: z.string().optional(), billingCycle: upperEnum(['MONTHLY', 'ANNUAL']).optional(), status: upperEnum(['TRIALING', 'PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'READ_ONLY', 'PAUSED', 'SUSPENDED', 'CANCELED']).optional(),
      price: z.coerce.number().min(0).optional(), discount: z.coerce.number().min(0).optional(), taxRate: z.coerce.number().min(0).optional(),
      invoiceDueDays: z.coerce.number().int().min(0).optional(), gracePeriodDays: z.coerce.number().int().min(0).optional(),
      maxUsers: z.coerce.number().int().positive().nullable().optional(), maxBranches: z.coerce.number().int().positive().nullable().optional(), maxBeds: z.coerce.number().int().positive().nullable().optional(), storageLimitMb: z.coerce.number().int().positive().nullable().optional(),
      enabledModules: z.array(z.string()).optional(), reason: z.string().min(3).optional(),
    }).parse(req.body);
    if (input.status && !input.reason) throw badRequest('A reason is required when changing subscription status.');
    const db = req.app.locals.prisma;
    const previous = await db.hospitalSubscription.findUnique({ where: { id: req.params.id }, include: { planVersion: { include: { plan: true } } } });
    if (!previous) throw notFound('Subscription not found.');
    if (input.status) assertSubscriptionTransition(previous.status, input.status);
    const statusChanged = Boolean(input.status && input.status !== previous.status);
    let nextPlanVersion = null;
    if (input.planId) nextPlanVersion = await db.subscriptionPlanVersion.findFirst({ where: { planId: input.planId, isPublished: true }, orderBy: { version: 'desc' } });
    if (input.planId && !nextPlanVersion) throw notFound('The requested plan version was not found.');
    const resolvedCycle = input.billingCycle || previous.billingCycle;
    const resolvedPrice = input.price ?? (nextPlanVersion ? (resolvedCycle === 'ANNUAL' ? nextPlanVersion.annualPrice : nextPlanVersion.monthlyPrice) : undefined);
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.hospitalSubscription.update({ where: { id: previous.id }, data: {
        planVersionId: nextPlanVersion?.id, billingCycle: input.billingCycle, status: input.status, price: resolvedPrice,
        discount: input.discount, taxRate: input.taxRate, invoiceDueDays: input.invoiceDueDays, gracePeriodDays: input.gracePeriodDays,
        maxUsers: input.maxUsers, maxBranches: input.maxBranches, maxBeds: input.maxBeds, storageLimitMb: input.storageLimitMb,
        gracePeriodEndsAt: input.status === 'ACTIVE' ? null : undefined,
        canceledAt: input.status === 'CANCELED' ? new Date() : input.status === 'ACTIVE' ? null : undefined,
      } });
      if (input.status && previous.isCurrent) await tx.hospital.update({ where: { id: previous.hospitalId }, data: { accountStatus: input.status } });
      if (statusChanged) {
        await createNotification(tx, {
          hospitalId: previous.hospitalId,
          type: `SUBSCRIPTION_${input.status}`,
          title: `Subscription status: ${input.status.replaceAll('_', ' ').toLowerCase()}`,
          body: input.reason,
          severity: ['ACTIVE', 'TRIALING'].includes(input.status) ? 'SUCCESS' : 'WARNING',
          link: '/hospital/subscription',
          dedupeKey: `manual-status:${previous.id}:${previous.status}:${input.status}:${previous.updatedAt.toISOString()}`,
        });
      }
      if (input.enabledModules) {
        const selected = new Set(input.enabledModules);
        for (const key of FEATURE_KEYS) {
          if (['dashboard', 'subscription_billing', 'user_management', 'data_export', 'support'].includes(key)) continue;
          await tx.hospitalFeatureOverride.upsert({
            where: { hospitalId_featureKey: { hospitalId: previous.hospitalId, featureKey: key } },
            create: { hospitalId: previous.hospitalId, subscriptionId: previous.id, featureKey: key, enabled: selected.has(key), reason: input.reason || 'Super Admin module configuration', changedByPlatformUserId: req.auth.user.id },
            update: { enabled: selected.has(key), reason: input.reason || 'Super Admin module configuration', changedByPlatformUserId: req.auth.user.id },
          });
        }
      }
      await writeAudit(tx, { hospitalId: previous.hospitalId, actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName,
        action: input.enabledModules ? 'HOSPITAL_MODULES_CHANGED' : input.planId ? 'HOSPITAL_PLAN_CHANGED' : 'SUBSCRIPTION_CHANGED', entityType: 'HospitalSubscription', entityId: previous.id,
        previousValue: previous, newValue: input, reason: input.reason, ipAddress: req.ip });
      return row;
    });
    res.json({ data: updated });
  }));

  router.post('/subscriptions/process', asyncHandler(async (req, res) => {
    const asOf = req.body?.asOf ? new Date(req.body.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw badRequest('Processing date is invalid.');
    const result = await processSubscriptions(req.app.locals.prisma, asOf, req.auth.user, req.ip);
    res.json({ data: result });
  }));

  router.get('/invoices', asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.subscriptionInvoice.findMany({ include: { hospital: true, items: true, payments: true }, orderBy: { issueDate: 'desc' } });
    res.json({ data: rows.map((row) => ({ ...subscriptionInvoiceDto(row), hospitalName: row.hospital.name, hospitalCode: row.hospital.code })) });
  }));

  router.post('/invoices', asyncHandler(async (req, res) => {
    const input = z.object({
      hospitalId: z.string(), subscriptionId: z.string().optional(), invoiceType: z.string().optional(), type: z.string().optional(),
      issueDate: z.string().optional(), dueDate: z.string().optional(), billingPeriodStart: z.string().nullable().optional(), billingPeriodEnd: z.string().nullable().optional(),
      billingPeriod: z.object({ start: z.string(), end: z.string() }).optional(), discount: z.coerce.number().min(0).optional(), taxRate: z.coerce.number().min(0).optional(),
      status: upperEnum(['DRAFT', 'ISSUED']).optional(), paymentInstructions: z.string().max(2000).optional(),
      items: z.array(z.object({ description: z.string().min(2), quantity: z.coerce.number().positive().optional(), unitAmount: z.coerce.number().min(0) })).min(1),
    }).refine((value) => value.invoiceType || value.type, { message: 'Invoice type is required.' }).parse(req.body);
    const invoiceType = String(input.invoiceType || input.type).toUpperCase();
    const allowedTypes = ['IMPLEMENTATION_FEE', 'MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION', 'ADDITIONAL_USER_CHARGES', 'ADDITIONAL_BRANCH_CHARGES', 'ADD_ON_MODULE_CHARGES', 'CUSTOMISATION_CHARGES', 'TRAINING_CHARGES', 'SUPPORT_CHARGES'];
    if (!allowedTypes.includes(invoiceType)) throw badRequest('Invoice type is invalid.');
    const subscription = await req.app.locals.prisma.hospitalSubscription.findFirst({ where: { hospitalId: input.hospitalId, isCurrent: true, ...(input.subscriptionId ? { id: input.subscriptionId } : {}) }, orderBy: { createdAt: 'desc' } });
    if (!subscription) throw notFound('Subscription not found for this hospital.');
    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    const dueDate = input.dueDate ? new Date(input.dueDate) : undefined;
    const periodStartValue = input.billingPeriodStart || input.billingPeriod?.start;
    const periodEndValue = input.billingPeriodEnd || input.billingPeriod?.end;
    const periodStart = periodStartValue ? new Date(periodStartValue) : null;
    const periodEnd = periodEndValue ? new Date(periodEndValue) : null;
    if ([issueDate, dueDate, periodStart, periodEnd].filter(Boolean).some((date) => Number.isNaN(date.getTime()))) throw badRequest('One or more invoice dates are invalid.');
    if (dueDate && dueDate < issueDate) throw badRequest('Invoice due date cannot be before the issue date.');
    if (periodStart && periodEnd && periodEnd <= periodStart) throw badRequest('Billing period end must be after its start.');
    const invoice = await createSubscriptionInvoice(req.app.locals.prisma, {
      hospitalId: input.hospitalId, subscriptionId: subscription.id, type: invoiceType, issueDate,
      dueDate, dueDays: subscription.invoiceDueDays, periodStart, periodEnd,
      items: input.items, discount: input.discount, taxRate: input.taxRate,
      status: input.status || 'ISSUED', paymentInstructions: input.paymentInstructions,
      idempotencyKey: `manual:${subscription.id}:${randomUUID()}`,
    });
    await auditAdmin(req, { hospitalId: input.hospitalId, action: 'SUBSCRIPTION_INVOICE_CREATED', entityType: 'SubscriptionInvoice', entityId: invoice.id, newValue: { invoiceNumber: invoice.invoiceNumber, type: invoiceType, status: invoice.status } });
    res.status(201).json({ data: subscriptionInvoiceDto(invoice) });
  }));

  async function recordInvoicePayment(req, input) {
    const db = req.app.locals.prisma;
    const invoice = await db.subscriptionInvoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) throw notFound('Subscription invoice not found.');
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw badRequest('Payment date is invalid.');
    const rawProvider = String(input.provider || input.method || 'MANUAL_BANK_TRANSFER').toUpperCase().replaceAll(' ', '_');
    const provider = ['BANK_TRANSFER', 'BANK'].includes(rawProvider) ? 'MANUAL_BANK_TRANSFER' : rawProvider;
    if (!['MANUAL_BANK_TRANSFER', 'CASH', 'ADJUSTMENT'].includes(provider)) throw badRequest('Manual payment provider must be bank transfer, cash, or adjustment. Safepay payments require a verified webhook.');
    return withSerializableFinancialTransaction(db, (tx) => applySubscriptionPayment(tx, {
      invoiceId: invoice.id, hospitalId: invoice.hospitalId, provider,
      reference: input.reference, amount: input.amount, paidAt,
      actor: adminActor(req), ipAddress: req.ip, notes: input.notes,
    }));
  }

  const adminPaymentSchema = z.object({ amount: z.coerce.number().positive(), reference: z.string().min(3), paidAt: z.string().optional(), notes: z.string().optional(), provider: z.string().optional(), method: z.string().optional() });
  router.post('/invoices/:id/payments', asyncHandler(async (req, res) => {
    const result = await recordInvoicePayment(req, adminPaymentSchema.parse(req.body));
    res.status(201).json({ data: result });
  }));

  async function applyCreditNote(req, input) {
    const db = req.app.locals.prisma;
    const source = await db.subscriptionInvoice.findUnique({ where: { id: req.params.id } });
    if (!source) throw notFound('Subscription invoice not found.');
    if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(source.status)) throw conflict('A credit note can only be applied to an open issued invoice.');
    const outstanding = Math.max(decimalNumber(source.total) - decimalNumber(source.paidAmount), 0);
    const amount = Number(input.amount);
    if (amount > outstanding + 0.001) throw badRequest('Credit note amount cannot exceed the invoice balance.');
    return withSerializableFinancialTransaction(db, async (tx) => {
      const credit = await tx.subscriptionInvoice.create({ data: {
        hospitalId: source.hospitalId, subscriptionId: source.subscriptionId,
        invoiceNumber: `AF-CN-${new Date().getUTCFullYear()}-${Date.now().toString().slice(-8)}`, invoiceType: 'CREDIT_NOTE',
        issueDate: new Date(), dueDate: new Date(), subtotal: -amount, discount: 0, tax: 0, total: -amount,
        paidAmount: -amount, status: 'CREDITED', issuedAt: new Date(), idempotencyKey: `credit:${source.id}:${Date.now()}`,
        paymentInstructions: `Credit against ${source.invoiceNumber}: ${input.reason}`,
        items: { create: { hospitalId: source.hospitalId, description: `Credit note for ${source.invoiceNumber}: ${input.reason}`, quantity: 1, unitAmount: -amount, lineTotal: -amount } },
      }, include: { items: true } });
      const nextPaid = decimalNumber(source.paidAmount) + amount;
      const sourceClaim = await tx.subscriptionInvoice.updateMany({
        where: { id: source.id, status: source.status, paidAmount: source.paidAmount },
        data: { paidAmount: nextPaid, status: nextPaid + 0.001 >= decimalNumber(source.total) ? 'CREDITED' : 'PARTIALLY_PAID' },
      });
      if (sourceClaim.count !== 1) throw conflict('The invoice balance changed while this credit note was being applied. Reload the invoice and try again.');
      await writeAudit(tx, { hospitalId: source.hospitalId, actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName,
        action: 'SUBSCRIPTION_CREDIT_NOTE_APPLIED', entityType: 'SubscriptionInvoice', entityId: credit.id,
        previousValue: { sourceInvoiceId: source.id, paidAmount: decimalNumber(source.paidAmount) }, newValue: { sourceInvoiceId: source.id, creditAmount: amount }, reason: input.reason, ipAddress: req.ip });
      return credit;
    });
  }
  const creditSchema = z.object({ amount: z.coerce.number().positive(), reason: z.string().min(3) });
  router.post('/invoices/:id/credit-notes', asyncHandler(async (req, res) => {
    const credit = await applyCreditNote(req, creditSchema.parse(req.body));
    res.status(201).json({ data: subscriptionInvoiceDto(credit) });
  }));

  router.patch('/invoices/:id/status', asyncHandler(async (req, res) => {
    const input = z.object({
      status: upperEnum(['DRAFT', 'ISSUED', 'OVERDUE', 'VOID']).optional(),
      reason: z.string().min(3).optional(), payment: adminPaymentSchema.optional(), creditNote: creditSchema.optional(),
    }).refine((value) => value.status || value.payment || value.creditNote, { message: 'Status, payment, or credit note data is required.' }).parse(req.body);
    if (input.payment) {
      const result = await recordInvoicePayment(req, input.payment);
      const invoice = await req.app.locals.prisma.subscriptionInvoice.findUnique({ where: { id: req.params.id }, include: { items: true } });
      return res.json({ data: { ...subscriptionInvoiceDto(invoice), payment: result.payment } });
    }
    if (input.creditNote) {
      const credit = await applyCreditNote(req, input.creditNote);
      const invoice = await req.app.locals.prisma.subscriptionInvoice.findUnique({ where: { id: req.params.id }, include: { items: true } });
      return res.json({ data: { ...subscriptionInvoiceDto(invoice), creditNote: subscriptionInvoiceDto(credit) } });
    }
    if (input.status === 'VOID' && !input.reason) throw badRequest('A reason is required to void an invoice.');
    const db = req.app.locals.prisma;
    const previous = await db.subscriptionInvoice.findUnique({ where: { id: req.params.id } });
    if (!previous) throw notFound('Subscription invoice not found.');
    assertInvoiceTransition(previous.status, input.status);
    if (previous.status === input.status) return res.json({ data: subscriptionInvoiceDto(previous) });
    if (input.status === 'VOID' && decimalNumber(previous.paidAmount) > 0) throw conflict('An invoice with recorded payments cannot be voided; use a credit/refund workflow.');
    const invoice = await db.subscriptionInvoice.update({ where: { id: previous.id }, data: { status: input.status, issuedAt: input.status === 'ISSUED' ? (previous.issuedAt || new Date()) : undefined, voidedAt: input.status === 'VOID' ? new Date() : undefined } });
    await auditAdmin(req, { hospitalId: invoice.hospitalId, action: `SUBSCRIPTION_INVOICE_${input.status}`, entityType: 'SubscriptionInvoice', entityId: invoice.id, previousValue: { status: previous.status }, newValue: { status: input.status }, reason: input.reason });
    res.json({ data: subscriptionInvoiceDto(invoice) });
  }));

  router.get('/payment-proofs', asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.bankTransferProof.findMany({
      include: { hospital: true, invoice: true, approvedPayment: true }, orderBy: { submittedAt: 'desc' },
    });
    res.json({ data: rows.map((proof) => ({
      ...proof, amount: decimalNumber(proof.amount), hospitalName: proof.hospital.name, hospitalCode: proof.hospital.code,
      invoiceNumber: proof.invoice.invoiceNumber, invoiceBalance: Math.max(decimalNumber(proof.invoice.total) - decimalNumber(proof.invoice.paidAmount), 0),
      proofUrl: `/api/super-admin/payment-proofs/${proof.id}/file`, fileUrl: `/api/super-admin/payment-proofs/${proof.id}/file`,
    })) });
  }));

  router.get('/payment-proofs/:id/file', asyncHandler(async (req, res) => {
    const proof = await req.app.locals.prisma.bankTransferProof.findUnique({ where: { id: req.params.id } });
    if (!proof) throw notFound('Payment proof not found.');
    if (path.basename(proof.storageKey) !== proof.storageKey) throw badRequest('Stored payment proof path is invalid.');
    res.setHeader('Content-Type', proof.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(proof.originalFileName).replace(/"/g, '')}"`);
    res.sendFile(path.join(env.uploadDir, proof.storageKey));
  }));

  router.post('/payment-proofs/:id/under-review', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const proof = await db.bankTransferProof.findUnique({ where: { id: req.params.id } });
    if (!proof) throw notFound('Payment proof not found.');
    if (proof.status !== 'PENDING') throw conflict('Only a pending payment proof can be marked under review.');
    const updated = await db.bankTransferProof.update({ where: { id: proof.id }, data: { status: 'UNDER_REVIEW', reviewedByPlatformUserId: req.auth.user.id } });
    await auditAdmin(req, { hospitalId: proof.hospitalId, action: 'PAYMENT_PROOF_UNDER_REVIEW', entityType: 'BankTransferProof', entityId: proof.id, previousValue: { status: proof.status }, newValue: { status: 'UNDER_REVIEW' } });
    res.json({ data: updated });
  }));

  router.post('/payment-proofs/:id/approve', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const proof = await db.bankTransferProof.findUnique({ where: { id: req.params.id }, include: { invoice: true } });
    if (!proof) throw notFound('Payment proof not found.');
    if (!['PENDING', 'UNDER_REVIEW'].includes(proof.status)) throw conflict('Only a pending or under-review proof can be approved.');
    const result = await withSerializableFinancialTransaction(db, async (tx) => {
      const paymentResult = await applySubscriptionPayment(tx, {
        invoiceId: proof.invoiceId, hospitalId: proof.hospitalId, provider: 'MANUAL_BANK_TRANSFER', reference: proof.transactionReference,
        amount: proof.amount, paidAt: proof.transferDate, proofId: proof.id, actor: adminActor(req), ipAddress: req.ip,
      });
      const updatedProof = await tx.bankTransferProof.update({ where: { id: proof.id }, data: {
        status: 'APPROVED', reviewedByPlatformUserId: req.auth.user.id, reviewedAt: new Date(), rejectionReason: null,
      } });
      await writeAudit(tx, { hospitalId: proof.hospitalId, actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName,
        action: 'PAYMENT_PROOF_APPROVED', entityType: 'BankTransferProof', entityId: proof.id, previousValue: { status: proof.status },
        newValue: { status: 'APPROVED', paymentId: paymentResult.payment.id }, ipAddress: req.ip });
      return { proof: updatedProof, ...paymentResult };
    });
    res.json({ data: result });
  }));

  router.post('/payment-proofs/:id/reject', asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().min(3) }).parse(req.body);
    const db = req.app.locals.prisma;
    const proof = await db.bankTransferProof.findUnique({ where: { id: req.params.id }, include: { invoice: true } });
    if (!proof) throw notFound('Payment proof not found.');
    if (!['PENDING', 'UNDER_REVIEW'].includes(proof.status)) throw conflict('Only a pending or under-review proof can be rejected.');
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.bankTransferProof.update({ where: { id: proof.id }, data: { status: 'REJECTED', rejectionReason: input.reason, reviewedByPlatformUserId: req.auth.user.id, reviewedAt: new Date() } });
      await createNotification(tx, { hospitalId: proof.hospitalId, type: 'PAYMENT_PROOF_REJECTED', title: 'Payment proof rejected', body: `${proof.invoice.invoiceNumber}: ${input.reason}`, severity: 'ERROR', link: '/hospital/subscription', dedupeKey: `proof-rejected:${proof.id}` });
      await writeAudit(tx, { hospitalId: proof.hospitalId, actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName,
        action: 'PAYMENT_PROOF_REJECTED', entityType: 'BankTransferProof', entityId: proof.id, previousValue: { status: proof.status }, newValue: { status: 'REJECTED' }, reason: input.reason, ipAddress: req.ip });
      return row;
    });
    res.json({ data: updated });
  }));

  router.post('/payment-proofs/:id/duplicate', asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().min(3) }).parse(req.body);
    const db = req.app.locals.prisma;
    const proof = await db.bankTransferProof.findUnique({ where: { id: req.params.id } });
    if (!proof) throw notFound('Payment proof not found.');
    if (!['PENDING', 'UNDER_REVIEW', 'REJECTED'].includes(proof.status)) throw conflict('Only a pending, under-review, or rejected proof can be flagged as duplicate.');
    const updated = await db.bankTransferProof.update({ where: { id: proof.id }, data: { status: 'DUPLICATE', rejectionReason: input.reason, reviewedByPlatformUserId: req.auth.user.id, reviewedAt: new Date() } });
    await auditAdmin(req, { hospitalId: proof.hospitalId, action: 'PAYMENT_PROOF_FLAGGED_DUPLICATE', entityType: 'BankTransferProof', entityId: proof.id, previousValue: { status: proof.status }, newValue: { status: 'DUPLICATE' }, reason: input.reason });
    res.json({ data: updated });
  }));

  router.post('/payment-proofs/:id/request-info', asyncHandler(async (req, res) => {
    const input = z.object({ message: z.string().min(3) }).parse(req.body);
    const db = req.app.locals.prisma;
    const proof = await db.bankTransferProof.findUnique({ where: { id: req.params.id }, include: { invoice: true } });
    if (!proof) throw notFound('Payment proof not found.');
    if (!['PENDING', 'UNDER_REVIEW'].includes(proof.status)) throw conflict('Additional information can only be requested for a pending or under-review proof.');
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.bankTransferProof.update({ where: { id: proof.id }, data: { status: 'UNDER_REVIEW', additionalInformation: input.message, reviewedByPlatformUserId: req.auth.user.id, reviewedAt: new Date() } });
      await createNotification(tx, { hospitalId: proof.hospitalId, type: 'PAYMENT_PROOF_INFORMATION_REQUESTED', title: 'Additional payment information requested', body: `${proof.invoice.invoiceNumber}: ${input.message}`, severity: 'WARNING', link: '/hospital/subscription', dedupeKey: `proof-info:${proof.id}:${Date.now()}` });
      await writeAudit(tx, { hospitalId: proof.hospitalId, actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName,
        action: 'PAYMENT_PROOF_INFORMATION_REQUESTED', entityType: 'BankTransferProof', entityId: proof.id, previousValue: { status: proof.status, additionalInformation: proof.additionalInformation }, newValue: { status: 'UNDER_REVIEW', additionalInformation: input.message }, reason: input.message, ipAddress: req.ip });
      return row;
    });
    res.json({ data: updated });
  }));

  async function startSupportAccess(req, res) {
    const input = z.object({ hospitalId: z.string().optional(), reason: z.string().min(5), durationMinutes: z.coerce.number().int().min(5).max(240).optional(), warningAccepted: z.literal(true) }).parse(req.body);
    const hospitalId = req.params.id || input.hospitalId;
    if (!hospitalId) throw badRequest('Hospital ID is required.');
    const db = req.app.locals.prisma;
    const hospital = await db.hospital.findUnique({ where: { id: hospitalId } });
    if (!hospital) throw notFound('Hospital not found.');
    const durationSetting = input.durationMinutes == null
      ? await db.platformSetting.findUnique({ where: { key: 'defaultSupportAccessMinutes' } })
      : null;
    const configuredDuration = Number(durationSetting?.value);
    const durationMinutes = input.durationMinutes ?? (Number.isInteger(configuredDuration) && configuredDuration >= 5 && configuredDuration <= 240 ? configuredDuration : 60);
    const session = await db.supportAccessSession.create({ data: {
      platformUserId: req.auth.user.id, hospitalId, reason: input.reason, warningAccepted: true,
      expiresAt: new Date(Date.now() + durationMinutes * 60 * 1000), ipAddress: req.ip,
    } });
    await auditAdmin(req, { hospitalId, action: 'SUPPORT_ACCESS_SESSION_STARTED', entityType: 'SupportAccessSession', entityId: session.id, newValue: { reason: input.reason, expiresAt: session.expiresAt }, reason: input.reason });
    const supportToken = signAuthToken({ id: req.auth.user.id, kind: 'support', tokenVersion: req.auth.user.tokenVersion, hospitalId, supportSessionId: session.id }, false);
    res.status(201).json({ data: { session, supportToken, accessToken: supportToken, redirectTo: '/hospital', warning: 'Support access is visible, time-limited, audited, and read-only.' } });
  }
  router.post('/hospitals/:id/support-access', asyncHandler(startSupportAccess));
  router.post('/support-access', asyncHandler(startSupportAccess));
  router.get('/support-access', asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.supportAccessSession.findMany({ include: { platformUser: { select: { fullName: true, email: true } }, hospital: { select: { name: true, code: true } } }, orderBy: { startedAt: 'desc' } });
    res.json({ data: rows });
  }));
  router.post('/support-access/:id/end', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const session = await db.supportAccessSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw notFound('Support-access session not found.');
    if (session.endedAt) throw conflict('Support-access session has already ended.');
    const updated = await db.supportAccessSession.update({ where: { id: session.id }, data: { endedAt: new Date(), endedById: req.auth.user.id } });
    await auditAdmin(req, { hospitalId: session.hospitalId, action: 'SUPPORT_ACCESS_SESSION_ENDED', entityType: 'SupportAccessSession', entityId: session.id, previousValue: { endedAt: null }, newValue: { endedAt: updated.endedAt } });
    res.json({ data: updated });
  }));

  router.get('/users', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const [platformUsers, hospitalUsers] = await Promise.all([
      db.platformUser.findMany({ orderBy: { fullName: 'asc' } }),
      db.hospitalUser.findMany({ include: { role: true, hospital: { select: { name: true, code: true } } }, orderBy: { fullName: 'asc' } }),
    ]);
    res.json({ data: [
      ...platformUsers.map((user) => ({
        id: user.id,
        accountType: 'PLATFORM',
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        hospital: null,
      })),
      ...hospitalUsers.map((user) => ({
        id: user.id,
        accountType: 'HOSPITAL',
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        role: user.role.name,
        roleKey: user.role.key,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        hospital: user.hospital,
      })),
    ] });
  }));

  router.patch('/users/:id', asyncHandler(async (req, res) => {
    const input = z.object({ isActive: z.boolean(), reason: z.string().min(3).optional() }).parse(req.body);
    const db = req.app.locals.prisma;
    const platformUser = await db.platformUser.findUnique({ where: { id: req.params.id } });
    if (platformUser) {
      if (platformUser.id === req.auth.user.id && !input.isActive) throw forbidden('You cannot disable your own Super Admin account.');
      const updated = await db.platformUser.update({ where: { id: platformUser.id }, data: { isActive: input.isActive, tokenVersion: { increment: 1 } } });
      await auditAdmin(req, { action: input.isActive ? 'PLATFORM_USER_ENABLED' : 'PLATFORM_USER_DISABLED', entityType: 'PlatformUser', entityId: updated.id, previousValue: { isActive: platformUser.isActive }, newValue: { isActive: input.isActive }, reason: input.reason });
      return res.json({ data: updated });
    }
    const hospitalUser = await db.hospitalUser.findUnique({ where: { id: req.params.id } });
    if (!hospitalUser) throw notFound('User not found.');
    const updated = await db.hospitalUser.update({ where: { id: hospitalUser.id }, data: { isActive: input.isActive, tokenVersion: { increment: 1 } } });
    await auditAdmin(req, { hospitalId: hospitalUser.hospitalId, action: input.isActive ? 'HOSPITAL_USER_ENABLED' : 'HOSPITAL_USER_DISABLED', entityType: 'HospitalUser', entityId: updated.id, previousValue: { isActive: hospitalUser.isActive }, newValue: { isActive: input.isActive }, reason: input.reason });
    res.json({ data: updated });
  }));

  router.get('/support-requests', asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.supportRequest.findMany({ include: { hospital: { select: { name: true, code: true } } }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows });
  }));
  router.patch('/support-requests/:id', asyncHandler(async (req, res) => {
    const input = z.object({ status: z.string().optional(), priority: z.string().optional(), assignedPlatformUserId: z.string().nullable().optional(), response: z.string().optional() }).parse(req.body);
    const db = req.app.locals.prisma;
    const previous = await db.supportRequest.findUnique({ where: { id: req.params.id } });
    if (!previous) throw notFound('Support request not found.');
    const row = await db.supportRequest.update({ where: { id: previous.id }, data: input });
    await auditAdmin(req, { hospitalId: row.hospitalId, action: 'SUPPORT_REQUEST_UPDATED', entityType: 'SupportRequest', entityId: row.id, previousValue: previous, newValue: input });
    res.json({ data: row });
  }));

  router.get('/audit-logs', asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.auditLog.findMany({
      where: platformAuditWhere(req.query.hospitalId ? { hospitalId: String(req.query.hospitalId) } : {}),
      include: { hospital: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit || 500), 1000),
    });
    res.json({ data: rows.filter(isPlatformAuditVisible).map(platformAuditDto) });
  }));

  router.get('/settings', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const [settings, providers] = await Promise.all([db.platformSetting.findMany({ orderBy: { key: 'asc' } }), db.paymentProviderConfiguration.findMany({ orderBy: { provider: 'asc' } })]);
    res.json({ data: { settings: Object.fromEntries(settings.map((item) => [item.key, item.value])), providers } });
  }));
  router.patch('/settings', asyncHandler(async (req, res) => {
    const input = z.object({ settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), safepay: z.object({ enabled: z.boolean().optional(), demoMode: z.boolean().optional(), publicConfigJson: z.string().optional() }).optional() }).passthrough().parse(req.body);
    const db = req.app.locals.prisma;
    if (input.safepay?.publicConfigJson) {
      try { JSON.parse(input.safepay.publicConfigJson); } catch { throw badRequest('Safepay public configuration must be valid JSON.'); }
    }
    if (env.nodeEnv === 'production' && input.safepay?.demoMode) throw badRequest('Safepay demo mode cannot be enabled in production.');
    if (env.nodeEnv === 'production' && input.safepay?.enabled && !new SafepayProvider(input.safepay).productionAdapterVerified) {
      throw badRequest('Safepay cannot be enabled in production until the merchant-specific checkout and webhook adapter has been implemented and verified.');
    }
    const settings = input.settings || Object.fromEntries(Object.entries(input).filter(([key]) => !['safepay'].includes(key)).map(([key, value]) => [key, String(value)]));
    if (Object.hasOwn(settings, 'invoicePrefix')) {
      const prefix = String(settings.invoicePrefix).trim().toUpperCase();
      if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(prefix) || prefix.length > 24) {
        throw badRequest('Invoice prefix must contain only uppercase letters, numbers, and single hyphens, up to 24 characters.');
      }
      settings.invoicePrefix = prefix;
    }
    for (const [key, minimum, maximum] of [
      ['renewalInvoiceDaysBefore', 1, 90],
      ['reminderDaysBefore', 0, 90],
      ['defaultSupportAccessMinutes', 5, 240],
    ]) {
      if (!Object.hasOwn(settings, key)) continue;
      const numericValue = Number(settings[key]);
      if (!Number.isInteger(numericValue) || numericValue < minimum || numericValue > maximum) {
        throw badRequest(`${key} must be a whole number from ${minimum} to ${maximum}.`);
      }
      settings[key] = String(numericValue);
    }
    if (Object.hasOwn(settings, 'renewalInvoiceDaysBefore') || Object.hasOwn(settings, 'reminderDaysBefore')) {
      const savedTimingSettings = await db.platformSetting.findMany({
        where: { key: { in: ['renewalInvoiceDaysBefore', 'reminderDaysBefore'] } },
      });
      const savedTimingMap = Object.fromEntries(savedTimingSettings.map((setting) => [setting.key, Number(setting.value)]));
      const requestedRenewalDays = Number(settings.renewalInvoiceDaysBefore ?? savedTimingMap.renewalInvoiceDaysBefore ?? 7);
      const requestedReminderDays = Number(settings.reminderDaysBefore ?? savedTimingMap.reminderDaysBefore ?? 3);
      if (requestedReminderDays > requestedRenewalDays) {
        throw badRequest('reminderDaysBefore must be less than or equal to renewalInvoiceDaysBefore.');
      }
    }
    await db.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(settings)) await tx.platformSetting.upsert({ where: { key }, create: { key, value: String(value), updatedById: req.auth.user.id }, update: { value: String(value), updatedById: req.auth.user.id } });
      if (input.safepay) await tx.paymentProviderConfiguration.upsert({ where: { provider: 'SAFEPAY' }, create: { provider: 'SAFEPAY', displayName: 'Safepay', enabled: input.safepay.enabled ?? false, demoMode: input.safepay.demoMode ?? true, publicConfigJson: input.safepay.publicConfigJson }, update: input.safepay });
      await writeAudit(tx, { actorType: 'PLATFORM_USER', actorId: req.auth.user.id, actorName: req.auth.user.fullName, action: 'PLATFORM_SETTINGS_CHANGED', entityType: 'PlatformSetting', newValue: input, ipAddress: req.ip });
    });
    const current = await Promise.all([db.platformSetting.findMany(), db.paymentProviderConfiguration.findMany()]);
    res.json({ data: { settings: Object.fromEntries(current[0].map((item) => [item.key, item.value])), providers: current[1] } });
  }));

  router.get('/safepay-transactions', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const [payments, events, configuration] = await Promise.all([
      db.subscriptionPayment.findMany({ where: { provider: 'SAFEPAY' }, include: { hospital: { select: { name: true, code: true } }, invoice: { select: { invoiceNumber: true } } }, orderBy: { paidAt: 'desc' } }),
      db.webhookEvent.findMany({ where: { provider: 'SAFEPAY' }, orderBy: { createdAt: 'desc' } }),
      db.paymentProviderConfiguration.findUnique({ where: { provider: 'SAFEPAY' } }),
    ]);
    const transactions = payments.map((item) => ({
      ...item,
      amount: decimalNumber(item.amount),
      hospitalName: item.hospital.name,
      invoiceNumber: item.invoice.invoiceNumber,
      providerReference: item.providerTransactionId || item.paymentReference,
      reference: item.paymentReference,
      status: 'COMPLETED',
      environment: configuration?.demoMode === false ? env.safepayEnvironment : 'demo',
    }));
    res.json({ data: { payments: transactions, transactions, webhookEvents: events, configured: Boolean(env.safepayPublicKey && env.safepaySecretKey), enabled: configuration?.enabled ?? false, demoMode: configuration?.demoMode ?? true } });
  }));

  return router;
}
