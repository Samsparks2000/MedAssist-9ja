import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors.js';
import { ownFacility, publishChange, touchFacility } from '../facilities/service.js';
import { RESOURCE_SUBTYPES } from '../search/vocabulary.js';

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth('hospital'));

resourcesRouter.get('/types', (_req, res) => res.json(RESOURCE_SUBTYPES));

resourcesRouter.get('/', async (req, res) => {
  const f = await ownFacility(req.user!);
  res.json(await query('SELECT * FROM resources WHERE facility_id = $1 ORDER BY type, sub_type', [f.id]));
});

const resourceInput = z
  .object({
    type: z.enum(['bed', 'blood', 'oxygen', 'equipment']),
    subType: z.string().trim().min(1).max(40),
    capacity: z.number().int().min(0),
    available: z.number().int().min(0),
    status: z.enum(['available', 'in_use', 'maintenance']).nullable().optional(),
    price: z.number().min(0).nullable().optional(),
  })
  .refine((r) => r.type === 'blood' || r.available <= r.capacity, { message: 'Available cannot exceed capacity', path: ['available'] });

/** US-09: one screen updates beds, blood, oxygen and equipment together. */
resourcesRouter.put('/', async (req, res) => {
  const f = await ownFacility(req.user!);
  const { items } = parse(z.object({ items: z.array(resourceInput).max(200) }), req.body);
  for (const r of items) {
    const allowed = RESOURCE_SUBTYPES[r.type] as readonly string[];
    if (!allowed.includes(r.subType)) throw badRequest(`Unknown ${r.type} type "${r.subType}"`);
  }
  const rows = await tx(async (c) => {
    const out = [];
    for (const r of items) {
      // Blood is counted in units with no fixed capacity; equipment marked under maintenance is not available.
      const capacity = r.type === 'blood' ? r.available : r.capacity;
      const available = r.type === 'equipment' && r.status === 'maintenance' ? 0 : r.available;
      const before = await one('SELECT available, status FROM resources WHERE facility_id = $1 AND type = $2 AND sub_type = $3', [f.id, r.type, r.subType], c);
      const row = await one(
        `INSERT INTO resources (facility_id, type, sub_type, capacity, available, status, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (facility_id, type, sub_type) DO UPDATE
           SET capacity = EXCLUDED.capacity, available = EXCLUDED.available, status = EXCLUDED.status,
               price = EXCLUDED.price, updated_at = now()
         RETURNING *`,
        [f.id, r.type, r.subType, capacity, available, r.type === 'equipment' ? (r.status ?? 'available') : null, r.price ?? null],
        c,
      );
      if (!before || before.available !== row.available || before.status !== row.status) {
        await audit(c, req.user!.id, 'resource.update', 'resource', row.id, { type: r.type, subType: r.subType, from: before, to: { available: row.available, status: row.status } });
      }
      out.push(row);
    }
    await touchFacility(c, f.id);
    return out;
  });
  publishChange(f.id, 'resource');
  res.json(rows);
});

resourcesRouter.delete('/:id', async (req, res) => {
  const f = await ownFacility(req.user!);
  const r = await one('SELECT facility_id FROM resources WHERE id = $1', [req.params.id]);
  if (!r) throw notFound();
  if (r.facility_id !== f.id) throw forbidden();
  await tx(async (c) => {
    await query('DELETE FROM resources WHERE id = $1', [req.params.id], c);
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'resource.remove', 'resource', req.params.id as string);
  });
  publishChange(f.id, 'resource');
  res.status(204).end();
});
