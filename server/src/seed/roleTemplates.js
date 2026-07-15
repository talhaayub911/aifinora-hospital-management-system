import { FEATURE_KEYS } from '../services/access.service.js';

const all = Object.fromEntries(FEATURE_KEYS.map((key) => [key, ['read', 'write', 'manage']]));

export const ROLE_TEMPLATES = [
  { key: 'hospital_admin', name: 'Hospital Admin', permissions: all },
  {
    key: 'receptionist', name: 'Receptionist', permissions: {
      dashboard: ['read'], patient_registration: ['read', 'write'], appointments: ['read', 'write'], admissions: ['read'],
      doctors: ['read'], departments: ['read'], charge_master: ['read'], receipts: ['read'], support: ['read', 'write'],
    },
  },
  {
    key: 'billing_officer', name: 'Billing Officer', permissions: {
      dashboard: ['read'], patient_registration: ['read'], appointments: ['read'], admissions: ['read'], charge_master: ['read'],
      opd_billing: ['read', 'write'], emergency_billing: ['read', 'write'], inpatient_billing: ['read', 'write'],
      pharmacy_billing: ['read', 'write'], laboratory_billing: ['read', 'write'], insurance_billing: ['read', 'write'],
      corporate_billing: ['read', 'write'], payments: ['read', 'write'], refunds: ['read', 'write'], receipts: ['read', 'write'],
    },
  },
  {
    key: 'accountant', name: 'Accountant', permissions: {
      dashboard: ['read'], opd_billing: ['read'], emergency_billing: ['read'], inpatient_billing: ['read'],
      pharmacy_billing: ['read'], laboratory_billing: ['read'], insurance_billing: ['read'], corporate_billing: ['read'],
      payments: ['read', 'write'], refunds: ['read', 'write'], receipts: ['read'], financial_reports: ['read'],
    },
  },
];

export async function createHospitalRoles(db, hospitalId) {
  // Step 1: Create all roles in a single batch
  await db.hospitalRole.createMany({
    data: ROLE_TEMPLATES.map((t) => ({ hospitalId, key: t.key, name: t.name })),
    skipDuplicates: true,
  });

  // Step 2: Fetch the created roles so we have their IDs
  const createdRoles = await db.hospitalRole.findMany({
    where: { hospitalId, key: { in: ROLE_TEMPLATES.map((t) => t.key) } },
  });
  const roleByKey = Object.fromEntries(createdRoles.map((r) => [r.key, r]));

  // Step 3: Create all permissions in a single batch
  const permissionsData = [];
  for (const template of ROLE_TEMPLATES) {
    const role = roleByKey[template.key];
    for (const [featureKey, actions] of Object.entries(template.permissions)) {
      permissionsData.push({
        hospitalId,
        roleId: role.id,
        featureKey,
        canRead: actions.includes('read'),
        canWrite: actions.includes('write'),
        canManage: actions.includes('manage'),
      });
    }
  }
  await db.hospitalRolePermission.createMany({ data: permissionsData, skipDuplicates: true });

  return roleByKey;
}
