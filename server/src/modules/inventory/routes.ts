import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { badRequest, conflict, notFound, parse } from '../../lib/errors.js';
import { ownFacility, publishChange, touchFacility } from '../facilities/service.js';
import { type Db, db } from '../../db/pool.js';
import { haversineSql } from '../../lib/geo.js';
import { allocateFefo, checkLowStock, cleanNafdac, isValidNafdac, NAFDAC_HINT, nafdacOnFile, notifyBackInStock, syncNafdac } from './service.js';
import { parseStockSheet, TEMPLATE_CSV } from './upload.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth('pharmacy', 'hospital'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /\.(csv|xlsx)$/i.test(file.originalname)),
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
/** Optional on input when the facility already recorded one for the drug; checked for shape when given. */
const nafdacStr = z
  .string()
  .max(40)
  .nullish()
  .transform((v) => cleanNafdac(v))
  .refine((v) => v === null || isValidNafdac(v), NAFDAC_HINT);
const NAFDAC_MISSING = 'Enter the NAFDAC registration number printed on the pack (for example A4-1234)';

inventoryRouter.get('/', async (req, res) => {
  const f = await ownFacility(req.user!);
  const items = await query(
    `SELECT i.*, d.brand_name, d.generic_name, d.strength, d.form, d.category,
            (i.expiry_date - current_date) AS days_to_expiry
       FROM inventory_items i JOIN drug_catalogue d ON d.id = i.drug_id
      WHERE i.facility_id = $1 ORDER BY d.brand_name, i.expiry_date`,
    [f.id],
  );
  res.json(items);
});

inventoryRouter.get('/alerts', async (req, res) => {
  const f = await ownFacility(req.user!);
  const low = await query(
    `SELECT i.drug_id, d.brand_name, d.strength, d.form,
            coalesce(sum(i.quantity - i.reserved) FILTER (WHERE i.expiry_date > current_date), 0)::int AS stock,
            max(i.reorder_level) AS reorder_level
       FROM inventory_items i JOIN drug_catalogue d ON d.id = i.drug_id
      WHERE i.facility_id = $1 GROUP BY i.drug_id, d.brand_name, d.strength, d.form
     HAVING max(i.reorder_level) > 0
        AND coalesce(sum(i.quantity - i.reserved) FILTER (WHERE i.expiry_date > current_date), 0) <= max(i.reorder_level)
      ORDER BY d.brand_name`,
    [f.id],
  );
  const expiring = await query(
    `SELECT i.id, i.batch_no, i.expiry_date, i.quantity, (i.expiry_date - current_date) AS days_to_expiry,
            d.brand_name, d.strength, d.form
       FROM inventory_items i JOIN drug_catalogue d ON d.id = i.drug_id
      WHERE i.facility_id = $1 AND i.quantity > 0 AND i.expiry_date <= current_date + 90
      ORDER BY i.expiry_date`,
    [f.id],
  );
  res.json({ low, expiring });
});

inventoryRouter.get('/template.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="medassist-stock-template.csv"');
  res.send(TEMPLATE_CSV);
});

const itemInput = z.object({
  drugId: z.uuid(),
  quantity: z.number().int().min(0),
  price: z.number().min(0),
  costPrice: z.number().min(0).optional().nullable(),
  batchNo: z.string().trim().min(1).max(40),
  expiryDate: dateStr,
  reorderLevel: z.number().int().min(0).default(0),
  needsPrescription: z.boolean().optional(),
  refrigerated: z.boolean().optional(),
  allowReservations: z.boolean().default(true),
  nafdacNo: nafdacStr,
});

/** Flags default to what this facility already set for the drug, so a re-delivery keeps them. */
async function flagDefaults(c: Db, facilityId: string, drugId: string) {
  const prev = await one(
    `SELECT bool_or(needs_prescription) AS rx, bool_or(refrigerated) AS cold FROM inventory_items WHERE facility_id = $1 AND drug_id = $2`,
    [facilityId, drugId],
    c,
  );
  return { rx: !!prev?.rx, cold: !!prev?.cold };
}

inventoryRouter.post('/', async (req, res) => {
  const f = await ownFacility(req.user!);
  const body = parse(itemInput, req.body);
  if (body.expiryDate <= new Date().toISOString().slice(0, 10)) throw badRequest('Expired stock cannot be added');
  const item = await tx(async (c) => {
    const d = await flagDefaults(c, f.id, body.drugId);
    const nafdacNo = body.nafdacNo ?? (await nafdacOnFile(c, f.id, [body.drugId])).get(body.drugId);
    if (!nafdacNo) throw badRequest(NAFDAC_MISSING);
    // A delivery of an existing batch adds to it rather than failing.
    const row = await one(
      `INSERT INTO inventory_items (facility_id, drug_id, quantity, price, cost_price, batch_no, expiry_date, reorder_level,
                                    needs_prescription, refrigerated, allow_reservations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (facility_id, drug_id, batch_no) DO UPDATE
         SET quantity = inventory_items.quantity + EXCLUDED.quantity, price = EXCLUDED.price,
             cost_price = coalesce(EXCLUDED.cost_price, inventory_items.cost_price), expiry_date = EXCLUDED.expiry_date,
             reorder_level = EXCLUDED.reorder_level, needs_prescription = EXCLUDED.needs_prescription,
             refrigerated = EXCLUDED.refrigerated, allow_reservations = EXCLUDED.allow_reservations, updated_at = now()
       RETURNING *`,
      [
        f.id, body.drugId, body.quantity, body.price, body.costPrice ?? null, body.batchNo, body.expiryDate, body.reorderLevel,
        body.needsPrescription ?? d.rx, body.refrigerated ?? d.cold, body.allowReservations,
      ],
      c,
    );
    // Keep the flags consistent across all batches of the drug.
    await query(
      `UPDATE inventory_items SET needs_prescription = $3, refrigerated = $4, allow_reservations = $5 WHERE facility_id = $1 AND drug_id = $2`,
      [f.id, body.drugId, row.needs_prescription, row.refrigerated, row.allow_reservations],
      c,
    );
    await syncNafdac(c, f.id, body.drugId, nafdacNo);
    row.nafdac_no = nafdacNo;
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'stock.add', 'inventory_item', row.id, body);
    await checkLowStock(c, f.id, [body.drugId]);
    await notifyBackInStock(c, f.id, [body.drugId]);
    return row;
  });
  publishChange(f.id, 'inventory');
  res.status(201).json(item);
});

/** People nearby who searched for this drug in the last week (shown on the Add stock screen). */
inventoryRouter.get('/demand/:drugId', async (req, res) => {
  const f = await ownFacility(req.user!);
  const row = await one(
    `SELECT count(*)::int AS searches FROM search_log s
      WHERE s.created_at > now() - interval '7 days' AND s.lat IS NOT NULL
        AND ${haversineSql('s', '$2', '$3')} <= 5
        AND (s.target = 'drug-id:' || $1 OR s.target IN (SELECT 'drug-generic:' || generic_name FROM drug_catalogue WHERE id = $1)
             OR s.target IN (SELECT 'drug-brand:' || brand_name FROM drug_catalogue WHERE id = $1))`,
    [req.params.drugId, f.lat, f.lng],
  );
  const stock = await one(
    `SELECT coalesce(sum(quantity - reserved) FILTER (WHERE expiry_date > current_date), 0)::int AS available, count(*)::int AS batches
       FROM inventory_items WHERE facility_id = $1 AND drug_id = $2`,
    [f.id, req.params.drugId],
  );
  const nafdacNo = (await nafdacOnFile(db(), f.id, [req.params.drugId as string])).get(req.params.drugId as string) ?? null;
  res.json({ searches: row?.searches ?? 0, available: stock?.available ?? 0, listed: (stock?.batches ?? 0) > 0, nafdacNo });
});

/** Imports rows corrected on the dashboard after an upload check (US-16). */
inventoryRouter.post('/import', async (req, res) => {
  const f = await ownFacility(req.user!);
  const { rows } = parse(
    z.object({
      rows: z
        .array(itemInput.pick({ drugId: true, quantity: true, price: true, batchNo: true, expiryDate: true, reorderLevel: true, nafdacNo: true }))
        .min(1)
        .max(2000),
    }),
    req.body,
  );
  const today = new Date().toISOString().slice(0, 10);
  if (rows.some((r) => r.expiryDate <= today)) throw badRequest('Remove or fix rows that have already expired');
  let created = 0;
  let updated = 0;
  await tx(async (c) => {
    const onFile = await nafdacOnFile(c, f.id, [...new Set(rows.map((r) => r.drugId))]);
    for (const r of rows) {
      const nafdacNo = r.nafdacNo ?? onFile.get(r.drugId);
      if (!nafdacNo) throw badRequest(`${NAFDAC_MISSING}. Batch ${r.batchNo} has none.`);
      onFile.set(r.drugId, nafdacNo);
      const d = await flagDefaults(c, f.id, r.drugId);
      const existed = await one('SELECT 1 FROM inventory_items WHERE facility_id = $1 AND drug_id = $2 AND batch_no = $3', [f.id, r.drugId, r.batchNo], c);
      await query(
        `INSERT INTO inventory_items (facility_id, drug_id, quantity, price, batch_no, expiry_date, reorder_level, needs_prescription, refrigerated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (facility_id, drug_id, batch_no) DO UPDATE
           SET quantity = greatest(EXCLUDED.quantity, inventory_items.reserved), price = EXCLUDED.price,
               expiry_date = EXCLUDED.expiry_date, reorder_level = EXCLUDED.reorder_level, updated_at = now()`,
        [f.id, r.drugId, r.quantity, r.price, r.batchNo, r.expiryDate, r.reorderLevel, d.rx, d.cold],
        c,
      );
      await syncNafdac(c, f.id, r.drugId, nafdacNo);
      if (existed) updated++;
      else created++;
    }
    const drugIds = [...new Set(rows.map((r) => r.drugId))];
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'stock.import', 'facility', f.id, { created, updated });
    await checkLowStock(c, f.id, drugIds);
    await notifyBackInStock(c, f.id, drugIds);
  });
  publishChange(f.id, 'inventory');
  res.json({ created, updated });
});

inventoryRouter.patch('/:id', async (req, res) => {
  const f = await ownFacility(req.user!);
  const body = parse(
    z.object({
      quantity: z.number().int().min(0).optional(),
      price: z.number().min(0).optional(),
      costPrice: z.number().min(0).optional(),
      reorderLevel: z.number().int().min(0).optional(),
      expiryDate: dateStr.optional(),
      needsPrescription: z.boolean().optional(),
      refrigerated: z.boolean().optional(),
      allowReservations: z.boolean().optional(),
      nafdacNo: nafdacStr.optional(),
      reason: z.string().max(120).optional(),
    }),
    req.body,
  );
  const item = await tx(async (c) => {
    const before = await one('SELECT * FROM inventory_items WHERE id = $1 AND facility_id = $2 FOR UPDATE', [req.params.id, f.id], c);
    if (!before) throw notFound('Item not found');
    if (body.quantity !== undefined && body.quantity < before.reserved) {
      throw conflict(`${before.reserved} units are reserved for customers; quantity cannot go below that`);
    }
    const row = await one(
      `UPDATE inventory_items SET quantity = coalesce($2, quantity), price = coalesce($3, price),
              reorder_level = coalesce($4, reorder_level), expiry_date = coalesce($5, expiry_date),
              cost_price = coalesce($6, cost_price), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [before.id, body.quantity, body.price, body.reorderLevel, body.expiryDate, body.costPrice],
      c,
    );
    if (body.needsPrescription !== undefined || body.refrigerated !== undefined || body.allowReservations !== undefined) {
      await query(
        `UPDATE inventory_items SET needs_prescription = coalesce($3, needs_prescription), refrigerated = coalesce($4, refrigerated),
                allow_reservations = coalesce($5, allow_reservations) WHERE facility_id = $1 AND drug_id = $2`,
        [f.id, before.drug_id, body.needsPrescription, body.refrigerated, body.allowReservations],
        c,
      );
    }
    if (body.nafdacNo) {
      await syncNafdac(c, f.id, before.drug_id, body.nafdacNo);
      row.nafdac_no = body.nafdacNo;
    }
    await notifyBackInStock(c, f.id, [before.drug_id]);
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'stock.adjust', 'inventory_item', before.id, {
      from: { quantity: before.quantity, price: before.price },
      to: { quantity: row.quantity, price: row.price },
      nafdacNo: body.nafdacNo ?? undefined,
      reason: body.reason,
    });
    await checkLowStock(c, f.id, [before.drug_id]);
    return row;
  });
  publishChange(f.id, 'inventory');
  res.json(item);
});

inventoryRouter.delete('/:id', async (req, res) => {
  const f = await ownFacility(req.user!);
  await tx(async (c) => {
    const item = await one('SELECT * FROM inventory_items WHERE id = $1 AND facility_id = $2 FOR UPDATE', [req.params.id, f.id], c);
    if (!item) throw notFound('Item not found');
    if (item.reserved > 0) throw conflict('This batch has reserved units; it cannot be removed');
    const used = await one('SELECT 1 FROM order_items WHERE inventory_item_id = $1 LIMIT 1', [item.id], c);
    if (used) {
      // Keep the row for order history; zero it out instead.
      await query('UPDATE inventory_items SET quantity = 0, updated_at = now() WHERE id = $1', [item.id], c);
    } else {
      await query('DELETE FROM inventory_items WHERE id = $1', [item.id], c);
    }
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'stock.remove', 'inventory_item', item.id, { quantity: item.quantity, batch: item.batch_no });
  });
  publishChange(f.id, 'inventory');
  res.status(204).end();
});

/** US-16: bulk upload. Valid rows are applied (upserting by batch); errors are reported per row. */
inventoryRouter.post('/upload', upload.single('file'), async (req, res) => {
  const f = await ownFacility(req.user!);
  if (!req.file) throw badRequest('Attach a .csv or .xlsx file');
  const dryRun = req.query.dryRun === 'true';
  const parsed = await parseStockSheet(req.file.buffer, req.file.originalname);
  const { errors } = parsed;
  // Rows without a NAFDAC number are fine when one is already on file for the drug (FR-07).
  const onFile = await nafdacOnFile(db(), f.id, [...new Set(parsed.rows.map((r) => r.drugId))]);
  const rows = parsed.rows.filter((r) => {
    r.nafdacNo ??= onFile.get(r.drugId) ?? parsed.rows.find((o) => o.drugId === r.drugId && o.nafdacNo)?.nafdacNo ?? null;
    if (r.nafdacNo) return true;
    errors.push({
      row: r.row,
      message: 'NAFDAC number is missing',
      kind: 'nafdac',
      raw: `${r.drugLabel} · batch ${r.batchNo}`,
      fields: { drugId: r.drugId, quantity: r.quantity, price: r.price, batchNo: r.batchNo, expiryDate: r.expiryDate, reorderLevel: r.reorderLevel, nafdacNo: null },
    });
    return false;
  });

  let created = 0;
  let updated = 0;
  if (!dryRun && rows.length) {
    await tx(async (c) => {
      for (const r of rows) {
        const existing = await one(
          'SELECT id, reserved FROM inventory_items WHERE facility_id = $1 AND drug_id = $2 AND batch_no = $3 FOR UPDATE',
          [f.id, r.drugId, r.batchNo],
          c,
        );
        if (existing && r.quantity < existing.reserved) {
          errors.push({ row: r.row, message: `quantity is below the ${existing.reserved} units already reserved` });
          continue;
        }
        await query(
          `INSERT INTO inventory_items (facility_id, drug_id, quantity, price, batch_no, expiry_date, reorder_level)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (facility_id, drug_id, batch_no) DO UPDATE
             SET quantity = EXCLUDED.quantity, price = EXCLUDED.price, expiry_date = EXCLUDED.expiry_date,
                 reorder_level = EXCLUDED.reorder_level, updated_at = now()`,
          [f.id, r.drugId, r.quantity, r.price, r.batchNo, r.expiryDate, r.reorderLevel],
          c,
        );
        await syncNafdac(c, f.id, r.drugId, r.nafdacNo!);
        if (existing) updated++;
        else created++;
      }
      await touchFacility(c, f.id);
      await audit(c, req.user!.id, 'stock.upload', 'facility', f.id, { file: req.file!.originalname, created, updated, errors: errors.length });
      await checkLowStock(c, f.id, [...new Set(rows.map((r) => r.drugId))]);
      await notifyBackInStock(c, f.id, [...new Set(rows.map((r) => r.drugId))]);
    });
    publishChange(f.id, 'inventory');
  }
  errors.sort((a, b) => a.row - b.row);
  res.json({ dryRun, valid: rows.length, created, updated, errors, preview: dryRun ? rows : undefined });
});

/** US-17: a counter sale deducts stock first-expiry-first-out; expired batches are never sold. */
inventoryRouter.post('/sales', async (req, res) => {
  const f = await ownFacility(req.user!);
  const body = parse(
    z.object({ items: z.array(z.object({ drugId: z.uuid(), quantity: z.number().int().positive() })).min(1) }),
    req.body,
  );
  const sale = await tx(async (c) => {
    const lines = [];
    for (const line of body.items) {
      const allocations = await allocateFefo(c, f.id, line.drugId, line.quantity);
      for (const a of allocations) {
        await query('UPDATE inventory_items SET quantity = quantity - $2, updated_at = now() WHERE id = $1', [a.itemId, a.quantity], c);
      }
      lines.push({ drugId: line.drugId, quantity: line.quantity, total: allocations.reduce((s, a) => s + a.price * a.quantity, 0), allocations });
    }
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'stock.sale', 'facility', f.id, { lines });
    await checkLowStock(c, f.id, body.items.map((i) => i.drugId));
    return { lines, total: lines.reduce((s, l) => s + l.total, 0) };
  });
  publishChange(f.id, 'inventory');
  res.status(201).json(sale);
});
