import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { normalisePhone } from '../../lib/codes.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors.js';
import { ownFacility } from '../facilities/service.js';
import { BED_TYPES } from '../search/vocabulary.js';
import { acceptRequest, cancelRequest, createBedRequest, forwardRequest } from './service.js';

export const bedRequestsRouter = Router();

// Guests may request a bed in an emergency (US-01); they get an access token for status.
bedRequestsRouter.post('/', async (req, res) => {
  const body = parse(
    z.object({
      patientName: z.string().trim().min(2).max(80),
      contactPhone: z.string(),
      subType: z.enum(BED_TYPES),
      notes: z.string().trim().max(300).optional(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    req.body,
  );
  const phone = normalisePhone(body.contactPhone);
  if (!phone) throw badRequest('Enter a valid Nigerian phone number');
  const r = await createBedRequest({ ...body, contactPhone: phone, userId: req.user?.id ?? null });
  res.status(201).json({ id: r.id, accessToken: r.access_token });
});

const requestSelect = `
  SELECT b.id, b.patient_name, b.sub_type, b.status, b.respond_by, b.responded_at, b.created_at, b.notes,
         cardinality(b.tried_facility_ids) AS forwards,
         f.id AS facility_id, f.name AS facility_name, f.phone AS facility_phone, f.address AS facility_address,
         f.lat AS facility_lat, f.lng AS facility_lng,
         (SELECT o.id FROM orders o WHERE o.bed_request_id = b.id ORDER BY o.created_at DESC LIMIT 1) AS order_id
    FROM bed_requests b LEFT JOIN facilities f ON f.id = b.facility_id`;

async function authorised(id: string, userId: string | undefined, accessToken: unknown) {
  const r = await one('SELECT id, user_id, access_token FROM bed_requests WHERE id = $1', [id]);
  if (!r) throw notFound('Request not found');
  if (!(userId && r.user_id === userId) && accessToken !== r.access_token) throw forbidden();
  return r;
}

bedRequestsRouter.get('/mine', requireAuth('patient'), async (req, res) => {
  res.json(await query(`${requestSelect} WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 50`, [req.user!.id]));
});

/** Hospital inbox: requests currently waiting on this hospital plus recent accepted ones. */
bedRequestsRouter.get('/incoming', requireAuth('hospital'), async (req, res) => {
  const f = await ownFacility(req.user!);
  res.json(
    await query(
      `SELECT b.id, b.patient_name, b.contact_phone, b.sub_type, b.notes, b.status, b.respond_by, b.responded_at, b.created_at,
              b.lat, b.lng
         FROM bed_requests b
        WHERE b.facility_id = $1 AND (b.status = 'pending' OR b.created_at > now() - interval '2 days')
        ORDER BY (b.status = 'pending') DESC, b.created_at DESC`,
      [f.id],
    ),
  );
});

bedRequestsRouter.post('/:id/accept', requireAuth('hospital'), async (req, res) => {
  const f = await ownFacility(req.user!);
  const { order } = await acceptRequest(req.params.id as string, f.id, req.user!.id);
  res.json({ accepted: true, depositOrderId: order?.id ?? null });
});

bedRequestsRouter.post('/:id/decline', requireAuth('hospital'), async (req, res) => {
  const f = await ownFacility(req.user!);
  const r = await one(`SELECT id FROM bed_requests WHERE id = $1 AND facility_id = $2 AND status = 'pending'`, [req.params.id, f.id]);
  if (!r) throw notFound('This request is no longer waiting for you');
  await forwardRequest(r.id, 'Declined by hospital');
  res.json({ forwarded: true });
});

bedRequestsRouter.get('/:id', async (req, res) => {
  await authorised(req.params.id as string, req.user?.id, req.query.token);
  res.json(await one(`${requestSelect} WHERE b.id = $1`, [req.params.id]));
});

bedRequestsRouter.post('/:id/cancel', async (req, res) => {
  await authorised(req.params.id as string, req.user?.id, req.query.token ?? req.body?.token);
  await cancelRequest(req.params.id as string, req.user?.id ?? null);
  res.json({ cancelled: true });
});
