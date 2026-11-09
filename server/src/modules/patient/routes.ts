import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { notFound, parse } from '../../lib/errors.js';
import { notify } from '../notifications/service.js';

/** US-07 refill reminders and "Tell me when back" stock watches. */
export const patientRouter = Router();
patientRouter.use(requireAuth('patient'));

patientRouter.get('/refills', async (req, res) => {
  res.json(
    await query(
      `SELECT r.id, r.interval_days, r.next_at, r.active, concat_ws(' ', d.brand_name, d.strength) AS drug, f.name AS facility_name, r.facility_id, r.drug_id
         FROM refill_reminders r JOIN drug_catalogue d ON d.id = r.drug_id LEFT JOIN facilities f ON f.id = r.facility_id
        WHERE r.user_id = $1 AND r.active ORDER BY r.next_at`,
      [req.user!.id],
    ),
  );
});

patientRouter.post('/refills', async (req, res) => {
  const b = parse(
    z.object({ drugId: z.uuid(), facilityId: z.uuid().optional(), intervalDays: z.number().int().min(7).max(180), fromOrderId: z.uuid().optional() }),
    req.body,
  );
  // Remind a few days before the supply runs out.
  const lead = Math.min(3, Math.floor(b.intervalDays / 7));
  const row = await one(
    `INSERT INTO refill_reminders (user_id, drug_id, facility_id, interval_days, next_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id, next_at`,
    [req.user!.id, b.drugId, b.facilityId ?? null, b.intervalDays, b.intervalDays - lead],
  );
  res.status(201).json(row);
});

patientRouter.delete('/refills/:id', async (req, res) => {
  await query('UPDATE refill_reminders SET active = false WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  res.status(204).end();
});

patientRouter.get('/watches', async (req, res) => {
  res.json(
    await query(
      `SELECT w.id, w.facility_id, w.drug_id, w.created_at, w.notified_at, concat_ws(' ', d.brand_name, d.strength) AS drug, f.name AS facility_name
         FROM stock_watches w JOIN drug_catalogue d ON d.id = w.drug_id JOIN facilities f ON f.id = w.facility_id
        WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT 50`,
      [req.user!.id],
    ),
  );
});

patientRouter.post('/watches', async (req, res) => {
  const b = parse(z.object({ facilityId: z.uuid(), drugId: z.uuid() }), req.body);
  const listed = await one('SELECT 1 FROM inventory_items WHERE facility_id = $1 AND drug_id = $2 LIMIT 1', [b.facilityId, b.drugId]);
  if (!listed) throw notFound('This pharmacy does not list that medicine');
  const row = await one(
    `INSERT INTO stock_watches (user_id, facility_id, drug_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, facility_id, drug_id) WHERE notified_at IS NULL DO UPDATE SET created_at = stock_watches.created_at
     RETURNING id`,
    [req.user!.id, b.facilityId, b.drugId],
  );
  res.status(201).json(row);
});

patientRouter.delete('/watches/:id', async (req, res) => {
  await query('DELETE FROM stock_watches WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  res.status(204).end();
});

/** Scheduler: sends due refill reminders by SMS and in-app, then schedules the next one. */
export async function sendDueRefillReminders(): Promise<number> {
  const due = await query(
    `UPDATE refill_reminders r SET next_at = r.next_at + make_interval(days => r.interval_days)
      WHERE r.active AND r.next_at <= now()
      RETURNING r.id, r.user_id, r.drug_id, r.facility_id,
        (SELECT concat_ws(' ', d.brand_name, d.strength) FROM drug_catalogue d WHERE d.id = r.drug_id) AS drug,
        (SELECT name FROM facilities WHERE id = r.facility_id) AS facility_name`,
  );
  for (const r of due) {
    await notify({
      userId: r.user_id,
      kind: 'refill',
      title: 'Time to refill',
      body: `Your ${r.drug} may run out soon.${r.facility_name ? ` Reserve it again at ${r.facility_name}.` : ''}`,
      link: r.facility_id ? `/facility/${r.facility_id}?reserve=${r.drug_id}` : `/search?target=${encodeURIComponent(`drug-id:${r.drug_id}`)}`,
      channels: ['sms'],
    });
  }
  return due.length;
}
