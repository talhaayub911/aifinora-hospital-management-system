import bcrypt from 'bcryptjs';
import { FEATURE_KEYS } from './access.service.js';
import { createNotification, writeAudit } from './audit.service.js';
import { createSubscriptionInvoice } from './subscriptionInvoice.service.js';
import { createHospitalRoles } from '../seed/roleTemplates.js';
import { addBillingPeriod, addDays, normalizeCode, normalizeEmail } from '../utils/format.js';
import { badRequest, notFound } from '../utils/errors.js';

export async function onboardHospital(prisma, input, actor, ipAddress) {
  const hospitalInput = input.hospital;
  const subscriptionInput = input.subscription;
  const limits = input.limits || {};
  const administrator = input.administrator;
  const code = normalizeCode(hospitalInput.code);
  if (!code) throw badRequest('Hospital code is required.');

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: subscriptionInput.planId },
    include: { versions: { where: { isPublished: true }, orderBy: { version: 'desc' }, take: 1, include: { features: true } } },
  });
  const planVersion = plan?.versions[0];
  if (!planVersion || !plan.isActive) throw notFound('The selected active subscription plan was not found.');
  const passwordHash = await bcrypt.hash(administrator.temporaryPassword, 12);
  const startDate = new Date(subscriptionInput.startDate);
  if (Number.isNaN(startDate.getTime())) throw badRequest('Subscription start date is invalid.');
  const trialDays = Number(subscriptionInput.trialDays || 0);
  const trialEndsAt = trialDays > 0 ? addDays(startDate, trialDays) : null;
  const billingStart = trialEndsAt || startDate;
  const billingCycle = subscriptionInput.billingCycle.toUpperCase();
  const initialStatus = trialDays > 0 ? 'TRIALING' : 'PENDING_PAYMENT';
  const periodEnd = addBillingPeriod(billingStart, billingCycle);
  const basePrice = subscriptionInput.subscriptionPrice ?? (billingCycle === 'ANNUAL' ? planVersion.annualPrice : planVersion.monthlyPrice);
  const implementationFee = subscriptionInput.implementationFee ?? planVersion.defaultImplementationFee;
  const maxUsers = limits.maxUsers ?? planVersion.maxUsers;
  const maxBranches = limits.maxBranches ?? planVersion.maxBranches;
  const maxBeds = limits.maxBeds ?? planVersion.maxBeds;
  const storageLimitMb = limits.storageLimitMb ?? planVersion.storageLimitMb;
  if (maxUsers != null && maxUsers < 1) throw badRequest('A hospital subscription must permit at least one user.');
  if (maxBranches != null && hospitalInput.numberOfBranches > maxBranches) throw badRequest('Declared branches exceed the configured subscription limit.');
  if (maxBeds != null && hospitalInput.numberOfBeds > maxBeds) throw badRequest('Hospital beds exceed the configured subscription limit.');

  return prisma.$transaction(async (tx) => {
    const hospital = await tx.hospital.create({
      data: {
        code,
        name: hospitalInput.name,
        legalBusinessName: hospitalInput.legalBusinessName,
        ntn: hospitalInput.ntn,
        email: normalizeEmail(hospitalInput.email),
        phone: hospitalInput.phone,
        address: hospitalInput.address,
        city: hospitalInput.city,
        province: hospitalInput.province,
        numberOfBeds: hospitalInput.numberOfBeds,
        declaredBranches: hospitalInput.numberOfBranches,
        primaryContactName: hospitalInput.primaryContactName,
        primaryContactDesignation: hospitalInput.primaryContactDesignation,
        primaryContactMobile: hospitalInput.primaryContactMobile,
        primaryContactEmail: hospitalInput.primaryContactEmail ? normalizeEmail(hospitalInput.primaryContactEmail) : null,
        accountStatus: initialStatus,
        branches: {
          create: {
            code: 'main',
            name: `${hospitalInput.name} - Main Branch`,
            address: hospitalInput.address,
            city: hospitalInput.city,
            province: hospitalInput.province,
            phone: hospitalInput.phone,
          },
        },
      },
    });
    const roles = await createHospitalRoles(tx, hospital.id);
    const role = roles[administrator.roleKey || 'hospital_admin'];
    if (!role) throw badRequest('The hospital administrator role is invalid.');
    const user = await tx.hospitalUser.create({
      data: {
        hospitalId: hospital.id,
        roleId: role.id,
        email: normalizeEmail(administrator.email),
        passwordHash,
        fullName: administrator.fullName,
        mobile: administrator.mobile,
        mustChangePassword: administrator.mustChangePassword ?? true,
      },
      include: { role: true },
    });
    const subscription = await tx.hospitalSubscription.create({
      data: {
        hospitalId: hospital.id,
        planVersionId: planVersion.id,
        billingCycle,
        status: initialStatus,
        startDate,
        trialEndsAt,
        currentPeriodStart: billingStart,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        gracePeriodEndsAt: null,
        contractRenewalDate: subscriptionInput.contractRenewalDate ? new Date(subscriptionInput.contractRenewalDate) : periodEnd,
        price: basePrice,
        discount: subscriptionInput.discount ?? 0,
        taxRate: subscriptionInput.taxRate ?? 0,
        implementationFee,
        implementationFeeStatus: Number(implementationFee) > 0 ? 'PENDING' : 'NOT_REQUIRED',
        invoiceDueDays: subscriptionInput.invoiceDueDays ?? 7,
        gracePeriodDays: subscriptionInput.gracePeriodDays ?? 7,
        maxUsers,
        maxBranches,
        maxBeds,
        storageLimitMb,
        notes: subscriptionInput.notes,
      },
    });

    const selectedModules = limits.enabledModules ? new Set([...limits.enabledModules, ...(limits.addOns || [])]) : null;
    if (selectedModules) {
      for (const featureKey of FEATURE_KEYS) {
        if (['dashboard', 'subscription_billing', 'user_management', 'data_export', 'support'].includes(featureKey)) continue;
        await tx.hospitalFeatureOverride.create({
          data: {
            hospitalId: hospital.id,
            subscriptionId: subscription.id,
            featureKey,
            enabled: selectedModules.has(featureKey),
            reason: 'Configured during hospital onboarding',
            changedByPlatformUserId: actor.id,
          },
        });
      }
    }

    const invoices = [];
    if (Number(implementationFee) > 0) {
      invoices.push(await createSubscriptionInvoice(tx, {
        hospitalId: hospital.id,
        subscriptionId: subscription.id,
        type: 'IMPLEMENTATION_FEE',
        issueDate: startDate,
        dueDays: subscription.invoiceDueDays,
        items: [{ description: 'One-time implementation and onboarding fee', quantity: 1, unitAmount: implementationFee }],
        taxRate: subscription.taxRate,
        idempotencyKey: `onboarding:implementation:${hospital.id}`,
      }));
    }
    invoices.push(await createSubscriptionInvoice(tx, {
      hospitalId: hospital.id,
      subscriptionId: subscription.id,
      type: billingCycle === 'ANNUAL' ? 'ANNUAL_SUBSCRIPTION' : 'MONTHLY_SUBSCRIPTION',
      issueDate: startDate,
      dueDate: trialEndsAt || addDays(startDate, subscription.invoiceDueDays),
      dueDays: subscription.invoiceDueDays,
      periodStart: billingStart,
      periodEnd,
      items: [{ description: `${plan.name} ${billingCycle.toLowerCase()} subscription`, quantity: 1, unitAmount: basePrice }],
      discount: subscription.discount,
      taxRate: subscription.taxRate,
      idempotencyKey: `onboarding:subscription:${hospital.id}:${billingStart.toISOString().slice(0, 10)}`,
    }));

    await createNotification(tx, {
      hospitalId: hospital.id,
      hospitalUserId: user.id,
      type: 'HOSPITAL_ACCOUNT_CREATED',
      title: 'Hospital account created',
      body: `Welcome to AI Finora. Your ${plan.name} subscription has been configured.`,
      severity: 'SUCCESS',
      link: '/hospital/subscription',
      dedupeKey: `hospital-created:${hospital.id}`,
    });
    await createNotification(tx, {
      hospitalId: hospital.id, hospitalUserId: user.id, type: 'TEMPORARY_PASSWORD_CREATED',
      title: 'Temporary password requires replacement', body: 'For security, change the temporary password before accessing hospital data.',
      severity: 'WARNING', link: '/change-password', dedupeKey: `temporary-password:${user.id}`,
    });
    for (const invoice of invoices) {
      await createNotification(tx, {
        hospitalId: hospital.id, hospitalUserId: user.id, type: invoice.invoiceType === 'IMPLEMENTATION_FEE' ? 'IMPLEMENTATION_INVOICE_ISSUED' : 'SUBSCRIPTION_INVOICE_ISSUED',
        title: invoice.invoiceType === 'IMPLEMENTATION_FEE' ? 'Implementation invoice issued' : 'Subscription invoice issued',
        body: `${invoice.invoiceNumber} is available in Subscription & Billing.`, severity: 'INFO', link: '/hospital/subscription', dedupeKey: `invoice-issued:${invoice.id}`,
      });
    }
    await writeAudit(tx, {
      hospitalId: hospital.id,
      actorType: 'PLATFORM_USER',
      actorId: actor.id,
      actorName: actor.fullName,
      action: 'HOSPITAL_CREATED',
      entityType: 'Hospital',
      entityId: hospital.id,
      newValue: { code: hospital.code, plan: plan.name, billingCycle, administrator: user.email },
      ipAddress,
    });
    return { hospital, administrator: { id: user.id, hospitalId: user.hospitalId, fullName: user.fullName, email: user.email, mobile: user.mobile, role: user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword, createdAt: user.createdAt }, subscription, invoices };
  }, { timeout: 30000 });
}
