import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { normalisePhone } from '../../lib/codes.js';
import { conflict, forbidden, notFound, parse } from '../../lib/errors.js';
import { config } from '../../config.js';
import { collectDeadline, DAY_KEYS, hoursStatus, isOpenNow, localNow } from '../../lib/time.js';
import { type FacilityRow, findOwnFacility, ownFacility, publicFacility, publishChange, touchFacility } from './service.js';

export const facilitiesRouter = Router();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const dayHours = z.tuple([hhmm, hhmm]).nullable();
const openingHours = z
  .object({ sun: dayHours, mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours })
  .partial();

const phone = z.string().transform((v, ctx) => {
  const p = normalisePhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid Nigerian phone number' });
    return z.NEVER;
  }
  return p;
});

const facilityInput = z.object({
  name: z.string().trim().min(2).max(120),
  licenceNo: z.string().trim().min(3).max(40),
  address: z.string().trim().min(5).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone,
  email: z.email().optional().nullable(),
  openingHours: openingHours.default({}),
  open24h: z.boolean().default(false),
  isGeneralHospital: z.boolean().default(false),
  payoutSubaccount: z.string().trim().max(40).optional().nullable(),
});

facilitiesRouter.post('/', requireAuth('pharmacy', 'hospital'), async (req, res) => {
  const body = parse(facilityInput, req.body);
  const existing = await one('SELECT 1 FROM facilities WHERE owner_id = $1', [req.user!.id]);
  if (existing) throw conflict('You have already registered a facility');
  const facility = await tx(async (c) => {
    const f = await one<FacilityRow>(
      `INSERT INTO facilities (owner_id, name, type, licence_no, address, lat, lng, phone, email, opening_hours,
         open_24h, is_general_hospital, payout_subaccount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        req.user!.id, body.name, req.user!.role, body.licenceNo, body.address, body.lat, body.lng, body.phone,
        body.email ?? null, JSON.stringify(body.openingHours), body.open24h,
        req.user!.role === 'hospital' && body.isGeneralHospital, body.payoutSubaccount ?? null,
      ],
      c,
    );
    await audit(c, req.user!.id, 'facility.register', 'facility', f!.id, { name: body.name });
    return f!;
  });
  res.status(201).json(facility);
});

facilitiesRouter.get('/mine', requireAuth('pharmacy', 'hospital'), async (req, res) => {
  res.json(await ownFacility(req.user!));
});

facilitiesRouter.patch('/mine', requireAuth('pharmacy', 'hospital'), async (req, res) => {
  const current = await ownFacility(req.user!);
  const body = parse(facilityInput.partial(), req.body);
  // Changing the licence number sends the facility back through verification (US-30).
  const licenceChanged = body.licenceNo !== undefined && body.licenceNo !== current.licence_no;
  const f = await tx(async (c) => {
    const row = await one<FacilityRow>(
      `UPDATE facilities SET
         name = coalesce($2, name), licence_no = coalesce($3, licence_no), address = coalesce($4, address),
         lat = coalesce($5, lat), lng = coalesce($6, lng), phone = coalesce($7, phone), email = coalesce($8, email),
         opening_hours = coalesce($9, opening_hours), open_24h = coalesce($10, open_24h),
         is_general_hospital = coalesce($11, is_general_hospital), payout_subaccount = coalesce($12, payout_subaccount),
         verification_status = CASE WHEN $13 THEN 'pending' ELSE verification_status END
       WHERE id = $1 RETURNING *`,
      [
        current.id, body.name, body.licenceNo, body.address, body.lat, body.lng, body.phone, body.email,
        body.openingHours ? JSON.stringify(body.openingHours) : null, body.open24h,
        current.type === 'hospital' ? body.isGeneralHospital : false, body.payoutSubaccount, licenceChanged,
      ],
      c,
    );
    await touchFacility(c, current.id);
    await audit(c, req.user!.id, 'facility.update', 'facility', current.id, { fields: Object.keys(body) });
    return row!;
  });
  publishChange(f.id, 'facility');
  res.json(f);
});

/** One-tap "everything is still accurate", so fresh data costs facilities almost nothing (risk mitigation, US-11). */
facilitiesRouter.post('/mine/confirm', requireAuth('pharmacy', 'hospital'), async (req, res) => {
  const f = await ownFacility(req.user!);
  await tx(async (c) => {
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'facility.confirm_current', 'facility', f.id);
  });
  publishChange(f.id, 'facility');
  res.json({ ok: true });
});

/** "Collect by" if a reservation were made now (shown before the customer commits). */
facilitiesRouter.get('/:id/collect-by', async (req, res) => {
  const f = await one<FacilityRow>('SELECT * FROM facilities WHERE id = $1', [req.params.id]);
  if (!f) throw notFound('Facility not found');
  res.json({ collectBy: collectDeadline(f.opening_hours, f.open_24h, config.reservations.holdMinutes).toISOString(), openNow: isOpenNow(f.opening_hours, f.open_24h) });
});

/** Approved hospitals, used by specialists to link duty schedules (US-10). */
facilitiesRouter.get('/hospitals', async (_req, res) => {
  res.json(
    await query(
      `SELECT id, name, address FROM facilities WHERE type = 'hospital' AND verification_status = 'approved' ORDER BY name`,
    ),
  );
});

facilitiesRouter.get('/:id', async (req, res) => {
  const f = await one<FacilityRow>('SELECT * FROM facilities WHERE id = $1', [req.params.id]);
  if (!f) throw notFound('Facility not found');
  const mine = req.user ? (await findOwnFacility(req.user.id))?.id === f.id : false;
  const isOwner = mine || req.user?.role === 'admin';
  if (f.verification_status !== 'approved' && !isOwner) throw forbidden('This facility is not verified yet');

  // Everything the facility lists, including items now out of stock ("Tell me when back").
  const drugs = await query(
    `SELECT d.id AS drug_id, d.brand_name, d.generic_name, d.strength, d.form, d.category, d.pack,
            coalesce(sum(i.quantity - i.reserved) FILTER (WHERE i.expiry_date > current_date), 0)::int AS available,
            min(i.price) FILTER (WHERE i.expiry_date > current_date AND i.quantity > i.reserved) AS price,
            max(i.price) AS last_price, max(i.updated_at) AS updated_at, max(i.reorder_level) AS reorder_level,
            (array_agg(i.batch_no ORDER BY i.expiry_date) FILTER (WHERE i.expiry_date > current_date AND i.quantity > i.reserved))[1] AS batch_no,
            min(i.expiry_date) FILTER (WHERE i.expiry_date > current_date AND i.quantity > i.reserved) AS expiry_date,
            bool_or(i.needs_prescription) AS needs_prescription, bool_or(i.refrigerated) AS refrigerated,
            bool_and(i.allow_reservations) AS allow_reservations
       FROM inventory_items i JOIN drug_catalogue d ON d.id = i.drug_id
      WHERE i.facility_id = $1
      GROUP BY d.id ORDER BY (coalesce(sum(i.quantity - i.reserved) FILTER (WHERE i.expiry_date > current_date), 0) > 0) DESC, d.brand_name`,
    [f.id],
  );
  const services = await query(`SELECT service, status FROM facility_services WHERE facility_id = $1 ORDER BY service`, [f.id]);
  const resources = await query(
    `SELECT id, type, sub_type, capacity, available, status, price, updated_at FROM resources
      WHERE facility_id = $1 ORDER BY type, sub_type`,
    [f.id],
  );
  const { day } = localNow();
  const specialists = await query(
    `SELECT DISTINCT s.id, u.name, s.specialty,
            (s.available_now AND s.available_at = $1) AS available_now, bool_or(d.on_call) OVER (PARTITION BY s.id) AS on_call
       FROM specialists s JOIN users u ON u.id = s.user_id
       JOIN specialist_hospitals sh ON sh.specialist_id = s.id AND sh.facility_id = $1 AND sh.status = 'confirmed'
       LEFT JOIN duty_schedules d ON d.specialist_id = s.id AND d.facility_id = $1 AND d.day = $2
      WHERE s.verification_status = 'approved'
        AND ((s.available_now AND s.available_at = $1)
             OR d.on_call OR (now() AT TIME ZONE 'Africa/Lagos')::time BETWEEN d.start_time AND d.end_time)`,
    [f.id, day],
  );
  const rating = await one<{ avg: number | null; count: number }>(
    `SELECT avg(score)::numeric(3,2) AS avg, count(*)::int AS count FROM feedback WHERE facility_id = $1 AND type = 'rating'`,
    [f.id],
  );
  const today = f.opening_hours[DAY_KEYS[day]];
  res.json({
    ...publicFacility(f),
    openNow: isOpenNow(f.opening_hours, f.open_24h),
    hours: hoursStatus(f.opening_hours, f.open_24h).label,
    closesAt: f.open_24h ? null : (today?.[1] ?? null),
    today: day,
    area: f.area,
    landmark: f.landmark,
    emergencyPhone: f.emergency_phone,
    trust: {
      licenceNo: f.licence_no,
      leadName: f.lead_name,
      verifiedAt: (f as unknown as { verified_at: string | null }).verified_at,
      licenceType: f.type === 'pharmacy' ? 'PCN premises licence' : 'State Ministry of Health registration',
    },
    drugs,
    services,
    resources,
    specialists,
    rating,
  });
});
