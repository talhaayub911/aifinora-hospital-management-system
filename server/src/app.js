import './config/env.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { requireAuth, requireHospital, requirePasswordChangeCompleted, requirePlatform } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sanitizeJsonResponses } from './middleware/sanitizeResponse.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createHospitalRouter } from './routes/hospital.routes.js';
import { createPublicRouter } from './routes/public.routes.js';
import { createSuperAdminRouter } from './routes/superAdmin.routes.js';
import { createWebhookRouter } from './routes/webhook.routes.js';
import { getEmailDeliveryStatus } from './services/email/email.service.js';

export function createApp({ prismaClient = prisma } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.prisma = prismaClient;
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.clientOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(sanitizeJsonResponses);

  app.get('/api/health', (_req, res) => res.json({
    data: {
      status: 'ok',
      service: 'ai-finora-api',
      timestamp: new Date().toISOString(),
      notifications: {
        inApp: { enabled: true },
        email: getEmailDeliveryStatus(),
      },
    },
  }));
  app.use('/api/auth', createAuthRouter());
  app.use('/api', createPublicRouter());
  app.use('/api/webhooks', createWebhookRouter());
  app.use('/api/hospital', requireAuth, requirePasswordChangeCompleted, requireHospital, createHospitalRouter());
  app.use('/api/super-admin', requireAuth, requirePlatform, createSuperAdminRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
export default app;
