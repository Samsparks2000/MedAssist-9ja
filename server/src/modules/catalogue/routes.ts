import { Router } from 'express';
import { z } from 'zod';
import { db, one } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { parse } from '../../lib/errors.js';
import { findOwnFacility } from '../facilities/service.js';
import { allDrugs, invalidateCatalogue, searchDrugs } from './service.js';

export const catalogueRouter = Router();

catalogueRouter.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(q ? await searchDrugs(q, 25) : (await allDrugs()).slice(0, 200));
});

/** "Not listed? Ask us to add it to the catalogue." */
catalogueRouter.post('/requests', requireAuth('pharmacy', 'hospital'), async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(120), details: z.string().trim().max(300).optional() }), req.body);
  const f = await findOwnFacility(req.user!.id);
  const row = await one(
    'INSERT INTO catalogue_requests (facility_id, requested_by, name, details) VALUES ($1, $2, $3, $4) RETURNING id',
    [f?.id ?? null, req.user!.id, body.name, body.details ?? null],
  );
  res.status(201).json(row);
});

catalogueRouter.post('/', requireAuth('admin'), async (req, res) => {
  const body = parse(
    z.object({
      brandName: z.string().trim().min(2),
      genericName: z.string().trim().min(2),
      strength: z.string().trim().max(40).optional(),
      form: z.string().trim().max(40).optional(),
      category: z.string().trim().max(60).optional(),
    }),
    req.body,
  );
  const drug = await one(
    `INSERT INTO drug_catalogue (brand_name, generic_name, strength, form, category)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [body.brandName, body.genericName, body.strength ?? null, body.form ?? null, body.category ?? null],
  );
  await audit(db(), req.user!.id, 'catalogue.add', 'drug', drug.id, body);
  invalidateCatalogue();
  res.status(201).json(drug);
});
