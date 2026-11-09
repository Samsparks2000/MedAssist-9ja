import { gateway, type PaymentChannel } from '../../adapters/payments.js';
import { config } from '../../config.js';
import { type Db, db, one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { paymentReference } from '../../lib/codes.js';
import { conflict, HttpError } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import { collectDeadline } from '../../lib/time.js';
import { notify, notifyFacilityOwner } from '../notifications/service.js';

const naira = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function splitAmount(amount: number) {
  const fee = Math.round(amount * config.payments.platformFeePercent) / 100;
  return { platformFee: fee, facilityAmount: Math.round((amount - fee) * 100) / 100 };
}

/** Starts a gateway checkout for an unpaid order (US-23). Card data never touches our servers (NFR-05). */
export async function startPayment(orderId: string, userId: string, choice: { method?: PaymentChannel; ussdBank?: string } = {}) {
  const order = await one(
    `SELECT o.*, f.payout_subaccount, u.email, u.phone FROM orders o
       JOIN facilities f ON f.id = o.facility_id JOIN users u ON u.id = o.user_id
      WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId],
  );
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'pending_payment') throw conflict('This order is not awaiting payment');
  if (new Date(order.expires_at) < new Date()) throw conflict('The reservation window has passed; please reserve again');

  const reference = paymentReference();
  const { platformFee, facilityAmount } = splitAmount(order.total);
  await query(
    `INSERT INTO payments (order_id, reference, gateway, amount, platform_fee, facility_amount, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'initialized')`,
    [order.id, reference, gateway.name, order.total, platformFee, facilityAmount],
  );
  const { authorizationUrl } = await gateway.initialize({
    reference,
    amountNaira: order.total,
    // Paystack requires an email; phone-only patients get a non-deliverable placeholder.
    email: order.email ?? `${order.phone.replace('+', '')}@customers.medassist-9ja.ng`,
    callbackUrl: `${config.webUrl}/orders/${order.id}?reference=${encodeURIComponent(reference)}`,
    subaccount: order.payout_subaccount,
    channel: choice.method,
    metadata: { orderId: order.id, ussdBank: choice.ussdBank },
  });
  return { reference, authorizationUrl };
}

async function issueReceipt(paymentId: string) {
  const p = await one(
    `SELECT p.reference, p.amount, p.method, o.id AS order_id, o.user_id, o.facility_id, o.pickup_code, o.type,
            o.expires_at, f.name AS facility_name
       FROM payments p JOIN orders o ON o.id = p.order_id JOIN facilities f ON f.id = o.facility_id
      WHERE p.id = $1`,
    [paymentId],
  );
  if (!p) return;
  const until = new Date(p.expires_at).toLocaleString('en-NG', { timeZone: config.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  await notify({
    userId: p.user_id,
    kind: 'receipt',
    title: 'Payment received',
    body: `${naira(p.amount)} paid to ${p.facility_name} (ref ${p.reference}). Pickup code ${p.pickup_code}, held until ${until}.`,
    link: `/orders/${p.order_id}`,
    channels: ['sms', 'email'],
  });
  await notifyFacilityOwner(p.facility_id, {
    kind: 'order_paid',
    title: p.type === 'bed' ? 'Bed deposit paid' : 'New paid reservation',
    body: `${naira(p.amount)} paid (ref ${p.reference}). The customer will show pickup code on arrival.`,
    link: '/dashboard/orders',
  });
}

/** Applies a confirmed charge. Idempotent: replays of the same webhook do nothing. */
export async function applyChargeSuccess(reference: string, amountNaira: number, method: string | null) {
  const outcome = await tx(async (c) => {
    const p = await one('SELECT * FROM payments WHERE reference = $1 FOR UPDATE', [reference], c);
    if (!p) return { kind: 'unknown' as const };
    if (p.status !== 'initialized' && p.status !== 'failed') return { kind: 'duplicate' as const };
    if (Math.abs(amountNaira - p.amount) > 0.009) {
      await audit(c, null, 'payment.amount_mismatch', 'payment', p.id, { expected: p.amount, got: amountNaira });
      return { kind: 'mismatch' as const };
    }
    await query(`UPDATE payments SET status = 'success', method = $2, paid_at = now() WHERE id = $1`, [p.id, method], c);
    const order = await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [p.order_id], c);
    await audit(c, order.user_id, 'payment.success', 'payment', p.id, { reference, amount: amountNaira, method });

    if (order.status === 'pending_payment' && new Date(order.expires_at) > new Date()) {
      const f = await one('SELECT opening_hours, open_24h FROM facilities WHERE id = $1', [order.facility_id], c);
      await query(
        `UPDATE orders SET status = 'paid', expires_at = $2, updated_at = now() WHERE id = $1`,
        [order.id, collectDeadline(f.opening_hours, f.open_24h, config.reservations.holdMinutes)],
        c,
      );
      return { kind: 'paid' as const, paymentId: p.id, order };
    }
    // Paid after the hold lapsed, or paid twice: money goes straight back (US-24).
    await requestRefund(c, p.id, order.status === 'paid' ? 'Duplicate payment' : 'Reservation was no longer active');
    return { kind: 'refund' as const, paymentId: p.id, order };
  });

  if (outcome.kind === 'paid') {
    bus.publish('order.updated', { id: outcome.order.id, userId: outcome.order.user_id, facilityId: outcome.order.facility_id, status: 'paid' });
    await issueReceipt(outcome.paymentId);
  }
  if (outcome.kind === 'refund') await processPendingRefunds();
  return outcome.kind;
}

export async function applyChargeFailed(reference: string) {
  await query(`UPDATE payments SET status = 'failed' WHERE reference = $1 AND status = 'initialized'`, [reference]);
}

/** Verifies and applies a gateway webhook. Throws 401 on a bad signature. */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
  if (!gateway.verifySignature(rawBody, signature)) throw new HttpError(401, 'Invalid signature');
  const event = JSON.parse(rawBody.toString('utf8')) as { event: string; data: { reference: string } };
  const reference = event.data?.reference;
  if (!reference) return 'ignored';
  if (event.event === 'charge.success') {
    // Never trust the webhook payload alone: confirm with the gateway.
    const verified = await gateway.verify(reference);
    if (verified.status !== 'success') return 'unverified';
    return applyChargeSuccess(reference, verified.amountNaira, verified.method);
  }
  if (event.event === 'charge.failed') {
    await applyChargeFailed(reference);
    return 'failed';
  }
  return 'ignored';
}

/** Callback-page fallback when a webhook is delayed: ask the gateway directly. */
export async function verifyReference(reference: string) {
  const p = await one('SELECT status FROM payments WHERE reference = $1', [reference]);
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.status === 'initialized') {
    const v = await gateway.verify(reference);
    if (v.status === 'success') await applyChargeSuccess(reference, v.amountNaira, v.method);
    if (v.status === 'failed') await applyChargeFailed(reference);
  }
  return one('SELECT reference, status, amount, method, paid_at FROM payments WHERE reference = $1', [reference]);
}

/** Marks a successful payment for refund; processPendingRefunds sends it (due within 24 h). */
export async function requestRefund(client: Db, paymentId: string, reason: string) {
  await query(
    `UPDATE payments SET status = 'refund_pending', refund_due_at = now() + interval '24 hours'
      WHERE id = $1 AND status = 'success'`,
    [paymentId],
    client,
  );
  await audit(client, null, 'payment.refund_requested', 'payment', paymentId, { reason });
}

export async function processPendingRefunds(): Promise<number> {
  const pending = await query(
    `SELECT p.id, p.reference, p.amount, o.user_id, o.id AS order_id FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'refund_pending' ORDER BY p.refund_due_at LIMIT 50`,
    [],
    db(),
  );
  let done = 0;
  for (const p of pending) {
    try {
      const { refundReference } = await gateway.refund(p.reference, p.amount);
      const updated = await one(
        `UPDATE payments SET status = 'refunded', refunded_at = now(), refund_reference = $2
          WHERE id = $1 AND status = 'refund_pending' RETURNING id`,
        [p.id, refundReference],
      );
      if (!updated) continue;
      await audit(db(), null, 'payment.refunded', 'payment', p.id, { refundReference, amount: p.amount });
      await notify({
        userId: p.user_id,
        kind: 'refund',
        title: 'Refund issued',
        body: `${naira(p.amount)} for payment ${p.reference} has been refunded (ref ${refundReference}).`,
        link: `/orders/${p.order_id}`,
        channels: ['sms'],
      });
      done++;
    } catch (err) {
      // Left as refund_pending; the scheduler retries.
      console.error(`Refund for ${p.reference} failed`, err);
    }
  }
  return done;
}
