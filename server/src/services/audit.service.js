import { jsonText } from '../utils/format.js';

export async function writeAudit(db, {
  hospitalId = null,
  actorType = 'SYSTEM',
  actorId = null,
  actorName = 'System',
  action,
  entityType,
  entityId = null,
  previousValue,
  newValue,
  reason = null,
  ipAddress = null,
}) {
  return db.auditLog.create({
    data: {
      hospitalId,
      actorType,
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      previousValue: jsonText(previousValue),
      newValue: jsonText(newValue),
      reason,
      ipAddress,
    },
  });
}

export async function createNotification(db, data) {
  if (data.dedupeKey) {
    return db.notification.upsert({
      where: { dedupeKey: data.dedupeKey },
      create: data,
      update: {},
    });
  }
  return db.notification.create({ data });
}
