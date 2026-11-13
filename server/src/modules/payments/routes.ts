import express, { Router } from 'express';
import { z } from 'zod';
import { gateway, MockGateway } from '../../adapters/payments.js';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { notFound, parse } from '../../lib/errors.js';
import { managedFacility } from '../facilities/service.js';
import { handleWebhook, verifyReference } from './service.js';

export const paymentsRouter = Router();

// The signature covers the exact bytes, so this route needs the raw body.
paymentsRouter.post('/webhook', express.raw({ type: '*/*', limit: '100kb' }), async (req, res) => {
  const signature = (req.headers['x-paystack-signature'] as string | undefined) ?? undefined;
  const result = await handleWebhook(req.body as Buffer, signature);
  res.json({ received: true, result });
});

paymentsRouter.get('/verify/:reference', requireAuth(), async (req, res) => {
  res.json(await verifyReference(req.params.reference as string));
});

/** Test-mode checkout: only exists while the mock gateway is active. */
paymentsRouter.get('/mock/:reference', async (req, res) => {
  if (!(gateway instanceof MockGateway)) throw notFound();
  const rows = await query(
    `SELECT p.reference, p.amount, p.status, o.id AS order_id, f.name AS facility_name
       FROM payments p JOIN orders o ON o.id = p.order_id JOIN facilities f ON f.id = o.facility_id
      WHERE p.reference = $1`,
    [req.params.reference],
  );
  if (!rows[0]) throw notFound('Payment not found');
  res.json(rows[0]);
});

paymentsRouter.post('/mock/:reference/complete', async (req, res) => {
  if (!(gateway instanceof MockGateway)) throw notFound();
  const body = parse(z.object({ method: z.enum(['card', 'bank_transfer', 'ussd']), success: z.boolean() }), req.body);
  const signed = gateway.complete(req.params.reference as string, body.method, body.success);
  if (!signed) throw notFound('Payment not found');
  // Deliver through the same verification path a real gateway webhook takes.
  const result = await handleWebhook(signed.body, signed.signature);
  res.json({ result });
});

/** US-25: settlement statement for the signed-in facility. */
paymentsRouter.get('/settlements', requireAuth('pharmacy', 'hospital'), async (req, res) => {
  const f = await managedFacility(req.user!);
  const rows = await query(
    `SELECT p.reference, p.paid_at, p.amount, p.platform_fee, p.facility_amount, p.method, p.status, p.refunded_at, o.type, o.id AS order_id
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.facility_id = $1 AND p.gateway <> 'counter' AND p.status IN ('success', 'refund_pending', 'refunded')
      ORDER BY p.paid_at DESC LIMIT 1000`,
    [f.id],
  );
  const settled = rows.filter((r) => r.status === 'success');
  const summary = {
    gross: settled.reduce((s, r) => s + r.amount, 0),
    fees: settled.reduce((s, r) => s + r.platform_fee, 0),
    net: settled.reduce((s, r) => s + r.facility_amount, 0),
    refunded: rows.filter((r) => r.status !== 'success').reduce((s, r) => s + r.amount, 0),
    count: settled.length,
    payoutAccount: f.payout_subaccount,
  };
  if (req.query.format === 'csv') {
    const header = 'reference,paid_at,type,method,amount,platform_fee,facility_amount,status,refunded_at';
    const lines = rows.map((r) =>
      [r.reference, r.paid_at?.toISOString?.() ?? r.paid_at, r.type, r.method, r.amount, r.platform_fee, r.facility_amount, r.status, r.refunded_at?.toISOString?.() ?? ''].join(','),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="medassist-settlements.csv"');
    res.send([header, ...lines].join('\n'));
    return;
  }
  res.json({ summary, payments: rows });
});
