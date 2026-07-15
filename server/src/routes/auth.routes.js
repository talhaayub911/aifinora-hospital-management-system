import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth, setAuthCookie, signAuthToken } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.service.js';
import { asyncHandler, badRequest, unauthorized } from '../utils/errors.js';
import { normalizeCode, normalizeEmail, publicUser } from '../utils/format.js';

const loginSchema = z.object({
  hospitalCode: z.string().trim().optional(),
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
});

const forgotSchema = z.object({ email: z.string().email(), hospitalCode: z.string().trim().optional() });
const strongPassword = z.string().min(10).max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/[0-9]/, 'Password must contain a number.')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character.');
const resetSchema = z.object({ token: z.string().min(20), password: strongPassword });

const accountLocked = (user) => user?.lockedUntil && user.lockedUntil > new Date();
const failedLoginData = (user) => {
  const attempts = Number(user.failedLoginAttempts || 0) + 1;
  return {
    failedLoginAttempts: attempts,
    ...(attempts >= env.maxLoginAttempts ? { lockedUntil: new Date(Date.now() + env.loginLockMinutes * 60 * 1000) } : {}),
  };
};

function loginEnvelope({ token, user, kind, hospital = null }) {
  const accountType = kind === 'platform' ? 'SUPER_ADMIN' : kind === 'support' ? 'SUPPORT' : 'HOSPITAL';
  return {
    accessToken: token,
    token,
    user: publicUser(user, kind === 'platform' ? 'platform' : 'hospital'),
    hospital,
    accountType,
    type: accountType,
    role: kind === 'platform' ? user.role : user.role?.name,
    redirectTo: kind === 'platform' ? '/super-admin' : '/hospital',
  };
}

export function createAuthRouter() {
  const router = Router();

  router.post('/login', asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const email = normalizeEmail(input.email);
    if (!input.hospitalCode) {
      const user = await db.platformUser.findUnique({ where: { email } });
      if (accountLocked(user)) throw unauthorized('This account is temporarily locked after repeated failed sign-in attempts. Try again later.');
      const validPassword = user && user.isActive && await bcrypt.compare(input.password, user.passwordHash);
      if (!validPassword) {
        if (user?.isActive) await db.platformUser.update({ where: { id: user.id }, data: failedLoginData(user) });
        throw unauthorized('Invalid email address or password.');
      }
      await db.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
      const token = signAuthToken({ id: user.id, kind: 'platform', tokenVersion: user.tokenVersion }, input.rememberMe);
      setAuthCookie(res, token, input.rememberMe);
      return res.json({ data: loginEnvelope({ token, user, kind: 'platform' }) });
    }

    const hospital = await db.hospital.findUnique({ where: { code: normalizeCode(input.hospitalCode) } });
    const user = hospital ? await db.hospitalUser.findUnique({
      where: { hospitalId_email: { hospitalId: hospital.id, email } },
      include: { role: true },
    }) : null;
    if (accountLocked(user)) throw unauthorized('This account is temporarily locked after repeated failed sign-in attempts. Try again later.');
    const validPassword = user?.isActive && await bcrypt.compare(input.password, user.passwordHash);
    if (!hospital || !user || !user.isActive || !validPassword) {
      if (user?.isActive) await db.hospitalUser.update({ where: { id: user.id }, data: failedLoginData(user) });
      throw unauthorized('Invalid hospital code, email address, or password.');
    }
    const subscription = await db.hospitalSubscription.findFirst({ where: { hospitalId: hospital.id, isCurrent: true }, orderBy: { createdAt: 'desc' } });
    if (['SUSPENDED', 'CANCELED'].includes(subscription?.status) && user.role.key !== 'hospital_admin') {
      throw unauthorized('This hospital is suspended. A Hospital Administrator may sign in to access billing and export information.');
    }
    await db.hospitalUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
    const token = signAuthToken({ id: user.id, kind: 'hospital', tokenVersion: user.tokenVersion, hospitalId: hospital.id }, input.rememberMe);
    setAuthCookie(res, token, input.rememberMe);
    res.json({ data: loginEnvelope({ token, user, kind: 'hospital', hospital: { id: hospital.id, code: hospital.code, name: hospital.name, accountStatus: hospital.accountStatus } }) });
  }));

  router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    if (req.auth.kind === 'support') {
      return res.json({ data: {
        user: { ...publicUser(req.auth.user, 'platform'), role: 'Hospital Admin', roleName: 'Hospital Admin' },
        hospital: req.auth.supportSession.hospital,
        accountType: 'SUPPORT',
        type: 'SUPPORT',
        role: 'Hospital Admin',
        redirectTo: '/hospital',
        supportAccessSessionId: req.auth.supportSession.id,
        reason: req.auth.supportSession.reason,
      } });
    }
    const kind = req.auth.kind;
    const hospital = kind === 'hospital' ? req.auth.user.hospital : null;
    res.json({ data: loginEnvelope({ token: undefined, user: req.auth.user, kind, hospital }) });
  }));

  router.post('/logout', (_req, res) => {
    res.clearCookie('ai_finora_session', { path: '/' });
    res.json({ data: { message: 'Signed out successfully.' } });
  });

  router.post('/forgot-password', asyncHandler(async (req, res) => {
    const input = forgotSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const email = normalizeEmail(input.email);
    let principal = null;
    const principalType = input.hospitalCode ? 'HOSPITAL_USER' : 'PLATFORM_USER';
    if (input.hospitalCode) {
      const hospital = await db.hospital.findUnique({ where: { code: normalizeCode(input.hospitalCode) } });
      if (hospital) principal = await db.hospitalUser.findUnique({ where: { hospitalId_email: { hospitalId: hospital.id, email } } });
    } else {
      principal = await db.platformUser.findUnique({ where: { email } });
    }
    const rawToken = randomBytes(32).toString('hex');
    if (principal) {
      await db.$transaction(async (tx) => {
        const now = new Date();
        await tx.passwordResetToken.updateMany({
          where: { principalType, principalId: principal.id, usedAt: null },
          data: { usedAt: now },
        });
        await tx.passwordResetToken.create({ data: {
          principalType,
          principalId: principal.id,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        } });
      });
    }
    res.json({ data: {
      message: 'If the account exists, password reset instructions have been generated.',
      ...(env.demoMode && env.nodeEnv !== 'production' ? { demoResetToken: rawToken, demoOnly: true } : {}),
    } });
  }));

  router.post('/reset-password', asyncHandler(async (req, res) => {
    const input = resetSchema.parse(req.body);
    const db = req.app.locals.prisma;
    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw badRequest('The reset token is invalid or expired.');
    const passwordHash = await bcrypt.hash(input.password, 12);
    await db.$transaction(async (tx) => {
      const usedAt = new Date();
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: usedAt } },
        data: { usedAt },
      });
      if (claimed.count !== 1) throw badRequest('The reset token is invalid or expired.');
      if (record.principalType === 'PLATFORM_USER') await tx.platformUser.update({ where: { id: record.principalId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
      else await tx.hospitalUser.update({ where: { id: record.principalId }, data: { passwordHash, tokenVersion: { increment: 1 }, mustChangePassword: false } });
      await tx.passwordResetToken.updateMany({
        where: { principalType: record.principalType, principalId: record.principalId, usedAt: null },
        data: { usedAt },
      });
    });
    res.json({ data: { message: 'Password reset successfully.' } });
  }));

  router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
    if (req.auth.kind !== 'hospital') throw badRequest('Password changes through this route are only available to hospital users.');
    const input = z.object({ currentPassword: z.string().min(1), newPassword: strongPassword }).parse(req.body);
    if (!(await bcrypt.compare(input.currentPassword, req.auth.user.passwordHash))) throw unauthorized('The current password is incorrect.');
    if (await bcrypt.compare(input.newPassword, req.auth.user.passwordHash)) throw badRequest('The new password must be different from the current password.');
    const db = req.app.locals.prisma;
    const nextVersion = req.auth.user.tokenVersion + 1;
    const updated = await db.$transaction(async (tx) => {
      const user = await tx.hospitalUser.update({ where: { id: req.auth.user.id }, data: {
        passwordHash: await bcrypt.hash(input.newPassword, 12), mustChangePassword: false, tokenVersion: nextVersion,
      }, include: { role: true, hospital: true } });
      await writeAudit(tx, { hospitalId: user.hospitalId, actorType: 'HOSPITAL_USER', actorId: user.id, actorName: user.fullName,
        action: 'PASSWORD_CHANGED', entityType: 'HospitalUser', entityId: user.id, previousValue: { mustChangePassword: req.auth.user.mustChangePassword }, newValue: { mustChangePassword: false }, ipAddress: req.ip });
      return user;
    });
    const token = signAuthToken({ id: updated.id, kind: 'hospital', tokenVersion: nextVersion, hospitalId: updated.hospitalId }, false);
    setAuthCookie(res, token, false);
    res.json({ data: { ...loginEnvelope({ token, user: updated, kind: 'hospital', hospital: updated.hospital }), message: 'Password changed successfully.' } });
  }));

  return router;
}
