import { Router } from 'express';
import { z } from 'zod';
import { type Db, one, query, tx } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { conflict, notFound, parse } from '../../lib/errors.js';

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth('patient'));

/** FR-14: reliability = Bayesian average of ratings (prior 0.5 weighted as 3 ratings), scaled to 0–1. */
export async function recomputeReliability(c: Db, facilityId: string) {
  await query(
    `UPDATE facilities SET reliability_score = (
       SELECT round(((1.5 + coalesce(sum((score - 1) / 4.0), 0)) / (3 + count(*)))::numeric, 3)
         FROM feedback WHERE facility_id = $1 AND type = 'rating')
     WHERE id = $1`,
    [facilityId],
    c,
  );
}

feedbackRouter.post('/', async (req, res) => {
  const body = parse(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('rating'), orderId: z.uuid(), score: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() }),
      z.object({
        type: z.literal('complaint'),
        facilityId: z.uuid(),
        orderId: z.uuid().optional(),
        category: z.enum(['Refund', 'Wrong stock', 'Contact', 'Price', 'Service', 'Other']).default('Other'),
        comment: z.string().trim().min(10).max(1000),
      }),
    ]),
    req.body,
  );
  if (body.type === 'rating') {
    // US-06: only after a completed reservation.
    const order = await one(`SELECT facility_id, status FROM orders WHERE id = $1 AND user_id = $2`, [body.orderId, req.user!.id]);
    if (!order) throw notFound('Order not found');
    if (order.status !== 'collected') throw conflict('You can rate a facility after your order is collected');
    const row = await tx(async (c) => {
      const exists = await one(`SELECT 1 FROM feedback WHERE order_id = $1 AND type = 'rating'`, [body.orderId], c);
      if (exists) throw conflict('You already rated this order');
      const r = await one(
        `INSERT INTO feedback (user_id, facility_id, order_id, type, score, comment) VALUES ($1, $2, $3, 'rating', $4, $5) RETURNING *`,
        [req.user!.id, order.facility_id, body.orderId, body.score, body.comment ?? null],
        c,
      );
      await recomputeReliability(c, order.facility_id);
      return r;
    });
    res.status(201).json(row);
    return;
  }
  const facility = await one('SELECT id FROM facilities WHERE id = $1', [body.facilityId]);
  if (!facility) throw notFound('Facility not found');
  const row = await one(
    `INSERT INTO feedback (user_id, facility_id, order_id, type, comment, category) VALUES ($1, $2, $3, 'complaint', $4, $5) RETURNING *`,
    [req.user!.id, body.facilityId, body.orderId ?? null, body.comment, body.category],
  );
  res.status(201).json(row);
});
