import { Router } from 'express';
import { z } from 'zod';
import { db, one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { normalisePhone } from '../../lib/codes.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors.js';
import { localNow } from '../../lib/time.js';
import { ownFacility, publishChange, touchFacility } from '../facilities/service.js';
import { notify } from '../notifications/service.js';
import { HOSPITAL_SERVICES } from '../search/vocabulary.js';

/** Services and equipment status, and the specialist rota (hospital dashboard). */
export const hospitalRouter = Router();
hospitalRouter.use(requireAuth('hospital'));

hospitalRouter.get('/services', async (req, res) => {
  const f = await ownFacility(req.user!);
  const rows = await query(`SELECT service, status, updated_at FROM facility_services WHERE facility_id = $1`, [f.id]);
  res.json({ all: HOSPITAL_SERVICES, services: rows });
});

hospitalRouter.put('/services', async (req, res) => {
  const f = await ownFacility(req.user!);
  const { items } = parse(
    z.object({ items: z.array(z.object({ service: z.enum(HOSPITAL_SERVICES), status: z.enum(['available', 'under_repair', 'not_available']) })).max(30) }),
    req.body,
  );
  await tx(async (c) => {
    for (const s of items) {
      await query(
        `INSERT INTO facility_services (facility_id, service, status) VALUES ($1, $2, $3)
         ON CONFLICT (facility_id, service) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
        [f.id, s.service, s.status],
        c,
      );
    }
    await touchFacility(c, f.id);
    await audit(c, req.user!.id, 'services.update', 'facility', f.id, { items });
  });
  publishChange(f.id, 'resource');
  res.json({ ok: true });
});

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon–Fri 8 am–4 pm · on call Sun" from weekly rows. */
function usualHours(rows: { day: number; start: string | null; end: string | null; on_call: boolean }[]): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const hh = h % 12 || 12;
    return `${hh}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
  };
  const groups = new Map<string, number[]>();
  const onCall: number[] = [];
  for (const r of rows) {
    if (r.on_call) onCall.push(r.day);
    else groups.set(`${fmt(r.start!)}–${fmt(r.end!)}`, [...(groups.get(`${fmt(r.start!)}–${fmt(r.end!)}`) ?? []), r.day]);
  }
  const days = (ds: number[]) => {
    const s = [...new Set(ds)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    if (s.length === 7) return 'Daily';
    const mondayFirst = s.map((d) => (d + 6) % 7);
    const contiguous = mondayFirst.every((d, i) => i === 0 || d === mondayFirst[i - 1] + 1);
    return contiguous && s.length > 2 ? `${DAY[s[0]]}–${DAY[s.at(-1)!]}` : s.map((d) => DAY[d]).join(', ');
  };
  const parts = [...groups].map(([time, ds]) => `${days(ds)} ${time}`);
  if (onCall.length) parts.push(`on call ${days(onCall)}`);
  return parts.join(' · ') || 'No schedule yet';
}

hospitalRouter.get('/specialists', async (req, res) => {
  const f = await ownFacility(req.user!);
  const { day, minutes } = localNow();
  const docs = await query(
    `SELECT s.id, u.name, s.title, s.specialty, s.licence_no, s.verification_status, sh.status AS link_status, sh.position,
            s.available_now AND s.available_at = $1 AS available_now,
            coalesce((SELECT json_agg(json_build_object('day', d.day, 'start', to_char(d.start_time, 'HH24:MI'), 'end', to_char(d.end_time, 'HH24:MI'), 'on_call', d.on_call))
                        FROM duty_schedules d WHERE d.specialist_id = s.id AND d.facility_id = $1), '[]') AS schedule
       FROM specialist_hospitals sh JOIN specialists s ON s.id = sh.specialist_id JOIN users u ON u.id = s.user_id
      WHERE sh.facility_id = $1 AND sh.status <> 'declined'
      ORDER BY (sh.status = 'pending') DESC, u.name`,
    [f.id],
  );
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  res.json(
    docs.map((d) => {
      const today = (d.schedule as any[]).filter((s) => s.day === day);
      const onDuty = d.available_now || today.some((s) => !s.on_call && minutes >= toMin(s.start) && minutes < toMin(s.end));
      const later = today.some((s) => !s.on_call && minutes < toMin(s.start));
      return {
        ...d,
        today: onDuty ? 'on_duty' : today.some((s) => s.on_call) ? 'on_call' : later ? 'later_today' : 'off',
        usualHours: usualHours(d.schedule),
      };
    }),
  );
});

hospitalRouter.post('/specialists/:id/:decision', async (req, res) => {
  const f = await ownFacility(req.user!);
  const decision = req.params.decision;
  if (decision !== 'confirm' && decision !== 'decline') throw notFound();
  const row = await one(
    `UPDATE specialist_hospitals SET status = $3 WHERE specialist_id = $1 AND facility_id = $2
     RETURNING specialist_id, (SELECT user_id FROM specialists WHERE id = $1) AS user_id`,
    [req.params.id, f.id, decision === 'confirm' ? 'confirmed' : 'declined'],
  );
  if (!row) throw notFound('That doctor has not listed your hospital');
  await audit(db(), req.user!.id, `specialist_link.${decision}`, 'specialist', row.specialist_id, { facilityId: f.id });
  await notify({
    userId: row.user_id,
    kind: 'specialist_link',
    title: decision === 'confirm' ? `${f.name} confirmed you` : `${f.name} did not confirm you`,
    body: decision === 'confirm' ? 'Your schedule there is now visible to patients.' : 'Contact the hospital if this is a mistake.',
    link: '/dashboard',
  });
  publishChange(f.id, 'specialist');
  res.json({ ok: true });
});

/** Staff accounts: people who may update the listing; each signs in with a code to their phone. */
export const staffRouter = Router();
staffRouter.use(requireAuth('pharmacy', 'hospital'));

staffRouter.get('/', async (req, res) => {
  const f = await ownFacility(req.user!);
  const owner = await one('SELECT id, name, phone FROM users WHERE id = $1', [f.owner_id]);
  const staff = await query(
    `SELECT u.id, u.name, u.phone, s.role, s.added_at FROM facility_staff s JOIN users u ON u.id = s.user_id WHERE s.facility_id = $1 ORDER BY s.added_at`,
    [f.id],
  );
  res.json({ owner, staff, canManage: f.owner_id === req.user!.id });
});

staffRouter.post('/', async (req, res) => {
  const f = await ownFacility(req.user!);
  if (f.owner_id !== req.user!.id) throw forbidden('Only the account owner can add staff');
  const b = parse(z.object({ name: z.string().trim().min(2).max(80), role: z.string().trim().min(2).max(40), phone: z.string() }), req.body);
  const phone = normalisePhone(b.phone);
  if (!phone) throw badRequest('Enter a valid Nigerian phone number');
  const role = req.user!.role;
  const user =
    (await one('SELECT id, role FROM users WHERE phone = $1', [phone])) ??
    (await one(`INSERT INTO users (name, phone, role, consent_at) VALUES ($1, $2, $3, now()) RETURNING id, role`, [b.name, phone, role]));
  if (user.role !== role) throw conflict(`That number already belongs to a ${user.role} account`);
  if (user.id === f.owner_id) throw conflict('That is the owner account');
  await query(
    `INSERT INTO facility_staff (facility_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (facility_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [f.id, user.id, b.role],
  );
  await audit(db(), req.user!.id, 'staff.add', 'facility', f.id, { userId: user.id, role: b.role });
  res.status(201).json({ id: user.id });
});

staffRouter.delete('/:userId', async (req, res) => {
  const f = await ownFacility(req.user!);
  if (f.owner_id !== req.user!.id) throw forbidden('Only the account owner can remove staff');
  await query('DELETE FROM facility_staff WHERE facility_id = $1 AND user_id = $2', [f.id, req.params.userId]);
  res.status(204).end();
});
