import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { normalisePhone } from '../../lib/codes.js';
import { badRequest, notFound, parse } from '../../lib/errors.js';
import { publishChange } from '../facilities/service.js';
import { SPECIALTIES } from '../search/vocabulary.js';

export const specialistsRouter = Router();

specialistsRouter.get('/specialties', (_req, res) => res.json(SPECIALTIES));

specialistsRouter.use(requireAuth('specialist'));

async function mySpecialist(userId: string) {
  return one('SELECT * FROM specialists WHERE user_id = $1', [userId]);
}

specialistsRouter.get('/me', async (req, res) => {
  const s = await mySpecialist(req.user!.id);
  const schedule = s
    ? await query(
        `SELECT d.id, d.facility_id, f.name AS facility_name, d.day, to_char(d.start_time, 'HH24:MI') AS start,
                to_char(d.end_time, 'HH24:MI') AS end, d.on_call
           FROM duty_schedules d JOIN facilities f ON f.id = d.facility_id
          WHERE d.specialist_id = $1 ORDER BY d.day, d.start_time`,
        [s.id],
      )
    : [];
  const hospitals = s
    ? await query(
        `SELECT sh.facility_id, sh.position, sh.status, f.name, f.area FROM specialist_hospitals sh JOIN facilities f ON f.id = sh.facility_id
          WHERE sh.specialist_id = $1 ORDER BY f.name`,
        [s.id],
      )
    : [];
  res.json({ profile: s, schedule, hospitals });
});

/** Ask a hospital to confirm you work there (design: "Where you work"). */
specialistsRouter.post('/me/hospitals', async (req, res) => {
  const s = await mySpecialist(req.user!.id);
  if (!s) throw notFound('Create your profile first');
  const b = parse(z.object({ facilityId: z.uuid(), position: z.string().trim().max(40).default('Consultant') }), req.body);
  await assertApprovedHospitals([b.facilityId]);
  await query(
    `INSERT INTO specialist_hospitals (specialist_id, facility_id, position) VALUES ($1, $2, $3)
     ON CONFLICT (specialist_id, facility_id) DO UPDATE SET position = EXCLUDED.position`,
    [s.id, b.facilityId, b.position],
  );
  res.status(201).json({ ok: true });
});

specialistsRouter.delete('/me/hospitals/:facilityId', async (req, res) => {
  const s = await mySpecialist(req.user!.id);
  if (!s) throw notFound();
  await tx(async (c) => {
    await query('DELETE FROM duty_schedules WHERE specialist_id = $1 AND facility_id = $2', [s.id, req.params.facilityId], c);
    await query('DELETE FROM specialist_hospitals WHERE specialist_id = $1 AND facility_id = $2', [s.id, req.params.facilityId], c);
  });
  res.status(204).end();
});

specialistsRouter.put('/me', async (req, res) => {
  const body = parse(
    z.object({
      specialty: z.enum(SPECIALTIES),
      licenceNo: z.string().trim().min(3).max(40),
      bio: z.string().trim().max(500).optional(),
      phone: z.string().optional(),
      title: z.enum(['Dr.', 'Prof.', 'Mr.', 'Mrs.', 'Ms.']).optional(),
      languages: z.array(z.enum(['English', 'Yoruba', 'Hausa', 'Igbo', 'Pidgin'])).optional(),
      yearsExperience: z.number().int().min(0).max(60).optional(),
    }),
    req.body,
  );
  const phone = body.phone ? normalisePhone(body.phone) : null;
  if (body.phone && !phone) throw badRequest('Enter a valid Nigerian phone number');
  const existing = await mySpecialist(req.user!.id);
  const row = await tx(async (c) => {
    const r = existing
      ? await one(
          `UPDATE specialists SET specialty = $2, licence_no = $3, bio = $4, phone = $5, updated_at = now(),
                  title = coalesce($6, title), languages = coalesce($7, languages), years_experience = coalesce($8, years_experience),
                  verification_status = CASE WHEN licence_no <> $3 THEN 'pending' ELSE verification_status END
            WHERE id = $1 RETURNING *`,
          [existing.id, body.specialty, body.licenceNo, body.bio ?? null, phone, body.title ?? null, body.languages ?? null, body.yearsExperience ?? null],
          c,
        )
      : await one(
          `INSERT INTO specialists (user_id, specialty, licence_no, bio, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.user!.id, body.specialty, body.licenceNo, body.bio ?? null, phone],
          c,
        );
    await audit(c, req.user!.id, existing ? 'specialist.update' : 'specialist.register', 'specialist', r.id, body);
    return r;
  });
  res.json(row);
});

async function assertApprovedHospitals(ids: string[]) {
  if (!ids.length) return;
  const rows = await query<{ id: string }>(
    `SELECT id FROM facilities WHERE id = ANY($1) AND type = 'hospital' AND verification_status = 'approved'`,
    [ids],
  );
  if (rows.length !== new Set(ids).size) throw badRequest('Duty locations must be verified hospitals');
}

/** US-10: weekly schedule at verified hospitals. Replaces the whole schedule. */
specialistsRouter.put('/me/schedule', async (req, res) => {
  const s = await mySpecialist(req.user!.id);
  if (!s) throw notFound('Create your profile first');
  const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const { slots } = parse(
    z.object({
      slots: z
        .array(z.object({ facilityId: z.uuid(), day: z.number().int().min(0).max(6), start: time.nullable().optional(), end: time.nullable().optional(), onCall: z.boolean().default(false) }))
        .max(50)
        .refine((xs) => xs.every((x) => x.onCall || (x.start && x.end && x.end > x.start)), 'Each shift must end after it starts'),
    }),
    req.body,
  );
  await assertApprovedHospitals(slots.map((x) => x.facilityId));
  await tx(async (c) => {
    await query('DELETE FROM duty_schedules WHERE specialist_id = $1', [s.id], c);
    for (const x of slots) {
      // Listing a shift at a hospital also asks it to confirm you (if not already linked).
      await query(
        `INSERT INTO specialist_hospitals (specialist_id, facility_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [s.id, x.facilityId],
        c,
      );
      await query(
        'INSERT INTO duty_schedules (specialist_id, facility_id, day, start_time, end_time, on_call) VALUES ($1, $2, $3, $4, $5, $6)',
        [s.id, x.facilityId, x.day, x.onCall ? null : x.start, x.onCall ? null : x.end, x.onCall],
        c,
      );
    }
    await query('UPDATE specialists SET updated_at = now() WHERE id = $1', [s.id], c);
    await audit(c, req.user!.id, 'specialist.schedule', 'specialist', s.id, { slots: slots.length });
  });
  for (const id of new Set(slots.map((x) => x.facilityId))) publishChange(id, 'specialist');
  res.json({ saved: slots.length });
});

/** US-10: "available now" toggle at one verified hospital. */
specialistsRouter.post('/me/availability', async (req, res) => {
  const s = await mySpecialist(req.user!.id);
  if (!s) throw notFound('Create your profile first');
  const body = parse(z.object({ availableNow: z.boolean(), facilityId: z.uuid().optional() }), req.body);
  if (body.availableNow && !body.facilityId) throw badRequest('Choose where you are available');
  if (body.facilityId) {
    await assertApprovedHospitals([body.facilityId]);
    const link = await one(`SELECT status FROM specialist_hospitals WHERE specialist_id = $1 AND facility_id = $2`, [s.id, body.facilityId]);
    if (body.availableNow && link?.status !== 'confirmed') throw badRequest('That hospital has not confirmed you yet');
  }
  const row = await one(
    `UPDATE specialists SET available_now = $2, available_at = CASE WHEN $2 THEN $3::uuid ELSE NULL END, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [s.id, body.availableNow, body.facilityId ?? null],
  );
  for (const id of new Set([s.available_at, row.available_at].filter(Boolean))) publishChange(id, 'specialist');
  res.json(row);
});
