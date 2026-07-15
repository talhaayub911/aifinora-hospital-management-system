import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FEATURE_KEYS } from '../services/access.service.js';
import { ROLE_TEMPLATES } from './roleTemplates.js';

export const SEED_DATASET_VERSION = '2026-07-13.1';
export const SEED_CLOCK = new Date('2026-07-13T12:00:00.000Z');

export const DEMO_ACCOUNTS = Object.freeze({
  superAdmin: { email: 'admin@aifinora.com', password: 'Admin@123' },
  hospitalAdmin: { hospitalCode: 'akram-medical', email: 'hospitaladmin@example.com', password: 'Hospital@123' },
  receptionist: { hospitalCode: 'akram-medical', email: 'receptionist@example.com', password: 'Reception@123' },
  billingOfficer: { hospitalCode: 'akram-medical', email: 'billing@example.com', password: 'Billing@123' },
  accountant: { hospitalCode: 'akram-medical', email: 'accountant@example.com', password: 'Accounts@123' },
  noorAdmin: { hospitalCode: 'noor-surgical', email: 'admin@noorsurgical.pk', password: 'Hospital@123' },
  islamabadAdmin: { hospitalCode: 'islamabad-family', email: 'admin@islamabadfamily.pk', password: 'Hospital@123' },
});

export const SEED_IDS = Object.freeze({
  platformAdmin: 'seed_platform_admin',
  plans: { starter: 'seed_plan_starter', growth: 'seed_plan_growth', enterprise: 'seed_plan_enterprise' },
  planVersions: { starter: 'seed_plan_starter_v1', growth: 'seed_plan_growth_v1', enterprise: 'seed_plan_enterprise_v1' },
  hospitals: { akram: 'seed_hospital_akram', noor: 'seed_hospital_noor', islamabad: 'seed_hospital_islamabad' },
  users: {
    akramAdmin: 'seed_user_akram_admin',
    akramReceptionist: 'seed_user_akram_receptionist',
    akramBilling: 'seed_user_akram_billing',
    akramAccountant: 'seed_user_akram_accountant',
    noorAdmin: 'seed_user_noor_admin',
    islamabadAdmin: 'seed_user_islamabad_admin',
  },
  subscriptions: { akram: 'seed_subscription_akram', noor: 'seed_subscription_noor', islamabad: 'seed_subscription_islamabad' },
  invoices: {
    akramImplementation: 'seed_saas_invoice_akram_implementation',
    akramJuly: 'seed_saas_invoice_akram_july',
    akramAddOn: 'seed_saas_invoice_akram_addon',
    noorAnnual: 'seed_saas_invoice_noor_annual',
    islamabadImplementation: 'seed_saas_invoice_islamabad_implementation',
  },
  proofs: {
    approved: 'seed_proof_approved',
    pending: 'seed_proof_pending',
    rejected: 'seed_proof_rejected',
  },
  payments: { approved: 'seed_subscription_payment_approved', akramJuly: 'seed_subscription_payment_akram_july' },
});

const date = (value) => new Date(`${value}T00:00:00.000Z`);
const dateTime = (value) => new Date(value);
const roleId = (hospitalKey, roleKey) => `seed_role_${hospitalKey}_${roleKey}`;
const permissionId = (hospitalKey, roleKey, featureKey) => `seed_permission_${hospitalKey}_${roleKey}_${featureKey}`;

const STARTER_FEATURES = [
  'dashboard', 'patient_registration', 'appointments', 'doctors', 'departments', 'charge_master',
  'opd_billing', 'payments', 'receipts', 'financial_reports', 'subscription_billing', 'data_export', 'support',
];
const GROWTH_FEATURES = [
  ...STARTER_FEATURES, 'admissions', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing',
  'laboratory_billing', 'insurance_billing', 'corporate_billing', 'refunds', 'user_management',
];

const PLAN_DEFINITIONS = [
  {
    key: 'starter', code: 'starter', name: 'Starter',
    description: 'Core patient registration, OPD billing, payments, receipts, and basic reporting for one branch.',
    monthlyPrice: 25000, annualPrice: 270000, implementationFee: 100000,
    maxUsers: 10, maxBranches: 1, maxBeds: 30, storageLimitMb: 5120,
    features: STARTER_FEATURES,
  },
  {
    key: 'growth', code: 'growth', name: 'Growth',
    description: 'Expanded clinical and billing workflows for growing multi-department hospitals.',
    monthlyPrice: 50000, annualPrice: 540000, implementationFee: 150000,
    maxUsers: 40, maxBranches: 2, maxBeds: 100, storageLimitMb: 20480,
    features: GROWTH_FEATURES,
  },
  {
    key: 'enterprise', code: 'enterprise', name: 'Enterprise',
    description: 'All AI Finora modules with custom capacity, API access, and priority support.',
    monthlyPrice: 120000, annualPrice: 1296000, implementationFee: 300000,
    maxUsers: null, maxBranches: null, maxBeds: null, storageLimitMb: 102400,
    features: FEATURE_KEYS,
  },
];

const HOSPITAL_DEFINITIONS = [
  {
    key: 'akram', id: SEED_IDS.hospitals.akram, code: 'akram-medical', name: 'Akram Medical Centre',
    legalBusinessName: 'Akram Medical Centre (Private) Limited', ntn: '7210456-8', email: 'info@akrammedical.pk',
    phone: '+92 42 3571 4400', address: '18 Jail Road', city: 'Lahore', province: 'Punjab', numberOfBeds: 85,
    declaredBranches: 2, primaryContactName: 'Dr. Farhan Akram', primaryContactDesignation: 'Medical Director',
    primaryContactMobile: '+92 300 845 1100', primaryContactEmail: 'farhan@akrammedical.pk',
  },
  {
    key: 'noor', id: SEED_IDS.hospitals.noor, code: 'noor-surgical', name: 'Noor Surgical Hospital',
    legalBusinessName: 'Noor Surgical Hospital', ntn: '4382190-4', email: 'accounts@noorsurgical.pk',
    phone: '+92 21 3498 2200', address: '42 Shaheed-e-Millat Road', city: 'Karachi', province: 'Sindh', numberOfBeds: 28,
    declaredBranches: 1, primaryContactName: 'Noor Fatima', primaryContactDesignation: 'Chief Executive Officer',
    primaryContactMobile: '+92 321 220 8844', primaryContactEmail: 'noor@noorsurgical.pk',
  },
  {
    key: 'islamabad', id: SEED_IDS.hospitals.islamabad, code: 'islamabad-family', name: 'Islamabad Family Hospital',
    legalBusinessName: 'Islamabad Family Hospital (Private) Limited', ntn: '8842107-2', email: 'hello@islamabadfamily.pk',
    phone: '+92 51 889 4100', address: '11 Service Road, F-8', city: 'Islamabad', province: 'Islamabad Capital Territory', numberOfBeds: 160,
    declaredBranches: 3, primaryContactName: 'Dr. Maryam Siddiqui', primaryContactDesignation: 'Hospital Director',
    primaryContactMobile: '+92 333 510 9030', primaryContactEmail: 'maryam@islamabadfamily.pk',
  },
];

const PROOF_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const PROOF_SHA256 = createHash('sha256').update(PROOF_PNG).digest('hex');
const PROOF_FILES = ['seed-approved-proof.png', 'seed-pending-proof.png', 'seed-rejected-proof.png'];

export async function resetDatabase(db) {
  // Delete children before parents so the same helper works with SQLite today and
  // PostgreSQL later, without relying on provider-specific foreign-key switches.
  await db.pharmacyInventoryItem.deleteMany();
  await db.patientReceipt.deleteMany();
  await db.patientPayment.deleteMany();
  await db.patientInvoiceItem.deleteMany();
  await db.patientInvoice.deleteMany();
  await db.appointment.deleteMany();
  await db.admission.deleteMany();
  await db.service.deleteMany();
  await db.doctor.deleteMany();
  await db.department.deleteMany();
  await db.patient.deleteMany();

  await db.subscriptionPayment.deleteMany();
  await db.paymentIntent.deleteMany();
  await db.bankTransferProof.deleteMany();
  await db.subscriptionInvoiceItem.deleteMany();
  await db.subscriptionInvoice.deleteMany();
  await db.hospitalFeatureOverride.deleteMany();
  await db.hospitalSubscription.deleteMany();
  await db.planFeature.deleteMany();
  await db.subscriptionPlanVersion.deleteMany();
  await db.subscriptionPlan.deleteMany();

  await db.passwordResetToken.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.paymentProviderConfiguration.deleteMany();
  await db.supportAccessSession.deleteMany();
  await db.supportRequest.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.hospitalSetting.deleteMany();
  await db.platformSetting.deleteMany();
  await db.hospitalUser.deleteMany();
  await db.hospitalRolePermission.deleteMany();
  await db.hospitalRole.deleteMany();
  await db.hospitalBranch.deleteMany();
  await db.hospital.deleteMany();
  await db.platformUser.deleteMany();
}

async function seedSummary(db) {
  const [hospitals, plans, planVersions, users, patients, invoices, payments, proofs, notifications, audits] = await Promise.all([
    db.hospital.count(),
    db.subscriptionPlan.count(),
    db.subscriptionPlanVersion.count(),
    db.hospitalUser.count(),
    db.patient.count(),
    db.subscriptionInvoice.count(),
    db.subscriptionPayment.count(),
    db.bankTransferProof.count(),
    db.notification.count(),
    db.auditLog.count(),
  ]);
  return {
    datasetVersion: SEED_DATASET_VERSION,
    hospitals,
    plans,
    planVersions,
    hospitalUsers: users,
    patients,
    subscriptionInvoices: invoices,
    subscriptionPayments: payments,
    bankTransferProofs: proofs,
    notifications,
    auditLogs: audits,
  };
}

async function createProofFiles(uploadDir) {
  await mkdir(uploadDir, { recursive: true });
  await Promise.all(PROOF_FILES.map((fileName) => writeFile(path.join(uploadDir, fileName), PROOF_PNG)));
}

let passwordHashesPromise;
async function passwordHashes() {
  passwordHashesPromise ||= Promise.all(Object.entries(DEMO_ACCOUNTS).map(async ([key, account]) => [
    key,
    await bcrypt.hash(account.password, 12),
  ])).then(Object.fromEntries);
  return passwordHashesPromise;
}

export async function seedDatabase(prisma, {
  reset = true,
  writeProofFiles = false,
  uploadDir = null,
} = {}) {
  if (!reset) {
    const marker = await prisma.platformSetting.findUnique({ where: { key: 'seed.dataset.version' } });
    if (marker?.value === SEED_DATASET_VERSION) return seedSummary(prisma);
    if (marker) {
      throw new Error(`Database contains seed dataset ${marker.value}; rerun with reset enabled to install ${SEED_DATASET_VERSION}.`);
    }
  }

  const hashes = await passwordHashes();
  if (writeProofFiles) {
    if (!uploadDir) throw new Error('uploadDir is required when writeProofFiles is enabled.');
    await createProofFiles(uploadDir);
  }

  return prisma.$transaction(async (db) => {
    if (reset) await resetDatabase(db);

    await db.platformUser.create({
      data: {
        id: SEED_IDS.platformAdmin,
        email: DEMO_ACCOUNTS.superAdmin.email,
        passwordHash: hashes.superAdmin,
        fullName: 'Areeba Khan',
        role: 'SUPER_ADMIN',
        isActive: true,
        createdAt: dateTime('2026-01-05T09:00:00.000Z'),
      },
    });

    for (const plan of PLAN_DEFINITIONS) {
      await db.subscriptionPlan.create({
        data: {
          id: SEED_IDS.plans[plan.key],
          code: plan.code,
          name: plan.name,
          description: plan.description,
          isActive: true,
          createdAt: dateTime('2026-01-01T08:00:00.000Z'),
          versions: {
            create: {
              id: SEED_IDS.planVersions[plan.key],
              version: 1,
              monthlyPrice: plan.monthlyPrice,
              annualPrice: plan.annualPrice,
              defaultImplementationFee: plan.implementationFee,
              maxUsers: plan.maxUsers,
              maxBranches: plan.maxBranches,
              maxBeds: plan.maxBeds,
              storageLimitMb: plan.storageLimitMb,
              isPublished: true,
              createdAt: dateTime('2026-01-01T08:00:00.000Z'),
              features: {
                create: plan.features.map((featureKey) => ({
                  id: `seed_plan_feature_${plan.key}_${featureKey}`,
                  featureKey,
                  enabled: true,
                  isAddOn: false,
                })),
              },
            },
          },
        },
      });
    }

    await db.hospital.createMany({
      data: HOSPITAL_DEFINITIONS.map(({ key: _key, ...hospital }) => ({
        ...hospital,
        accountStatus: hospital.id === SEED_IDS.hospitals.noor ? 'PAST_DUE' : hospital.id === SEED_IDS.hospitals.islamabad ? 'TRIALING' : 'ACTIVE',
        createdAt: dateTime(hospital.id === SEED_IDS.hospitals.akram
          ? '2026-06-01T08:30:00.000Z'
          : hospital.id === SEED_IDS.hospitals.noor
            ? '2026-03-15T10:00:00.000Z'
            : '2026-07-10T07:45:00.000Z'),
      })),
    });

    await db.hospitalBranch.createMany({ data: [
      { id: 'seed_branch_akram_main', hospitalId: SEED_IDS.hospitals.akram, code: 'main', name: 'Akram Medical Centre - Main Branch', address: '18 Jail Road', city: 'Lahore', province: 'Punjab', phone: '+92 42 3571 4400' },
      { id: 'seed_branch_akram_dha', hospitalId: SEED_IDS.hospitals.akram, code: 'dha', name: 'Akram Medical Centre - DHA Clinic', address: '22-C Phase 5, DHA', city: 'Lahore', province: 'Punjab', phone: '+92 42 3718 4400' },
      { id: 'seed_branch_noor_main', hospitalId: SEED_IDS.hospitals.noor, code: 'main', name: 'Noor Surgical Hospital - Main Branch', address: '42 Shaheed-e-Millat Road', city: 'Karachi', province: 'Sindh', phone: '+92 21 3498 2200' },
      { id: 'seed_branch_islamabad_main', hospitalId: SEED_IDS.hospitals.islamabad, code: 'main', name: 'Islamabad Family Hospital - F-8', address: '11 Service Road, F-8', city: 'Islamabad', province: 'Islamabad Capital Territory', phone: '+92 51 889 4100' },
      { id: 'seed_branch_islamabad_g11', hospitalId: SEED_IDS.hospitals.islamabad, code: 'g11', name: 'Islamabad Family Hospital - G-11 Clinic', address: 'G-11 Markaz', city: 'Islamabad', province: 'Islamabad Capital Territory', phone: '+92 51 236 4100' },
      { id: 'seed_branch_islamabad_rawalpindi', hospitalId: SEED_IDS.hospitals.islamabad, code: 'rwp', name: 'Islamabad Family Hospital - Rawalpindi Clinic', address: 'Murree Road', city: 'Rawalpindi', province: 'Punjab', phone: '+92 51 485 4100' },
    ] });

    for (const hospital of HOSPITAL_DEFINITIONS) {
      await db.hospitalRole.createMany({
        data: ROLE_TEMPLATES.map((template) => ({
          id: roleId(hospital.key, template.key),
          hospitalId: hospital.id,
          key: template.key,
          name: template.name,
          description: `${template.name} demonstration role`,
          isSystem: true,
        })),
      });
      await db.hospitalRolePermission.createMany({
        data: ROLE_TEMPLATES.flatMap((template) => Object.entries(template.permissions).map(([featureKey, actions]) => ({
          id: permissionId(hospital.key, template.key, featureKey),
          hospitalId: hospital.id,
          roleId: roleId(hospital.key, template.key),
          featureKey,
          canRead: actions.includes('read'),
          canWrite: actions.includes('write'),
          canManage: actions.includes('manage'),
        }))),
      });
    }

    await db.hospitalUser.createMany({ data: [
      { id: SEED_IDS.users.akramAdmin, hospitalId: SEED_IDS.hospitals.akram, roleId: roleId('akram', 'hospital_admin'), email: DEMO_ACCOUNTS.hospitalAdmin.email, passwordHash: hashes.hospitalAdmin, fullName: 'Hassan Akram', mobile: '+92 300 845 1122', isActive: true },
      { id: SEED_IDS.users.akramReceptionist, hospitalId: SEED_IDS.hospitals.akram, roleId: roleId('akram', 'receptionist'), email: DEMO_ACCOUNTS.receptionist.email, passwordHash: hashes.receptionist, fullName: 'Mahnoor Ali', mobile: '+92 321 770 6120', isActive: true },
      { id: SEED_IDS.users.akramBilling, hospitalId: SEED_IDS.hospitals.akram, roleId: roleId('akram', 'billing_officer'), email: DEMO_ACCOUNTS.billingOfficer.email, passwordHash: hashes.billingOfficer, fullName: 'Adeel Raza', mobile: '+92 333 221 8410', isActive: true },
      { id: SEED_IDS.users.akramAccountant, hospitalId: SEED_IDS.hospitals.akram, roleId: roleId('akram', 'accountant'), email: DEMO_ACCOUNTS.accountant.email, passwordHash: hashes.accountant, fullName: 'Sadia Iqbal', mobile: '+92 315 881 2006', isActive: true },
      { id: SEED_IDS.users.noorAdmin, hospitalId: SEED_IDS.hospitals.noor, roleId: roleId('noor', 'hospital_admin'), email: DEMO_ACCOUNTS.noorAdmin.email, passwordHash: hashes.noorAdmin, fullName: 'Noor Fatima', mobile: '+92 321 220 8844', isActive: true },
      { id: SEED_IDS.users.islamabadAdmin, hospitalId: SEED_IDS.hospitals.islamabad, roleId: roleId('islamabad', 'hospital_admin'), email: DEMO_ACCOUNTS.islamabadAdmin.email, passwordHash: hashes.islamabadAdmin, fullName: 'Dr. Maryam Siddiqui', mobile: '+92 333 510 9030', isActive: true },
    ] });

    await db.hospitalSubscription.createMany({ data: [
      {
        id: SEED_IDS.subscriptions.akram, hospitalId: SEED_IDS.hospitals.akram, planVersionId: SEED_IDS.planVersions.growth,
        billingCycle: 'MONTHLY', status: 'ACTIVE', startDate: date('2026-06-01'), currentPeriodStart: date('2026-07-01'),
        currentPeriodEnd: date('2026-08-01'), nextBillingDate: date('2026-08-01'), contractRenewalDate: date('2027-06-01'),
        price: 50000, discount: 0, taxRate: 0, implementationFee: 150000, implementationFeeStatus: 'PAID',
        invoiceDueDays: 7, gracePeriodDays: 7, suspensionAfterDays: 30, maxUsers: 40, maxBranches: 2, maxBeds: 100,
        storageLimitMb: 20480, notes: 'Primary tenant containing the migrated hospital demonstration data.', isCurrent: true,
      },
      {
        id: SEED_IDS.subscriptions.noor, hospitalId: SEED_IDS.hospitals.noor, planVersionId: SEED_IDS.planVersions.starter,
        billingCycle: 'ANNUAL', status: 'PAST_DUE', startDate: date('2025-07-01'), currentPeriodStart: date('2025-07-01'),
        currentPeriodEnd: date('2026-07-01'), nextBillingDate: date('2026-07-01'), gracePeriodEndsAt: date('2026-07-15'),
        contractRenewalDate: date('2026-07-01'), price: 270000, discount: 0, taxRate: 0, implementationFee: 100000,
        implementationFeeStatus: 'PAID', invoiceDueDays: 7, gracePeriodDays: 14, suspensionAfterDays: 45,
        maxUsers: 10, maxBranches: 1, maxBeds: 30, storageLimitMb: 5120, notes: 'Annual renewal awaits verified payment.', isCurrent: true,
      },
      {
        id: SEED_IDS.subscriptions.islamabad, hospitalId: SEED_IDS.hospitals.islamabad, planVersionId: SEED_IDS.planVersions.enterprise,
        billingCycle: 'MONTHLY', status: 'TRIALING', startDate: date('2026-07-10'), trialEndsAt: date('2026-07-24'),
        currentPeriodStart: date('2026-07-24'), currentPeriodEnd: date('2026-08-24'), nextBillingDate: date('2026-08-24'),
        contractRenewalDate: date('2027-07-10'), price: 120000, discount: 20000, taxRate: 0, implementationFee: 300000,
        implementationFeeStatus: 'PENDING', invoiceDueDays: 7, gracePeriodDays: 7, suspensionAfterDays: 30,
        maxUsers: null, maxBranches: null, maxBeds: null, storageLimitMb: 102400, notes: 'Fourteen-day Enterprise evaluation.', isCurrent: true,
      },
    ] });

    await db.subscriptionInvoice.createMany({ data: [
      {
        id: SEED_IDS.invoices.akramImplementation, hospitalId: SEED_IDS.hospitals.akram, subscriptionId: SEED_IDS.subscriptions.akram,
        invoiceNumber: 'AF-IMP-2026-0001', invoiceType: 'IMPLEMENTATION_FEE', issueDate: date('2026-06-01'), dueDate: date('2026-06-08'),
        subtotal: 150000, discount: 0, tax: 0, total: 150000, paidAmount: 150000, status: 'PAID',
        paymentInstructions: 'AI Finora demonstration bank transfer account. No real funds should be sent.',
        idempotencyKey: 'seed:akram:implementation', issuedAt: date('2026-06-01'),
      },
      {
        id: SEED_IDS.invoices.akramJuly, hospitalId: SEED_IDS.hospitals.akram, subscriptionId: SEED_IDS.subscriptions.akram,
        invoiceNumber: 'AF-SUB-2026-0002', invoiceType: 'MONTHLY_SUBSCRIPTION', issueDate: date('2026-06-24'), dueDate: date('2026-07-01'),
        billingPeriodStart: date('2026-07-01'), billingPeriodEnd: date('2026-08-01'), subtotal: 50000, discount: 0, tax: 0,
        total: 50000, paidAmount: 50000, status: 'PAID', paymentInstructions: 'AI Finora demonstration bank transfer account.',
        idempotencyKey: 'renewal:seed_subscription_akram:2026-07-01', issuedAt: date('2026-06-24'),
      },
      {
        id: SEED_IDS.invoices.akramAddOn, hospitalId: SEED_IDS.hospitals.akram, subscriptionId: SEED_IDS.subscriptions.akram,
        invoiceNumber: 'AF-ADD-2026-0003', invoiceType: 'ADD_ON_MODULE_CHARGES', issueDate: date('2026-07-05'), dueDate: date('2026-07-20'),
        subtotal: 75000, discount: 0, tax: 0, total: 75000, paidAmount: 0, status: 'ISSUED',
        paymentInstructions: 'AI Finora demonstration bank transfer account. Upload a receipt for verification.',
        idempotencyKey: 'seed:akram:addon:2026-07', issuedAt: date('2026-07-05'),
      },
      {
        id: SEED_IDS.invoices.noorAnnual, hospitalId: SEED_IDS.hospitals.noor, subscriptionId: SEED_IDS.subscriptions.noor,
        invoiceNumber: 'AF-SUB-2026-0004', invoiceType: 'ANNUAL_SUBSCRIPTION', issueDate: date('2026-06-24'), dueDate: date('2026-07-01'),
        billingPeriodStart: date('2026-07-01'), billingPeriodEnd: date('2027-07-01'), subtotal: 270000, discount: 0, tax: 0,
        total: 270000, paidAmount: 0, status: 'OVERDUE', paymentInstructions: 'AI Finora demonstration bank transfer account.',
        idempotencyKey: 'renewal:seed_subscription_noor:2026-07-01', issuedAt: date('2026-06-24'),
      },
      {
        id: SEED_IDS.invoices.islamabadImplementation, hospitalId: SEED_IDS.hospitals.islamabad, subscriptionId: SEED_IDS.subscriptions.islamabad,
        invoiceNumber: 'AF-IMP-2026-0005', invoiceType: 'IMPLEMENTATION_FEE', issueDate: date('2026-07-10'), dueDate: date('2026-07-17'),
        subtotal: 300000, discount: 0, tax: 0, total: 300000, paidAmount: 0, status: 'ISSUED',
        paymentInstructions: 'AI Finora demonstration bank transfer account.', idempotencyKey: 'seed:islamabad:implementation',
        issuedAt: date('2026-07-10'),
      },
    ] });

    await db.subscriptionInvoiceItem.createMany({ data: [
      { id: 'seed_saas_item_akram_implementation', hospitalId: SEED_IDS.hospitals.akram, invoiceId: SEED_IDS.invoices.akramImplementation, description: 'One-time implementation, onboarding, and data migration fee', quantity: 1, unitAmount: 150000, lineTotal: 150000 },
      { id: 'seed_saas_item_akram_july', hospitalId: SEED_IDS.hospitals.akram, invoiceId: SEED_IDS.invoices.akramJuly, description: 'Growth monthly subscription - July 2026', quantity: 1, unitAmount: 50000, lineTotal: 50000 },
      { id: 'seed_saas_item_akram_addon', hospitalId: SEED_IDS.hospitals.akram, invoiceId: SEED_IDS.invoices.akramAddOn, description: 'Historical data import and staff training package', quantity: 1, unitAmount: 75000, lineTotal: 75000 },
      { id: 'seed_saas_item_noor_annual', hospitalId: SEED_IDS.hospitals.noor, invoiceId: SEED_IDS.invoices.noorAnnual, description: 'Starter annual subscription - July 2026 to June 2027', quantity: 1, unitAmount: 270000, lineTotal: 270000 },
      { id: 'seed_saas_item_islamabad_implementation', hospitalId: SEED_IDS.hospitals.islamabad, invoiceId: SEED_IDS.invoices.islamabadImplementation, description: 'Enterprise implementation and onboarding fee', quantity: 1, unitAmount: 300000, lineTotal: 300000 },
    ] });

    await db.bankTransferProof.createMany({ data: [
      {
        id: SEED_IDS.proofs.approved, hospitalId: SEED_IDS.hospitals.akram, invoiceId: SEED_IDS.invoices.akramImplementation,
        submittedByHospitalUserId: SEED_IDS.users.akramAdmin, amount: 150000, bankName: 'Habib Bank Limited',
        transactionReference: 'HBL-IMPL-88201', normalizedReference: 'HBLIMPL88201', transferDate: date('2026-06-03'),
        storageKey: PROOF_FILES[0], originalFileName: 'hbl-implementation-transfer.png', mimeType: 'image/png', fileSize: PROOF_PNG.length,
        sha256: PROOF_SHA256, status: 'APPROVED', reviewedByPlatformUserId: SEED_IDS.platformAdmin,
        reviewedAt: dateTime('2026-06-04T09:15:00.000Z'), submittedAt: dateTime('2026-06-03T14:20:00.000Z'),
      },
      {
        id: SEED_IDS.proofs.pending, hospitalId: SEED_IDS.hospitals.akram, invoiceId: SEED_IDS.invoices.akramAddOn,
        submittedByHospitalUserId: SEED_IDS.users.akramAdmin, amount: 75000, bankName: 'MCB Bank Limited',
        transactionReference: 'MCB-ADDON-43092', normalizedReference: 'MCBADDON43092', transferDate: date('2026-07-11'),
        storageKey: PROOF_FILES[1], originalFileName: 'mcb-addon-payment.png', mimeType: 'image/png', fileSize: PROOF_PNG.length,
        sha256: PROOF_SHA256, status: 'PENDING', submittedAt: dateTime('2026-07-11T11:45:00.000Z'),
      },
      {
        id: SEED_IDS.proofs.rejected, hospitalId: SEED_IDS.hospitals.noor, invoiceId: SEED_IDS.invoices.noorAnnual,
        submittedByHospitalUserId: SEED_IDS.users.noorAdmin, amount: 270000, bankName: 'United Bank Limited',
        transactionReference: 'UBL-NOOR-77120', normalizedReference: 'UBLNOOR77120', transferDate: date('2026-07-04'),
        storageKey: PROOF_FILES[2], originalFileName: 'ubl-noor-transfer.png', mimeType: 'image/png', fileSize: PROOF_PNG.length,
        sha256: PROOF_SHA256, status: 'REJECTED', rejectionReason: 'The uploaded image does not show a successful bank transaction status.',
        additionalInformation: 'Please upload the final debit confirmation or stamped deposit slip.', reviewedByPlatformUserId: SEED_IDS.platformAdmin,
        reviewedAt: dateTime('2026-07-05T10:20:00.000Z'), submittedAt: dateTime('2026-07-04T16:05:00.000Z'),
      },
    ] });

    await db.subscriptionPayment.createMany({ data: [
      {
        id: SEED_IDS.payments.approved, hospitalId: SEED_IDS.hospitals.akram, invoiceId: SEED_IDS.invoices.akramImplementation,
        bankTransferProofId: SEED_IDS.proofs.approved, provider: 'MANUAL_BANK_TRANSFER', paymentReference: 'HBL-IMPL-88201',
        normalizedReference: 'HBLIMPL88201', amount: 150000, paidAt: dateTime('2026-06-04T09:15:00.000Z'),
        receiptNumber: 'AF-RCP-2026-0001', notes: 'Approved demonstration bank transfer.',
      },
      {
        id: SEED_IDS.payments.akramJuly, hospitalId: SEED_IDS.hospitals.akram, invoiceId: SEED_IDS.invoices.akramJuly,
        provider: 'MANUAL_BANK_TRANSFER', paymentReference: 'AKR-JUL-2026-001', normalizedReference: 'AKRJUL2026001',
        amount: 50000, paidAt: dateTime('2026-06-30T12:10:00.000Z'), receiptNumber: 'AF-RCP-2026-0002',
        notes: 'July subscription payment recorded before the billing-period start.',
      },
    ] });

    await db.paymentProviderConfiguration.createMany({ data: [
      { id: 'seed_provider_manual', provider: 'MANUAL_BANK_TRANSFER', displayName: 'Manual bank transfer', enabled: true, demoMode: true, publicConfigJson: JSON.stringify({ bankName: 'Demo Commercial Bank', accountTitle: 'AI Finora Demo', iban: 'PK00 DEMO 0000 0000 0000 0000' }) },
      { id: 'seed_provider_safepay', provider: 'SAFEPAY', displayName: 'Safepay', enabled: true, demoMode: true, publicConfigJson: JSON.stringify({ label: 'Safepay Demo', environment: 'sandbox', realPaymentsEnabled: false }) },
    ] });

    await db.platformSetting.createMany({ data: [
      { id: 'seed_setting_dataset', key: 'seed.dataset.version', value: SEED_DATASET_VERSION, description: 'Identifies the deterministic local demonstration dataset.', updatedById: SEED_IDS.platformAdmin },
      { id: 'seed_setting_currency', key: 'platform.currency', value: 'PKR', description: 'Default SaaS invoice currency.', updatedById: SEED_IDS.platformAdmin },
      { id: 'seed_setting_timezone', key: 'platform.timezone', value: 'Asia/Karachi', description: 'Default display timezone.', updatedById: SEED_IDS.platformAdmin },
      { id: 'seed_setting_bank', key: 'billing.bankInstructions', value: JSON.stringify({ bank: 'Demo Commercial Bank', accountTitle: 'AI Finora Demo', iban: 'PK00 DEMO 0000 0000 0000 0000', demoOnly: true }), description: 'Demonstration bank details; never send real funds.', updatedById: SEED_IDS.platformAdmin },
    ] });

    await db.hospitalSetting.createMany({
      data: HOSPITAL_DEFINITIONS.flatMap((hospital) => [
        { id: `seed_hospital_setting_${hospital.key}_currency`, hospitalId: hospital.id, key: 'currency', value: 'PKR' },
        { id: `seed_hospital_setting_${hospital.key}_timezone`, hospitalId: hospital.id, key: 'timezone', value: 'Asia/Karachi' },
      ]),
    });

    await db.supportRequest.create({ data: {
      id: 'seed_support_request_noor', hospitalId: SEED_IDS.hospitals.noor, hospitalUserId: SEED_IDS.users.noorAdmin,
      subject: 'Annual renewal payment proof was rejected', category: 'SUBSCRIPTION_BILLING',
      description: 'Please confirm which bank document is required to verify our annual subscription transfer.',
      status: 'OPEN', priority: 'HIGH', assignedPlatformUserId: SEED_IDS.platformAdmin,
      createdAt: dateTime('2026-07-06T08:25:00.000Z'),
    } });

    await db.notification.createMany({ data: [
      { id: 'seed_notification_akram_created', hospitalId: SEED_IDS.hospitals.akram, hospitalUserId: SEED_IDS.users.akramAdmin, type: 'HOSPITAL_ACCOUNT_CREATED', title: 'Hospital account created', body: 'Akram Medical Centre is ready on the Growth plan.', severity: 'SUCCESS', link: '/hospital/subscription', dedupeKey: 'seed:notification:akram-created', createdAt: dateTime('2026-06-01T08:35:00.000Z') },
      { id: 'seed_notification_akram_payment', hospitalId: SEED_IDS.hospitals.akram, hospitalUserId: SEED_IDS.users.akramAdmin, type: 'PAYMENT_PROOF_APPROVED', title: 'Implementation payment approved', body: 'AF-RCP-2026-0001 was issued for your approved implementation payment.', severity: 'SUCCESS', link: '/hospital/subscription', dedupeKey: 'seed:notification:akram-payment-approved', createdAt: dateTime('2026-06-04T09:16:00.000Z') },
      { id: 'seed_notification_akram_pending', hospitalId: SEED_IDS.hospitals.akram, hospitalUserId: SEED_IDS.users.akramAdmin, type: 'PAYMENT_PROOF_SUBMITTED', title: 'Payment proof submitted', body: 'Your proof for AF-ADD-2026-0003 is awaiting verification.', severity: 'INFO', link: '/hospital/subscription', dedupeKey: 'seed:notification:akram-proof-pending', createdAt: dateTime('2026-07-11T11:46:00.000Z') },
      { id: 'seed_notification_noor_overdue', hospitalId: SEED_IDS.hospitals.noor, hospitalUserId: SEED_IDS.users.noorAdmin, type: 'PAYMENT_OVERDUE', title: 'Annual subscription payment overdue', body: 'AF-SUB-2026-0004 is overdue. The grace period ends on 15 Jul 2026.', severity: 'ERROR', link: '/hospital/subscription', dedupeKey: 'seed:notification:noor-overdue', createdAt: dateTime('2026-07-02T09:00:00.000Z') },
      { id: 'seed_notification_noor_rejected', hospitalId: SEED_IDS.hospitals.noor, hospitalUserId: SEED_IDS.users.noorAdmin, type: 'PAYMENT_PROOF_REJECTED', title: 'Payment proof needs attention', body: 'Upload a final debit confirmation or stamped deposit slip for AF-SUB-2026-0004.', severity: 'ERROR', link: '/hospital/subscription', dedupeKey: 'seed:notification:noor-proof-rejected', createdAt: dateTime('2026-07-05T10:21:00.000Z') },
      { id: 'seed_notification_islamabad_created', hospitalId: SEED_IDS.hospitals.islamabad, hospitalUserId: SEED_IDS.users.islamabadAdmin, type: 'HOSPITAL_ACCOUNT_CREATED', title: 'Enterprise trial started', body: 'Your 14-day AI Finora Enterprise trial is active.', severity: 'SUCCESS', link: '/hospital/subscription', dedupeKey: 'seed:notification:islamabad-created', createdAt: dateTime('2026-07-10T07:50:00.000Z') },
      { id: 'seed_notification_islamabad_invoice', hospitalId: SEED_IDS.hospitals.islamabad, hospitalUserId: SEED_IDS.users.islamabadAdmin, type: 'IMPLEMENTATION_INVOICE_ISSUED', title: 'Implementation invoice issued', body: 'AF-IMP-2026-0005 is due on 17 Jul 2026.', severity: 'WARNING', link: '/hospital/subscription', dedupeKey: 'seed:notification:islamabad-invoice', createdAt: dateTime('2026-07-10T07:52:00.000Z') },
      { id: 'seed_notification_platform_pending', platformUserId: SEED_IDS.platformAdmin, type: 'PAYMENT_PROOF_SUBMITTED', title: 'Payment verification required', body: 'Akram Medical Centre submitted MCB-ADDON-43092 for verification.', severity: 'WARNING', link: '/super-admin/payment-verification', dedupeKey: 'seed:notification:platform-pending', createdAt: dateTime('2026-07-11T11:46:00.000Z') },
    ] });

    await db.auditLog.createMany({ data: [
      { id: 'seed_audit_akram_created', hospitalId: SEED_IDS.hospitals.akram, actorType: 'PLATFORM_USER', actorId: SEED_IDS.platformAdmin, actorName: 'Areeba Khan', action: 'HOSPITAL_CREATED', entityType: 'Hospital', entityId: SEED_IDS.hospitals.akram, newValue: JSON.stringify({ code: 'akram-medical', plan: 'Growth', billingCycle: 'MONTHLY' }), reason: 'Demonstration tenant onboarding', ipAddress: '127.0.0.1', createdAt: dateTime('2026-06-01T08:30:00.000Z') },
      { id: 'seed_audit_akram_payment', hospitalId: SEED_IDS.hospitals.akram, actorType: 'PLATFORM_USER', actorId: SEED_IDS.platformAdmin, actorName: 'Areeba Khan', action: 'PAYMENT_PROOF_APPROVED', entityType: 'BankTransferProof', entityId: SEED_IDS.proofs.approved, previousValue: JSON.stringify({ status: 'UNDER_REVIEW' }), newValue: JSON.stringify({ status: 'APPROVED', receiptNumber: 'AF-RCP-2026-0001' }), reason: 'Bank reference and amount matched the demonstration statement.', ipAddress: '127.0.0.1', createdAt: dateTime('2026-06-04T09:15:00.000Z') },
      { id: 'seed_audit_noor_created', hospitalId: SEED_IDS.hospitals.noor, actorType: 'PLATFORM_USER', actorId: SEED_IDS.platformAdmin, actorName: 'Areeba Khan', action: 'HOSPITAL_CREATED', entityType: 'Hospital', entityId: SEED_IDS.hospitals.noor, newValue: JSON.stringify({ code: 'noor-surgical', plan: 'Starter', billingCycle: 'ANNUAL' }), reason: 'Demonstration tenant onboarding', ipAddress: '127.0.0.1', createdAt: dateTime('2026-03-15T10:00:00.000Z') },
      { id: 'seed_audit_noor_past_due', hospitalId: SEED_IDS.hospitals.noor, actorType: 'SYSTEM', actorName: 'Subscription Processing Service', action: 'SUBSCRIPTION_PAST_DUE', entityType: 'HospitalSubscription', entityId: SEED_IDS.subscriptions.noor, previousValue: JSON.stringify({ status: 'ACTIVE' }), newValue: JSON.stringify({ status: 'PAST_DUE' }), createdAt: dateTime('2026-07-02T00:05:00.000Z') },
      { id: 'seed_audit_noor_rejected', hospitalId: SEED_IDS.hospitals.noor, actorType: 'PLATFORM_USER', actorId: SEED_IDS.platformAdmin, actorName: 'Areeba Khan', action: 'PAYMENT_PROOF_REJECTED', entityType: 'BankTransferProof', entityId: SEED_IDS.proofs.rejected, previousValue: JSON.stringify({ status: 'UNDER_REVIEW' }), newValue: JSON.stringify({ status: 'REJECTED' }), reason: 'The document did not show a successful transfer.', ipAddress: '127.0.0.1', createdAt: dateTime('2026-07-05T10:20:00.000Z') },
      { id: 'seed_audit_islamabad_created', hospitalId: SEED_IDS.hospitals.islamabad, actorType: 'PLATFORM_USER', actorId: SEED_IDS.platformAdmin, actorName: 'Areeba Khan', action: 'HOSPITAL_CREATED', entityType: 'Hospital', entityId: SEED_IDS.hospitals.islamabad, newValue: JSON.stringify({ code: 'islamabad-family', plan: 'Enterprise', billingCycle: 'MONTHLY', status: 'TRIALING' }), reason: 'Demonstration tenant onboarding', ipAddress: '127.0.0.1', createdAt: dateTime('2026-07-10T07:45:00.000Z') },
      { id: 'seed_audit_pending_proof', hospitalId: SEED_IDS.hospitals.akram, actorType: 'HOSPITAL_USER', actorId: SEED_IDS.users.akramAdmin, actorName: 'Hassan Akram', action: 'PAYMENT_PROOF_SUBMITTED', entityType: 'BankTransferProof', entityId: SEED_IDS.proofs.pending, newValue: JSON.stringify({ invoiceNumber: 'AF-ADD-2026-0003', amount: 75000, reference: 'MCB-ADDON-43092' }), ipAddress: '127.0.0.1', createdAt: dateTime('2026-07-11T11:45:00.000Z') },
    ] });

    const departmentIds = {
      Cardiology: 'seed_department_cardiology', Gynaecology: 'seed_department_gynaecology', Orthopaedics: 'seed_department_orthopaedics',
      Paediatrics: 'seed_department_paediatrics', Radiology: 'seed_department_radiology', Emergency: 'seed_department_emergency',
      'General OPD': 'seed_department_general_opd', Pathology: 'seed_department_pathology', Inpatient: 'seed_department_inpatient',
      Surgery: 'seed_department_surgery', Nursing: 'seed_department_nursing', Pharmacy: 'seed_department_pharmacy',
    };
    await db.department.createMany({ data: [
      { id: departmentIds.Cardiology, hospitalId: SEED_IDS.hospitals.akram, code: 'CARD', name: 'Cardiology', headDoctorName: 'Dr. Zain Malik', monthlyPatientCount: 128 },
      { id: departmentIds.Gynaecology, hospitalId: SEED_IDS.hospitals.akram, code: 'GYNAE', name: 'Gynaecology', headDoctorName: 'Dr. Mehwish Raza', monthlyPatientCount: 96 },
      { id: departmentIds.Orthopaedics, hospitalId: SEED_IDS.hospitals.akram, code: 'ORTHO', name: 'Orthopaedics', headDoctorName: 'Dr. Umar Qureshi', monthlyPatientCount: 111 },
      { id: departmentIds.Paediatrics, hospitalId: SEED_IDS.hospitals.akram, code: 'PAEDS', name: 'Paediatrics', headDoctorName: 'Dr. Sana Karim', monthlyPatientCount: 147 },
      { id: departmentIds.Radiology, hospitalId: SEED_IDS.hospitals.akram, code: 'RAD', name: 'Radiology', headDoctorName: 'Dr. Ahmed Saeed', monthlyPatientCount: 173 },
      { id: departmentIds.Emergency, hospitalId: SEED_IDS.hospitals.akram, code: 'ER', name: 'Emergency', headDoctorName: 'Dr. Hira Salman', monthlyPatientCount: 212 },
      { id: departmentIds['General OPD'], hospitalId: SEED_IDS.hospitals.akram, code: 'OPD', name: 'General OPD', monthlyPatientCount: 264 },
      { id: departmentIds.Pathology, hospitalId: SEED_IDS.hospitals.akram, code: 'PATH', name: 'Pathology', monthlyPatientCount: 318 },
      { id: departmentIds.Inpatient, hospitalId: SEED_IDS.hospitals.akram, code: 'INPAT', name: 'Inpatient', monthlyPatientCount: 54 },
      { id: departmentIds.Surgery, hospitalId: SEED_IDS.hospitals.akram, code: 'SURG', name: 'Surgery', monthlyPatientCount: 37 },
      { id: departmentIds.Nursing, hospitalId: SEED_IDS.hospitals.akram, code: 'NURS', name: 'Nursing', monthlyPatientCount: 290 },
      { id: departmentIds.Pharmacy, hospitalId: SEED_IDS.hospitals.akram, code: 'PHARM', name: 'Pharmacy', monthlyPatientCount: 406 },
    ] });

    const doctorIds = {
      zain: 'seed_doctor_zain', mehwish: 'seed_doctor_mehwish', umar: 'seed_doctor_umar',
      sana: 'seed_doctor_sana', ahmed: 'seed_doctor_ahmed', hira: 'seed_doctor_hira',
    };
    await db.doctor.createMany({ data: [
      { id: doctorIds.zain, hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Cardiology, displayCode: 'D-101', name: 'Dr. Zain Malik', specialty: 'Consultant Cardiologist', phone: '0301-5551022', fee: 3500, availability: 'Mon-Sat' },
      { id: doctorIds.mehwish, hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Gynaecology, displayCode: 'D-102', name: 'Dr. Mehwish Raza', specialty: 'Consultant Gynaecologist', phone: '0322-5557741', fee: 3000, availability: 'Mon, Wed, Fri' },
      { id: doctorIds.umar, hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Orthopaedics, displayCode: 'D-103', name: 'Dr. Umar Qureshi', specialty: 'Orthopaedic Surgeon', phone: '0334-5553044', fee: 3200, availability: 'Tue-Sun' },
      { id: doctorIds.sana, hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Paediatrics, displayCode: 'D-104', name: 'Dr. Sana Karim', specialty: 'Paediatrician', phone: '0307-5558292', fee: 2500, availability: 'Mon-Sat' },
      { id: doctorIds.ahmed, hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Radiology, displayCode: 'D-105', name: 'Dr. Ahmed Saeed', specialty: 'Radiologist', phone: '0316-5556127', fee: 2800, availability: 'Daily' },
      { id: doctorIds.hira, hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Emergency, displayCode: 'D-106', name: 'Dr. Hira Salman', specialty: 'Emergency Physician', phone: '0309-5550448', fee: 2200, availability: 'Rotational' },
    ] });

    const patientIds = {
      ayesha: 'seed_patient_ayesha', bilal: 'seed_patient_bilal', sara: 'seed_patient_sara', usman: 'seed_patient_usman',
      hina: 'seed_patient_hina', hamza: 'seed_patient_hamza', nadia: 'seed_patient_nadia', mariam: 'seed_patient_mariam',
      kamran: 'seed_patient_kamran', irfan: 'seed_patient_irfan', noor: 'seed_patient_noor_zoya', islamabad: 'seed_patient_islamabad_rayan',
    };
    await db.patient.createMany({ data: [
      { id: patientIds.ayesha, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1048', name: 'Ayesha Khan', age: 34, gender: 'Female', phone: '0300-8844211', city: 'Lahore', bloodGroup: 'B+', cnic: '35202-****-***-2', payer: 'Self Pay', status: 'Active', createdAt: dateTime('2026-07-12T08:45:00.000Z') },
      { id: patientIds.bilal, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1047', name: 'Muhammad Bilal', age: 49, gender: 'Male', phone: '0321-6720411', city: 'Rawalpindi', bloodGroup: 'O+', cnic: '37405-****-***-6', payer: 'Jubilee Health', status: 'Admitted', createdAt: dateTime('2026-07-10T06:30:00.000Z') },
      { id: patientIds.sara, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1046', name: 'Sara Ahmed', age: 27, gender: 'Female', phone: '0333-9081224', city: 'Islamabad', bloodGroup: 'A+', cnic: '61101-****-***-8', payer: 'Adamjee Insurance', status: 'Active', createdAt: dateTime('2026-07-11T09:10:00.000Z') },
      { id: patientIds.usman, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1045', name: 'Usman Ali', age: 61, gender: 'Male', phone: '0302-1178104', city: 'Gujranwala', bloodGroup: 'AB+', cnic: '34101-****-***-3', payer: 'Self Pay', status: 'Discharged', createdAt: dateTime('2026-07-10T07:20:00.000Z') },
      { id: patientIds.hina, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1044', name: 'Hina Farooq', age: 42, gender: 'Female', phone: '0315-4472990', city: 'Lahore', bloodGroup: 'O-', cnic: '35202-****-***-1', payer: 'EFU Health', status: 'Active', createdAt: dateTime('2026-07-08T11:30:00.000Z') },
      { id: patientIds.hamza, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1043', name: 'Hamza Tariq', age: 29, gender: 'Male', phone: '0308-3117702', city: 'Lahore', bloodGroup: 'O+', payer: 'Self Pay', status: 'Active', createdAt: dateTime('2026-07-12T09:20:00.000Z') },
      { id: patientIds.nadia, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1042', name: 'Nadia Iqbal', age: 38, gender: 'Female', phone: '0324-9014225', city: 'Lahore', bloodGroup: 'A-', payer: 'Self Pay', status: 'Active', createdAt: dateTime('2026-07-12T09:35:00.000Z') },
      { id: patientIds.mariam, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1041', name: 'Mariam Akhtar', age: 53, gender: 'Female', phone: '0312-7781042', city: 'Kasur', bloodGroup: 'B-', payer: 'Self Pay', status: 'Admitted', createdAt: dateTime('2026-07-11T04:50:00.000Z') },
      { id: patientIds.kamran, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1040', name: 'Kamran Shah', age: 46, gender: 'Male', phone: '0335-6100291', city: 'Sheikhupura', bloodGroup: 'AB-', payer: 'Corporate', status: 'Admitted', createdAt: dateTime('2026-07-09T05:45:00.000Z') },
      { id: patientIds.irfan, hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1039', name: 'Irfan Bashir', age: 40, gender: 'Male', phone: '0306-8810449', city: 'Lahore', bloodGroup: 'A+', payer: 'Self Pay', status: 'Active', createdAt: dateTime('2026-07-02T10:15:00.000Z') },
      { id: patientIds.noor, hospitalId: SEED_IDS.hospitals.noor, displayCode: 'P-1048', name: 'Zoya Rahman', age: 33, gender: 'Female', phone: '0301-7008812', city: 'Karachi', bloodGroup: 'O+', payer: 'Self Pay', status: 'Active', createdAt: dateTime('2026-07-08T08:00:00.000Z') },
      { id: patientIds.islamabad, hospitalId: SEED_IDS.hospitals.islamabad, displayCode: 'P-1048', name: 'Rayan Siddiqui', age: 8, gender: 'Male', phone: '0332-5102234', city: 'Islamabad', bloodGroup: 'B+', payer: 'Self Pay', status: 'Active', createdAt: dateTime('2026-07-12T10:00:00.000Z') },
    ] });

    const serviceIds = Object.fromEntries(['S-001', 'S-002', 'S-003', 'S-004', 'S-005', 'S-006', 'S-007', 'S-008', 'S-009', 'S-010', 'S-011', 'S-012', 'M-001', 'M-002'].map((code) => [code, `seed_service_${code.replace('-', '_').toLowerCase()}`]));
    await db.service.createMany({ data: [
      { id: serviceIds['S-001'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds['General OPD'], displayCode: 'S-001', name: 'OPD Consultation', category: 'Consultation', departmentName: 'General OPD', price: 2000 },
      { id: serviceIds['S-002'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Cardiology, displayCode: 'S-002', name: 'Cardiology Consultation', category: 'Consultation', departmentName: 'Cardiology', price: 3500 },
      { id: serviceIds['S-003'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Pathology, displayCode: 'S-003', name: 'Complete Blood Count', category: 'Laboratory', departmentName: 'Pathology', price: 1800 },
      { id: serviceIds['S-004'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Pathology, displayCode: 'S-004', name: 'Liver Function Test', category: 'Laboratory', departmentName: 'Pathology', price: 3200 },
      { id: serviceIds['S-005'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Radiology, displayCode: 'S-005', name: 'Chest X-Ray', category: 'Radiology', departmentName: 'Radiology', price: 2500 },
      { id: serviceIds['S-006'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Radiology, displayCode: 'S-006', name: 'Ultrasound Abdomen', category: 'Radiology', departmentName: 'Radiology', price: 4500 },
      { id: serviceIds['S-007'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Emergency, displayCode: 'S-007', name: 'Emergency Room Charge', category: 'Emergency', departmentName: 'Emergency', price: 5000 },
      { id: serviceIds['S-008'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Inpatient, displayCode: 'S-008', name: 'General Ward - Per Day', category: 'Room', departmentName: 'Inpatient', price: 7500 },
      { id: serviceIds['S-009'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Inpatient, displayCode: 'S-009', name: 'Private Room - Per Day', category: 'Room', departmentName: 'Inpatient', price: 18000 },
      { id: serviceIds['S-010'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Surgery, displayCode: 'S-010', name: 'Operation Theatre - Minor', category: 'Procedure', departmentName: 'Surgery', price: 25000 },
      { id: serviceIds['S-011'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Cardiology, displayCode: 'S-011', name: 'ECG', category: 'Procedure', departmentName: 'Cardiology', price: 3000 },
      { id: serviceIds['S-012'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Nursing, displayCode: 'S-012', name: 'IV Cannula & Administration', category: 'Procedure', departmentName: 'Nursing', price: 1500 },
      { id: serviceIds['M-001'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Pharmacy, displayCode: 'M-001', name: 'Paracetamol 500mg', category: 'Medicine', departmentName: 'Pharmacy', price: 280 },
      { id: serviceIds['M-002'], hospitalId: SEED_IDS.hospitals.akram, departmentId: departmentIds.Pharmacy, displayCode: 'M-002', name: 'Ceftriaxone 1g Injection', category: 'Medicine', departmentName: 'Pharmacy', price: 950 },
    ] });

    await db.appointment.createMany({ data: [
      { id: 'seed_appointment_2081', hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.ayesha, doctorId: doctorIds.zain, departmentId: departmentIds.Cardiology, displayCode: 'A-2081', visitType: 'OPD', appointmentDate: date('2026-07-12'), appointmentTime: '09:30 AM', status: 'Checked In' },
      { id: 'seed_appointment_2082', hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.sara, doctorId: doctorIds.mehwish, departmentId: departmentIds.Gynaecology, displayCode: 'A-2082', visitType: 'OPD', appointmentDate: date('2026-07-12'), appointmentTime: '10:15 AM', status: 'Scheduled' },
      { id: 'seed_appointment_2083', hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.hamza, doctorId: doctorIds.umar, departmentId: departmentIds.Orthopaedics, displayCode: 'A-2083', visitType: 'Emergency', appointmentDate: date('2026-07-12'), appointmentTime: '10:40 AM', status: 'In Treatment' },
      { id: 'seed_appointment_2084', hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.nadia, doctorId: doctorIds.zain, departmentId: departmentIds.Cardiology, displayCode: 'A-2084', visitType: 'OPD', appointmentDate: date('2026-07-12'), appointmentTime: '11:30 AM', status: 'Scheduled' },
    ] });

    await db.admission.createMany({ data: [
      { id: 'seed_admission_709', hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.bilal, doctorId: doctorIds.zain, displayCode: 'ADM-709', ward: 'Cardiac Ward', room: 'C-204', bed: '02', admittedAt: date('2026-07-10'), billingPackage: 'Insurance', status: 'Admitted' },
      { id: 'seed_admission_708', hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.mariam, doctorId: doctorIds.sana, displayCode: 'ADM-708', ward: 'General Ward', room: 'G-106', bed: '04', admittedAt: date('2026-07-11'), billingPackage: 'Self Pay', status: 'Admitted' },
      { id: 'seed_admission_707', hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.kamran, doctorId: doctorIds.umar, displayCode: 'ADM-707', ward: 'Surgical Ward', room: 'S-301', bed: '01', admittedAt: date('2026-07-09'), billingPackage: 'Corporate', status: 'Discharge Pending' },
    ] });

    const patientInvoiceIds = {
      i418: 'seed_patient_invoice_0418', i417: 'seed_patient_invoice_0417', i416: 'seed_patient_invoice_0416',
      i415: 'seed_patient_invoice_0415', i399: 'seed_patient_invoice_0399',
    };
    await db.patientInvoice.createMany({ data: [
      { id: patientInvoiceIds.i418, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.ayesha, invoiceNumber: 'INV-2026-0418', invoiceDate: date('2026-07-12'), payer: 'Self Pay', total: 7300, paidAmount: 7300, status: 'Paid', visitType: 'OPD', discount: 760, insurance: 0 },
      { id: patientInvoiceIds.i417, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.bilal, invoiceNumber: 'INV-2026-0417', invoiceDate: date('2026-07-11'), payer: 'Jubilee Health', total: 68500, paidAmount: 50000, status: 'Partially Paid', visitType: 'Inpatient', discount: 0, insurance: 22300 },
      { id: patientInvoiceIds.i416, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.sara, invoiceNumber: 'INV-2026-0416', invoiceDate: date('2026-07-11'), payer: 'Adamjee Insurance', total: 7700, paidAmount: 0, status: 'Outstanding', visitType: 'OPD', discount: 0, insurance: 0 },
      { id: patientInvoiceIds.i415, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.usman, invoiceNumber: 'INV-2026-0415', invoiceDate: date('2026-07-10'), payer: 'Self Pay', total: 13400, paidAmount: 13400, status: 'Paid', visitType: 'Emergency', discount: 1500, insurance: 0 },
      { id: patientInvoiceIds.i399, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.irfan, invoiceNumber: 'INV-2026-0399', invoiceDate: date('2026-07-02'), payer: 'Self Pay', total: 10000, paidAmount: 7500, status: 'Partially Paid', visitType: 'OPD', discount: 0, insurance: 0 },
    ] });

    await db.patientInvoiceItem.createMany({ data: [
      { id: 'seed_patient_item_0418_1', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i418, serviceId: serviceIds['S-002'], description: 'Cardiology Consultation', quantity: 1, unitPrice: 3500, lineTotal: 3500 },
      { id: 'seed_patient_item_0418_2', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i418, serviceId: serviceIds['S-011'], description: 'ECG', quantity: 1, unitPrice: 3000, lineTotal: 3000 },
      { id: 'seed_patient_item_0418_3', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i418, serviceId: serviceIds['M-001'], description: 'Paracetamol 500mg', quantity: 2, unitPrice: 280, lineTotal: 560 },
      { id: 'seed_patient_item_0418_4', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i418, description: 'Legacy invoice migration adjustment', quantity: 1, unitPrice: 1000, lineTotal: 1000 },

      { id: 'seed_patient_item_0417_1', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i417, serviceId: serviceIds['S-009'], description: 'Private Room - Per Day', quantity: 2, unitPrice: 18000, lineTotal: 36000 },
      { id: 'seed_patient_item_0417_2', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i417, serviceId: serviceIds['S-011'], description: 'ECG', quantity: 1, unitPrice: 3000, lineTotal: 3000 },
      { id: 'seed_patient_item_0417_3', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i417, serviceId: serviceIds['S-003'], description: 'Complete Blood Count', quantity: 1, unitPrice: 1800, lineTotal: 1800 },
      { id: 'seed_patient_item_0417_4', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i417, serviceId: serviceIds['S-007'], description: 'Emergency Room Charge', quantity: 1, unitPrice: 5000, lineTotal: 5000 },
      { id: 'seed_patient_item_0417_5', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i417, description: 'Legacy inpatient package adjustment', quantity: 1, unitPrice: 22700, lineTotal: 22700 },

      { id: 'seed_patient_item_0416_1', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i416, serviceId: serviceIds['S-001'], description: 'OPD Consultation', quantity: 1, unitPrice: 2000, lineTotal: 2000 },
      { id: 'seed_patient_item_0416_2', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i416, serviceId: serviceIds['S-006'], description: 'Ultrasound Abdomen', quantity: 1, unitPrice: 4500, lineTotal: 4500 },
      { id: 'seed_patient_item_0416_3', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i416, description: 'Legacy invoice migration adjustment', quantity: 1, unitPrice: 1200, lineTotal: 1200 },

      { id: 'seed_patient_item_0415_1', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i415, serviceId: serviceIds['S-007'], description: 'Emergency Room Charge', quantity: 1, unitPrice: 5000, lineTotal: 5000 },
      { id: 'seed_patient_item_0415_2', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i415, serviceId: serviceIds['S-005'], description: 'Chest X-Ray', quantity: 1, unitPrice: 2500, lineTotal: 2500 },
      { id: 'seed_patient_item_0415_3', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i415, serviceId: serviceIds['S-012'], description: 'IV Cannula & Administration', quantity: 1, unitPrice: 1500, lineTotal: 1500 },
      { id: 'seed_patient_item_0415_4', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i415, serviceId: serviceIds['M-002'], description: 'Ceftriaxone 1g Injection', quantity: 2, unitPrice: 950, lineTotal: 1900 },
      { id: 'seed_patient_item_0415_5', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i415, description: 'Legacy emergency package adjustment', quantity: 1, unitPrice: 4000, lineTotal: 4000 },

      { id: 'seed_patient_item_0399_1', hospitalId: SEED_IDS.hospitals.akram, invoiceId: patientInvoiceIds.i399, description: 'Historical outpatient procedure package', quantity: 1, unitPrice: 10000, lineTotal: 10000 },
    ] });

    const patientPaymentIds = { p9008: 'seed_patient_payment_9008', p9007: 'seed_patient_payment_9007', p9006: 'seed_patient_payment_9006', r1032: 'seed_patient_payment_refund_1032' };
    await db.patientPayment.createMany({ data: [
      { id: patientPaymentIds.p9008, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.ayesha, invoiceId: patientInvoiceIds.i418, paymentNumber: 'PAY-9008', paymentDate: date('2026-07-12'), method: 'Card', amount: 7300, status: 'Received', reference: 'CARD-DEMO-9008' },
      { id: patientPaymentIds.p9007, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.bilal, invoiceId: patientInvoiceIds.i417, paymentNumber: 'PAY-9007', paymentDate: date('2026-07-11'), method: 'Insurance', amount: 50000, status: 'Received', reference: 'JUBILEE-DEMO-9007' },
      { id: patientPaymentIds.p9006, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.usman, invoiceId: patientInvoiceIds.i415, paymentNumber: 'PAY-9006', paymentDate: date('2026-07-10'), method: 'Cash', amount: 13400, status: 'Received' },
      { id: patientPaymentIds.r1032, hospitalId: SEED_IDS.hospitals.akram, patientId: patientIds.irfan, invoiceId: patientInvoiceIds.i399, paymentNumber: 'REF-1032', paymentDate: date('2026-07-09'), method: 'Bank Transfer', amount: -2500, status: 'Refunded', reference: 'REFUND-DEMO-1032' },
    ] });

    await db.patientReceipt.createMany({ data: [
      { id: 'seed_patient_receipt_9008', hospitalId: SEED_IDS.hospitals.akram, paymentId: patientPaymentIds.p9008, receiptNumber: 'RCP-2026-9008', issuedAt: dateTime('2026-07-12T10:00:00.000Z') },
      { id: 'seed_patient_receipt_9007', hospitalId: SEED_IDS.hospitals.akram, paymentId: patientPaymentIds.p9007, receiptNumber: 'RCP-2026-9007', issuedAt: dateTime('2026-07-11T13:20:00.000Z') },
      { id: 'seed_patient_receipt_9006', hospitalId: SEED_IDS.hospitals.akram, paymentId: patientPaymentIds.p9006, receiptNumber: 'RCP-2026-9006', issuedAt: dateTime('2026-07-10T15:40:00.000Z') },
    ] });

    return seedSummary(db);
  }, { maxWait: 10_000, timeout: 60_000 });
}
