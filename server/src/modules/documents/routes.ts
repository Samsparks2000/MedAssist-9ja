import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { gateway } from '../../adapters/payments.js';
import { db, one, query } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors.js';
import { findOwnFacility } from '../facilities/service.js';

/** Licences, registration certificates and photos submitted for verification (US-30). */
export const documentsRouter = Router();

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

export const DOCUMENT_KINDS = ['licence', 'shop_photo', 'registration_certificate', 'practising_licence', 'photo'] as const;

async function ownerTarget(userId: string, role: string) {
  if (role === 'specialist') {
    const s = await one('SELECT id FROM specialists WHERE user_id = $1', [userId]);
    if (!s) throw notFound('Create your profile first');
    return { facilityId: null as string | null, specialistId: s.id as string };
  }
  const f = await findOwnFacility(userId);
  if (!f) throw notFound('Register your facility first');
  return { facilityId: f.id, specialistId: null as string | null };
}

documentsRouter.post('/', requireAuth('pharmacy', 'hospital', 'specialist'), upload.single('file'), async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(DOCUMENT_KINDS) }), req.body);
  if (!req.file) throw badRequest('Attach a PDF, JPG or PNG up to 5 MB');
  const target = await ownerTarget(req.user!.id, req.user!.role);
  // One current file per kind: replacing removes the previous upload.
  await query(
    `DELETE FROM documents WHERE kind = $1 AND (facility_id = $2 OR specialist_id = $3)`,
    [kind, target.facilityId, target.specialistId],
  );
  const doc = await one(
    `INSERT INTO documents (facility_id, specialist_id, kind, filename, mime, size, data, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, kind, filename, size, created_at`,
    [target.facilityId, target.specialistId, kind, req.file.originalname.slice(0, 120), req.file.mimetype, req.file.size, req.file.buffer, req.user!.id],
  );
  res.status(201).json(doc);
});

documentsRouter.get('/:id', requireAuth(), async (req, res) => {
  const doc = await one('SELECT * FROM documents WHERE id = $1', [req.params.id]);
  if (!doc) throw notFound();
  if (req.user!.role !== 'admin') {
    const target = await ownerTarget(req.user!.id, req.user!.role).catch(() => null);
    if (!target || (doc.facility_id !== target.facilityId && doc.specialist_id !== target.specialistId)) throw forbidden();
  } else {
    await audit(db(), req.user!.id, 'document.view', 'document', doc.id);
  }
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(doc.data);
});

documentsRouter.delete('/:id', requireAuth('pharmacy', 'hospital', 'specialist'), async (req, res) => {
  const target = await ownerTarget(req.user!.id, req.user!.role);
  await query('DELETE FROM documents WHERE id = $1 AND (facility_id = $2 OR specialist_id = $3)', [req.params.id, target.facilityId, target.specialistId]);
  res.status(204).end();
});

/** Payout setup helpers used by registration and the Payouts page. */
export const payoutsRouter = Router();

payoutsRouter.get('/banks', async (_req, res) => {
  res.json(await gateway.listBanks());
});

payoutsRouter.post('/resolve', async (req, res) => {
  const b = parse(
    z.object({ bankCode: z.string().max(20), accountNumber: z.string().regex(/^\d{10}$/, 'Account numbers have 10 digits'), hint: z.string().max(120).optional() }),
    req.body,
  );
  try {
    res.json(await gateway.resolveAccount(b.bankCode, b.accountNumber, b.hint));
  } catch {
    throw badRequest('We could not find that account. Check the bank and number.');
  }
});
