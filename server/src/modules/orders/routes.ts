import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_CHANNELS } from '../../adapters/payments.js';
import { one, query } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { notFound, parse } from '../../lib/errors.js';
import { haversineKm } from '../../lib/geo.js';
import { ownFacility } from '../facilities/service.js';
import { startPayment } from '../payments/service.js';
import { ACTIVE_STATUSES, collectByCode, confirmOrder, createDrugOrder, endOrder } from './service.js';

export const ordersRouter = Router();

const orderSelect = `
  SELECT o.*, f.name AS facility_name, f.address AS facility_address, f.phone AS facility_phone, f.landmark AS facility_landmark,
         f.area AS facility_area, f.lat AS facility_lat, f.lng AS facility_lng, u.phone AS customer_phone,
         (SELECT json_agg(json_build_object('description', oi.description, 'quantity', oi.quantity, 'unitPrice', oi.unit_price,
                 'drugId', (SELECT i.drug_id FROM inventory_items i WHERE i.id = oi.inventory_item_id)))
            FROM order_items oi WHERE oi.order_id = o.id) AS items,
         (SELECT json_agg(json_build_object('reference', p.reference, 'status', p.status, 'amount', p.amount, 'method', p.method,
                 'gateway', p.gateway, 'paidAt', p.paid_at, 'refundedAt', p.refunded_at, 'refundReference', p.refund_reference,
                 'refundDueAt', p.refund_due_at) ORDER BY p.created_at DESC)
            FROM payments p WHERE p.order_id = o.id AND p.status <> 'initialized') AS payments,
         EXISTS (SELECT 1 FROM feedback fb WHERE fb.order_id = o.id AND fb.type = 'rating') AS rated
    FROM orders o JOIN facilities f ON f.id = o.facility_id JOIN users u ON u.id = o.user_id`;

/** Hides the pickup code until the order is paid or confirmed, so only a real customer can collect. */
function forCustomer(o: any) {
  const show = ['paid', 'reserved', 'collected'].includes(o.status);
  return { ...o, pickup_code: show ? o.pickup_code : null };
}

ordersRouter.post('/', requireAuth('patient'), async (req, res) => {
  const body = parse(
    z.object({
      facilityId: z.uuid(),
      items: z.array(z.object({ drugId: z.uuid(), quantity: z.number().int().min(1).max(100) })).min(1).max(10),
      paymentMode: z.enum(['online', 'at_pickup']).default('online'),
    }),
    req.body,
  );
  const order = await createDrugOrder(req.user!.id, body.facilityId, body.items, body.paymentMode);
  res.status(201).json(forCustomer(order));
});

ordersRouter.get('/', requireAuth('patient'), async (req, res) => {
  const rows = await query(`${orderSelect} WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [req.user!.id]);
  res.json(rows.map(forCustomer));
});

ordersRouter.get('/:id', requireAuth('patient'), async (req, res) => {
  const o = await one(`${orderSelect} WHERE o.id = $1 AND o.user_id = $2`, [req.params.id, req.user!.id]);
  if (!o) throw notFound('Order not found');
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const distanceKm = Number.isFinite(lat) && Number.isFinite(lng) ? Math.round(haversineKm({ lat, lng }, { lat: o.facility_lat, lng: o.facility_lng }) * 10) / 10 : null;
  res.json({ ...forCustomer(o), distanceKm });
});

ordersRouter.post('/:id/pay', requireAuth('patient'), async (req, res) => {
  const choice = parse(
    z.object({ method: z.enum(PAYMENT_CHANNELS).optional(), ussdBank: z.string().trim().max(40).optional() }),
    req.body ?? {},
  );
  res.json(await startPayment(req.params.id as string, req.user!.id, choice));
});

ordersRouter.post('/:id/cancel', requireAuth('patient'), async (req, res) => {
  const o = await one('SELECT id FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  if (!o) throw notFound('Order not found');
  const result = await endOrder(o.id, req.user!.id, 'cancelled', 'Cancelled by you');
  res.json({ cancelled: !!result, refunding: result?.refunding ?? false });
});

/* Facility side */

export const facilityOrdersRouter = Router();
facilityOrdersRouter.use(requireAuth('pharmacy', 'hospital'));

/** "Amaka O." and "0812 *** 4410": enough for the counter, without exposing full details. */
const shortName = (n: string | null) => {
  if (!n) return 'Customer';
  const [first, last] = n.split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
};
const maskPhone = (p: string) => `0${p.slice(4, 7)} *** ${p.slice(-4)}`;

facilityOrdersRouter.get('/', async (req, res) => {
  const f = await ownFacility(req.user!);
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const active = req.query.active === 'true';
  const rows = await query(
    `SELECT o.id, o.type, o.status, o.total, o.expires_at, o.created_at, o.cancel_reason, o.payment_mode, o.confirmed_at,
            o.needs_prescription, o.pickup_code, u.name AS customer_name, u.phone AS customer_phone,
            (SELECT json_agg(json_build_object('description', oi.description, 'quantity', oi.quantity, 'unitPrice', oi.unit_price))
               FROM order_items oi WHERE oi.order_id = o.id) AS items
       FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.facility_id = $1 AND ($2::text IS NULL OR o.status = $2) AND (NOT $3 OR o.status = ANY($4))
      ORDER BY (o.status = 'requested') DESC, o.created_at DESC LIMIT 200`,
    [f.id, status, active, ACTIVE_STATUSES],
  );
  res.json(
    rows.map((r) => ({
      ...r,
      customer_name: shortName(r.customer_name),
      customer_phone: maskPhone(r.customer_phone),
      // The counter needs the code only once the order can be collected.
      pickup_code: ['paid', 'reserved'].includes(r.status) ? r.pickup_code : null,
      needs_answer: r.status === 'requested' || (r.status === 'paid' && !r.confirmed_at),
    })),
  );
});

facilityOrdersRouter.post('/collect', async (req, res) => {
  const f = await ownFacility(req.user!);
  const { code } = parse(z.object({ code: z.string().trim().min(4).max(12) }), req.body);
  const o = await collectByCode(f.id, req.user!.id, code);
  res.json({ id: o.id, status: 'collected', total: o.total, paymentMode: o.payment_mode });
});

/** "Confirm and set aside": answers a pay-at-pickup request, or acknowledges a paid order. */
facilityOrdersRouter.post('/:id/confirm', async (req, res) => {
  const f = await ownFacility(req.user!);
  const o = await confirmOrder(req.params.id as string, f.id, req.user!.id);
  res.json({ id: o.id, status: o.status, expiresAt: o.expires_at });
});

/** US-24: the facility declines or cancels; paid customers are refunded automatically. */
facilityOrdersRouter.post('/:id/cancel', async (req, res) => {
  const f = await ownFacility(req.user!);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  const o = await one('SELECT id FROM orders WHERE id = $1 AND facility_id = $2', [req.params.id, f.id]);
  if (!o) throw notFound('Order not found');
  const result = await endOrder(o.id, req.user!.id, 'cancelled', `Declined by the pharmacy: ${reason}`);
  res.json({ cancelled: !!result, refunding: result?.refunding ?? false });
});
