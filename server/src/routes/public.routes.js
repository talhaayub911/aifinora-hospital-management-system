import { Router } from 'express';
import { asyncHandler, badRequest } from '../utils/errors.js';
import { normalizeReference } from '../utils/format.js';

const masked = (value) => value.length < 6 ? '***' : `${value.slice(0, 3)}***${value.slice(-3)}`;

export function createPublicRouter() {
  const router = Router();
  router.get('/payments/status', asyncHandler(async (req, res) => {
    const reference = String(req.query.reference || req.query.invoice || '').trim();
    if (!reference) throw badRequest('A payment or invoice reference is required.');
    const db = req.app.locals.prisma;
    const normalized = normalizeReference(reference);
    const proof = await db.bankTransferProof.findFirst({
      where: { OR: [{ normalizedReference: normalized }, { invoice: { invoiceNumber: reference } }] },
      orderBy: { submittedAt: 'desc' },
      include: { invoice: { select: { invoiceNumber: true, status: true } } },
    });
    const payment = await db.subscriptionPayment.findFirst({
      where: { OR: [{ normalizedReference: normalized }, { invoice: { invoiceNumber: reference } }] },
      include: { invoice: { select: { invoiceNumber: true, status: true } } },
    });
    if (!proof && !payment) return res.json({ data: { found: false, reference: masked(reference), status: 'NOT_FOUND' } });
    res.json({ data: {
      found: true,
      reference: masked(reference),
      status: payment ? 'APPROVED' : proof.status,
      invoiceNumber: payment?.invoice.invoiceNumber || proof.invoice.invoiceNumber,
      invoiceStatus: payment?.invoice.status || proof.invoice.status,
      submittedAt: proof?.submittedAt || null,
      paidAt: payment?.paidAt || null,
    } });
  }));
  return router;
}
