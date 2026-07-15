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
  const roles = {};
  for (const template of ROLE_TEMPLATES) {
    const role = await db.hospitalRole.create({
      data: {
        hospitalId,
        key: template.key,
        name: template.name,
        permissions: {
          create: Object.entries(template.permissions).map(([featureKey, actions]) => ({
            hospitalId,
            featureKey,
            canRead: actions.includes('read'),
            canWrite: actions.includes('write'),
            canManage: actions.includes('manage'),
          })),
        },
      },
    });
    roles[template.key] = role;
  }
  return roles;
}
