import { decimalNumber } from './format.js';

export const patientDto = (item) => ({
  id: item.displayCode, databaseId: item.id, name: item.name, age: item.age, gender: item.gender,
  phone: item.phone, city: item.city, blood: item.bloodGroup, cnic: item.cnic, payer: item.payer, status: item.status,
});

export const departmentDto = (item) => ({
  id: item.id, code: item.code, name: item.name, head: item.headDoctorName,
  doctors: item._count?.doctors ?? 0, patients: item.monthlyPatientCount, isActive: item.isActive,
});

export const doctorDto = (item) => ({
  id: item.displayCode, databaseId: item.id, name: item.name, specialty: item.specialty,
  department: item.department?.name || null, departmentId: item.departmentId, phone: item.phone,
  fee: decimalNumber(item.fee), availability: item.availability, isActive: item.isActive,
});

export const serviceDto = (item) => ({
  id: item.displayCode, databaseId: item.id, name: item.name, category: item.category,
  department: item.departmentName, departmentId: item.departmentId, price: decimalNumber(item.price), isActive: item.isActive,
});

export const appointmentDto = (item) => ({
  id: item.displayCode, databaseId: item.id, patient: item.patient?.name, patientId: item.patient?.displayCode,
  doctor: item.doctor?.name || null, doctorId: item.doctor?.displayCode || null,
  department: item.department?.name || null, type: item.visitType,
  date: item.appointmentDate.toISOString().slice(0, 10), time: item.appointmentTime, status: item.status,
});

export const admissionDto = (item) => ({
  id: item.displayCode, databaseId: item.id, patient: item.patient?.name, patientId: item.patient?.displayCode,
  doctor: item.doctor?.name || null, doctorId: item.doctor?.displayCode || null, ward: item.ward,
  room: item.room, bed: item.bed, admitted: item.admittedAt.toISOString().slice(0, 10), package: item.billingPackage, status: item.status,
});

export const patientInvoiceDto = (item) => ({
  id: item.invoiceNumber, databaseId: item.id, patient: item.patient?.name, patientId: item.patient?.displayCode,
  date: item.invoiceDate.toISOString().slice(0, 10), payer: item.payer, total: decimalNumber(item.total),
  paid: decimalNumber(item.paidAmount), status: item.status, type: item.visitType,
  discount: decimalNumber(item.discount), insurance: decimalNumber(item.insurance), notes: item.notes || '',
  items: item.items?.map((line) => ({ name: line.description, qty: line.quantity, price: decimalNumber(line.unitPrice) })) || [],
});

export const patientPaymentDto = (item) => ({
  id: item.paymentNumber, databaseId: item.id, invoice: item.invoice?.invoiceNumber || null,
  patient: item.patient?.name || item.invoice?.patient?.name || null, date: item.paymentDate.toISOString().slice(0, 10),
  method: item.method, amount: decimalNumber(item.amount), status: item.status, reference: item.reference,
  receiptNumber: item.receipt?.receiptNumber || null,
});
