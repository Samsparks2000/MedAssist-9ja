import { config } from '../../config.js';
import { type Db, one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { normalisePickupCode, pickupCode } from '../../lib/codes.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import { collectDeadline } from '../../lib/time.js';
import { drugLabel } from '../catalogue/service.js';
import { publishChange, touchFacility } from '../facilities/service.js';
import { allocateFefo, checkLowStock } from '../inventory/service.js';
import { notify, notifyFacilityOwner } from '../notifications/service.js';
import { processPendingRefunds, requestRefund } from '../payments/service.js';

/** Minutes an unpaid online reservation is held while the customer completes checkout. */
export const PAYMENT_WINDOW_MINUTES = 15;
/** Minutes a facility has to confirm a pay-at-pickup request before it lapses. */
export const CONFIRM_WINDOW_MINUTES = 30;

/** Statuses in which an order still holds stock (or a bed). */
export const ACTIVE_STATUSES = ['requested', 'pending_payment', 'paid', 'reserved'] as const;

export type PaymentMode = 'online' | 'at_pickup';

/** A pickup code not used by any of this facility's active orders. */
export async function freshPickupCode(c: Db, facilityId: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const code = pickupCode();
    const taken = await one(
      `SELECT 1 FROM orders WHERE facility_id = $1 AND pickup_code = $2 AND status = ANY($3)`,
      [facilityId, code, ACTIVE_STATUSES],
      c,
    );
    if (!taken) return code;
  }
  throw conflict('Could not allocate a pickup code; please try again');
}

/** The "collect by" time for a facility, honouring its opening hours. */
export async function collectByFor(c: Db, facilityId: string, from = new Date()): Promise<Date> {
  const f = await one('SELECT opening_hours, open_24h FROM facilities WHERE id = $1', [facilityId], c);
  return collectDeadline(f.opening_hours, f.open_24h, config.reservations.holdMinutes, from);
}

/**
 * US-22: reserves drug stock at one facility.
 *  - online: held for the payment window, then until the collect-by time once paid;
 *  - at_pickup: held while the facility confirms, then until the collect-by time.
 */
export async function createDrugOrder(userId: string, facilityId: string, lines: { drugId: string; quantity: number }[], mode: PaymentMode = 'online') {
  const order = await tx(async (c) => {
    const f = await one(`SELECT id, verification_status FROM facilities WHERE id = $1`, [facilityId], c);
    if (!f || f.verification_status !== 'approved') throw notFound('Facility not found');

    const items: { itemId: string; quantity: number; price: number; label: string }[] = [];
    let needsPrescription = false;
    for (const line of lines) {
      const drug = await one('SELECT brand_name, generic_name, strength, form FROM drug_catalogue WHERE id = $1', [line.drugId], c);
      if (!drug) throw badRequest('Unknown drug');
      const flags = await one(
        `SELECT bool_or(needs_prescription) AS rx, bool_and(allow_reservations) AS reservable
           FROM inventory_items WHERE facility_id = $1 AND drug_id = $2`,
        [facilityId, line.drugId],
        c,
      );
      if (flags?.reservable === false) throw conflict(`${drugLabel(drug)} cannot be reserved here; please call the pharmacy`);
      needsPrescription ||= !!flags?.rx;
      for (const a of await allocateFefo(c, facilityId, line.drugId, line.quantity)) {
        await query('UPDATE inventory_items SET reserved = reserved + $2, updated_at = now() WHERE id = $1', [a.itemId, a.quantity], c);
        items.push({ ...a, label: drugLabel(drug) });
      }
    }
    const total = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
    const o = await one(
      `INSERT INTO orders (user_id, facility_id, type, status, pickup_code, expires_at, total, payment_mode, needs_prescription)
       VALUES ($1, $2, 'drug', $3, $4, now() + make_interval(mins => $5), $6, $7, $8) RETURNING *`,
      [
        userId, facilityId, mode === 'online' ? 'pending_payment' : 'requested', await freshPickupCode(c, facilityId),
        mode === 'online' ? PAYMENT_WINDOW_MINUTES : CONFIRM_WINDOW_MINUTES, total, mode, needsPrescription,
      ],
      c,
    );
    for (const i of items) {
      await query(
        'INSERT INTO order_items (order_id, inventory_item_id, description, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)',
        [o.id, i.itemId, i.label, i.quantity, i.price],
        c,
      );
    }
    await touchFacility(c, facilityId);
    await audit(c, userId, 'order.reserve', 'order', o.id, { facilityId, lines, total, mode });
    await checkLowStock(c, facilityId, lines.map((l) => l.drugId));
    return o;
  });
  publishChange(facilityId, 'inventory');
  if (mode === 'at_pickup') {
    await notifyFacilityOwner(facilityId, {
      kind: 'reservation_request',
      title: 'New reservation · pay at pickup',
      body: `${order.total ? `₦${Number(order.total).toLocaleString('en-NG')} ` : ''}reservation waiting for your answer. Confirm or decline within ${CONFIRM_WINDOW_MINUTES} minutes.`,
      link: '/dashboard/reservations',
      channels: ['sms'],
    });
  }
  bus.publish('order.updated', { id: order.id, userId, facilityId, status: order.status });
  return order;
}

/** The facility confirms it has set the items aside (pay-at-pickup request or paid order). */
export async function confirmOrder(orderId: string, facilityId: string, actorId: string) {
  const order = await tx(async (c) => {
    const o = await one(`SELECT * FROM orders WHERE id = $1 AND facility_id = $2 FOR UPDATE`, [orderId, facilityId], c);
    if (!o) throw notFound('Order not found');
    if (o.status === 'requested') {
      const until = await collectByFor(c, facilityId);
      await query(
        `UPDATE orders SET status = 'reserved', confirmed_at = now(), expires_at = $2, updated_at = now() WHERE id = $1`,
        [o.id, until],
        c,
      );
    } else if (o.status === 'paid' && !o.confirmed_at) {
      await query(`UPDATE orders SET confirmed_at = now(), updated_at = now() WHERE id = $1`, [o.id], c);
    } else {
      throw conflict('This reservation is not waiting for confirmation');
    }
    await audit(c, actorId, 'order.confirm', 'order', o.id);
    return one('SELECT o.*, f.name AS facility_name FROM orders o JOIN facilities f ON f.id = o.facility_id WHERE o.id = $1', [o.id], c);
  });
  bus.publish('order.updated', { id: order.id, userId: order.user_id, facilityId, status: order.status });
  const until = new Date(order.expires_at).toLocaleTimeString('en-NG', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' });
  await notify({
    userId: order.user_id,
    kind: 'order_confirmed',
    title: `${order.facility_name} set your order aside`,
    body: `Show code ${order.pickup_code} at the counter before ${until}.${order.needs_prescription ? ' Bring your prescription.' : ''}`,
    link: `/orders/${order.id}`,
    channels: ['sms'],
  });
  return order;
}

/** Returns held stock (or a held bed) to the public listing. */
async function releaseHold(c: Db, orderId: string) {
  const items = await query('SELECT inventory_item_id, resource_id, quantity FROM order_items WHERE order_id = $1', [orderId], c);
  for (const it of items) {
    if (it.inventory_item_id) {
      await query('UPDATE inventory_items SET reserved = greatest(reserved - $2, 0), updated_at = now() WHERE id = $1', [it.inventory_item_id, it.quantity], c);
    }
    if (it.resource_id) {
      await query('UPDATE resources SET available = least(available + $2, capacity), updated_at = now() WHERE id = $1', [it.resource_id, it.quantity], c);
    }
  }
}

/**
 * Ends an active order without collection. Paid orders are refunded automatically (US-24).
 * `final` is 'cancelled' for user/facility action or 'expired' when a window lapsed.
 */
export async function endOrder(orderId: string, actorId: string | null, final: 'cancelled' | 'expired', reason: string) {
  const result = await tx(async (c) => {
    const o = await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], c);
    if (!o) throw notFound('Order not found');
    if (!(ACTIVE_STATUSES as readonly string[]).includes(o.status)) return null;
    await releaseHold(c, o.id);
    await query(`UPDATE orders SET status = $2, cancel_reason = $3, updated_at = now() WHERE id = $1`, [o.id, final, reason], c);
    let refunding = false;
    if (o.status === 'paid') {
      const p = await one(`SELECT id FROM payments WHERE order_id = $1 AND status = 'success'`, [o.id], c);
      if (p) {
        await requestRefund(c, p.id, reason);
        refunding = true;
      }
    }
    if (o.bed_request_id) {
      await query(`UPDATE bed_requests SET status = 'cancelled' WHERE id = $1 AND status = 'accepted'`, [o.bed_request_id], c);
    }
    await touchFacility(c, o.facility_id);
    await audit(c, actorId, `order.${final}`, 'order', o.id, { reason, refunding });
    return { order: o, refunding };
  });
  if (!result) return null;
  const { order, refunding } = result;
  publishChange(order.facility_id, order.type === 'bed' ? 'resource' : 'inventory');
  bus.publish('order.updated', { id: order.id, userId: order.user_id, facilityId: order.facility_id, status: final });
  await notify({
    userId: order.user_id,
    kind: 'order_ended',
    title: final === 'expired' ? 'Reservation expired' : 'Reservation cancelled',
    body: `${reason}.${refunding ? ' Your refund has been started and will reach you within 24 hours.' : ''}`,
    link: `/orders/${order.id}`,
    channels: refunding || actorId !== order.user_id ? ['sms'] : [],
  });
  if (actorId === order.user_id) {
    await notifyFacilityOwner(order.facility_id, {
      kind: 'order_cancelled',
      title: 'Reservation cancelled by customer',
      body: `Order ${order.pickup_code} was cancelled; it is available again.`,
      link: '/dashboard/reservations',
    });
  }
  if (refunding) await processPendingRefunds();
  return { refunding };
}

/**
 * US-26: the pharmacist (or hospital desk) enters the customer's code to hand over and close the order.
 * Pay-at-pickup orders are recorded as paid at the counter.
 */
export async function collectByCode(facilityId: string, actorId: string, code: string) {
  const order = await tx(async (c) => {
    const o = await one(
      `SELECT * FROM orders WHERE facility_id = $1 AND pickup_code = $2 AND status = ANY($3) FOR UPDATE`,
      [facilityId, normalisePickupCode(code), ACTIVE_STATUSES],
      c,
    );
    if (!o) throw notFound('No active order with that code');
    if (o.status === 'pending_payment') throw conflict('This order has not been paid yet');
    if (o.status === 'requested') throw conflict('Confirm this reservation first');
    if (new Date(o.expires_at) < new Date()) throw conflict('This reservation has expired');
    const items = await query('SELECT inventory_item_id, quantity FROM order_items WHERE order_id = $1', [o.id], c);
    for (const it of items) {
      if (!it.inventory_item_id) continue;
      await query(
        'UPDATE inventory_items SET quantity = quantity - $2, reserved = reserved - $2, updated_at = now() WHERE id = $1',
        [it.inventory_item_id, it.quantity],
        c,
      );
    }
    if (o.status === 'reserved') {
      await query(
        `INSERT INTO payments (order_id, reference, gateway, amount, platform_fee, facility_amount, method, status, paid_at)
         VALUES ($1, $2, 'counter', $3, 0, $3, 'counter', 'success', now())`,
        [o.id, `CTR-${o.pickup_code}-${Date.now().toString(36).toUpperCase()}`, o.total],
        c,
      );
    }
    await query(
      `UPDATE orders SET status = 'collected', collected_at = now(), confirmed_at = coalesce(confirmed_at, now()), updated_at = now() WHERE id = $1`,
      [o.id],
      c,
    );
    await touchFacility(c, facilityId);
    await audit(c, actorId, 'order.collected', 'order', o.id, { code, mode: o.payment_mode });
    return o;
  });
  bus.publish('order.updated', { id: order.id, userId: order.user_id, facilityId, status: 'collected' });
  await notify({
    userId: order.user_id,
    kind: 'order_collected',
    title: order.type === 'bed' ? 'Checked in' : 'Order collected',
    body: 'Thank you for using MedAssist-9ja. You can now rate this facility.',
    link: `/orders/${order.id}`,
  });
  return order;
}

/** Scheduler: ends requests nobody answered and reservations whose window has passed. */
export async function expireOverdueOrders(): Promise<number> {
  const due = await query<{ id: string; status: string }>(
    `SELECT id, status FROM orders WHERE status = ANY($1) AND expires_at < now() LIMIT 100`,
    [ACTIVE_STATUSES],
  );
  const reasons: Record<string, string> = {
    pending_payment: 'Payment was not completed in time',
    requested: 'The pharmacy did not confirm in time; please try another one',
    paid: 'Not collected within the reservation window',
    reserved: 'Not collected within the reservation window',
  };
  for (const o of due) await endOrder(o.id, null, 'expired', reasons[o.status]);
  return due.length;
}
