import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError, forbidden, unauthorized } from '../utils/errors.js';

export function signAuthToken({ id, kind, tokenVersion = 0, hospitalId = null, supportSessionId = null }, rememberMe = false) {
  return jwt.sign(
    { kind, tokenVersion, hospitalId, supportSessionId },
    env.jwtSecret,
    { subject: id, expiresIn: rememberMe ? env.rememberMeExpiresIn : env.jwtExpiresIn },
  );
}

export function setAuthCookie(res, token, rememberMe = false) {
  res.cookie('ai_finora_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
    path: '/',
    ...(rememberMe ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
  });
}

function tokenFromRequest(req) {
  const authorization = req.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return req.cookies?.ai_finora_session;
}

export async function requireAuth(req, _res, next) {
  try {
    const token = tokenFromRequest(req);
    if (!token) throw unauthorized();
    let claims;
    try {
      claims = jwt.verify(token, env.jwtSecret);
    } catch {
      throw unauthorized('The authentication token is invalid or expired.');
    }
    const db = req.app.locals.prisma;

    if (claims.kind === 'platform') {
      const user = await db.platformUser.findUnique({ where: { id: claims.sub } });
      if (!user?.isActive || user.tokenVersion !== claims.tokenVersion) throw unauthorized('This platform account is disabled or its session has expired.');
      req.auth = { kind: 'platform', user, token };
    } else if (claims.kind === 'hospital') {
      const user = await db.hospitalUser.findUnique({
        where: { id: claims.sub },
        include: { role: { include: { permissions: true } }, hospital: true },
      });
      if (!user?.isActive || user.tokenVersion !== claims.tokenVersion) throw unauthorized('This hospital account is disabled or its session has expired.');
      if (user.hospitalId !== claims.hospitalId) throw unauthorized('The tenant claim is invalid.');
      req.auth = { kind: 'hospital', user, hospitalId: user.hospitalId, token };
    } else if (claims.kind === 'support') {
      const session = await db.supportAccessSession.findUnique({
        where: { id: claims.supportSessionId },
        include: { platformUser: true, hospital: true },
      });
      if (!session || session.endedAt || session.expiresAt <= new Date() || session.platformUserId !== claims.sub || session.hospitalId !== claims.hospitalId || !session.platformUser.isActive || session.platformUser.role !== 'SUPER_ADMIN' || session.platformUser.tokenVersion !== claims.tokenVersion) {
        throw unauthorized('The support-access session is invalid or has expired.');
      }
      req.auth = { kind: 'support', user: session.platformUser, hospitalId: session.hospitalId, supportSession: session, token };
    } else {
      throw unauthorized();
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePlatform(req, _res, next) {
  if (req.auth?.kind !== 'platform' || req.auth.user.role !== 'SUPER_ADMIN') return next(forbidden('Super Admin access is required.'));
  next();
}

export function requireHospital(req, _res, next) {
  if (!['hospital', 'support'].includes(req.auth?.kind)) return next(forbidden('Hospital tenant access is required.'));
  req.hospitalId = req.auth.hospitalId;
  next();
}

export function requirePasswordChangeCompleted(req, _res, next) {
  if (req.auth?.kind === 'hospital' && req.auth.user.mustChangePassword) {
    return next(new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change the temporary password before accessing hospital data.'));
  }
  next();
}

export function requireHospitalAdmin(req, _res, next) {
  if (req.auth?.kind !== 'hospital' || req.auth.user.role.key !== 'hospital_admin') return next(forbidden('Hospital Administrator access is required.'));
  next();
}
