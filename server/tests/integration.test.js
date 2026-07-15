import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DEMO_ACCOUNTS, SEED_IDS, seedDatabase } from '../src/seed/seedDatabase.js';
import { createSubscriptionInvoice } from '../src/services/subscriptionInvoice.service.js';
import { applySubscriptionPayment, withSerializableFinancialTransaction } from '../src/services/subscriptionPayment.service.js';
import { addBillingPeriod } from '../src/utils/format.js';

const databasePath = fileURLToPath(new URL('../prisma/integration.test.db', import.meta.url));
const databaseUrl = 'file:./integration.test.db';
const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const prismaCliPath = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url));
const envModuleUrl = new URL('../src/config/env.js', import.meta.url).href;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = 'integration-test-jwt-secret-with-sufficient-entropy';
process.env.DEMO_MODE = 'true';
process.env.SAFEPAY_WEBHOOK_SECRET = 'integration-test-safepay-secret';
process.env.UPLOAD_DIR = fileURLToPath(new URL('../test-uploads', import.meta.url));

let app;
let db;
let seedSummary;
let tokens;

async function login(account) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      ...(account.hospitalCode ? { hospitalCode: account.hospitalCode } : {}),
      email: account.email,
      password: account.password,
    })
    .expect(200);
  return { token: response.body.data.accessToken, response };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const PROOF_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const SENSITIVE_RESPONSE_KEYS = [
  'passwordHash', 'tokenVersion', 'failedLoginAttempts', 'lockedUntil', 'tokenHash', 'storageKey', 'sha256',
];

function expectNoSensitiveResponseFields(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const key of SENSITIVE_RESPONSE_KEYS) expect(serialized).not.toContain(`"${key.toLowerCase()}"`);
}

const safepaySignature = (payload) => createHmac('sha256', process.env.SAFEPAY_WEBHOOK_SECRET)
  .update(JSON.stringify(payload))
  .digest('hex');

beforeAll(async () => {
  await rm(databasePath, { force: true });
  await rm(`${databasePath}-journal`, { force: true });
  // Initializing a valid SQLite header avoids a Windows file-creation race in
  // Prisma's schema engine when it is handed a path that does not yet exist.
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA user_version = 1;');
  sqlite.close();
  execFileSync(process.execPath, [prismaCliPath, 'db', 'push', '--schema', schemaPath, '--skip-generate'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const appModule = await import('../src/app.js');
  const prismaModule = await import('../src/lib/prisma.js');
  db = prismaModule.prisma;
  app = appModule.createApp({ prismaClient: db });

  const firstSeed = await seedDatabase(db, { reset: true });
  const secondSeed = await seedDatabase(db, { reset: true });
  expect(secondSeed).toEqual(firstSeed);
  seedSummary = secondSeed;

  const [platform, akram, noor, islamabad] = await Promise.all([
    login(DEMO_ACCOUNTS.superAdmin),
    login(DEMO_ACCOUNTS.hospitalAdmin),
    login(DEMO_ACCOUNTS.noorAdmin),
    login(DEMO_ACCOUNTS.islamabadAdmin),
  ]);
  tokens = {
    platform: platform.token,
    akram: akram.token,
    noor: noor.token,
    islamabad: islamabad.token,
  };
}, 60_000);

afterAll(async () => {
  if (db) await db.$disconnect();
  await rm(databasePath, { force: true });
  await rm(`${databasePath}-journal`, { force: true });
  await rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

describe.sequential('AI Finora SaaS integration contract', () => {
  test('billing periods clamp month ends and production rejects placeholder JWT secrets', () => {
    expect(addBillingPeriod(new Date('2024-01-31T14:15:16.000Z'), 'MONTHLY').toISOString())
      .toBe('2024-02-29T14:15:16.000Z');
    expect(addBillingPeriod(new Date('2024-02-29T14:15:16.000Z'), 'ANNUAL').toISOString())
      .toBe('2025-02-28T14:15:16.000Z');

    const importEnv = `await import(${JSON.stringify(envModuleUrl)});`;
    expect(() => execFileSync(process.execPath, ['--input-type=module', '--eval', importEnv], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DEMO_MODE: 'false',
        SAFEPAY_DEMO_MODE: 'false',
        JWT_SECRET: 'replace-with-a-long-random-secret-value',
      },
      stdio: 'pipe',
    })).toThrow();
  });

  test('the deterministic seed contains the required tenants, plans, proofs, and legacy data', async () => {
    expect(seedSummary).toMatchObject({
      hospitals: 3,
      plans: 3,
      planVersions: 3,
      hospitalUsers: 6,
      patients: 12,
      subscriptionInvoices: 5,
      subscriptionPayments: 2,
      bankTransferProofs: 3,
    });

    const proofStatuses = await db.bankTransferProof.groupBy({ by: ['status'], _count: { _all: true } });
    expect(Object.fromEntries(proofStatuses.map((row) => [row.status, row._count._all]))).toMatchObject({
      PENDING: 1,
      APPROVED: 1,
      REJECTED: 1,
    });
    expect(await db.patient.findUnique({
      where: { hospitalId_displayCode: { hospitalId: SEED_IDS.hospitals.akram, displayCode: 'P-1048' } },
    })).toMatchObject({ name: 'Ayesha Khan' });
  });

  test('login returns account-specific redirects and stored passwords are bcrypt hashes', async () => {
    const platform = await login(DEMO_ACCOUNTS.superAdmin);
    expect(platform.response.body.data).toMatchObject({ accountType: 'SUPER_ADMIN', redirectTo: '/super-admin' });
    expect(platform.response.headers['set-cookie']?.[0]).toContain('ai_finora_session=');
    expect(platform.response.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const hospital = await login({ ...DEMO_ACCOUNTS.hospitalAdmin, hospitalCode: 'AKRAM-MEDICAL' });
    expect(hospital.response.body.data).toMatchObject({
      accountType: 'HOSPITAL',
      redirectTo: '/hospital',
      hospital: { code: 'akram-medical', name: 'Akram Medical Centre' },
      role: 'Hospital Admin',
    });

    const stored = await db.hospitalUser.findUnique({ where: { id: SEED_IDS.users.akramAdmin } });
    expect(stored.passwordHash).not.toBe(DEMO_ACCOUNTS.hospitalAdmin.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await expect(bcrypt.compare(DEMO_ACCOUNTS.hospitalAdmin.password, stored.passwordHash)).resolves.toBe(true);
  });

  test('Super Admin endpoints reject hospital principals', async () => {
    await request(app).get('/api/super-admin/overview').set(bearer(tokens.akram)).expect(403);
    const response = await request(app).get('/api/super-admin/overview').set(bearer(tokens.platform)).expect(200);
    expect(response.body.data).toMatchObject({ totalHospitals: 3, activeHospitals: 1, trialHospitals: 1, pastDueHospitals: 1 });

    const users = await request(app).get('/api/super-admin/users').set(bearer(tokens.platform)).expect(200);
    expectNoSensitiveResponseFields(users.body);
    expect(users.body.data.find((user) => user.id === SEED_IDS.users.akramAdmin)).toMatchObject({
      accountType: 'HOSPITAL',
      createdAt: expect.any(String),
      lastLoginAt: expect.any(String),
      mustChangePassword: false,
    });

    const hospital = await request(app)
      .get(`/api/super-admin/hospitals/${SEED_IDS.hospitals.akram}`)
      .set(bearer(tokens.platform))
      .expect(200);
    expectNoSensitiveResponseFields(hospital.body);
    expect(hospital.body.data).toMatchObject({
      usage: { users: 4, branches: 2, beds: 85, storageGb: 0 },
      limits: { maxUsers: 40, maxBranches: 2, maxBeds: 100, storageLimitMb: 20480, storageGb: 20 },
      outstandingAmount: 75000,
    });
    expect(hospital.body.data.subscriptionPayments).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: 'HBL-IMPL-88201', method: 'MANUAL_BANK_TRANSFER', status: 'COMPLETED' }),
      expect.objectContaining({ reference: 'AKR-JUL-2026-001', method: 'MANUAL_BANK_TRANSFER', status: 'COMPLETED' }),
    ]));

    const proofs = await request(app).get('/api/super-admin/payment-proofs').set(bearer(tokens.platform)).expect(200);
    expectNoSensitiveResponseFields(proofs.body);
  });

  test('hospital search covers advertised contact fields and safely bounds search input', async () => {
    const searches = [
      ['Dr. Farhan Akram', SEED_IDS.hospitals.akram],
      ['farhan@akrammedical.pk', SEED_IDS.hospitals.akram],
      ['3571 4400', SEED_IDS.hospitals.akram],
      ['300 845 1100', SEED_IDS.hospitals.akram],
      ['Punjab', SEED_IDS.hospitals.akram],
      ['noor-surgical', SEED_IDS.hospitals.noor],
    ];

    for (const [search, hospitalId] of searches) {
      const response = await request(app)
        .get('/api/super-admin/hospitals')
        .query({ search })
        .set(bearer(tokens.platform))
        .expect(200);
      expect(response.body.data.map((hospital) => hospital.id)).toContain(hospitalId);
    }

    await request(app)
      .get('/api/super-admin/hospitals')
      .query({ search: 'x'.repeat(101) })
      .set(bearer(tokens.platform))
      .expect(400);
  });

  test('editing a subscription status creates one hospital notification for the actual transition', async () => {
    const reason = 'Scheduled pause for integration regression coverage';
    let notificationId;
    try {
      const changed = await request(app)
        .patch(`/api/super-admin/subscriptions/${SEED_IDS.subscriptions.akram}`)
        .set(bearer(tokens.platform))
        .send({ status: 'PAUSED', reason })
        .expect(200);
      expect(changed.body.data).toMatchObject({ status: 'PAUSED' });

      const notification = await db.notification.findFirst({
        where: {
          hospitalId: SEED_IDS.hospitals.akram,
          type: 'SUBSCRIPTION_PAUSED',
          body: reason,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification).toMatchObject({
        title: 'Subscription status: paused',
        severity: 'WARNING',
        link: '/hospital/subscription',
      });
      expect(notification.dedupeKey).toContain(`manual-status:${SEED_IDS.subscriptions.akram}:ACTIVE:PAUSED:`);
      notificationId = notification.id;

      await request(app)
        .patch(`/api/super-admin/subscriptions/${SEED_IDS.subscriptions.akram}`)
        .set(bearer(tokens.platform))
        .send({ status: 'PAUSED', reason: 'No transition occurred' })
        .expect(200);
      expect(await db.notification.count({
        where: { hospitalId: SEED_IDS.hospitals.akram, type: 'SUBSCRIPTION_PAUSED' },
      })).toBe(1);
    } finally {
      await db.$transaction([
        db.hospitalSubscription.update({
          where: { id: SEED_IDS.subscriptions.akram },
          data: { status: 'ACTIVE', canceledAt: null, gracePeriodEndsAt: null },
        }),
        db.hospital.update({ where: { id: SEED_IDS.hospitals.akram }, data: { accountStatus: 'ACTIVE' } }),
        db.auditLog.deleteMany({
          where: {
            entityId: SEED_IDS.subscriptions.akram,
            reason: { in: [reason, 'No transition occurred'] },
          },
        }),
        ...(notificationId ? [db.notification.delete({ where: { id: notificationId } })] : []),
      ]);
    }
  });

  test('platform audit APIs exclude operational patient records and project SaaS audit values', async () => {
    const clinicalMarker = 'PRIVATE-PATIENT-DIAGNOSIS-MARKER';
    const patientAuditId = 'test_platform_privacy_patient_audit';
    const subscriptionAuditId = 'test_platform_privacy_subscription_audit';
    await db.auditLog.createMany({ data: [
      {
        id: patientAuditId,
        hospitalId: SEED_IDS.hospitals.akram,
        actorType: 'HOSPITAL_USER',
        actorId: SEED_IDS.users.akramAdmin,
        actorName: 'Hospital Administrator',
        action: 'PATIENT_UPDATED',
        entityType: 'Patient',
        entityId: 'seed_patient_ayesha',
        previousValue: JSON.stringify({ name: 'Ayesha Khan', diagnosis: clinicalMarker }),
        newValue: JSON.stringify({ name: 'Ayesha Khan', diagnosis: `${clinicalMarker}-UPDATED` }),
        reason: clinicalMarker,
      },
      {
        id: subscriptionAuditId,
        hospitalId: SEED_IDS.hospitals.akram,
        actorType: 'PLATFORM_USER',
        actorId: SEED_IDS.platformAdmin,
        actorName: 'Areeba Khan',
        action: 'SUBSCRIPTION_READ_ONLY',
        entityType: 'HospitalSubscription',
        entityId: SEED_IDS.subscriptions.akram,
        previousValue: JSON.stringify({ status: 'ACTIVE', patientName: clinicalMarker }),
        newValue: JSON.stringify({ status: 'READ_ONLY', notes: clinicalMarker }),
        reason: clinicalMarker,
      },
    ] });

    try {
      const [globalLogs, hospitalDetail] = await Promise.all([
        request(app).get('/api/super-admin/audit-logs').set(bearer(tokens.platform)).expect(200),
        request(app).get(`/api/super-admin/hospitals/${SEED_IDS.hospitals.akram}`).set(bearer(tokens.platform)).expect(200),
      ]);
      for (const payload of [globalLogs.body, hospitalDetail.body.data.auditLogs]) {
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain(clinicalMarker);
        expect(serialized).not.toContain(patientAuditId);
      }
      const projected = globalLogs.body.data.find((row) => row.id === subscriptionAuditId);
      expect(projected).toMatchObject({
        entityType: 'HospitalSubscription',
        previousValue: { status: 'ACTIVE' },
        newValue: { status: 'READ_ONLY' },
        reason: '[REDACTED FROM PLATFORM VIEW]',
      });
      expect(hospitalDetail.body.data.auditLogs.some((row) => row.id === subscriptionAuditId)).toBe(true);
    } finally {
      await db.auditLog.deleteMany({ where: { id: { in: [patientAuditId, subscriptionAuditId] } } });
    }
  });

  test('issuing a password-reset token invalidates older tokens and reset consumes the account token set', async () => {
    const account = DEMO_ACCOUNTS.noorAdmin;
    const original = await db.hospitalUser.findUnique({
      where: { id: SEED_IDS.users.noorAdmin },
      select: { passwordHash: true, tokenVersion: true, mustChangePassword: true },
    });
    try {
      const first = await request(app).post('/api/auth/forgot-password').send({
        hospitalCode: account.hospitalCode,
        email: account.email,
      }).expect(200);
      const second = await request(app).post('/api/auth/forgot-password').send({
        hospitalCode: account.hospitalCode,
        email: account.email,
      }).expect(200);
      expect(first.body.data.demoResetToken).not.toBe(second.body.data.demoResetToken);

      await request(app).post('/api/auth/reset-password').send({
        token: first.body.data.demoResetToken,
        password: 'Replacement@456',
      }).expect(400);
      await request(app).post('/api/auth/reset-password').send({
        token: second.body.data.demoResetToken,
        password: 'Replacement@456',
      }).expect(200);

      expect(await db.passwordResetToken.count({
        where: { principalType: 'HOSPITAL_USER', principalId: SEED_IDS.users.noorAdmin, usedAt: null },
      })).toBe(0);
      const changed = await db.hospitalUser.findUnique({ where: { id: SEED_IDS.users.noorAdmin } });
      expect(changed.tokenVersion).toBe(original.tokenVersion + 1);
      await expect(bcrypt.compare('Replacement@456', changed.passwordHash)).resolves.toBe(true);
    } finally {
      await db.hospitalUser.update({ where: { id: SEED_IDS.users.noorAdmin }, data: original });
      await db.passwordResetToken.deleteMany({
        where: { principalType: 'HOSPITAL_USER', principalId: SEED_IDS.users.noorAdmin },
      });
    }
  });

  test('temporary-password accounts cannot access hospital data until the password is changed', async () => {
    await db.hospitalUser.update({ where: { id: SEED_IDS.users.akramAdmin }, data: { mustChangePassword: true } });
    try {
      await request(app).get('/api/auth/me').set(bearer(tokens.akram)).expect(200);
      const response = await request(app).get('/api/hospital/bootstrap').set(bearer(tokens.akram)).expect(403);
      expect(response.body.error).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    } finally {
      await db.hospitalUser.update({ where: { id: SEED_IDS.users.akramAdmin }, data: { mustChangePassword: false } });
    }
  });

  test('repeated failed sign-in attempts persistently lock a hospital account', async () => {
    const account = DEMO_ACCOUNTS.receptionist;
    await db.hospitalUser.update({
      where: { id: SEED_IDS.users.akramReceptionist },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app).post('/api/auth/login').send({
          hospitalCode: account.hospitalCode,
          email: account.email,
          password: 'DefinitelyWrong@123',
        }).expect(401);
      }
      const locked = await db.hospitalUser.findUnique({ where: { id: SEED_IDS.users.akramReceptionist } });
      expect(locked.failedLoginAttempts).toBe(5);
      expect(locked.lockedUntil.getTime()).toBeGreaterThan(Date.now());
      await request(app).post('/api/auth/login').send(account).expect(401);
    } finally {
      await db.hospitalUser.update({
        where: { id: SEED_IDS.users.akramReceptionist },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }
  });

  test('two hospital tokens remain tenant-scoped, including direct ID substitution', async () => {
    const [akramResponse, noorResponse] = await Promise.all([
      request(app).get('/api/hospital/patients').set(bearer(tokens.akram)).expect(200),
      request(app).get('/api/hospital/patients').set(bearer(tokens.noor)).expect(200),
    ]);

    expect(akramResponse.body.data.some((patient) => patient.name === 'Ayesha Khan')).toBe(true);
    expect(akramResponse.body.data.some((patient) => patient.name === 'Zoya Rahman')).toBe(false);
    expect(noorResponse.body.data).toEqual([
      expect.objectContaining({ id: 'P-1048', name: 'Zoya Rahman' }),
    ]);

    await request(app)
      .patch(`/api/hospital/patients/seed_patient_ayesha`)
      .set(bearer(tokens.noor))
      .send({ city: 'Karachi' })
      .expect(404);

    const original = await db.patient.findUnique({ where: { id: 'seed_patient_ayesha' } });
    expect(original).toMatchObject({ hospitalId: SEED_IDS.hospitals.akram, city: 'Lahore' });
  });

  test('plan features and read-only subscription state are enforced by the API', async () => {
    const featureBlocked = await request(app)
      .get('/api/hospital/admissions')
      .set(bearer(tokens.noor))
      .expect(403);
    expect(featureBlocked.body.error.message).toContain('not enabled');

    await db.hospitalSubscription.update({
      where: { id: SEED_IDS.subscriptions.akram },
      data: { status: 'READ_ONLY' },
    });
    try {
      await request(app).get('/api/hospital/patients').set(bearer(tokens.akram)).expect(200);
      const blockedWrite = await request(app)
        .post('/api/hospital/patients')
        .set(bearer(tokens.akram))
        .send({ name: 'Blocked Patient', age: 30, gender: 'Male', hospitalId: SEED_IDS.hospitals.noor })
        .expect(403);
      expect(blockedWrite.body.error.message).toContain('read-only mode');
    } finally {
      await db.hospitalSubscription.update({
        where: { id: SEED_IDS.subscriptions.akram },
        data: { status: 'ACTIVE' },
      });
    }
  });

  test('suspended hospitals expose only administrator billing, export, and support surfaces', async () => {
    await db.hospitalSubscription.update({
      where: { id: SEED_IDS.subscriptions.akram },
      data: { status: 'SUSPENDED' },
    });
    try {
      await request(app).get('/api/hospital/subscription').set(bearer(tokens.akram)).expect(200);
      await request(app).get('/api/hospital/data-export-requests').set(bearer(tokens.akram)).expect(200);
      await request(app).get('/api/hospital/patient-invoices').set(bearer(tokens.akram)).expect(403);
      await request(app).get('/api/hospital/patients').set(bearer(tokens.akram)).expect(403);
      await request(app).post('/api/auth/login').send(DEMO_ACCOUNTS.receptionist).expect(401);
    } finally {
      await db.hospitalSubscription.update({
        where: { id: SEED_IDS.subscriptions.akram },
        data: { status: 'ACTIVE' },
      });
    }
  });

  test('subscription processing advances overdue renewals and protects an active trial', async () => {
    const processAt = async (asOf) => request(app)
      .post('/api/super-admin/subscriptions/process')
      .set(bearer(tokens.platform))
      .send({ asOf })
      .expect(200);

    try {
      await processAt('2026-07-02T12:00:00.000Z');
      expect(await db.hospitalSubscription.findUnique({ where: { id: SEED_IDS.subscriptions.noor } }))
        .toMatchObject({ status: 'PAST_DUE' });

      const grace = await processAt('2026-07-03T12:00:00.000Z');
      expect(grace.body.data.transitions).toContainEqual({
        subscriptionId: SEED_IDS.subscriptions.noor,
        from: 'PAST_DUE',
        to: 'GRACE_PERIOD',
      });
      expect(await db.hospitalSubscription.findUnique({ where: { id: SEED_IDS.subscriptions.noor } }))
        .toMatchObject({ status: 'GRACE_PERIOD' });

      const readOnly = await processAt('2026-07-16T12:00:00.000Z');
      expect(readOnly.body.data.transitions).toContainEqual({
        subscriptionId: SEED_IDS.subscriptions.noor,
        from: 'GRACE_PERIOD',
        to: 'READ_ONLY',
      });
      await processAt('2026-07-20T12:00:00.000Z');
      expect(await db.hospitalSubscription.findUnique({ where: { id: SEED_IDS.subscriptions.noor } }))
        .toMatchObject({ status: 'READ_ONLY' });
      const historical = await processAt('2026-07-02T12:00:00.000Z');
      expect(historical.body.data.transitions).not.toContainEqual(expect.objectContaining({
        subscriptionId: SEED_IDS.subscriptions.noor,
        to: 'PAST_DUE',
      }));
      expect(await db.hospitalSubscription.findUnique({ where: { id: SEED_IDS.subscriptions.noor } }))
        .toMatchObject({ status: 'READ_ONLY' });
      expect(await db.subscriptionInvoice.findUnique({ where: { id: SEED_IDS.invoices.noorAnnual } }))
        .toMatchObject({ status: 'OVERDUE' });
      expect(await db.hospitalSubscription.findUnique({ where: { id: SEED_IDS.subscriptions.islamabad } }))
        .toMatchObject({ status: 'TRIALING' });
    } finally {
      await db.$transaction([
        db.hospitalSubscription.update({
          where: { id: SEED_IDS.subscriptions.noor },
          data: { status: 'PAST_DUE', gracePeriodEndsAt: new Date('2026-07-15T00:00:00.000Z') },
        }),
        db.hospital.update({ where: { id: SEED_IDS.hospitals.noor }, data: { accountStatus: 'PAST_DUE' } }),
      ]);
    }
  });

  test('invoice workflow rejects direct or backwards financial state changes', async () => {
    await request(app)
      .patch(`/api/super-admin/invoices/${SEED_IDS.invoices.akramImplementation}/status`)
      .set(bearer(tokens.platform))
      .send({ status: 'DRAFT' })
      .expect(409);
    await request(app)
      .patch(`/api/super-admin/invoices/${SEED_IDS.invoices.akramAddOn}/status`)
      .set(bearer(tokens.platform))
      .send({ status: 'PAID' })
      .expect(400);
    expect(await db.subscriptionInvoice.findUnique({ where: { id: SEED_IDS.invoices.akramImplementation } }))
      .toMatchObject({ status: 'PAID' });
    const openInvoice = await db.subscriptionInvoice.findUnique({ where: { id: SEED_IDS.invoices.akramAddOn } });
    expect(openInvoice).toMatchObject({ status: 'ISSUED' });
    expect(Number(openInvoice.paidAmount)).toBe(0);
  });

  test('payment-proof validation enforces content, resubmission invoice binding, and review state', async () => {
    const invalidMagic = await request(app)
      .post('/api/hospital/bank-transfer-proofs')
      .set(bearer(tokens.akram))
      .field('invoiceId', SEED_IDS.invoices.akramAddOn)
      .field('amount', '1000')
      .field('bankName', 'Demo Bank')
      .field('transactionReference', 'INVALID-MAGIC-001')
      .field('transferDate', '2026-07-13')
      .attach('proof', Buffer.from('this is not a png'), { filename: 'proof.png', contentType: 'image/png' })
      .expect(400);
    expect(invalidMagic.body.error.message).toContain('file content');

    const otherInvoiceId = 'test_noor_resubmission_other_invoice';
    await db.subscriptionInvoice.create({ data: {
      id: otherInvoiceId,
      hospitalId: SEED_IDS.hospitals.noor,
      subscriptionId: SEED_IDS.subscriptions.noor,
      invoiceNumber: 'AF-TEST-RESUB-0001',
      invoiceType: 'SUPPORT_CHARGES',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      dueDate: new Date('2026-07-10T00:00:00.000Z'),
      subtotal: 270000,
      discount: 0,
      tax: 0,
      total: 270000,
      paidAmount: 0,
      status: 'OVERDUE',
      idempotencyKey: 'test:noor:resubmission-other-invoice',
      issuedAt: new Date('2026-07-01T00:00:00.000Z'),
    } });
    try {
      await request(app)
        .post('/api/hospital/bank-transfer-proofs')
        .set(bearer(tokens.noor))
        .field('invoiceId', otherInvoiceId)
        .field('amount', '270000')
        .field('bankName', 'Demo Bank')
        .field('transactionReference', 'WRONG-INVOICE-RESUB-001')
        .field('transferDate', '2026-07-13')
        .field('parentProofId', SEED_IDS.proofs.rejected)
        .attach('proof', PROOF_PNG, { filename: 'proof.png', contentType: 'image/png' })
        .expect(400);
    } finally {
      await db.bankTransferProof.deleteMany({ where: { invoiceId: otherInvoiceId } });
      await db.subscriptionInvoice.delete({ where: { id: otherInvoiceId } });
    }

    await request(app)
      .post(`/api/super-admin/payment-proofs/${SEED_IDS.proofs.approved}/request-info`)
      .set(bearer(tokens.platform))
      .send({ message: 'This must not alter an approved proof.' })
      .expect(409);
    expect(await db.bankTransferProof.findUnique({ where: { id: SEED_IDS.proofs.approved } }))
      .toMatchObject({ status: 'APPROVED', additionalInformation: null });

    const requested = await request(app)
      .post(`/api/super-admin/payment-proofs/${SEED_IDS.proofs.pending}/request-info`)
      .set(bearer(tokens.platform))
      .send({ message: 'Please confirm the account debit date.' })
      .expect(200);
    expect(requested.body.data).toMatchObject({ status: 'UNDER_REVIEW', additionalInformation: 'Please confirm the account debit date.' });
    expect(await db.auditLog.count({ where: { action: 'PAYMENT_PROOF_INFORMATION_REQUESTED', entityId: SEED_IDS.proofs.pending } })).toBe(1);
  });

  test('duplicate bank references are rejected and a valid pending proof completes atomically', async () => {
    const duplicateProofId = 'test_duplicate_bank_reference_proof';
    await db.bankTransferProof.create({ data: {
      id: duplicateProofId,
      hospitalId: SEED_IDS.hospitals.akram,
      invoiceId: SEED_IDS.invoices.akramAddOn,
      submittedByHospitalUserId: SEED_IDS.users.akramAdmin,
      amount: 75000,
      bankName: 'Habib Bank Limited',
      transactionReference: 'HBL IMPL 88201',
      normalizedReference: 'HBLIMPL88201',
      transferDate: new Date('2026-07-12T00:00:00.000Z'),
      storageKey: 'test-duplicate.png',
      originalFileName: 'duplicate.png',
      mimeType: 'image/png',
      fileSize: 68,
      sha256: 'a'.repeat(64),
      status: 'PENDING',
    } });

    const paymentCountBefore = await db.subscriptionPayment.count();
    const duplicateResponse = await request(app)
      .post(`/api/super-admin/payment-proofs/${duplicateProofId}/approve`)
      .set(bearer(tokens.platform))
      .send({})
      .expect(409);
    expect(duplicateResponse.body.error.message).toContain('already been approved');
    expect(await db.subscriptionPayment.count()).toBe(paymentCountBefore);
    expect(await db.bankTransferProof.findUnique({ where: { id: duplicateProofId } })).toMatchObject({ status: 'PENDING' });
    await db.bankTransferProof.delete({ where: { id: duplicateProofId } });

    const approved = await request(app)
      .post(`/api/super-admin/payment-proofs/${SEED_IDS.proofs.pending}/approve`)
      .set(bearer(tokens.platform))
      .send({})
      .expect(200);
    expect(approved.body.data).toMatchObject({ invoiceStatus: 'PAID', outstandingBalance: 0, proof: { status: 'APPROVED' } });

    const [invoice, proof, payment] = await Promise.all([
      db.subscriptionInvoice.findUnique({ where: { id: SEED_IDS.invoices.akramAddOn } }),
      db.bankTransferProof.findUnique({ where: { id: SEED_IDS.proofs.pending } }),
      db.subscriptionPayment.findUnique({ where: { bankTransferProofId: SEED_IDS.proofs.pending } }),
    ]);
    expect(invoice).toMatchObject({ status: 'PAID' });
    expect(Number(invoice.paidAmount)).toBe(75000);
    expect(proof).toMatchObject({ status: 'APPROVED', reviewedByPlatformUserId: SEED_IDS.platformAdmin });
    expect(payment).toMatchObject({ normalizedReference: 'MCBADDON43092', provider: 'MANUAL_BANK_TRANSFER' });
  });

  test('plan limits and tenant boundaries protect hospital users, branches, and export requests', async () => {
    await db.hospitalSubscription.update({
      where: { id: SEED_IDS.subscriptions.akram },
      data: { maxUsers: 4 },
    });
    try {
      await request(app)
        .post('/api/hospital/users')
        .set(bearer(tokens.akram))
        .send({
          fullName: 'Limit Test User',
          email: 'limit-user@example.invalid',
          temporaryPassword: 'Temporary@123',
          roleKey: 'receptionist',
        })
        .expect(409);
    } finally {
      await db.hospitalSubscription.update({
        where: { id: SEED_IDS.subscriptions.akram },
        data: { maxUsers: 40 },
      });
    }

    await db.hospitalSubscription.update({
      where: { id: SEED_IDS.subscriptions.islamabad },
      data: { maxBranches: 3 },
    });
    try {
      await request(app)
        .post('/api/hospital/branches')
        .set(bearer(tokens.islamabad))
        .send({ code: 'limit-branch', name: 'Limit Branch', city: 'Islamabad', province: 'Islamabad Capital Territory' })
        .expect(409);
    } finally {
      await db.hospitalSubscription.update({
        where: { id: SEED_IDS.subscriptions.islamabad },
        data: { maxBranches: null },
      });
    }

    await request(app)
      .patch(`/api/hospital/users/${SEED_IDS.users.akramBilling}`)
      .set(bearer(tokens.noor))
      .send({ isActive: false, reason: 'Cross-tenant isolation regression check.' })
      .expect(404);
    expect(await db.hospitalUser.findUnique({ where: { id: SEED_IDS.users.akramBilling } }))
      .toMatchObject({ hospitalId: SEED_IDS.hospitals.akram, isActive: true });

    const exportRequest = await request(app)
      .post('/api/hospital/data-export-requests')
      .set(bearer(tokens.noor))
      .send({ scope: 'BILLING', format: 'CSV', reason: 'Tenant isolation regression check.' })
      .expect(201);
    try {
      const akramExports = await request(app)
        .get('/api/hospital/data-export-requests')
        .set(bearer(tokens.akram))
        .expect(200);
      expect(akramExports.body.data.some((item) => item.id === exportRequest.body.data.id)).toBe(false);
    } finally {
      await db.supportRequest.delete({ where: { id: exportRequest.body.data.id } });
    }
  });

  test('subscription processing creates only one renewal invoice for a billing period', async () => {
    const asOf = '2026-07-25T00:00:00.000Z';
    const first = await request(app)
      .post('/api/super-admin/subscriptions/process')
      .set(bearer(tokens.platform))
      .send({ asOf })
      .expect(200);
    const second = await request(app)
      .post('/api/super-admin/subscriptions/process')
      .set(bearer(tokens.platform))
      .send({ asOf })
      .expect(200);

    expect(first.body.data.createdInvoices).toHaveLength(1);
    expect(second.body.data.createdInvoices).toHaveLength(0);
    expect(await db.subscriptionInvoice.count({
      where: { idempotencyKey: `renewal:${SEED_IDS.subscriptions.akram}:2026-08-01` },
    })).toBe(1);
  });

  test('Safepay verifies signatures and retries only failed, invoice-bound intent events', async () => {
    const invalidPayload = { id: 'evt_invalid_signature', type: 'payment.succeeded' };
    await request(app)
      .post('/api/webhooks/safepay')
      .set('x-safepay-signature', 'invalid')
      .send(invalidPayload)
      .expect(401);
    expect(await db.webhookEvent.count({ where: { providerEventId: 'evt_invalid_signature' } })).toBe(0);

    const tracker = 'sfpy_integration_txn_001';
    await db.paymentIntent.create({ data: {
      id: 'test_safepay_intent_001',
      hospitalId: SEED_IDS.hospitals.islamabad,
      invoiceId: SEED_IDS.invoices.islamabadImplementation,
      provider: 'SAFEPAY',
      providerReference: tracker,
      amount: 300000,
      currency: 'PKR',
      status: 'CREATED',
    } });

    const payload = (amount, currency) => ({
      id: 'evt_safepay_integration_001',
      type: 'payment.succeeded',
      data: {
        metadata: { invoiceId: SEED_IDS.invoices.islamabadImplementation },
        tracker,
        amount,
        currency,
      },
    });

    const wrongAmount = payload(299999, 'PKR');
    await request(app)
      .post('/api/webhooks/safepay')
      .set('x-safepay-signature', safepaySignature(wrongAmount))
      .send(wrongAmount)
      .expect(400);
    expect(await db.webhookEvent.findUnique({
      where: { provider_providerEventId: { provider: 'SAFEPAY', providerEventId: wrongAmount.id } },
    })).toMatchObject({ processingStatus: 'FAILED' });
    expect(await db.paymentIntent.findUnique({ where: { id: 'test_safepay_intent_001' } }))
      .toMatchObject({ status: 'CREATED' });

    const wrongCurrency = payload(300000, 'USD');
    await request(app)
      .post('/api/webhooks/safepay')
      .set('x-safepay-signature', safepaySignature(wrongCurrency))
      .send(wrongCurrency)
      .expect(400);
    expect(await db.webhookEvent.findUnique({
      where: { provider_providerEventId: { provider: 'SAFEPAY', providerEventId: wrongCurrency.id } },
    })).toMatchObject({ processingStatus: 'FAILED' });

    const validPayload = payload(300000, 'PKR');
    const retried = await request(app)
      .post('/api/webhooks/safepay')
      .set('x-safepay-signature', safepaySignature(validPayload))
      .send(validPayload)
      .expect(200);
    const duplicate = await request(app)
      .post('/api/webhooks/safepay')
      .set('x-safepay-signature', safepaySignature(validPayload))
      .send(validPayload)
      .expect(200);

    expect(retried.body.data).toMatchObject({ received: true, processed: true });
    expect(duplicate.body.data).toMatchObject({ received: true, duplicate: true });
    expect(await db.webhookEvent.count({ where: { provider: 'SAFEPAY', providerEventId: validPayload.id } })).toBe(1);
    expect(await db.subscriptionPayment.count({ where: { provider: 'SAFEPAY', normalizedReference: 'SFPYINTEGRATIONTXN001' } })).toBe(1);
    expect(await db.subscriptionInvoice.findUnique({ where: { id: SEED_IDS.invoices.islamabadImplementation } })).toMatchObject({ status: 'PAID' });
    expect(await db.paymentIntent.findUnique({ where: { id: 'test_safepay_intent_001' } })).toMatchObject({ status: 'COMPLETED' });
  });

  test('runtime settings govern new invoices/support sessions and concurrent payments cannot over-collect', async () => {
    const settingKeys = ['invoicePrefix', 'renewalInvoiceDaysBefore', 'reminderDaysBefore', 'defaultSupportAccessMinutes'];
    const priorSettings = await db.platformSetting.findMany({ where: { key: { in: settingKeys } } });
    const createdInvoiceIds = [];
    let supportSessionId;
    try {
      await request(app)
        .patch('/api/super-admin/settings')
        .set(bearer(tokens.platform))
        .send({ settings: { renewalInvoiceDaysBefore: 5, reminderDaysBefore: 6 } })
        .expect(400);

      const settings = await request(app)
        .patch('/api/super-admin/settings')
        .set(bearer(tokens.platform))
        .send({ settings: {
          invoicePrefix: 'QA-SUB',
          renewalInvoiceDaysBefore: 12,
          reminderDaysBefore: 4,
          defaultSupportAccessMinutes: 17,
        } })
        .expect(200);
      expect(settings.body.data.settings).toMatchObject({
        invoicePrefix: 'QA-SUB',
        renewalInvoiceDaysBefore: '12',
        reminderDaysBefore: '4',
        defaultSupportAccessMinutes: '17',
      });

      await request(app)
        .post(`/api/super-admin/hospitals/${SEED_IDS.hospitals.akram}/support-access`)
        .set(bearer(tokens.platform))
        .send({ reason: 'Regression test support session' })
        .expect(400);
      const supportStart = Date.now();
      const support = await request(app)
        .post(`/api/super-admin/hospitals/${SEED_IDS.hospitals.akram}/support-access`)
        .set(bearer(tokens.platform))
        .send({ reason: 'Regression test support session', warningAccepted: true })
        .expect(201);
      supportSessionId = support.body.data.session.id;
      const durationMinutes = (new Date(support.body.data.session.expiresAt).getTime() - supportStart) / 60_000;
      expect(durationMinutes).toBeGreaterThan(16.8);
      expect(durationMinutes).toBeLessThan(17.2);

      const prefixed = await createSubscriptionInvoice(db, {
        hospitalId: SEED_IDS.hospitals.akram,
        subscriptionId: SEED_IDS.subscriptions.akram,
        type: 'SUPPORT_CHARGES',
        items: [{ description: 'Prefix regression invoice', quantity: 1, unitAmount: 100 }],
        idempotencyKey: `test:settings-prefix:${Date.now()}`,
      });
      createdInvoiceIds.push(prefixed.id);
      expect(prefixed.invoiceNumber.startsWith('QA-SUB-')).toBe(true);

      const concurrent = await createSubscriptionInvoice(db, {
        hospitalId: SEED_IDS.hospitals.akram,
        subscriptionId: SEED_IDS.subscriptions.akram,
        type: 'SUPPORT_CHARGES',
        items: [{ description: 'Concurrent payment regression invoice', quantity: 1, unitAmount: 100 }],
        idempotencyKey: `test:concurrent-payment:${Date.now()}`,
      });
      createdInvoiceIds.push(concurrent.id);
      const actor = { type: 'PLATFORM_USER', id: SEED_IDS.platformAdmin, name: 'Integration Test Admin' };
      const attempts = await Promise.allSettled(['CONCURRENT-A', 'CONCURRENT-B'].map((reference) => (
        withSerializableFinancialTransaction(db, (tx) => applySubscriptionPayment(tx, {
          invoiceId: concurrent.id,
          hospitalId: concurrent.hospitalId,
          provider: 'ADJUSTMENT',
          reference: `${reference}-${Date.now()}`,
          amount: 60,
          actor,
        }))
      )));
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
      const reconciled = await db.subscriptionInvoice.findUnique({ where: { id: concurrent.id } });
      expect(Number(reconciled.paidAmount)).toBe(60);
      expect(reconciled.status).toBe('PARTIALLY_PAID');
      expect(await db.subscriptionPayment.count({ where: { invoiceId: concurrent.id } })).toBe(1);
    } finally {
      if (supportSessionId) {
        await request(app)
          .post(`/api/super-admin/support-access/${supportSessionId}/end`)
          .set(bearer(tokens.platform));
      }
      if (createdInvoiceIds.length) await db.subscriptionInvoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
      await db.platformSetting.deleteMany({ where: { key: { in: settingKeys } } });
      if (priorSettings.length) {
        await db.platformSetting.createMany({ data: priorSettings.map(({ id, key, value, description, updatedById, createdAt, updatedAt }) => ({
          id, key, value, description, updatedById, createdAt, updatedAt,
        })) });
      }
    }
  }, 30_000);

  test('hospital users can replace a temporary password and receive a refreshed session', async () => {
    const response = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(tokens.akram))
      .send({ currentPassword: DEMO_ACCOUNTS.hospitalAdmin.password, newPassword: 'ChangedDemo@456' })
      .expect(200);
    expect(response.body.data).toMatchObject({ accountType: 'HOSPITAL', redirectTo: '/hospital', user: { mustChangePassword: false } });
    await request(app).get('/api/auth/me').set(bearer(tokens.akram)).expect(401);
    await request(app).get('/api/auth/me').set(bearer(response.body.data.accessToken)).expect(200);
    const user = await db.hospitalUser.findUnique({ where: { id: SEED_IDS.users.akramAdmin } });
    expect(user.mustChangePassword).toBe(false);
    expect(await bcrypt.compare('ChangedDemo@456', user.passwordHash)).toBe(true);
  });
});
