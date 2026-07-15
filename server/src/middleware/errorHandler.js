import multer from 'multer';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `No API route matches ${req.method} ${req.originalUrl}.` } });
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid data.', details: error.issues } });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: error.message } });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with the same unique value already exists.', details: error.meta } });
    if (error.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
  }
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
  }
  console.error(error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message, stack: error.stack } });
}
