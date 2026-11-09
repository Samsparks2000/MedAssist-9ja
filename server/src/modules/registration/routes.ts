import { type Request, type Response, Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { gateway } from '../../adapters/payments.js';
import { one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { signToken, type Role } from '../../lib/auth.js';
import { normalisePhone } from '../../lib/codes.js';
import { badRequest, conflict, forbidden, parse } from '../../lib/errors.js';
import { consumeOtp } from '../auth/otp.js';
import { findOwnFacility } from '../facilities/service.js';
import { notifyFacilityOwner } from '../notifications/service.js';
import { BED_TYPES, HOSPITAL_SERVICES, PHARMACY_OFFERS, SPECIALTIES } from '../search/vocabulary.js';

/**
 * Self-service registration for pharmacies, hospitals and specialists (design pages 14–19).
 * New applicants prove their phone with a one-time code; the account and listing are created
 * together. Drafts ("Save and finish later") are stored with status 'draft' and can be resumed.
 */
export const registrationRouter = Router();

const phone = z.string().transform((v, ctx) => {
  const p = normalisePhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid Nigerian phone number' });
    return z.NEVER;
  }
  return p;
});
const optionalPhone = z.union([z.literal(''), phone]).optional().nullable();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const dayHours = z.tuple([hhmm, hhmm]).nullable();
const openingHours = z
  .object({ sun: dayHours, mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours })
  .partial();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max = 120) => z.string().trim().max(max);

const account = z.object({
  name: text(80).min(2, 'Enter your name'),
  phone,
  role: text(40).optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
});

const payout = z
  .object({ bankCode: text(20), bankName: text(80).optional(), accountNumber: z.string().regex(/^\d{10}$/, 'Account numbers have 10 digits'), accountName: text(120).optional() })
  .optional()
  .nullable();

const facilityBody = z.object({
  draft: z.boolean().default(false),
  confirm: z.boolean().default(false),
  account,
  name: text(120).min(2, 'Enter the name'),
  phone: optionalPhone,
  email: z.union([z.literal(''), z.email()]).optional().nullable(),
  cacNumber: text(30).optional().nullable(),
  kind: text(60).optional().nullable(),
  ownership: text(60).optional().nullable(),
  emergencyPhone: optionalPhone,
  address: text(200).optional().nullable(),
  area: text(60).optional().nullable(),
  lga: text(60).optional().nullable(),
  landmark: text(200).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  licenceNo: text(40).optional().nullable(),
  licenceExpiry: z.union([z.literal(''), date]).optional().nullable(),
  leadName: text(80).optional().nullable(),
  leadRegNo: text(40).optional().nullable(),
  openingHours: openingHours.default({}),
  open24h: z.boolean().default(false),
  outpatientHours: z.tuple([hhmm, hhmm]).optional().nullable(),
  offers: z.array(text(80)).max(20).default([]),
  wards: z.array(z.object({ subType: z.enum(BED_TYPES), total: z.number().int().min(0).max(2000) })).max(10).default([]),
  staff: z.array(z.object({ name: text(80).min(2), role: text(40), phone })).max(10).default([]),
  payout,
});

const specialistBody = z.object({
  draft: z.boolean().default(false),
  confirm: z.boolean().default(false),
  account,
  title: z.enum(['Dr.', 'Prof.', 'Mr.', 'Mrs.', 'Ms.']).default('Dr.'),
  languages: z.array(z.enum(['English', 'Yoruba', 'Hausa', 'Igbo', 'Pidgin'])).default(['English']),
  specialty: z.enum(SPECIALTIES).optional().nullable(),
  yearsExperience: z.number().int().min(0).max(60).optional().nullable(),
  licenceNo: text(40).optional().nullable(),
  hospitals: z.array(z.object({ facilityId: z.uuid(), position: text(40).default('Consultant') })).max(6).default([]),
  schedule: z
    .array(z.object({ day: z.number().int().min(0).max(6), facilityId: z.uuid(), start: hhmm.nullable(), end: hhmm.nullable(), onCall: z.boolean().default(false) }))
    .max(30)
    .default([]),
});

type FacilityBody = z.infer<typeof facilityBody>;

/** Fields a submission (not a draft) must have, with patient-friendly messages. */
function missingForSubmit(kind: 'pharmacy' | 'hospital', b: FacilityBody): string[] {
  const m: string[] = [];
  if (!b.phone) m.push(kind === 'pharmacy' ? 'Phone for customers' : 'Main phone');
  if (kind === 'hospital' && !b.emergencyPhone) m.push('Emergency line');
  if (!b.address) m.push('Street address');
  if (b.lat == null || b.lng == null) m.push('Map pin');
  if (!b.licenceNo) m.push(kind === 'pharmacy' ? 'PCN premises licence number' : 'State registration number');
  if (kind === 'pharmacy' && !b.leadName) m.push('Superintendent pharmacist');
  if (!b.confirm) m.push('Confirmation tick box');
  return m;
}

/** Resolves the applicant: the signed-in provider, or a new account proven with a phone code. */
async function applicant(req: Request, role: Role, acct: z.infer<typeof account>) {
  if (req.user) {
    if (req.user.role !== role) throw forbidden(`You are signed in as a ${req.user.role} account`);
    return { userId: req.user.id, isNew: false };
  }
  if (!acct.code) throw badRequest('Verify your phone number to continue', [{ path: 'account.code', message: 'Enter the 6-digit code' }]);
  const exists = await one('SELECT 1 FROM users WHERE phone = $1', [acct.phone]);
  if (exists) throw conflict('An account already uses this phone number. Sign in to continue your registration.');
  await consumeOtp(acct.phone, acct.code);
  return { userId: null, isNew: true };
}

async function savePayout(c: pg.PoolClient, facilityId: string, name: string, p: NonNullable<FacilityBody['payout']>) {
  const resolved = await gateway.resolveAccount(p.bankCode, p.accountNumber, name).catch(() => null);
  if (!resolved) throw badRequest('We could not find that bank account. Check the bank and number.');
  const current = await one('SELECT payout_bank_code, payout_account_number, payout_subaccount FROM facilities WHERE id = $1', [facilityId], c);
  let sub = current?.payout_subaccount ?? null;
  if (!sub || current.payout_bank_code !== p.bankCode || current.payout_account_number !== p.accountNumber) {
    sub = (await gateway.createSubaccount({ businessName: name, bankCode: p.bankCode, accountNumber: p.accountNumber })).code;
  }
  await query(
    `UPDATE facilities SET payout_bank_code = $2, payout_bank_name = $3, payout_account_number = $4, payout_account_name = $5,
            payout_subaccount = $6 WHERE id = $1`,
    [facilityId, p.bankCode, p.bankName ?? null, p.accountNumber, resolved.accountName, sub],
    c,
  );
}

function registerFacility(kind: 'pharmacy' | 'hospital') {
  return async (req: Request, res: Response) => {
    const b = parse(facilityBody, req.body);
    if (!b.draft) {
      const missing = missingForSubmit(kind, b);
      if (missing.length) throw badRequest(`Please complete: ${missing.join(', ')}`, missing.map((m) => ({ path: m, message: 'Required' })));
    }
    const allowed = new Set<string>(kind === 'pharmacy' ? PHARMACY_OFFERS : HOSPITAL_SERVICES);
    const offers = b.offers.filter((o) => allowed.has(o));
    const who = await applicant(req, kind, b.account);

    const result = await tx(async (c) => {
      let userId = who.userId;
      if (!userId) {
        const u = await one(
          `INSERT INTO users (name, phone, role, consent_at) VALUES ($1, $2, $3, now()) RETURNING id`,
          [b.account.name, b.account.phone, kind],
          c,
        );
        userId = u!.id as string;
      }
      const existing = who.isNew ? null : await findOwnFacility(userId, c);
      if (existing && existing.owner_id !== userId) throw forbidden('Only the owner can change the registration');
      if (existing?.verification_status === 'approved' && b.draft) throw conflict('Your facility is live; save your changes instead');
      const status = b.draft ? 'draft' : 'pending';
      const values = [
        b.name, kind, b.licenceNo || '', b.address || '', b.lat ?? 0, b.lng ?? 0, b.phone || b.account.phone, b.email || null,
        JSON.stringify(b.openingHours), b.open24h, kind === 'hospital' && b.kind === 'General hospital', b.area || null, b.lga || null,
        b.landmark || null, b.kind || null, b.ownership || null, b.emergencyPhone || null, b.cacNumber || null, b.licenceExpiry || null,
        b.leadName || null, b.leadRegNo || null, offers, b.outpatientHours ? JSON.stringify(b.outpatientHours) : null, status,
      ];
      const fullAddress = b.address ? [b.address, b.area].filter(Boolean).join(', ') : '';
      values[3] = fullAddress;
      const f = existing
        ? await one(
            `UPDATE facilities SET name=$2, type=$3, licence_no=$4, address=$5, lat=$6, lng=$7, phone=$8, email=$9, opening_hours=$10,
                    open_24h=$11, is_general_hospital=$12, area=$13, lga=$14, landmark=$15, kind=$16, ownership=$17, emergency_phone=$18,
                    cac_number=$19, licence_expiry=$20, lead_name=$21, lead_reg_no=$22, offers=$23, outpatient_hours=$24,
                    -- A live listing stays live unless the licence changes, which needs a fresh check.
                    verification_status = CASE WHEN verification_status = 'approved' AND licence_no = $4 THEN 'approved' ELSE $25 END,
                    submitted_at = CASE WHEN $25 = 'pending' AND NOT (verification_status = 'approved' AND licence_no = $4) THEN now() ELSE submitted_at END,
                    last_updated = now()
              WHERE id = $1 RETURNING *`,
            [existing.id, ...values],
            c,
          )
        : await one(
            `INSERT INTO facilities (name, type, licence_no, address, lat, lng, phone, email, opening_hours, open_24h, is_general_hospital,
                                     area, lga, landmark, kind, ownership, emergency_phone, cac_number, licence_expiry, lead_name,
                                     lead_reg_no, offers, outpatient_hours, verification_status, owner_id, submitted_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
                     CASE WHEN $24 = 'pending' THEN now() END)
             RETURNING *`,
            [...values, userId],
            c,
          );

      if (kind === 'hospital') {
        for (const s of offers) {
          await query(`INSERT INTO facility_services (facility_id, service) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [f.id, s], c);
        }
        await query(`DELETE FROM facility_services WHERE facility_id = $1 AND NOT (service = ANY($2))`, [f.id, offers], c);
        for (const w of b.wards) {
          await query(
            `INSERT INTO resources (facility_id, type, sub_type, capacity, available) VALUES ($1, 'bed', $2, $3, 0)
             ON CONFLICT (facility_id, type, sub_type) DO UPDATE SET capacity = EXCLUDED.capacity,
               available = least(resources.available, EXCLUDED.capacity), updated_at = now()`,
            [f.id, w.subType, w.total],
            c,
          );
        }
      }
      for (const s of b.staff) {
        if (s.phone === b.account.phone) continue;
        const u =
          (await one('SELECT id, role FROM users WHERE phone = $1', [s.phone], c)) ??
          (await one(`INSERT INTO users (name, phone, role, consent_at) VALUES ($1, $2, $3, now()) RETURNING id, role`, [s.name, s.phone, kind], c));
        if (u.role !== kind) throw conflict(`${s.phone} already belongs to a ${u.role} account`);
        await query(
          `INSERT INTO facility_staff (facility_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (facility_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [f.id, u.id, s.role],
          c,
        );
      }
      if (b.payout) await savePayout(c, f.id, b.name, b.payout);
      await audit(c, userId, b.draft ? `facility.draft` : 'facility.submit', 'facility', f.id, { kind });
      return { userId, facility: f };
    });

    res.status(who.isNew ? 201 : 200).json({
      facilityId: result.facility.id,
      status: result.facility.verification_status,
      token: who.isNew ? signToken({ id: result.userId, role: kind }) : undefined,
    });
  };
}

registrationRouter.post('/pharmacy', registerFacility('pharmacy'));
registrationRouter.post('/hospital', registerFacility('hospital'));

registrationRouter.post('/specialist', async (req, res) => {
  const b = parse(specialistBody, req.body);
  if (!b.draft) {
    const missing = [!b.specialty && 'Specialty', !b.licenceNo && 'MDCN registration number', !b.hospitals.length && 'At least one hospital', !b.confirm && 'Confirmation tick box'].filter(Boolean);
    if (missing.length) throw badRequest(`Please complete: ${missing.join(', ')}`);
  }
  const linked = new Set(b.hospitals.map((h) => h.facilityId));
  if (b.schedule.some((s) => !linked.has(s.facilityId))) throw badRequest('Schedule shifts must be at hospitals you listed');
  if (b.schedule.some((s) => !s.onCall && (!s.start || !s.end || s.end <= s.start))) throw badRequest('Each shift needs a start and an end time');
  if (b.hospitals.length) {
    const ok = await query(`SELECT id FROM facilities WHERE id = ANY($1) AND type = 'hospital' AND verification_status = 'approved'`, [[...linked]]);
    if (ok.length !== linked.size) throw badRequest('Choose hospitals that are already verified on MedAssist-9ja');
  }
  const who = await applicant(req, 'specialist', b.account);

  const result = await tx(async (c) => {
    let userId = who.userId;
    if (!userId) {
      userId = (await one(`INSERT INTO users (name, phone, role, consent_at) VALUES ($1, $2, 'specialist', now()) RETURNING id`, [b.account.name, b.account.phone], c))!.id as string;
    } else {
      await query('UPDATE users SET name = $2 WHERE id = $1', [userId, b.account.name], c);
    }
    const status = b.draft ? 'draft' : 'pending';
    const existing = await one('SELECT id, verification_status FROM specialists WHERE user_id = $1', [userId], c);
    const s = existing
      ? await one(
          `UPDATE specialists SET title=$2, languages=$3, specialty=coalesce($4, specialty), years_experience=$5, licence_no=coalesce($6, licence_no),
                  verification_status = CASE WHEN verification_status = 'approved' THEN 'approved' ELSE $7 END, updated_at = now()
            WHERE id = $1 RETURNING *`,
          [existing.id, b.title, b.languages, b.specialty ?? null, b.yearsExperience ?? null, b.licenceNo || null, status],
          c,
        )
      : await one(
          `INSERT INTO specialists (user_id, title, languages, specialty, years_experience, licence_no, verification_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [userId, b.title, b.languages, b.specialty ?? 'Internal Medicine', b.yearsExperience ?? null, b.licenceNo || '', status],
          c,
        );
    for (const h of b.hospitals) {
      await query(
        `INSERT INTO specialist_hospitals (specialist_id, facility_id, position) VALUES ($1, $2, $3)
         ON CONFLICT (specialist_id, facility_id) DO UPDATE SET position = EXCLUDED.position`,
        [s.id, h.facilityId, h.position],
        c,
      );
    }
    await query('DELETE FROM specialist_hospitals WHERE specialist_id = $1 AND NOT (facility_id = ANY($2))', [s.id, [...linked]], c);
    await query('DELETE FROM duty_schedules WHERE specialist_id = $1', [s.id], c);
    for (const x of b.schedule) {
      await query(
        'INSERT INTO duty_schedules (specialist_id, facility_id, day, start_time, end_time, on_call) VALUES ($1, $2, $3, $4, $5, $6)',
        [s.id, x.facilityId, x.day, x.onCall ? null : x.start, x.onCall ? null : x.end, x.onCall],
        c,
      );
    }
    await audit(c, userId, b.draft ? 'specialist.draft' : 'specialist.submit', 'specialist', s.id);
    return { userId, specialist: s };
  });
  // Each listed hospital is asked to confirm the doctor works there.
  if (!b.draft) {
    const pending = await query(`SELECT facility_id FROM specialist_hospitals WHERE specialist_id = $1 AND status = 'pending'`, [result.specialist.id]);
    for (const p of pending) {
      await notifyFacilityOwner(p.facility_id, {
        kind: 'specialist_link',
        title: 'Confirm a doctor',
        body: `${b.title} ${b.account.name} (${b.specialty}) says they work at your hospital.`,
        link: '/dashboard/specialists',
      });
    }
  }
  res.status(who.isNew ? 201 : 200).json({
    specialistId: result.specialist.id,
    status: result.specialist.verification_status,
    token: who.isNew ? signToken({ id: result.userId, role: 'specialist' }) : undefined,
  });
});

/** Resumes a saved registration for the signed-in provider. */
registrationRouter.get('/mine', async (req, res) => {
  if (!req.user) {
    res.json(null);
    return;
  }
  const user = await one('SELECT name, phone, role FROM users WHERE id = $1', [req.user.id]);
  if (req.user.role === 'specialist') {
    const s = await one('SELECT * FROM specialists WHERE user_id = $1', [req.user.id]);
    const hospitals = s
      ? await query(
          `SELECT sh.facility_id, sh.position, sh.status, f.name, f.area FROM specialist_hospitals sh JOIN facilities f ON f.id = sh.facility_id
            WHERE sh.specialist_id = $1`,
          [s.id],
        )
      : [];
    const schedule = s
      ? await query(
          `SELECT day, facility_id, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end", on_call
             FROM duty_schedules WHERE specialist_id = $1 ORDER BY day`,
          [s.id],
        )
      : [];
    const documents = s ? await query('SELECT id, kind, filename, size, created_at FROM documents WHERE specialist_id = $1', [s.id]) : [];
    res.json({ kind: 'specialist', user, specialist: s, hospitals, schedule, documents });
    return;
  }
  const f = await findOwnFacility(req.user.id);
  if (!f) {
    res.json({ kind: req.user.role, user, facility: null });
    return;
  }
  const [wards, services, staff, documents] = await Promise.all([
    query(`SELECT sub_type, capacity FROM resources WHERE facility_id = $1 AND type = 'bed' ORDER BY sub_type`, [f.id]),
    query(`SELECT service, status FROM facility_services WHERE facility_id = $1`, [f.id]),
    query(`SELECT u.id, u.name, u.phone, s.role FROM facility_staff s JOIN users u ON u.id = s.user_id WHERE s.facility_id = $1`, [f.id]),
    query('SELECT id, kind, filename, size, created_at FROM documents WHERE facility_id = $1', [f.id]),
  ]);
  res.json({ kind: f.type, user, facility: f, wards, services, staff, documents });
});
