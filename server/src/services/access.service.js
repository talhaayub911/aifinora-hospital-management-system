import { forbidden } from '../utils/errors.js';

export const FEATURE_KEYS = [
  'dashboard', 'patient_registration', 'appointments', 'admissions', 'doctors', 'departments',
  'charge_master', 'opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing',
  'laboratory_billing', 'insurance_billing', 'corporate_billing', 'payments', 'refunds', 'receipts',
  'financial_reports', 'pharmacy_inventory', 'multi_branch_management', 'api_access',
  'subscription_billing', 'user_management', 'data_export', 'support',
];

const alwaysAvailable = new Set(['dashboard', 'subscription_billing', 'user_management', 'data_export', 'support']);
const billingWhileRestricted = new Set(['subscription_billing', 'data_export', 'support']);

export async function loadAccessContext(db, hospitalId, auth) {
  const subscription = await db.hospitalSubscription.findFirst({
    where: { hospitalId, isCurrent: true },
    orderBy: { createdAt: 'desc' },
    include: {
      planVersion: { include: { plan: true, features: true } },
      featureOverrides: true,
    },
  });
  const now = new Date();
  const enabled = new Set(subscription?.planVersion.features.filter((feature) => feature.enabled).map((feature) => feature.featureKey) || []);
  for (const key of alwaysAvailable) enabled.add(key);
  for (const override of subscription?.featureOverrides || []) {
    if (alwaysAvailable.has(override.featureKey)) continue;
    if (override.expiresAt && override.expiresAt <= now) continue;
    if (override.enabled) enabled.add(override.featureKey);
    else enabled.delete(override.featureKey);
  }

  const permissions = auth.kind === 'support'
    ? Object.fromEntries(FEATURE_KEYS.map((key) => [key, { read: true, write: false, manage: false }]))
    : Object.fromEntries(auth.user.role.permissions.map((permission) => [permission.featureKey, {
      read: permission.canRead,
      write: permission.canWrite,
      manage: permission.canManage,
    }]));

  return {
    subscription,
    status: subscription?.status || 'PENDING_PAYMENT',
    features: [...enabled],
    featureSet: enabled,
    permissions,
  };
}

export function assertAccess(req, featureKey, action = 'read') {
  const access = req.access;
  if (!access) throw forbidden('Subscription access has not been resolved.');
  if (!access.featureSet.has(featureKey)) throw forbidden(`The ${featureKey} module is not enabled for this hospital.`);
  const permission = access.permissions[featureKey];
  const allowedByRole = action === 'manage' ? permission?.manage : action === 'write' ? permission?.write : permission?.read;
  if (!allowedByRole) throw forbidden(`Your hospital role cannot ${action} the ${featureKey} module.`);

  const status = String(access.status).toUpperCase();
  if (['READ_ONLY', 'PAUSED'].includes(status) && action !== 'read' && !billingWhileRestricted.has(featureKey)) {
    throw forbidden('This hospital is in read-only mode. Existing records remain available, but new operational transactions are blocked.');
  }
  if (status === 'PENDING_PAYMENT' && !billingWhileRestricted.has(featureKey) && featureKey !== 'dashboard') {
    throw forbidden('Only onboarding and subscription billing are available while payment is pending.');
  }
  if (['SUSPENDED', 'CANCELED'].includes(status) && !billingWhileRestricted.has(featureKey)) {
    throw forbidden('This hospital account is suspended. Only subscription billing and data export information are available.');
  }
  if (req.auth.kind === 'support' && action !== 'read') throw forbidden('Support-access sessions are read-only.');
}

export function assertAnyAccess(req, featureKeys, action = 'read') {
  const eligible = featureKeys.find((featureKey) => {
    if (!req.access?.featureSet.has(featureKey)) return false;
    const permission = req.access.permissions[featureKey];
    return action === 'manage' ? permission?.manage : action === 'write' ? permission?.write : permission?.read;
  });
  if (!eligible) throw forbidden('Your role and subscription do not permit access to this resource.');
  assertAccess(req, eligible, action);
  return eligible;
}

export function loadHospitalAccess(req, _res, next) {
  loadAccessContext(req.app.locals.prisma, req.hospitalId, req.auth)
    .then((access) => {
      const status = String(access.status).toUpperCase();
      if (req.auth.kind === 'hospital' && ['SUSPENDED', 'CANCELED'].includes(status) && req.auth.user.role.key !== 'hospital_admin') {
        throw forbidden('This hospital account is suspended. Only a Hospital Administrator may access subscription billing and data-export information.');
      }
      req.access = access;
      next();
    })
    .catch(next);
}

export const requireAccess = (featureKey, action = 'read') => (req, _res, next) => {
  try {
    assertAccess(req, featureKey, action);
    next();
  } catch (error) {
    next(error);
  }
};
