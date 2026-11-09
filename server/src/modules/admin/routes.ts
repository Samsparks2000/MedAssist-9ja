import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { requireAuth } from '../../lib/auth.js';
import { notFound, parse } from '../../lib/errors.js';
import { publishChange } from '../facilities/service.js';
import { notify } from '../notifications/service.js';
import { sendStaleReminders } from './service.js';

export const adminRouter = Router();
adminRouter.use(requireAuth('admin'));

adminRouter.get('/stats', async (_req, res) => {
  const s = await one(`
    SELECT
      (SELECT count(*) FROM facilities WHERE verification_status = 'approved')::int AS facilities_live,
      (SELECT count(*) FROM facilities WHERE verification_status = 'pending')::int
        + (SELECT count(*) FROM specialists WHERE verification_status = 'pending')::int AS pending_verifications,
      (SELECT max(extract(day FROM now() - submitted_at))::int FROM facilities WHERE verification_status = 'pending') AS oldest_pending_days,
      (SELECT count(*) FROM facilities WHERE verification_status = 'approved'
          AND last_updated < now() - make_interval(hours => ${Number(config.search.staleFlagHours)}))::int AS stale_listings,
      (SELECT count(*) FROM feedback WHERE type = 'complaint' AND status = 'open' AND category = 'Refund')::int AS refund_complaints,
      (SELECT count(*) FROM payments WHERE status = 'failed' AND created_at > date_trunc('day', now()))::int AS failed_payments_today,
      (SELECT count(*) FROM users WHERE role = 'patient')::int AS patients,
      (SELECT count(*) FROM feedback WHERE type = 'complaint' AND status = 'open')::int AS open_complaints,
      (SELECT round(100.0 * count(*) FILTER (WHERE last_updated > now() - interval '24 hours') / nullif(count(*), 0), 1)
         FROM facilities WHERE verification_status = 'approved') AS pct_updated_24h,
      (SELECT round(100.0 * count(*) FILTER (WHERE status IN ('success', 'refund_pending', 'refunded'))
                    / nullif(count(*) FILTER (WHERE status <> 'initialized'), 0), 1) FROM payments) AS payment_success_pct,
      (SELECT count(*) FROM search_log WHERE created_at > now() - interval '7 days')::int AS searches_7d,
      (SELECT count(*) FROM search_log WHERE created_at > now() - interval '7 days' AND result_count = 0)::int AS unmet_searches_7d`);
  res.json(s);
});

/** US-30: verification queue for facilities and specialists. */
adminRouter.get('/verifications', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  const facilities = await query(
    `SELECT f.id, f.name, f.type, f.kind, f.licence_no, f.licence_expiry, f.address, f.area, f.lga, f.landmark, f.lat, f.lng,
            f.phone, f.emergency_phone, f.email, f.cac_number, f.lead_name, f.lead_reg_no, f.offers, f.verification_status,
            f.verification_note, f.verification_checklist, f.created_at, coalesce(f.submitted_at, f.created_at) AS submitted_at,
            f.payout_bank_name, f.payout_account_name, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
            (SELECT coalesce(json_agg(json_build_object('id', d.id, 'kind', d.kind, 'filename', d.filename, 'size', d.size, 'mime', d.mime)), '[]')
               FROM documents d WHERE d.facility_id = f.id) AS documents
       FROM facilities f LEFT JOIN users u ON u.id = f.owner_id
      WHERE f.verification_status = $1 ORDER BY coalesce(f.submitted_at, f.created_at)`,
    [status],
  );
  const specialists = await query(
    `SELECT s.id, s.title, u.name, u.email, u.phone, s.specialty, s.licence_no, s.years_experience, s.languages,
            s.verification_status, s.verification_note, s.updated_at AS submitted_at,
            (SELECT coalesce(json_agg(json_build_object('name', f.name, 'status', sh.status)), '[]')
               FROM specialist_hospitals sh JOIN facilities f ON f.id = sh.facility_id WHERE sh.specialist_id = s.id) AS hospitals,
            (SELECT coalesce(json_agg(json_build_object('id', d.id, 'kind', d.kind, 'filename', d.filename, 'size', d.size, 'mime', d.mime)), '[]')
               FROM documents d WHERE d.specialist_id = s.id) AS documents
       FROM specialists s JOIN users u ON u.id = s.user_id
      WHERE s.verification_status = $1 ORDER BY s.updated_at`,
    [status],
  );
  res.json({ facilities, specialists });
});

const decision = z
  .object({
    decision: z.enum(['approve', 'reject', 'suspend', 'request_info']),
    reason: z.string().trim().max(500).optional(),
    checklist: z.record(z.string().max(60), z.boolean()).optional(),
  })
  .refine((d) => d.decision === 'approve' || (d.reason && d.reason.length >= 3), { message: 'Write a note to the applicant', path: ['reason'] });
const statusFor = { approve: 'approved', reject: 'rejected', suspend: 'suspended', request_info: 'info_requested' } as const;
const decisionTitle = { approve: 'verified', reject: 'not approved', suspend: 'suspended', request_info: 'needs more information' } as const;

/** Saves the reviewer's checklist without deciding yet. */
adminRouter.put('/facilities/:id/checklist', async (req, res) => {
  const { checklist } = parse(z.object({ checklist: z.record(z.string().max(60), z.boolean()) }), req.body);
  await query('UPDATE facilities SET verification_checklist = $2 WHERE id = $1', [req.params.id, JSON.stringify(checklist)]);
  res.json({ ok: true });
});

adminRouter.post('/facilities/:id/verify', async (req, res) => {
  const body = parse(decision, req.body);
  const f = await tx(async (c) => {
    const row = await one(
      `UPDATE facilities SET verification_status = $2, verification_note = $3,
              verified_at = CASE WHEN $2 = 'approved' THEN now() ELSE verified_at END,
              verification_checklist = coalesce($4, verification_checklist),
              last_updated = CASE WHEN $2 = 'approved' THEN now() ELSE last_updated END
        WHERE id = $1 RETURNING id, name, owner_id, verification_status`,
      [req.params.id, statusFor[body.decision], body.reason ?? null, body.checklist ? JSON.stringify(body.checklist) : null],
      c,
    );
    if (!row) throw notFound('Facility not found');
    await audit(c, req.user!.id, `facility.${body.decision}`, 'facility', row.id, { reason: body.reason, checklist: body.checklist });
    return row;
  });
  if (f.owner_id) {
    await notify({
      userId: f.owner_id,
      kind: 'verification',
      title: `${f.name} ${decisionTitle[body.decision]}`,
      body: body.decision === 'approve' ? `${f.name} is now live with a verified badge. Add your stock from the dashboard.` : (body.reason ?? ''),
      link: body.decision === 'approve' ? '/dashboard' : '/register',
      channels: ['sms', 'email'],
    });
  }
  publishChange(f.id, 'facility');
  res.json(f);
});

adminRouter.post('/specialists/:id/verify', async (req, res) => {
  const body = parse(decision, req.body);
  const s = await tx(async (c) => {
    const row = await one(
      `UPDATE specialists SET verification_status = $2, verification_note = $3,
              available_now = CASE WHEN $2 = 'approved' THEN available_now ELSE false END
        WHERE id = $1 RETURNING id, user_id, specialty, available_at`,
      [req.params.id, statusFor[body.decision], body.reason ?? null],
      c,
    );
    if (!row) throw notFound('Specialist not found');
    await audit(c, req.user!.id, `specialist.${body.decision}`, 'specialist', row.id, { reason: body.reason });
    return row;
  });
  await notify({
    userId: s.user_id,
    kind: 'verification',
    title: `Your profile ${decisionTitle[body.decision]}`,
    body: body.decision === 'approve' ? 'Patients can now find you when you are on duty.' : (body.reason ?? ''),
    link: '/dashboard',
    channels: ['sms', 'email'],
  });
  if (s.available_at) publishChange(s.available_at, 'specialist');
  res.json(s);
});

/** FR-13 / US-11: data freshness monitoring. */
adminRouter.get('/freshness', async (_req, res) => {
  res.json(
    await query(
      `SELECT id, name, type, phone, last_updated, stale_reminded_at,
              round(extract(epoch FROM now() - last_updated) / 3600)::int AS hours_since_update,
              last_updated < now() - make_interval(hours => $1) AS hidden
         FROM facilities WHERE verification_status = 'approved' AND last_updated < now() - interval '24 hours'
        ORDER BY last_updated`,
      [config.search.freshnessLimitHours],
    ),
  );
});

adminRouter.post('/freshness/remind', async (_req, res) => {
  res.json({ reminded: await sendStaleReminders(true) });
});

adminRouter.get('/complaints', async (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  res.json(
    await query(
      `SELECT fb.id, fb.comment, fb.status, fb.resolution, fb.created_at, fb.order_id, fb.category, f.id AS facility_id, f.name AS facility_name,
              u.name AS user_name, u.phone AS user_phone, o.pickup_code
         FROM feedback fb JOIN facilities f ON f.id = fb.facility_id JOIN users u ON u.id = fb.user_id
         LEFT JOIN orders o ON o.id = fb.order_id
        WHERE fb.type = 'complaint' AND fb.status = $1 ORDER BY fb.created_at DESC`,
      [status],
    ),
  );
});

adminRouter.post('/complaints/:id/resolve', async (req, res) => {
  const { resolution } = parse(z.object({ resolution: z.string().trim().min(3).max(500) }), req.body);
  const row = await tx(async (c) => {
    const r = await one(
      `UPDATE feedback SET status = 'resolved', resolution = $2 WHERE id = $1 AND type = 'complaint' RETURNING id, user_id`,
      [req.params.id, resolution],
      c,
    );
    if (!r) throw notFound('Complaint not found');
    await audit(c, req.user!.id, 'complaint.resolve', 'feedback', r.id, { resolution });
    return r;
  });
  await notify({ userId: row.user_id, kind: 'complaint', title: 'Complaint resolved', body: resolution });
  res.json({ ok: true });
});

adminRouter.get('/facilities', async (req, res) => {
  const q = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%';
  res.json(
    await query(
      `SELECT f.id, f.name, f.type, f.area, f.address, f.phone, f.verification_status, f.last_updated, f.reliability_score,
              (SELECT count(*) FROM feedback fb WHERE fb.facility_id = f.id AND fb.type = 'complaint' AND fb.status = 'open')::int AS open_complaints
         FROM facilities f WHERE f.name ILIKE $1 OR f.area ILIKE $1 ORDER BY f.name LIMIT 300`,
      [q],
    ),
  );
});

adminRouter.get('/catalogue-requests', async (_req, res) => {
  res.json(
    await query(
      `SELECT r.id, r.name, r.details, r.status, r.created_at, f.name AS facility_name
         FROM catalogue_requests r LEFT JOIN facilities f ON f.id = r.facility_id ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 100`,
    ),
  );
});

adminRouter.post('/catalogue-requests/:id', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['added', 'declined']) }), req.body);
  const r = await one(`UPDATE catalogue_requests SET status = $2 WHERE id = $1 RETURNING id, requested_by, name`, [req.params.id, status]);
  if (!r) throw notFound();
  if (r.requested_by) {
    await notify({
      userId: r.requested_by,
      kind: 'catalogue',
      title: status === 'added' ? 'Medicine added to the catalogue' : 'Catalogue request declined',
      body: status === 'added' ? `${r.name} can now be added to your stock.` : `${r.name} was not added. Contact support for details.`,
      link: '/dashboard/inventory/add',
    });
  }
  res.json({ ok: true });
});

adminRouter.get('/payments', async (_req, res) => {
  res.json(
    await query(
      `SELECT p.reference, p.amount, p.status, p.method, p.gateway, p.created_at, p.paid_at, p.refunded_at, p.refund_due_at,
              f.name AS facility_name, o.id AS order_id
         FROM payments p JOIN orders o ON o.id = p.order_id JOIN facilities f ON f.id = o.facility_id
        ORDER BY p.created_at DESC LIMIT 200`,
    ),
  );
});

adminRouter.get('/unmet-searches', async (_req, res) => {
  res.json(
    await query(
      `SELECT query, target, count(*)::int AS times, max(created_at) AS last_searched
         FROM search_log WHERE result_count = 0 AND created_at > now() - interval '30 days'
        GROUP BY query, target ORDER BY times DESC LIMIT 50`,
    ),
  );
});

adminRouter.get('/audit', async (req, res) => {
  const entity = typeof req.query.entity === 'string' ? req.query.entity : null;
  res.json(
    await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, u.name AS actor_name, u.role AS actor_role
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ($1::text IS NULL OR a.entity = $1) ORDER BY a.id DESC LIMIT 200`,
      [entity],
    ),
  );
});
