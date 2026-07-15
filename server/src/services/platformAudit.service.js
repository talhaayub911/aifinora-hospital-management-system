// Platform administration needs SaaS/account evidence, but it must not become
// a second route into a hospital's patient or clinical records. This is a
// default-deny allowlist: new operational entity types stay private until they
// are deliberately classified here.
export const PLATFORM_AUDIT_ENTITY_TYPES = Object.freeze([
  'Hospital',
  'HospitalBranch',
  'HospitalFeatureOverride',
  'HospitalRole',
  'HospitalRolePermission',
  'HospitalSubscription',
  'HospitalUser',
  'PlatformSetting',
  'PlatformUser',
  'SubscriptionPlan',
  'SubscriptionPlanVersion',
  'SubscriptionInvoice',
  'SubscriptionPayment',
  'BankTransferProof',
  'PaymentProviderConfiguration',
  'SupportAccessSession',
  'SupportRequest',
]);

const OPERATIONAL_ACTION_PREFIXES = Object.freeze([
  'PATIENT_',
  'APPOINTMENT_',
  'ADMISSION_',
  'DOCTOR_',
  'DEPARTMENT_',
  'CHARGE_MASTER_',
  'PHARMACY_INVENTORY_',
]);

const SAFE_FIELDS = Object.freeze({
  Hospital: ['code', 'name', 'accountStatus', 'status', 'plan', 'planId', 'planName', 'billingCycle', 'enabledModules', 'maxUsers', 'maxBranches', 'maxBeds', 'storageLimitMb'],
  HospitalBranch: ['code', 'name', 'isActive', 'status'],
  HospitalFeatureOverride: ['featureKey', 'enabled', 'expiresAt'],
  HospitalRole: ['key', 'name', 'isSystem'],
  HospitalRolePermission: ['featureKey', 'canRead', 'canWrite', 'canManage'],
  HospitalSubscription: ['status', 'plan', 'planId', 'planName', 'billingCycle', 'price', 'discount', 'taxRate', 'implementationFee', 'implementationFeeStatus', 'currentPeriodStart', 'currentPeriodEnd', 'nextBillingDate', 'gracePeriodEndsAt', 'maxUsers', 'maxBranches', 'maxBeds', 'storageLimitMb', 'enabledModules'],
  HospitalUser: ['email', 'role', 'roleKey', 'isActive', 'mustChangePassword'],
  PlatformSetting: [],
  PlatformUser: ['email', 'role', 'isActive'],
  SubscriptionPlan: ['code', 'name', 'isActive', 'monthlyPrice', 'annualPrice', 'defaultImplementationFee', 'maxUsers', 'maxBranches', 'maxBeds', 'storageLimitMb', 'features', 'addOns'],
  SubscriptionPlanVersion: ['version', 'isPublished', 'monthlyPrice', 'annualPrice', 'defaultImplementationFee', 'maxUsers', 'maxBranches', 'maxBeds', 'storageLimitMb', 'features'],
  SubscriptionInvoice: ['invoiceId', 'sourceInvoiceId', 'invoiceNumber', 'type', 'invoiceType', 'status', 'paidAmount', 'creditAmount', 'paymentId'],
  SubscriptionPayment: ['invoiceId', 'provider', 'reference', 'amount', 'invoiceStatus', 'status'],
  BankTransferProof: ['invoiceId', 'invoiceNumber', 'amount', 'reference', 'status', 'paymentId', 'receiptNumber'],
  PaymentProviderConfiguration: ['provider', 'enabled', 'demoMode'],
  SupportAccessSession: ['warningAccepted', 'expiresAt', 'endedAt'],
  SupportRequest: ['category', 'status', 'priority', 'assignedPlatformUserId', 'scope', 'format'],
});

const SENSITIVE_KEYS = new Set([
  'password', 'passwordhash', 'temporarypassword', 'token', 'tokenhash', 'tokenversion',
  'secret', 'authorization', 'storagekey', 'sha256', 'description', 'response', 'subject',
  'notes', 'reason', 'patient', 'patientid', 'patientname', 'diagnosis', 'medicalrecord',
]);

function parseAuditValue(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function scrubNested(value, depth = 0) {
  if (depth > 5) return '[REDACTED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => scrubNested(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEYS.has(key.toLowerCase()))
    .map(([key, child]) => [key, scrubNested(child, depth + 1)]));
}

function projectedValue(entityType, value) {
  const parsed = parseAuditValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const fields = SAFE_FIELDS[entityType] || [];
  const projected = {};
  for (const field of fields) {
    if (Object.hasOwn(parsed, field) && !SENSITIVE_KEYS.has(field.toLowerCase())) projected[field] = scrubNested(parsed[field]);
  }
  return Object.keys(projected).length ? projected : null;
}

export function platformAuditWhere(additional = {}) {
  return {
    ...additional,
    entityType: { in: [...PLATFORM_AUDIT_ENTITY_TYPES] },
    NOT: OPERATIONAL_ACTION_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })),
  };
}

export function isPlatformAuditVisible(audit) {
  return PLATFORM_AUDIT_ENTITY_TYPES.includes(audit.entityType)
    && !OPERATIONAL_ACTION_PREFIXES.some((prefix) => String(audit.action).startsWith(prefix));
}

export function platformAuditDto(audit) {
  return {
    id: audit.id,
    hospitalId: audit.hospitalId,
    actorType: audit.actorType,
    actorId: audit.actorId,
    actorName: audit.actorName,
    action: audit.action,
    entityType: audit.entityType,
    entityId: audit.entityId,
    previousValue: projectedValue(audit.entityType, audit.previousValue),
    newValue: projectedValue(audit.entityType, audit.newValue),
    reason: audit.reason ? '[REDACTED FROM PLATFORM VIEW]' : null,
    ipAddress: audit.ipAddress,
    createdAt: audit.createdAt,
    ...(audit.hospital ? { hospital: audit.hospital, hospitalName: audit.hospital.name, hospitalCode: audit.hospital.code } : {}),
  };
}
