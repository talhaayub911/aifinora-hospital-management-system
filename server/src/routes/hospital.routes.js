import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../config/env.js';
import { paymentProofUpload, validatePaymentProofFile } from '../middleware/upload.js';
import { assertAccess, assertAnyAccess, loadHospitalAccess, requireAccess } from '../services/access.service.js';
import { createNotification, writeAudit } from '../services/audit.service.js';
import { SafepayProvider } from '../services/payments/SafepayProvider.js';
import { subscriptionInvoiceDto } from '../services/subscriptionInvoice.service.js';
import { withSerializableFinancialTransaction } from '../services/subscriptionPayment.service.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { decimalNumber, normalizeCode, normalizeEmail, normalizeReference } from '../utils/format.js';
import {
  admissionDto, appointmentDto, departmentDto, doctorDto, patientDto, patientInvoiceDto, patientPaymentDto, serviceDto,
} from '../utils/hospitalDto.js';

const dateOnly = (value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw badRequest('A supplied date is invalid.');
  return date;
};
const displayCode = (prefix) => `${prefix}-${Date.now().toString().slice(-7)}-${randomUUID().slice(0, 3).toUpperCase()}`;
const actorFrom = (req) => ({
  actorType: req.auth.kind === 'support' ? 'PLATFORM_USER' : 'HOSPITAL_USER',
  actorId: req.auth.user.id,
  actorName: req.auth.user.fullName,
});
const recordAudit = (req, data) => writeAudit(req.app.locals.prisma, { hospitalId: req.hospitalId, ...actorFrom(req), ipAddress: req.ip, ...data });
const byTenantIdentifier = (hospitalId, id, codeField) => ({ hospitalId, OR: [{ id }, { [codeField]: id }] });
const paymentProofDto = (value) => {
  const proof = { ...value };
  delete proof.storageKey;
  delete proof.sha256;
  return proof;
};
const inventoryDto = (item) => ({
  ...item,
  unitCost: decimalNumber(item.unitCost),
  salePrice: decimalNumber(item.salePrice),
  lowStock: item.quantity <= item.reorderLevel,
});
const parseJsonObject = (value) => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const moneyEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.005;

async function subscriptionCapabilities(db, access, hospitalId) {
  const [activeUsers, activeBranches, proofStorage, configuration] = await Promise.all([
    db.hospitalUser.count({ where: { hospitalId, isActive: true } }),
    db.hospitalBranch.count({ where: { hospitalId, isActive: true } }),
    db.bankTransferProof.aggregate({ where: { hospitalId }, _sum: { fileSize: true } }),
    db.paymentProviderConfiguration.findUnique({ where: { provider: 'SAFEPAY' } }),
  ]);
  const subscription = access.subscription;
  const safepayProvider = new SafepayProvider(configuration || {});
  const safepayDemoMode = safepayProvider.demoAllowed;
  return {
    usage: { users: activeUsers, branches: activeBranches, beds: null, storageMb: Number(((proofStorage._sum.fileSize || 0) / (1024 * 1024)).toFixed(2)) },
    limits: {
      maxUsers: subscription?.maxUsers ?? null,
      maxBranches: subscription?.maxBranches ?? null,
      maxBeds: subscription?.maxBeds ?? null,
      storageLimitMb: subscription?.storageLimitMb ?? null,
    },
    safepay: {
      enabled: Boolean(configuration?.enabled && (safepayDemoMode || safepayProvider.realPaymentsEnabled)),
      configured: safepayProvider.configured && safepayProvider.webhookConfigured,
      demoMode: safepayDemoMode,
      realPaymentsEnabled: safepayProvider.realPaymentsEnabled,
      productionAdapterVerified: safepayProvider.productionAdapterVerified,
      environment: safepayDemoMode ? 'demo' : env.safepayEnvironment,
      verificationMode: env.safepayWebhookVerificationMode,
    },
  };
}

const patientSchema = z.object({
  name: z.string().trim().min(2), age: z.coerce.number().int().min(0).max(130).optional(), gender: z.string().min(1),
  phone: z.string().optional(), city: z.string().optional(), blood: z.string().optional(), bloodGroup: z.string().optional(),
  cnic: z.string().optional(), payer: z.string().optional(), status: z.string().optional(),
});
const departmentSchema = z.object({ code: z.string().optional(), name: z.string().min(2), headDoctorName: z.string().optional(), head: z.string().optional() });
const doctorSchema = z.object({
  name: z.string().min(2), specialty: z.string().min(2), departmentId: z.string().optional(), department: z.string().optional(),
  phone: z.string().optional(), fee: z.coerce.number().min(0).default(0), availability: z.string().optional(),
});
const serviceSchema = z.object({
  name: z.string().min(2), category: z.string().min(2), departmentId: z.string().optional(), department: z.string().min(2), price: z.coerce.number().min(0),
});

async function includeOperational(db, hospitalId) {
  return {
    patients: await db.patient.findMany({ where: { hospitalId }, orderBy: { createdAt: 'desc' } }),
    appointments: await db.appointment.findMany({ where: { hospitalId }, include: { patient: true, doctor: true, department: true }, orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'asc' }] }),
    admissions: await db.admission.findMany({ where: { hospitalId }, include: { patient: true, doctor: true }, orderBy: { admittedAt: 'desc' } }),
    doctors: await db.doctor.findMany({ where: { hospitalId }, include: { department: true }, orderBy: { name: 'asc' } }),
    departments: await db.department.findMany({ where: { hospitalId }, include: { _count: { select: { doctors: true } } }, orderBy: { name: 'asc' } }),
    services: await db.service.findMany({ where: { hospitalId }, orderBy: { displayCode: 'asc' } }),
    patientInvoices: await db.patientInvoice.findMany({ where: { hospitalId }, include: { patient: true, items: true }, orderBy: { invoiceDate: 'desc' } }),
    patientPayments: await db.patientPayment.findMany({ where: { hospitalId }, include: { patient: true, invoice: { include: { patient: true } }, receipt: true }, orderBy: { paymentDate: 'desc' } }),
  };
}

export function createHospitalRouter() {
  const router = Router();
  router.use(loadHospitalAccess);

  router.get('/bootstrap', asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const hospital = req.auth.kind === 'hospital' ? req.auth.user.hospital : await db.hospital.findUnique({ where: { id: req.hospitalId } });
    const billingOnly = ['SUSPENDED', 'CANCELED', 'PENDING_PAYMENT'].includes(String(req.access.status).toUpperCase());
    const operational = billingOnly ? { patients: [], appointments: [], admissions: [], doctors: [], departments: [], services: [], patientInvoices: [], patientPayments: [] }
      : await includeOperational(db, req.hospitalId);
    const canRead = (feature) => req.access.featureSet.has(feature) && req.access.permissions[feature]?.read;
    const canReadBilling = ['opd_billing', 'emergency_billing', 'inpatient_billing', 'payments', 'receipts', 'financial_reports'].some(canRead);
    const notifications = await db.notification.findMany({
      where: { hospitalId: req.hospitalId, OR: [{ hospitalUserId: null }, ...(req.auth.kind === 'hospital' ? [{ hospitalUserId: req.auth.user.id }] : [])] },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    const subscription = req.access.subscription;
    const capabilities = await subscriptionCapabilities(db, req.access, req.hospitalId);
    capabilities.usage.beds = hospital?.numberOfBeds ?? 0;
    res.json({ data: {
      hospital,
      user: req.auth.kind === 'support' ? { id: req.auth.user.id, fullName: req.auth.user.fullName, role: 'hospital_admin', roleName: 'Hospital Admin' } : {
        id: req.auth.user.id, fullName: req.auth.user.fullName, email: req.auth.user.email, mobile: req.auth.user.mobile,
        role: req.auth.user.role.key, roleName: req.auth.user.role.name,
      },
      subscription: subscription ? {
        id: subscription.id, status: subscription.status, billingCycle: subscription.billingCycle,
        plan: subscription.planVersion.plan.name, planCode: subscription.planVersion.plan.code,
        currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd,
        nextBillingDate: subscription.nextBillingDate, gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        implementationFeeStatus: subscription.implementationFeeStatus,
      } : null,
      features: req.access.features,
      permissions: req.access.permissions,
      usage: capabilities.usage,
      limits: capabilities.limits,
      safepay: capabilities.safepay,
      accessScope: billingOnly ? 'BILLING_AND_EXPORT' : 'HOSPITAL',
      patients: canRead('patient_registration') ? operational.patients.map(patientDto) : [],
      appointments: canRead('appointments') ? operational.appointments.map(appointmentDto) : [],
      admissions: canRead('admissions') ? operational.admissions.map(admissionDto) : [],
      doctors: canRead('doctors') ? operational.doctors.map(doctorDto) : [],
      departments: canRead('departments') ? operational.departments.map(departmentDto) : [],
      services: canRead('charge_master') ? operational.services.map(serviceDto) : [],
      patientInvoices: canReadBilling ? operational.patientInvoices.map(patientInvoiceDto) : [],
      patientPayments: canReadBilling ? operational.patientPayments.map(patientPaymentDto) : [],
      notifications,
      supportAccess: req.auth.kind === 'support' ? { id: req.auth.supportSession.id, reason: req.auth.supportSession.reason, expiresAt: req.auth.supportSession.expiresAt } : null,
    } });
  }));

  router.get('/patients', requireAccess('patient_registration'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.patient.findMany({ where: { hospitalId: req.hospitalId }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows.map(patientDto) });
  }));
  router.post('/patients', requireAccess('patient_registration', 'write'), asyncHandler(async (req, res) => {
    const input = patientSchema.parse(req.body);
    const row = await req.app.locals.prisma.patient.create({ data: {
      hospitalId: req.hospitalId, displayCode: displayCode('P'), name: input.name, age: input.age, gender: input.gender,
      phone: input.phone, city: input.city, bloodGroup: input.blood || input.bloodGroup, cnic: input.cnic,
      payer: input.payer || 'Self Pay', status: input.status || 'Active',
    } });
    await recordAudit(req, { action: 'PATIENT_CREATED', entityType: 'Patient', entityId: row.id, newValue: { displayCode: row.displayCode, name: row.name } });
    res.status(201).json({ data: patientDto(row) });
  }));
  router.patch('/patients/:id', requireAccess('patient_registration', 'write'), asyncHandler(async (req, res) => {
    const input = patientSchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.patient.findFirst({ where: byTenantIdentifier(req.hospitalId, req.params.id, 'displayCode') });
    if (!row) throw notFound('Patient not found.');
    const { blood, ...changes } = input;
    const updated = await db.patient.update({ where: { id: row.id }, data: {
      ...changes, bloodGroup: blood || input.bloodGroup,
    } });
    await recordAudit(req, { action: 'PATIENT_UPDATED', entityType: 'Patient', entityId: row.id, previousValue: patientDto(row), newValue: patientDto(updated) });
    res.json({ data: patientDto(updated) });
  }));

  router.get('/departments', requireAccess('departments'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.department.findMany({ where: { hospitalId: req.hospitalId }, include: { _count: { select: { doctors: true } } }, orderBy: { name: 'asc' } });
    res.json({ data: rows.map(departmentDto) });
  }));
  router.post('/departments', requireAccess('departments', 'write'), asyncHandler(async (req, res) => {
    const input = departmentSchema.parse(req.body);
    const row = await req.app.locals.prisma.department.create({ data: {
      hospitalId: req.hospitalId, code: input.code || displayCode('DEPT').toLowerCase(), name: input.name, headDoctorName: input.headDoctorName || input.head,
    } });
    await recordAudit(req, { action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: row.id, newValue: input });
    res.status(201).json({ data: departmentDto({ ...row, _count: { doctors: 0 } }) });
  }));
  router.patch('/departments/:id', requireAccess('departments', 'write'), asyncHandler(async (req, res) => {
    const input = departmentSchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.department.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: req.params.id }, { code: req.params.id }] } });
    if (!row) throw notFound('Department not found.');
    const updated = await db.department.update({ where: { id: row.id }, data: {
      code: input.code, name: input.name, headDoctorName: input.headDoctorName ?? input.head,
    }, include: { _count: { select: { doctors: true } } } });
    await recordAudit(req, { action: 'DEPARTMENT_UPDATED', entityType: 'Department', entityId: row.id, previousValue: departmentDto(row), newValue: departmentDto(updated) });
    res.json({ data: departmentDto(updated) });
  }));

  router.get('/doctors', requireAccess('doctors'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.doctor.findMany({ where: { hospitalId: req.hospitalId }, include: { department: true }, orderBy: { name: 'asc' } });
    res.json({ data: rows.map(doctorDto) });
  }));
  router.post('/doctors', requireAccess('doctors', 'write'), asyncHandler(async (req, res) => {
    const input = doctorSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const department = input.departmentId ? await db.department.findFirst({ where: { hospitalId: req.hospitalId, id: input.departmentId } })
      : input.department ? await db.department.findFirst({ where: { hospitalId: req.hospitalId, name: input.department } }) : null;
    if ((input.departmentId || input.department) && !department) throw notFound('Department not found.');
    const row = await db.doctor.create({ data: {
      hospitalId: req.hospitalId, departmentId: department?.id, displayCode: displayCode('D'), name: input.name,
      specialty: input.specialty, phone: input.phone, fee: input.fee, availability: input.availability,
    }, include: { department: true } });
    await recordAudit(req, { action: 'DOCTOR_CREATED', entityType: 'Doctor', entityId: row.id, newValue: input });
    res.status(201).json({ data: doctorDto(row) });
  }));
  router.patch('/doctors/:id', requireAccess('doctors', 'write'), asyncHandler(async (req, res) => {
    const input = doctorSchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.doctor.findFirst({ where: byTenantIdentifier(req.hospitalId, req.params.id, 'displayCode'), include: { department: true } });
    if (!row) throw notFound('Doctor not found.');
    let departmentId;
    if (input.departmentId !== undefined || input.department !== undefined) {
      const department = input.departmentId
        ? await db.department.findFirst({ where: { hospitalId: req.hospitalId, id: input.departmentId } })
        : input.department ? await db.department.findFirst({ where: { hospitalId: req.hospitalId, name: input.department } }) : null;
      if ((input.departmentId || input.department) && !department) throw notFound('Department not found.');
      departmentId = department?.id ?? null;
    }
    const updated = await db.doctor.update({ where: { id: row.id }, data: {
      name: input.name, specialty: input.specialty, departmentId, phone: input.phone, fee: input.fee, availability: input.availability,
    }, include: { department: true } });
    await recordAudit(req, { action: 'DOCTOR_UPDATED', entityType: 'Doctor', entityId: row.id, previousValue: doctorDto(row), newValue: doctorDto(updated) });
    res.json({ data: doctorDto(updated) });
  }));

  router.get('/services', requireAccess('charge_master'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.service.findMany({ where: { hospitalId: req.hospitalId }, orderBy: { displayCode: 'asc' } });
    res.json({ data: rows.map(serviceDto) });
  }));
  router.post('/services', requireAccess('charge_master', 'write'), asyncHandler(async (req, res) => {
    const input = serviceSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const department = input.departmentId ? await db.department.findFirst({ where: { id: input.departmentId, hospitalId: req.hospitalId } }) : null;
    if (input.departmentId && !department) throw notFound('Department not found.');
    const row = await db.service.create({ data: {
      hospitalId: req.hospitalId, departmentId: department?.id, displayCode: displayCode(input.category === 'Medicine' ? 'M' : 'S'),
      name: input.name, category: input.category, departmentName: input.department, price: input.price,
    } });
    await recordAudit(req, { action: 'CHARGE_MASTER_ITEM_CREATED', entityType: 'Service', entityId: row.id, newValue: serviceDto(row) });
    res.status(201).json({ data: serviceDto(row) });
  }));
  router.patch('/services/:id', requireAccess('charge_master', 'write'), asyncHandler(async (req, res) => {
    const input = serviceSchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.service.findFirst({ where: byTenantIdentifier(req.hospitalId, req.params.id, 'displayCode') });
    if (!row) throw notFound('Charge master item not found.');
    const updated = await db.service.update({ where: { id: row.id }, data: {
      name: input.name, category: input.category, departmentName: input.department, price: input.price,
    } });
    await recordAudit(req, { action: 'CHARGE_MASTER_ITEM_UPDATED', entityType: 'Service', entityId: row.id, previousValue: serviceDto(row), newValue: serviceDto(updated) });
    res.json({ data: serviceDto(updated) });
  }));

  const appointmentSchema = z.object({
    patientId: z.string().optional(), patient: z.string().optional(), doctorId: z.string().optional(), doctor: z.string().optional(),
    departmentId: z.string().optional(), department: z.string().optional(), type: z.string().optional(), visitType: z.string().optional(),
    date: z.string(), time: z.string().min(1), status: z.string().optional(),
  });
  router.get('/appointments', requireAccess('appointments'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.appointment.findMany({ where: { hospitalId: req.hospitalId }, include: { patient: true, doctor: true, department: true }, orderBy: { appointmentDate: 'desc' } });
    res.json({ data: rows.map(appointmentDto) });
  }));
  router.post('/appointments', requireAccess('appointments', 'write'), asyncHandler(async (req, res) => {
    const input = appointmentSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const patientRef = input.patientId || input.patient;
    if (!patientRef) throw badRequest('Patient is required.');
    const patient = await db.patient.findFirst({ where: byTenantIdentifier(req.hospitalId, patientRef, 'displayCode') });
    if (!patient) throw notFound('Patient not found.');
    const doctor = input.doctorId || input.doctor ? await db.doctor.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: input.doctorId || '' }, { displayCode: input.doctorId || '' }, { name: input.doctor || '' }] } }) : null;
    const department = input.departmentId || input.department ? await db.department.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: input.departmentId || '' }, { name: input.department || '' }] } }) : null;
    if ((input.doctorId || input.doctor) && !doctor) throw notFound('Doctor not found.');
    if ((input.departmentId || input.department) && !department) throw notFound('Department not found.');
    const row = await db.appointment.create({ data: {
      hospitalId: req.hospitalId, patientId: patient.id, doctorId: doctor?.id, departmentId: department?.id,
      displayCode: displayCode('A'), visitType: input.visitType || input.type || 'OPD', appointmentDate: dateOnly(input.date),
      appointmentTime: input.time, status: input.status || 'Scheduled',
    }, include: { patient: true, doctor: true, department: true } });
    await recordAudit(req, { action: 'APPOINTMENT_CREATED', entityType: 'Appointment', entityId: row.id, newValue: appointmentDto(row) });
    res.status(201).json({ data: appointmentDto(row) });
  }));
  router.patch('/appointments/:id', requireAccess('appointments', 'write'), asyncHandler(async (req, res) => {
    const input = appointmentSchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.appointment.findFirst({ where: byTenantIdentifier(req.hospitalId, req.params.id, 'displayCode'), include: { patient: true, doctor: true, department: true } });
    if (!row) throw notFound('Appointment not found.');
    const updated = await db.appointment.update({ where: { id: row.id }, data: {
      visitType: input.visitType || input.type, appointmentDate: input.date ? dateOnly(input.date) : undefined,
      appointmentTime: input.time, status: input.status,
    }, include: { patient: true, doctor: true, department: true } });
    await recordAudit(req, { action: 'APPOINTMENT_UPDATED', entityType: 'Appointment', entityId: row.id, previousValue: appointmentDto(row), newValue: appointmentDto(updated) });
    res.json({ data: appointmentDto(updated) });
  }));

  const admissionSchema = z.object({
    patientId: z.string().optional(), patient: z.string().optional(), doctorId: z.string().optional(), doctor: z.string().optional(),
    ward: z.string().min(1), room: z.string().min(1), bed: z.string().min(1), date: z.string().optional(), admitted: z.string().optional(),
    package: z.string().optional(), billingPackage: z.string().optional(), status: z.string().optional(),
  });
  router.get('/admissions', requireAccess('admissions'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.admission.findMany({ where: { hospitalId: req.hospitalId }, include: { patient: true, doctor: true }, orderBy: { admittedAt: 'desc' } });
    res.json({ data: rows.map(admissionDto) });
  }));
  router.post('/admissions', requireAccess('admissions', 'write'), asyncHandler(async (req, res) => {
    const input = admissionSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const patientRef = input.patientId || input.patient;
    if (!patientRef) throw badRequest('Patient is required.');
    const patient = await db.patient.findFirst({ where: byTenantIdentifier(req.hospitalId, patientRef, 'displayCode') });
    if (!patient) throw notFound('Patient not found.');
    const doctor = input.doctorId || input.doctor ? await db.doctor.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: input.doctorId || '' }, { displayCode: input.doctorId || '' }, { name: input.doctor || '' }] } }) : null;
    if ((input.doctorId || input.doctor) && !doctor) throw notFound('Doctor not found.');
    const admitted = input.admitted || input.date;
    const row = await db.admission.create({ data: {
      hospitalId: req.hospitalId, patientId: patient.id, doctorId: doctor?.id, displayCode: displayCode('ADM'),
      ward: input.ward, room: input.room, bed: input.bed, admittedAt: dateOnly(admitted),
      billingPackage: input.billingPackage || input.package || 'Self Pay', status: input.status || 'Admitted',
    }, include: { patient: true, doctor: true } });
    await recordAudit(req, { action: 'ADMISSION_CREATED', entityType: 'Admission', entityId: row.id, newValue: admissionDto(row) });
    res.status(201).json({ data: admissionDto(row) });
  }));
  router.patch('/admissions/:id', requireAccess('admissions', 'write'), asyncHandler(async (req, res) => {
    const input = admissionSchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.admission.findFirst({ where: byTenantIdentifier(req.hospitalId, req.params.id, 'displayCode'), include: { patient: true, doctor: true } });
    if (!row) throw notFound('Admission not found.');
    const updated = await db.admission.update({ where: { id: row.id }, data: {
      ward: input.ward, room: input.room, bed: input.bed, admittedAt: input.admitted || input.date ? dateOnly(input.admitted || input.date) : undefined,
      billingPackage: input.billingPackage || input.package, status: input.status,
    }, include: { patient: true, doctor: true } });
    await recordAudit(req, { action: 'ADMISSION_UPDATED', entityType: 'Admission', entityId: row.id, previousValue: admissionDto(row), newValue: admissionDto(updated) });
    res.json({ data: admissionDto(updated) });
  }));

  router.get('/patient-invoices', asyncHandler(async (req, res) => {
    assertAnyAccess(req, ['opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing', 'laboratory_billing', 'receipts', 'payments']);
    const rows = await req.app.locals.prisma.patientInvoice.findMany({ where: { hospitalId: req.hospitalId }, include: { patient: true, items: true }, orderBy: { invoiceDate: 'desc' } });
    res.json({ data: rows.map(patientInvoiceDto) });
  }));
  const patientInvoiceSchema = z.object({
    patientId: z.string(), payer: z.string().default('Self Pay'), type: z.string().optional(), visitType: z.string().optional(),
    discount: z.coerce.number().min(0).default(0), insurance: z.coerce.number().min(0).optional(), coverage: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().trim().max(1000).optional(),
    items: z.array(z.object({ serviceId: z.string(), qty: z.coerce.number().int().min(1).default(1) })).min(1),
  });
  router.post('/patient-invoices', asyncHandler(async (req, res) => {
    const input = patientInvoiceSchema.parse(req.body);
    const visitType = (input.visitType || input.type || 'OPD').toUpperCase();
    const feature = visitType === 'INPATIENT' ? 'inpatient_billing' : visitType === 'EMERGENCY' ? 'emergency_billing' : visitType === 'PHARMACY' ? 'pharmacy_billing' : visitType === 'LABORATORY' ? 'laboratory_billing' : 'opd_billing';
    assertAccess(req, feature, 'write');
    if (input.payer !== 'Self Pay' && /insurance/i.test(input.payer)) assertAccess(req, 'insurance_billing', 'write');
    if (/corporate/i.test(input.payer)) assertAccess(req, 'corporate_billing', 'write');
    const db = req.app.locals.prisma;
    const patient = await db.patient.findFirst({ where: byTenantIdentifier(req.hospitalId, input.patientId, 'displayCode') });
    if (!patient) throw notFound('Patient not found.');
    const serviceRows = [];
    for (const line of input.items) {
      const service = await db.service.findFirst({ where: byTenantIdentifier(req.hospitalId, line.serviceId, 'displayCode') });
      if (!service?.isActive) throw badRequest(`Service ${line.serviceId} is unavailable.`);
      serviceRows.push({ service, qty: line.qty });
    }
    const subtotal = serviceRows.reduce((sum, line) => sum + decimalNumber(line.service.price) * line.qty, 0);
    const discount = Math.min(input.discount, subtotal);
    const insurance = input.insurance ?? (input.payer === 'Self Pay' ? 0 : (subtotal - discount) * Number(input.coverage || 0) / 100);
    const total = Math.max(subtotal - discount - insurance, 0);
    const invoice = await db.patientInvoice.create({ data: {
      hospitalId: req.hospitalId, patientId: patient.id, invoiceNumber: displayCode('INV'), invoiceDate: new Date(), payer: input.payer,
      total, paidAmount: 0, status: total === 0 ? 'Paid' : 'Outstanding', visitType,
      discount, insurance, notes: input.notes || null,
      items: { create: serviceRows.map(({ service, qty }) => ({ hospitalId: req.hospitalId, serviceId: service.id, description: service.name, quantity: qty, unitPrice: service.price, lineTotal: decimalNumber(service.price) * qty })) },
    }, include: { patient: true, items: true } });
    await recordAudit(req, { action: 'PATIENT_INVOICE_CREATED', entityType: 'PatientInvoice', entityId: invoice.id, newValue: { invoiceNumber: invoice.invoiceNumber, total, notes: input.notes } });
    res.status(201).json({ data: patientInvoiceDto(invoice) });
  }));

  router.get('/patient-payments', requireAccess('payments'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.patientPayment.findMany({ where: { hospitalId: req.hospitalId }, include: { patient: true, invoice: { include: { patient: true } }, receipt: true }, orderBy: { paymentDate: 'desc' } });
    res.json({ data: rows.map(patientPaymentDto) });
  }));
  const patientPaymentSchema = z.object({ invoiceId: z.string(), amount: z.coerce.number().positive(), method: z.string().min(1), reference: z.string().optional() });
  router.post('/patient-payments', requireAccess('payments', 'write'), asyncHandler(async (req, res) => {
    const input = patientPaymentSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const invoice = await db.patientInvoice.findFirst({ where: byTenantIdentifier(req.hospitalId, input.invoiceId, 'invoiceNumber'), include: { patient: true } });
    if (!invoice) throw notFound('Patient invoice not found.');
    const outstanding = decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount);
    if (input.amount > outstanding + 0.001) throw badRequest('Payment cannot exceed the patient invoice balance.');
    const payment = await withSerializableFinancialTransaction(db, async (tx) => {
      const row = await tx.patientPayment.create({ data: {
        hospitalId: req.hospitalId, patientId: invoice.patientId, invoiceId: invoice.id, paymentNumber: displayCode('PAY'),
        paymentDate: new Date(), method: input.method, amount: input.amount, status: 'Received', reference: input.reference,
      } });
      const nextPaid = decimalNumber(invoice.paidAmount) + input.amount;
      const invoiceClaim = await tx.patientInvoice.updateMany({
        where: { id: invoice.id, hospitalId: req.hospitalId, status: invoice.status, paidAmount: invoice.paidAmount },
        data: { paidAmount: nextPaid, status: nextPaid + 0.001 >= decimalNumber(invoice.total) ? 'Paid' : 'Partially Paid' },
      });
      if (invoiceClaim.count !== 1) throw conflict('The patient invoice balance changed while this payment was being recorded. Reload the invoice and try again.');
      const receipt = await tx.patientReceipt.create({ data: { hospitalId: req.hospitalId, paymentId: row.id, receiptNumber: displayCode('RCP') } });
      return { ...row, patient: invoice.patient, invoice, receipt };
    });
    await recordAudit(req, { action: 'PATIENT_PAYMENT_RECORDED', entityType: 'PatientPayment', entityId: payment.id, newValue: { invoice: invoice.invoiceNumber, amount: input.amount } });
    res.status(201).json({ data: patientPaymentDto(payment) });
  }));

  router.get('/patient-refunds', requireAccess('refunds'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.patientPayment.findMany({
      where: { hospitalId: req.hospitalId, amount: { lt: 0 } },
      include: { patient: true, invoice: { include: { patient: true } }, receipt: true },
      orderBy: { paymentDate: 'desc' },
    });
    res.json({ data: rows.map(patientPaymentDto) });
  }));
  router.post('/patient-refunds', requireAccess('refunds', 'write'), asyncHandler(async (req, res) => {
    const input = z.object({
      paymentId: z.string(), amount: z.coerce.number().positive(), reason: z.string().trim().min(3).max(500), method: z.string().min(1).optional(),
    }).parse(req.body);
    const db = req.app.locals.prisma;
    const source = await db.patientPayment.findFirst({
      where: { hospitalId: req.hospitalId, amount: { gt: 0 }, OR: [{ id: input.paymentId }, { paymentNumber: input.paymentId }] },
      include: { patient: true, invoice: true },
    });
    if (!source) throw notFound('Original patient payment not found.');
    const refund = await withSerializableFinancialTransaction(db, async (tx) => {
      const sourceLockStatus = `REFUND_LOCK:${randomUUID()}`;
      const sourceClaim = await tx.patientPayment.updateMany({
        where: {
          id: source.id,
          hospitalId: req.hospitalId,
          amount: source.amount,
          status: source.status,
        },
        data: { status: sourceLockStatus },
      });
      if (sourceClaim.count !== 1) {
        throw conflict('The original payment is already being refunded. Reload the payment and try again.');
      }
      const row = await tx.patientPayment.create({ data: {
        hospitalId: req.hospitalId, patientId: source.patientId, invoiceId: source.invoiceId,
        paymentNumber: displayCode('RFND'), paymentDate: new Date(), method: input.method || source.method,
        amount: -input.amount, status: 'Refunded', reference: `REFUND:${source.id}:${input.reason}`,
      } });
      const refundRows = await tx.patientPayment.findMany({
        where: { hospitalId: req.hospitalId, amount: { lt: 0 }, reference: { startsWith: `REFUND:${source.id}:` } },
        select: { amount: true },
      });
      const refunded = refundRows.reduce((sum, payment) => sum + Math.abs(decimalNumber(payment.amount)), 0);
      if (refunded > decimalNumber(source.amount) + 0.001) throw conflict('Refund total cannot exceed the original payment amount. Reload the payment and try again.');
      let invoice = source.invoice;
      if (source.invoice) {
        const nextPaid = Math.max(decimalNumber(source.invoice.paidAmount) - input.amount, 0);
        const invoiceClaim = await tx.patientInvoice.updateMany({
          where: { id: source.invoice.id, hospitalId: req.hospitalId, status: source.invoice.status, paidAmount: source.invoice.paidAmount },
          data: {
            paidAmount: nextPaid,
            status: nextPaid <= 0.001 ? 'Outstanding' : nextPaid + 0.001 >= decimalNumber(source.invoice.total) ? 'Paid' : 'Partially Paid',
          },
        });
        if (invoiceClaim.count !== 1) throw conflict('The patient invoice balance changed while this refund was being recorded. Reload the payment and try again.');
        invoice = await tx.patientInvoice.findUnique({ where: { id: source.invoice.id } });
      }
      const sourceRelease = await tx.patientPayment.updateMany({
        where: { id: source.id, hospitalId: req.hospitalId, status: sourceLockStatus },
        data: { status: source.status },
      });
      if (sourceRelease.count !== 1) throw conflict('The original payment changed while this refund was being recorded.');
      const receipt = await tx.patientReceipt.create({ data: { hospitalId: req.hospitalId, paymentId: row.id, receiptNumber: displayCode('RFD-RCP') } });
      return { ...row, patient: source.patient, invoice, receipt };
    });
    await recordAudit(req, { action: 'PATIENT_REFUND_RECORDED', entityType: 'PatientPayment', entityId: refund.id, newValue: { sourcePaymentId: source.id, amount: input.amount, reason: input.reason } });
    res.status(201).json({ data: patientPaymentDto(refund) });
  }));

  router.get('/users', requireAccess('user_management', 'manage'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.hospitalUser.findMany({ where: { hospitalId: req.hospitalId }, include: { role: true }, orderBy: { fullName: 'asc' } });
    res.json({ data: rows.map((user) => ({ id: user.id, fullName: user.fullName, email: user.email, mobile: user.mobile, role: user.role.key, roleName: user.role.name, isActive: user.isActive, mustChangePassword: user.mustChangePassword })) });
  }));
  const userSchema = z.object({
    fullName: z.string().min(2), email: z.string().email(), mobile: z.string().optional(),
    temporaryPassword: z.string().min(10).max(128)
      .regex(/[a-z]/, 'Temporary password must contain a lowercase letter.')
      .regex(/[A-Z]/, 'Temporary password must contain an uppercase letter.')
      .regex(/[0-9]/, 'Temporary password must contain a number.')
      .regex(/[^A-Za-z0-9]/, 'Temporary password must contain a special character.'),
    roleKey: z.string(),
  });
  router.post('/users', requireAccess('user_management', 'manage'), asyncHandler(async (req, res) => {
    const input = userSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const activeCount = await db.hospitalUser.count({ where: { hospitalId: req.hospitalId, isActive: true } });
    if (req.access.subscription.maxUsers != null && activeCount >= req.access.subscription.maxUsers) throw conflict('The subscription user limit has been reached.');
    const role = await db.hospitalRole.findUnique({ where: { hospitalId_key: { hospitalId: req.hospitalId, key: input.roleKey } } });
    if (!role) throw badRequest('The selected hospital role is invalid.');
    const user = await db.hospitalUser.create({ data: {
      hospitalId: req.hospitalId, roleId: role.id, fullName: input.fullName, email: normalizeEmail(input.email), mobile: input.mobile,
      passwordHash: await bcrypt.hash(input.temporaryPassword, 12), mustChangePassword: true,
    }, include: { role: true } });
    await recordAudit(req, { action: 'HOSPITAL_USER_CREATED', entityType: 'HospitalUser', entityId: user.id, newValue: { email: user.email, role: role.key } });
    res.status(201).json({ data: { id: user.id, fullName: user.fullName, email: user.email, mobile: user.mobile, role: role.key, roleName: role.name, isActive: user.isActive } });
  }));
  router.patch('/users/:id', requireAccess('user_management', 'manage'), asyncHandler(async (req, res) => {
    const input = z.object({ isActive: z.boolean(), reason: z.string().trim().min(3).max(500).optional() }).parse(req.body);
    if (!input.isActive && !input.reason) throw badRequest('A reason is required when disabling a hospital user.');
    if (req.auth.user.id === req.params.id && !input.isActive) throw forbidden('You cannot disable your own account.');
    const db = req.app.locals.prisma;
    const user = await db.hospitalUser.findFirst({ where: { id: req.params.id, hospitalId: req.hospitalId }, include: { role: true } });
    if (!user) throw notFound('Hospital user not found.');
    if (input.isActive && !user.isActive) {
      const activeCount = await db.hospitalUser.count({ where: { hospitalId: req.hospitalId, isActive: true } });
      if (req.access.subscription.maxUsers != null && activeCount >= req.access.subscription.maxUsers) throw conflict('The subscription user limit has been reached.');
    }
    const updated = await db.hospitalUser.update({ where: { id: user.id }, data: { isActive: input.isActive, tokenVersion: { increment: 1 } }, include: { role: true } });
    await recordAudit(req, { action: input.isActive ? 'HOSPITAL_USER_ENABLED' : 'HOSPITAL_USER_DISABLED', entityType: 'HospitalUser', entityId: user.id, previousValue: { isActive: user.isActive }, newValue: { isActive: updated.isActive }, reason: input.reason });
    res.json({ data: { id: updated.id, fullName: updated.fullName, email: updated.email, mobile: updated.mobile, role: updated.role.key, roleName: updated.role.name, isActive: updated.isActive, mustChangePassword: updated.mustChangePassword } });
  }));

  const branchSchema = z.object({
    code: z.string().trim().min(2), name: z.string().trim().min(2), address: z.string().optional(), city: z.string().trim().min(2),
    province: z.string().trim().min(2), phone: z.string().optional(), isActive: z.boolean().optional(),
  });
  router.get('/branches', requireAccess('multi_branch_management'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.hospitalBranch.findMany({ where: { hospitalId: req.hospitalId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    res.json({ data: rows });
  }));
  router.post('/branches', requireAccess('multi_branch_management', 'manage'), asyncHandler(async (req, res) => {
    const input = branchSchema.omit({ isActive: true }).parse(req.body);
    const db = req.app.locals.prisma;
    const activeCount = await db.hospitalBranch.count({ where: { hospitalId: req.hospitalId, isActive: true } });
    if (req.access.subscription.maxBranches != null && activeCount >= req.access.subscription.maxBranches) throw conflict('The subscription branch limit has been reached.');
    const code = normalizeCode(input.code);
    if (!code) throw badRequest('Branch code is required.');
    const row = await db.hospitalBranch.create({ data: { hospitalId: req.hospitalId, ...input, code } });
    await db.hospital.update({ where: { id: req.hospitalId }, data: { declaredBranches: activeCount + 1 } });
    await recordAudit(req, { action: 'HOSPITAL_BRANCH_CREATED', entityType: 'HospitalBranch', entityId: row.id, newValue: { code: row.code, name: row.name } });
    res.status(201).json({ data: row });
  }));
  router.patch('/branches/:id', requireAccess('multi_branch_management', 'manage'), asyncHandler(async (req, res) => {
    const input = branchSchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.hospitalBranch.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: req.params.id }, { code: req.params.id }] } });
    if (!row) throw notFound('Hospital branch not found.');
    if (input.isActive === false && row.isActive) {
      const activeCount = await db.hospitalBranch.count({ where: { hospitalId: req.hospitalId, isActive: true } });
      if (activeCount <= 1) throw conflict('At least one hospital branch must remain active.');
    }
    if (input.isActive === true && !row.isActive && req.access.subscription.maxBranches != null) {
      const activeCount = await db.hospitalBranch.count({ where: { hospitalId: req.hospitalId, isActive: true } });
      if (activeCount >= req.access.subscription.maxBranches) throw conflict('The subscription branch limit has been reached.');
    }
    const updated = await db.hospitalBranch.update({ where: { id: row.id }, data: { ...input, code: input.code ? normalizeCode(input.code) : undefined } });
    const activeCount = await db.hospitalBranch.count({ where: { hospitalId: req.hospitalId, isActive: true } });
    await db.hospital.update({ where: { id: req.hospitalId }, data: { declaredBranches: activeCount } });
    await recordAudit(req, { action: 'HOSPITAL_BRANCH_UPDATED', entityType: 'HospitalBranch', entityId: row.id, previousValue: row, newValue: updated });
    res.json({ data: updated });
  }));

  const inventorySchema = z.object({
    sku: z.string().trim().min(2), name: z.string().trim().min(2), batchNumber: z.string().optional(),
    quantity: z.coerce.number().int().min(0), reorderLevel: z.coerce.number().int().min(0).default(0),
    unitCost: z.coerce.number().min(0).default(0), salePrice: z.coerce.number().min(0).default(0),
    expiryDate: z.string().nullable().optional(), isActive: z.boolean().optional(),
  });
  router.get('/pharmacy-inventory', requireAccess('pharmacy_inventory'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.pharmacyInventoryItem.findMany({ where: { hospitalId: req.hospitalId }, orderBy: { name: 'asc' } });
    res.json({ data: rows.map(inventoryDto) });
  }));
  router.post('/pharmacy-inventory', requireAccess('pharmacy_inventory', 'write'), asyncHandler(async (req, res) => {
    const input = inventorySchema.parse(req.body);
    const row = await req.app.locals.prisma.pharmacyInventoryItem.create({ data: {
      hospitalId: req.hospitalId, ...input, sku: input.sku.trim().toUpperCase(), expiryDate: input.expiryDate ? dateOnly(input.expiryDate) : null,
    } });
    await recordAudit(req, { action: 'PHARMACY_INVENTORY_ITEM_CREATED', entityType: 'PharmacyInventoryItem', entityId: row.id, newValue: inventoryDto(row) });
    res.status(201).json({ data: inventoryDto(row) });
  }));
  router.patch('/pharmacy-inventory/:id', requireAccess('pharmacy_inventory', 'write'), asyncHandler(async (req, res) => {
    const input = inventorySchema.partial().parse(req.body);
    const db = req.app.locals.prisma;
    const row = await db.pharmacyInventoryItem.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: req.params.id }, { sku: req.params.id.toUpperCase() }] } });
    if (!row) throw notFound('Pharmacy inventory item not found.');
    const updated = await db.pharmacyInventoryItem.update({ where: { id: row.id }, data: {
      ...input, sku: input.sku?.trim().toUpperCase(), expiryDate: input.expiryDate === null ? null : input.expiryDate ? dateOnly(input.expiryDate) : undefined,
    } });
    await recordAudit(req, { action: 'PHARMACY_INVENTORY_ITEM_UPDATED', entityType: 'PharmacyInventoryItem', entityId: row.id, previousValue: inventoryDto(row), newValue: inventoryDto(updated) });
    res.json({ data: inventoryDto(updated) });
  }));

  const exportRequestDto = (row) => {
    const parsed = parseJsonObject(row.description);
    const details = Object.keys(parsed).length ? parsed : { reason: row.description };
    return { ...row, ...details };
  };
  router.get('/data-export-requests', requireAccess('data_export'), asyncHandler(async (req, res) => {
    const rows = await req.app.locals.prisma.supportRequest.findMany({ where: { hospitalId: req.hospitalId, category: 'DATA_EXPORT' }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows.map(exportRequestDto) });
  }));
  router.post('/data-export-requests', requireAccess('data_export', 'write'), asyncHandler(async (req, res) => {
    const input = z.object({ scope: z.string().trim().min(2).default('ALL_DATA'), format: z.enum(['CSV', 'JSON', 'PDF']).default('CSV'), reason: z.string().trim().min(3).max(1000).optional() }).parse(req.body);
    const row = await req.app.locals.prisma.supportRequest.create({ data: {
      hospitalId: req.hospitalId, hospitalUserId: req.auth.user.id, category: 'DATA_EXPORT', subject: `Data export request: ${input.scope}`,
      description: JSON.stringify(input), status: 'OPEN', priority: 'NORMAL',
    } });
    await recordAudit(req, { action: 'DATA_EXPORT_REQUESTED', entityType: 'SupportRequest', entityId: row.id, newValue: input });
    res.status(201).json({ data: exportRequestDto(row) });
  }));

  router.get('/subscription', requireAccess('subscription_billing'), asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const subscription = await db.hospitalSubscription.findFirst({ where: { hospitalId: req.hospitalId, isCurrent: true }, include: { planVersion: { include: { plan: true, features: true } } } });
    if (!subscription) throw notFound('No subscription is configured.');
    const invoices = await db.subscriptionInvoice.findMany({ where: { hospitalId: req.hospitalId }, include: { items: true }, orderBy: { issueDate: 'desc' } });
    const proofs = await db.bankTransferProof.findMany({ where: { hospitalId: req.hospitalId }, orderBy: { submittedAt: 'desc' } });
    const [settings, globalSettings, manualProvider, capabilities, hospital] = await Promise.all([
      db.hospitalSetting.findMany({ where: { hospitalId: req.hospitalId, key: { startsWith: 'bank_' } } }),
      db.platformSetting.findMany({ where: { key: { in: ['bankName', 'bankAccountTitle', 'iban', 'branchCode', 'paymentInstructions', 'billing.bankInstructions'] } } }),
      db.paymentProviderConfiguration.findUnique({ where: { provider: 'MANUAL_BANK_TRANSFER' } }),
      subscriptionCapabilities(db, req.access, req.hospitalId),
      db.hospital.findUnique({ where: { id: req.hospitalId }, select: { numberOfBeds: true } }),
    ]);
    const tenantBank = Object.fromEntries(settings.map((setting) => [setting.key.replace(/^bank_/, ''), setting.value]));
    const globalBank = Object.fromEntries(globalSettings.map((setting) => [setting.key, setting.value]));
    const legacyBank = parseJsonObject(globalBank['billing.bankInstructions']);
    const providerBank = parseJsonObject(manualProvider?.publicConfigJson);
    const bankInstructions = {
      bankName: tenantBank.bankName || tenantBank.name || globalBank.bankName || providerBank.bankName || legacyBank.bank || legacyBank.bankName || '',
      accountTitle: tenantBank.accountTitle || tenantBank.account_title || globalBank.bankAccountTitle || providerBank.accountTitle || legacyBank.accountTitle || '',
      iban: tenantBank.iban || globalBank.iban || providerBank.iban || legacyBank.iban || '',
      branchCode: tenantBank.branchCode || tenantBank.branch_code || globalBank.branchCode || providerBank.branchCode || legacyBank.branchCode || '',
      paymentInstructions: tenantBank.paymentInstructions || tenantBank.payment_instructions || globalBank.paymentInstructions || providerBank.paymentInstructions || legacyBank.paymentInstructions || '',
      demoOnly: Boolean(legacyBank.demoOnly || manualProvider?.demoMode),
    };
    capabilities.usage.beds = hospital?.numberOfBeds ?? 0;
    res.json({ data: {
      id: subscription.id, status: subscription.status, billingCycle: subscription.billingCycle,
      plan: { id: subscription.planVersion.plan.id, code: subscription.planVersion.plan.code, name: subscription.planVersion.plan.name },
      price: decimalNumber(subscription.price), implementationFee: decimalNumber(subscription.implementationFee), implementationFeeStatus: subscription.implementationFeeStatus,
      currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingDate: subscription.nextBillingDate, gracePeriodEndsAt: subscription.gracePeriodEndsAt,
      limits: capabilities.limits,
      usage: capabilities.usage,
      features: req.access.features, enabledModules: req.access.features,
      invoices: invoices.map(subscriptionInvoiceDto), proofs: proofs.map(paymentProofDto), bankInstructions,
      safepay: capabilities.safepay,
    } });
  }));

  router.get('/subscription-invoices/:id', requireAccess('subscription_billing'), asyncHandler(async (req, res) => {
    const invoice = await req.app.locals.prisma.subscriptionInvoice.findFirst({
      where: { hospitalId: req.hospitalId, OR: [{ id: req.params.id }, { invoiceNumber: req.params.id }] },
      include: { items: true, payments: true, hospital: true },
    });
    if (!invoice) throw notFound('Subscription invoice not found.');
    res.json({ data: subscriptionInvoiceDto(invoice) });
  }));

  router.post('/subscription-invoices/:id/safepay-link', requireAccess('subscription_billing', 'write'), asyncHandler(async (req, res) => {
    const db = req.app.locals.prisma;
    const invoice = await db.subscriptionInvoice.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: req.params.id }, { invoiceNumber: req.params.id }] } });
    if (!invoice) throw notFound('Subscription invoice not found.');
    if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) throw conflict('Only an open issued invoice can be paid through Safepay.');
    const outstanding = Math.max(decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount), 0);
    if (outstanding <= 0) throw conflict('This invoice has no outstanding balance.');
    const configuration = await db.paymentProviderConfiguration.findUnique({ where: { provider: 'SAFEPAY' } });
    if (!configuration?.enabled) throw forbidden('Safepay is disabled.');
    const provider = new SafepayProvider(configuration);
    const link = await provider.createPaymentLink(invoice);
    if (!link.demo) {
      if (!link.providerReference) throw badRequest('Safepay did not return a tracker that can be bound to this invoice.');
      const intentWhere = { provider_providerReference: { provider: 'SAFEPAY', providerReference: link.providerReference } };
      const existingIntent = await db.paymentIntent.findUnique({ where: intentWhere });
      if (existingIntent) {
        if (existingIntent.invoiceId !== invoice.id || existingIntent.hospitalId !== invoice.hospitalId || !moneyEqual(existingIntent.amount, outstanding) || String(existingIntent.currency).toUpperCase() !== String(invoice.currency).toUpperCase()) {
          throw conflict('Safepay returned a tracker that is already bound to a different payment intent.');
        }
        if (['PROCESSING', 'COMPLETED'].includes(existingIntent.status)) throw conflict('This Safepay payment intent is already being processed or has completed.');
        await db.paymentIntent.update({ where: { id: existingIntent.id }, data: { status: 'CREATED', completedAt: null } });
      } else {
        await db.paymentIntent.create({ data: { hospitalId: invoice.hospitalId, invoiceId: invoice.id, provider: 'SAFEPAY', providerReference: link.providerReference, amount: outstanding, currency: invoice.currency, status: 'CREATED' } });
      }
    }
    res.json({ data: link });
  }));

  const proofFieldsSchema = z.object({
    invoiceId: z.string(), amount: z.coerce.number().positive(), bankName: z.string().min(2), transactionReference: z.string().min(3),
    transferDate: z.string(), parentProofId: z.string().optional(),
  });
  router.post('/bank-transfer-proofs', requireAccess('subscription_billing', 'write'), paymentProofUpload, asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('A payment proof file is required.');
    if (!validatePaymentProofFile(req.file)) throw badRequest('The uploaded file content does not match a valid PNG, JPEG, or PDF signature.');
    const input = proofFieldsSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const invoice = await db.subscriptionInvoice.findFirst({ where: { hospitalId: req.hospitalId, OR: [{ id: input.invoiceId }, { invoiceNumber: input.invoiceId }] } });
    if (!invoice) throw notFound('Subscription invoice not found.');
    if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) throw badRequest('Payment proof can only be submitted for an open issued invoice.');
    const outstanding = decimalNumber(invoice.total) - decimalNumber(invoice.paidAmount);
    if (outstanding <= 0) throw badRequest('This invoice has no outstanding balance.');
    if (input.amount > outstanding + 0.001) throw badRequest('Claimed payment amount cannot exceed the invoice balance.');
    const normalizedReference = normalizeReference(input.transactionReference);
    if (!normalizedReference) throw badRequest('Transaction reference must contain letters or numbers.');
    const approvedReference = await db.subscriptionPayment.findFirst({ where: { provider: 'MANUAL_BANK_TRANSFER', normalizedReference } });
    if (approvedReference) throw conflict('This bank transaction reference has already been approved.', { paymentId: approvedReference.id });
    if (req.access.subscription?.storageLimitMb != null) {
      const storage = await db.bankTransferProof.aggregate({ where: { hospitalId: req.hospitalId }, _sum: { fileSize: true } });
      const nextStorageBytes = Number(storage._sum.fileSize || 0) + req.file.size;
      if (nextStorageBytes > req.access.subscription.storageLimitMb * 1024 * 1024) throw conflict('The subscription storage limit would be exceeded by this upload.');
    }
    if (input.parentProofId) {
      const parent = await db.bankTransferProof.findFirst({ where: { id: input.parentProofId, hospitalId: req.hospitalId, invoiceId: invoice.id, status: 'REJECTED' }, include: { resubmissions: true } });
      if (!parent) throw badRequest('Only a rejected proof from this hospital can be resubmitted.');
      if (parent.resubmissions.length) throw conflict('This rejected proof has already been resubmitted.');
    }
    const extension = req.file.mimetype === 'application/pdf' ? '.pdf' : req.file.mimetype === 'image/png' ? '.png' : '.jpg';
    const storageKey = `${randomUUID()}${extension}`;
    await mkdir(env.uploadDir, { recursive: true });
    const target = path.join(env.uploadDir, storageKey);
    await writeFile(target, req.file.buffer, { flag: 'wx' });
    let proof;
    try {
      proof = await db.bankTransferProof.create({ data: {
        hospitalId: req.hospitalId, invoiceId: invoice.id, submittedByHospitalUserId: req.auth.user.id, parentProofId: input.parentProofId,
        amount: input.amount, bankName: input.bankName, transactionReference: input.transactionReference,
        normalizedReference, transferDate: dateOnly(input.transferDate), storageKey,
        originalFileName: path.basename(req.file.originalname), mimeType: req.file.mimetype, fileSize: req.file.size,
        sha256: createHash('sha256').update(req.file.buffer).digest('hex'), status: 'PENDING',
      } });
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    await createNotification(db, { hospitalId: req.hospitalId, type: 'PAYMENT_PROOF_SUBMITTED', title: 'Payment proof submitted', body: `Proof for ${invoice.invoiceNumber} is awaiting verification.`, link: '/hospital/subscription', dedupeKey: `proof-submitted:${proof.id}` });
    await recordAudit(req, { action: 'PAYMENT_PROOF_SUBMITTED', entityType: 'BankTransferProof', entityId: proof.id, newValue: { invoiceId: invoice.id, amount: input.amount, reference: input.transactionReference } });
    res.status(201).json({ data: paymentProofDto(proof) });
  }));

  router.get('/payment-proofs/:id/file', requireAccess('subscription_billing'), asyncHandler(async (req, res) => {
    const proof = await req.app.locals.prisma.bankTransferProof.findFirst({ where: { id: req.params.id, hospitalId: req.hospitalId } });
    if (!proof) throw notFound('Payment proof not found.');
    if (path.basename(proof.storageKey) !== proof.storageKey) throw badRequest('Stored payment proof path is invalid.');
    res.setHeader('Content-Type', proof.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(proof.originalFileName).replace(/"/g, '')}"`);
    res.sendFile(path.join(env.uploadDir, proof.storageKey));
  }));

  router.post('/support-requests', requireAccess('support', 'write'), asyncHandler(async (req, res) => {
    const input = z.object({ subject: z.string().min(3), category: z.string().default('GENERAL'), description: z.string().min(5), priority: z.string().optional() }).parse(req.body);
    const row = await req.app.locals.prisma.supportRequest.create({ data: { hospitalId: req.hospitalId, hospitalUserId: req.auth.user.id, ...input } });
    await recordAudit(req, { action: 'SUPPORT_REQUEST_CREATED', entityType: 'SupportRequest', entityId: row.id, newValue: input });
    res.status(201).json({ data: row });
  }));

  return router;
}
