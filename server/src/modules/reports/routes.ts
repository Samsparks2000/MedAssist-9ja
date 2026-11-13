import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { parse } from '../../lib/errors.js';
import { haversineSql } from '../../lib/geo.js';
import { managedFacility, ownFacility } from '../facilities/service.js';

/** US-21 facility reports: overview counts, missed searches nearby, sales and top items. */
export const reportsRouter = Router();
reportsRouter.use(requireAuth('pharmacy', 'hospital'));

/**
 * Searches within 5 km of the facility, in the window, for drugs it does not have available now.
 * Search targets are spec strings; each is expanded to its drug ids and checked against stock.
 */
async function missedSearches(facility: { id: string; lat: number; lng: number }, days: number) {
  return query<{ label: string; target: string; times: number }>(
    `WITH nearby AS (
       SELECT s.query, s.target FROM search_log s
        WHERE s.created_at > now() - make_interval(days => $4) AND s.lat IS NOT NULL
          AND s.target LIKE 'drug%' AND ${haversineSql('s', '$2', '$3')} <= 5
     ), expanded AS (
       SELECT n.target, n.query, d.id AS drug_id FROM nearby n JOIN drug_catalogue d ON
            n.target = 'drug-id:' || d.id OR n.target = 'drug-brand:' || d.brand_name
         OR n.target = 'drug-generic:' || d.generic_name OR n.target = 'drug-category:' || d.category
     ), missed AS (
       SELECT target, min(query) AS label, count(DISTINCT query || target) AS variants
         FROM expanded e
        GROUP BY target
       HAVING NOT bool_or(EXISTS (SELECT 1 FROM inventory_items i WHERE i.facility_id = $1 AND i.drug_id = e.drug_id
                                    AND i.expiry_date > current_date AND i.quantity > i.reserved))
     )
     SELECT m.target, m.label, (SELECT count(*) FROM nearby n WHERE n.target = m.target)::int AS times
       FROM missed m ORDER BY times DESC LIMIT 12`,
    [facility.id, facility.lat, facility.lng, days],
  );
}

reportsRouter.get('/overview', async (req, res) => {
  const f = await ownFacility(req.user!);
  const counts = await one(
    `SELECT
       (SELECT count(*) FROM orders WHERE facility_id = $1 AND status IN ('requested', 'paid', 'reserved'))::int AS reservations,
       (SELECT count(*) FROM orders WHERE facility_id = $1 AND (status = 'requested' OR (status = 'paid' AND confirmed_at IS NULL)))::int AS needs_answer,
       (SELECT count(*) FROM (
          SELECT i.drug_id FROM inventory_items i WHERE i.facility_id = $1 GROUP BY i.drug_id
          HAVING max(i.reorder_level) > 0
             AND coalesce(sum(i.quantity - i.reserved) FILTER (WHERE i.expiry_date > current_date), 0) <= max(i.reorder_level)) x)::int AS low_stock,
       (SELECT count(*) FROM inventory_items WHERE facility_id = $1 AND quantity > 0 AND expiry_date <= current_date + 90)::int AS expiring,
       (SELECT min(expiry_date - current_date) FROM inventory_items WHERE facility_id = $1 AND quantity > 0 AND expiry_date <= current_date + 90)::int AS soonest_expiry_days,
       (SELECT count(*) FROM bed_requests WHERE facility_id = $1 AND status = 'pending')::int AS bed_requests`,
    [f.id],
  );
  const missed = await missedSearches(f, 7);
  res.json({ ...counts, missedSearches: missed.reduce((s, m) => s + m.times, 0), missedTop: missed.slice(0, 4) });
});

reportsRouter.get('/missed-searches', async (req, res) => {
  const f = await ownFacility(req.user!);
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }), req.query);
  res.json(await missedSearches(f, days));
});

reportsRouter.get('/sales', async (req, res) => {
  const f = await managedFacility(req.user!);
  const p = parse(
    z.object({ days: z.coerce.number().int().min(1).max(366).default(30), format: z.enum(['json', 'csv']).default('json') }),
    req.query,
  );
  // Counter sales are logged in the audit trail; reservations come from collected orders.
  const lines = await query<{ day: string; channel: string; item: string; quantity: number; amount: number }>(
    `SELECT to_char(a.created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS day, 'Counter sale' AS channel,
            concat_ws(' ', d.brand_name, d.strength) AS item, (l->>'quantity')::int AS quantity, (l->>'total')::numeric AS amount
       FROM audit_log a, jsonb_array_elements(a.details->'lines') l JOIN drug_catalogue d ON d.id = (l->>'drugId')::uuid
      WHERE a.action = 'stock.sale' AND a.entity_id = $1::text AND a.created_at > now() - make_interval(days => $2)
     UNION ALL
     SELECT to_char(o.collected_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD'), CASE o.payment_mode WHEN 'online' THEN 'Reservation (paid online)' ELSE 'Reservation (paid at pickup)' END,
            oi.description, oi.quantity, oi.quantity * oi.unit_price
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.facility_id = $1::uuid AND o.status = 'collected' AND o.collected_at > now() - make_interval(days => $2)
      ORDER BY 1 DESC`,
    [f.id, p.days],
  );
  if (p.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="medassist-sales-${p.days}d.csv"`);
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    res.send(['date,channel,item,quantity,amount', ...lines.map((l) => [l.day, l.channel, l.item, l.quantity, l.amount].map(esc).join(','))].join('\n'));
    return;
  }
  const top = new Map<string, { item: string; quantity: number; amount: number }>();
  for (const l of lines) {
    const t = top.get(l.item) ?? { item: l.item, quantity: 0, amount: 0 };
    t.quantity += l.quantity;
    t.amount += Number(l.amount);
    top.set(l.item, t);
  }
  const byDay = new Map<string, number>();
  for (const l of lines) byDay.set(l.day, (byDay.get(l.day) ?? 0) + Number(l.amount));
  res.json({
    days: p.days,
    total: lines.reduce((s, l) => s + Number(l.amount), 0),
    count: lines.length,
    byDay: [...byDay].map(([day, amount]) => ({ day, amount })).sort((a, b) => a.day.localeCompare(b.day)),
    top: [...top.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
    missed: await missedSearches(f, p.days),
  });
});
