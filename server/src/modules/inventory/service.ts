import { type Db, db, one, query } from '../../db/pool.js';
import { conflict } from '../../lib/errors.js';
import { drugLabel } from '../catalogue/service.js';
import { notify, notifyFacilityOwner } from '../notifications/service.js';

export interface Allocation {
  itemId: string;
  quantity: number;
  price: number;
}

/**
 * Picks unexpired batches first-expiry-first-out and locks them (NFR-09): a concurrent
 * reservation of the last unit waits on the row lock and then sees it is gone.
 */
export async function allocateFefo(client: Db, facilityId: string, drugId: string, quantity: number): Promise<Allocation[]> {
  const batches = await query<{ id: string; quantity: number; reserved: number; price: number }>(
    `SELECT id, quantity, reserved, price FROM inventory_items
      WHERE facility_id = $1 AND drug_id = $2 AND expiry_date > current_date AND quantity > reserved
      ORDER BY expiry_date, id FOR UPDATE`,
    [facilityId, drugId],
    client,
  );
  const allocations: Allocation[] = [];
  let remaining = quantity;
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.quantity - b.reserved);
    allocations.push({ itemId: b.id, quantity: take, price: b.price });
    remaining -= take;
  }
  if (remaining > 0) {
    const available = quantity - remaining;
    throw conflict(available ? `Only ${available} left in stock` : 'This item is out of stock');
  }
  return allocations;
}

/** US-18: alert (in-app + SMS) once when a drug's sellable stock falls to its reorder level. */
export async function checkLowStock(client: Db, facilityId: string, drugIds?: string[]): Promise<void> {
  const rows = await query<{ drug_id: string; brand_name: string; strength: string | null; form: string | null; stock: number; level: number }>(
    `SELECT i.drug_id, d.brand_name, d.strength, d.form,
            coalesce(sum(i.quantity - i.reserved) FILTER (WHERE i.expiry_date > current_date), 0)::int AS stock,
            max(i.reorder_level) AS level
       FROM inventory_items i JOIN drug_catalogue d ON d.id = i.drug_id
      WHERE i.facility_id = $1 AND ($2::uuid[] IS NULL OR i.drug_id = ANY($2))
      GROUP BY i.drug_id, d.brand_name, d.strength, d.form`,
    [facilityId, drugIds ?? null],
    client,
  );
  for (const r of rows) {
    const key = `low:${facilityId}:${r.drug_id}`;
    if (r.level > 0 && r.stock <= r.level) {
      const inserted = await one('INSERT INTO alerts_sent (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key], client);
      if (inserted) {
        await notifyFacilityOwner(
          facilityId,
          {
            kind: 'low_stock',
            title: 'Low stock',
            body: `${drugLabel(r)} is down to ${r.stock} (reorder level ${r.level}).`,
            link: '/dashboard/inventory?filter=low',
            channels: ['sms'],
          },
          client,
        );
      }
    } else {
      // Restocked above the level: re-arm the alert.
      await query('DELETE FROM alerts_sent WHERE key = $1', [key], client);
    }
  }
}

/** "Tell me when back": notifies patients watching a drug once it is sellable here again. */
export async function notifyBackInStock(client: Db, facilityId: string, drugIds: string[]): Promise<void> {
  if (!drugIds.length) return;
  const back = await query<{ id: string; user_id: string; label: string; facility_name: string }>(
    `SELECT w.id, w.user_id, concat_ws(' ', d.brand_name, d.strength) AS label, f.name AS facility_name
       FROM stock_watches w JOIN drug_catalogue d ON d.id = w.drug_id JOIN facilities f ON f.id = w.facility_id
      WHERE w.facility_id = $1 AND w.drug_id = ANY($2) AND w.notified_at IS NULL
        AND EXISTS (SELECT 1 FROM inventory_items i WHERE i.facility_id = w.facility_id AND i.drug_id = w.drug_id
                      AND i.expiry_date > current_date AND i.quantity > i.reserved)`,
    [facilityId, drugIds],
    client,
  );
  for (const w of back) {
    await query('UPDATE stock_watches SET notified_at = now() WHERE id = $1', [w.id], client);
    await notify(
      { userId: w.user_id, kind: 'back_in_stock', title: 'Back in stock', body: `${w.label} is available again at ${w.facility_name}.`, link: `/facility/${facilityId}`, channels: ['sms'] },
      client,
    );
  }
}

const EXPIRY_THRESHOLDS = [90, 60, 30] as const;

/** US-19: alerts at 90, 60 and 30 days before expiry, and once when a batch expires. Run daily. */
export async function runExpiryAlerts(client: Db = db()): Promise<number> {
  const items = await query<{
    id: string; facility_id: string; batch_no: string; expiry_date: string; days: number;
    brand_name: string; strength: string | null; form: string | null; quantity: number;
  }>(
    `SELECT i.id, i.facility_id, i.batch_no, i.expiry_date, (i.expiry_date - current_date) AS days,
            d.brand_name, d.strength, d.form, i.quantity
       FROM inventory_items i JOIN drug_catalogue d ON d.id = i.drug_id
      WHERE i.quantity > 0 AND i.expiry_date <= current_date + 90`,
    [],
    client,
  );
  let sent = 0;
  for (const it of items) {
    const kind = it.days <= 0 ? 'expired' : `exp${EXPIRY_THRESHOLDS.filter((t) => it.days <= t).at(-1)}`;
    const inserted = await one(
      'INSERT INTO alerts_sent (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key',
      [`${kind}:${it.id}`],
      client,
    );
    if (!inserted) continue;
    sent++;
    const label = `${drugLabel(it)} (batch ${it.batch_no}, ${it.quantity} units)`;
    await notifyFacilityOwner(
      it.facility_id,
      kind === 'expired'
        ? { kind: 'expired', title: 'Batch expired', body: `${label} has expired and is blocked from sale.`, link: '/dashboard/inventory?filter=expiring', channels: ['sms'] }
        : { kind: 'expiry', title: `Expires in ${it.days} days`, body: `${label} expires on ${it.expiry_date}.`, link: '/dashboard/inventory?filter=expiring', channels: ['sms'] },
      client,
    );
  }
  return sent;
}
