import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';
const nodeEnv = process.env.NODE_ENV || 'development';
const demoMode = String(process.env.DEMO_MODE ?? (nodeEnv === 'production' ? 'false' : 'true')).toLowerCase() === 'true';
const emailProvider = String(process.env.EMAIL_PROVIDER || (nodeEnv === 'production' ? 'disabled' : 'local_simulation')).trim().toLowerCase();

export const env = Object.freeze({
  nodeEnv,
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'local-demo-change-this-secret-before-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  rememberMeExpiresIn: process.env.REMEMBER_ME_EXPIRES_IN || '30d',
  clientOrigin: process.env.CLIENT_ORIGIN || process.env.APP_BASE_URL || 'http://localhost:5173',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  demoMode,
  maxLoginAttempts: Math.max(3, Number(process.env.MAX_LOGIN_ATTEMPTS || 5)),
  loginLockMinutes: Math.max(1, Number(process.env.LOGIN_LOCK_MINUTES || 15)),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(serverRoot, 'storage', 'payment-proofs')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
  safepayPublicKey: process.env.SAFEPAY_PUBLIC_KEY || '',
  safepaySecretKey: process.env.SAFEPAY_SECRET_KEY || '',
  safepayWebhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET || '',
  safepayEnvironment: process.env.SAFEPAY_ENVIRONMENT || 'sandbox',
  safepayDemoMode: String(process.env.SAFEPAY_DEMO_MODE ?? demoMode).toLowerCase() === 'true',
  safepayWebhookVerificationMode: process.env.SAFEPAY_WEBHOOK_VERIFICATION_MODE || 'structural_hmac_demo',
  safepayApiBaseUrl: process.env.SAFEPAY_API_BASE_URL || '',
  safepayCreateLinkUrl: process.env.SAFEPAY_CREATE_LINK_URL || '',
  emailProvider,
});

const normalizedJwtSecret = env.jwtSecret.trim().toLowerCase();
const unsafeJwtSecret = [
  'local-demo',
  'replace',
  'change-me',
  'changeme',
  'default',
  'example',
  'placeholder',
].some((marker) => normalizedJwtSecret.startsWith(marker));

if (env.nodeEnv === 'production' && (unsafeJwtSecret || env.jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be a unique secret of at least 32 characters in production.');
}
if (env.nodeEnv === 'production' && env.demoMode) {
  throw new Error('DEMO_MODE must be disabled in production.');
}
if (env.nodeEnv === 'production' && env.safepayDemoMode) {
  throw new Error('SAFEPAY_DEMO_MODE must be disabled in production.');
}
if (!['disabled', 'local_simulation'].includes(env.emailProvider)) {
  throw new Error('EMAIL_PROVIDER must be disabled or local_simulation in this build. A real provider adapter must be implemented before selecting it.');
}
