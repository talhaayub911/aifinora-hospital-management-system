import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

const acceptedTypes = new Set(['image/png', 'image/jpeg', 'application/pdf']);

const startsWith = (buffer, signature) => signature.every((byte, index) => buffer[index] === byte);

export function validatePaymentProofFile(file) {
  if (!file?.buffer || !acceptedTypes.has(file.mimetype)) return false;
  if (file.mimetype === 'image/png') return startsWith(file.buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (file.mimetype === 'image/jpeg') return startsWith(file.buffer, [0xff, 0xd8, 0xff]);
  if (file.mimetype === 'application/pdf') return startsWith(file.buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  return false;
}

export const paymentProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.maxUploadBytes },
  fileFilter: (_req, file, done) => {
    if (!acceptedTypes.has(file.mimetype)) return done(badRequest('Payment proof must be a PNG, JPEG, or PDF file.'));
    done(null, true);
  },
}).single('proof');
