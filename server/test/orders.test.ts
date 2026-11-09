import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { one, query } from '../src/db/pool.js';
import { expireOverdueOrders } from '../src/modules/orders/service.js';
import { auth, drugId, facilityId, http, IKEJA, patientToken, providerToken, useDb } from './helpers.js';

useDb();

async function reserve(token: string, facility: string, drug: string, quantity = 1) {
  return http().post('/api/orders').set(auth(token)).send({ facilityId: facility, items: [{ drugId: drug, quantity }] });
}

async function payWithMock(token: string, orderId: string, success = true) {
  const start = await http().post(`/api/orders/${orderId}/pay`).set(auth(token));
  expect(start.status).toBe(200);
  const reference = start.body.reference as string;
  const done = await http().post(`/api/payments/mock/${reference}/complete`).send({ method: 'ussd', success });
  expect(done.status).toBe(200);
  return reference;
}

describe('reservation and payment (US-22 – US-26)', () => {
  it('never sells the last unit twice under concurrent reservations (NFR-09)', async () => {
    const facility = await facilityId('ikeja-central');
    const epipen = await drugId('EpiPen', '0.3mg'); // seeded with 2 units
    const tokens = await Promise.all([patientToken(), patientToken(), patientToken()]);
    const results = await Promise.all(tokens.map((t) => reserve(t, facility, epipen)));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 201, 409]);

    // Fully reserved stock disappears from search (US-17, US-27).
    const res = await http().get('/api/search').query({ target: `drug-id:${epipen}`, ...IKEJA });
    expect(res.body.results.map((r: any) => r.facility.id)).not.toContain(facility);
  });

  it('runs the full paid reservation: pay → receipt → pickup code → collect', async () => {
    const patient = await patientToken();
    const facility = await facilityId('tunde');
    const coartem = await drugId('Coartem', '80/480mg');
    const before = await one('SELECT sum(quantity)::int AS q, sum(reserved)::int AS r FROM inventory_items WHERE facility_id = $1 AND drug_id = $2', [facility, coartem]);

    const order = await reserve(patient, facility, coartem, 2);
    expect(order.status).toBe(201);
    expect(order.body.status).toBe('pending_payment');
    expect(order.body.pickup_code).toBeNull(); // hidden until paid
    expect(order.body.total).toBe(7600);

    const reference = await payWithMock(patient, order.body.id);
    const paid = await http().get(`/api/orders/${order.body.id}`).set(auth(patient));
    expect(paid.body.status).toBe('paid');
    expect(paid.body.pickup_code).toMatch(/^MA-\d{4}$/);
    expect(paid.body.payments[0]).toMatchObject({ reference, status: 'success', method: 'ussd', amount: 7600 });
    // Hold window restarts on payment.
    const holdMs = new Date(paid.body.expires_at).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan((config.reservations.holdMinutes - 2) * 60_000);

    const notes = await http().get('/api/notifications').set(auth(patient));
    expect(notes.body.items.some((n: any) => n.kind === 'receipt' && n.body.includes(reference))).toBe(true);

    // Settlement split for the facility (US-25).
    const pharmacist = await providerToken('tunde');
    const settlements = await http().get('/api/payments/settlements').set(auth(pharmacist));
    const row = settlements.body.payments.find((p: any) => p.reference === reference);
    expect(row.platform_fee + row.facility_amount).toBeCloseTo(7600, 2);

    const wrong = await http().post('/api/facility-orders/collect').set(auth(pharmacist)).send({ code: 'ZZZZZZ' });
    expect(wrong.status).toBe(404);
    // Pharmacists may type just the digits.
    const collect = await http().post('/api/facility-orders/collect').set(auth(pharmacist)).send({ code: paid.body.pickup_code.slice(3) });
    expect(collect.status).toBe(200);

    const after = await one('SELECT sum(quantity)::int AS q, sum(reserved)::int AS r FROM inventory_items WHERE facility_id = $1 AND drug_id = $2', [facility, coartem]);
    expect(after.q).toBe(before.q - 2);
    expect(after.r).toBe(before.r);

    // Rating is allowed once the order is collected (US-06).
    const rate = await http().post('/api/feedback').set(auth(patient)).send({ type: 'rating', orderId: order.body.id, score: 5 });
    expect(rate.status).toBe(201);
  });

  it('refunds automatically when a paid order is cancelled (US-24)', async () => {
    const patient = await patientToken();
    const order = await reserve(patient, await facilityId('maryland-247'), await drugId('Solu-Cortef', '100mg'));
    const reference = await payWithMock(patient, order.body.id);

    const cancel = await http().post(`/api/orders/${order.body.id}/cancel`).set(auth(patient));
    expect(cancel.body).toEqual({ cancelled: true, refunding: true });
    const p = await one('SELECT status, refund_reference FROM payments WHERE reference = $1', [reference]);
    expect(p.status).toBe('refunded');
    expect(p.refund_reference).toBeTruthy();
    const item = await one('SELECT reserved FROM inventory_items i JOIN orders o ON o.facility_id = i.facility_id WHERE o.id = $1 AND i.drug_id = $2', [order.body.id, await drugId('Solu-Cortef', '100mg')]);
    expect(item.reserved).toBe(0);
  });

  it('refunds when the facility cannot fulfil, and when the hold expires uncollected', async () => {
    const patient = await patientToken();
    const facility = await facilityId('maryland-247');
    const panadol = await drugId('Panadol', '500mg');

    const a = await reserve(patient, facility, panadol, 3);
    await payWithMock(patient, a.body.id);
    const pharmacist = await providerToken('maryland-247');
    const cancel = await http().post(`/api/facility-orders/${a.body.id}/cancel`).set(auth(pharmacist)).send({ reason: 'Stock damaged' });
    expect(cancel.body.refunding).toBe(true);

    const b = await reserve(patient, facility, panadol, 1);
    const refB = await payWithMock(patient, b.body.id);
    await query(`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`, [b.body.id]);
    expect(await expireOverdueOrders()).toBeGreaterThanOrEqual(1);
    const order = await http().get(`/api/orders/${b.body.id}`).set(auth(patient));
    expect(order.body.status).toBe('expired');
    const pay = await one('SELECT status FROM payments WHERE reference = $1', [refB]);
    expect(pay.status).toBe('refunded');
  });

  it('rejects forged webhooks and ignores replays', async () => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'nope' } });
    const forged = await http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', 'bad').send(body);
    expect(forged.status).toBe(401);

    const patient = await patientToken();
    const order = await reserve(patient, await facilityId('tunde'), await drugId('Panadol', '500mg'));
    const reference = await payWithMock(patient, order.body.id);
    const replay = JSON.stringify({ event: 'charge.success', data: { reference } });
    const sig = crypto.createHmac('sha512', config.payments.secretKey).update(replay).digest('hex');
    const res = await http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(replay);
    expect(res.body.result).toBe('duplicate');
  });

  it('releases unpaid reservations after the payment window', async () => {
    const patient = await patientToken();
    const facility = await facilityId('tunde');
    const glucophage = await drugId('Glucophage', '500mg');
    const order = await reserve(patient, facility, glucophage, 5);
    const held = await one('SELECT sum(reserved)::int AS r FROM inventory_items WHERE facility_id = $1 AND drug_id = $2', [facility, glucophage]);
    expect(held.r).toBe(5);
    await query(`UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1`, [order.body.id]);
    await expireOverdueOrders();
    const released = await one('SELECT sum(reserved)::int AS r FROM inventory_items WHERE facility_id = $1 AND drug_id = $2', [facility, glucophage]);
    expect(released.r).toBe(0);
  });

  it('only lets patients see their own orders', async () => {
    const a = await patientToken();
    const b = await patientToken();
    const order = await reserve(a, await facilityId('tunde'), await drugId('Panadol', '500mg'));
    expect((await http().get(`/api/orders/${order.body.id}`).set(auth(b))).status).toBe(404);
    expect((await http().get('/api/orders')).status).toBe(401);
  });
});
