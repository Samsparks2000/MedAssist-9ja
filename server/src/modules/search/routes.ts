import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { areas, geocoder, nearestPlace } from '../../adapters/maps.js';
import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { badRequest, parse } from '../../lib/errors.js';
import { emergencySearch, SITUATION_KEYS } from './emergency.js';
import { resolveQuery, type Target, targetFromSpec } from './resolve.js';
import { neighbourhoodSearch } from './service.js';
import { SYMPTOMS } from './vocabulary.js';

export const searchRouter = Router();

// NFR-04: rate limiting on search.
searchRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: config.env === 'test' ? 10_000 : 90,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many searches. Please wait a moment.' },
  }),
);

searchRouter.get('/symptoms', async (_req, res) => {
  const out = [];
  for (const s of SYMPTOMS) {
    const targets = (await Promise.all(s.targets.map(targetFromSpec))).filter((t): t is Target => !!t);
    out.push({ ...s, targets: targets.map((t) => ({ spec: t.spec, label: t.label, kind: t.kind })) });
  }
  res.json(out);
});

/** Emergency screen: nearest hospitals with an emergency unit, tagged for the situation chosen. */
searchRouter.get('/emergency', async (req, res) => {
  const p = parse(
    z.object({
      situation: z.enum(SITUATION_KEYS).optional(),
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radiusKm: z.coerce.number().refine((v) => [5, 10, 20].includes(v)).optional(),
    }),
    req.query,
  );
  res.json(await emergencySearch({ lat: p.lat, lng: p.lng }, p.situation, p.radiusKm));
});

searchRouter.get('/suggest', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  res.json(q.trim().length < 2 ? [] : await resolveQuery(q, 8));
});

const boolish = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());

searchRouter.get('/', async (req, res) => {
  const p = parse(
    z.object({
      q: z.string().trim().max(80).optional(),
      target: z.string().max(120).optional(),
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      maxDistanceKm: z.coerce.number().positive().max(100).optional(),
      maxPrice: z.coerce.number().min(0).optional(),
      openNow: boolish.optional(),
      facilityType: z.enum(['pharmacy', 'hospital']).optional(),
      radiusKm: z.coerce.number().refine((v) => [5, 10, 20].includes(v), 'Use 5, 10 or 20').optional(),
      maxAgeHours: z.coerce.number().positive().max(24 * 90).optional(),
      sort: z.enum(['best', 'nearest', 'price', 'updated']).optional(),
    }),
    req.query,
  );
  if (!p.q && !p.target) throw badRequest('Say what you need');

  let target: Target | null = null;
  let alternatives: Awaited<ReturnType<typeof resolveQuery>> = [];
  if (p.target) {
    target = await targetFromSpec(p.target);
  } else {
    const matches = await resolveQuery(p.q!);
    if (matches[0]) target = await targetFromSpec(matches[0].spec);
    alternatives = matches.slice(1);
  }

  if (!target) {
    await query('INSERT INTO search_log (query, target, lat, lng, result_count) VALUES ($1, NULL, $2, $3, 0)', [
      p.q ?? p.target, p.lat, p.lng,
    ]);
    res.json({ target: null, alternatives, results: [], radiusKm: null, expanded: false, fallback: null, unmatched: true });
    return;
  }

  const response = await neighbourhoodSearch(target, { lat: p.lat, lng: p.lng }, {
    maxDistanceKm: p.maxDistanceKm,
    maxPrice: p.maxPrice,
    openNow: p.openNow,
    facilityType: p.facilityType,
    radiusKm: p.radiusKm,
    maxAgeHours: p.maxAgeHours,
    sort: p.sort,
  });
  // Unmet-demand log feeds facility reports and admin monitoring.
  await query('INSERT INTO search_log (query, target, lat, lng, result_count) VALUES ($1, $2, $3, $4, $5)', [
    p.q ?? target.label, target.spec, p.lat, p.lng, response.results.length,
  ]);
  res.json({ target: { spec: target.spec, label: target.label, kind: target.kind }, alternatives, ...response });
});

export const geoRouter = Router();

geoRouter.get('/autocomplete', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
  res.json(q.trim().length < 2 ? [] : await geocoder.autocomplete(q));
});

geoRouter.get('/areas', (_req, res) => res.json(areas()));

/** Labels a GPS fix or map pin with the nearest known landmark. */
geoRouter.get('/reverse', (req, res) => {
  const p = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req.query);
  const place = nearestPlace(p);
  res.json(
    place
      ? { label: place.distanceKm < 0.3 ? place.label : `Near ${place.label}`, detail: place.detail, lat: p.lat, lng: p.lng }
      : { label: 'Pinned location', detail: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, lat: p.lat, lng: p.lng },
  );
});
