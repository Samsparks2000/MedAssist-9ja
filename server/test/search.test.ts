import { describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { AJAH, auth, facilityId, http, IKEJA, IKORODU, providerToken, useDb, YABA } from './helpers.js';

useDb();

const search = (params: Record<string, string | number>) =>
  http().get('/api/search').query(params);

describe('neighbourhood search (O6, US-27, US-28)', () => {
  it('returns only facilities that have the resource, nearest first', async () => {
    const res = await search({ target: 'resource:bed:ICU', ...IKEJA });
    expect(res.status).toBe(200);
    const names = res.body.results.map((r: any) => r.facility.name);
    expect(names[0]).toBe('Bello Specialist Hospital');
    // Island General lists ICU beds but has none free.
    expect(names).not.toContain('Island General Hospital');
    for (const r of res.body.results) {
      expect(r.available).toBeGreaterThan(0);
      expect(r.facility.verified).toBe(true);
      expect(r).toHaveProperty('etaMinutes');
      expect(r).toHaveProperty('minutesAgo');
    }
    const d = res.body.results.map((r: any) => r.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it('widens the radius 5 → 10 → 20 km when nothing is close', async () => {
    const res = await search({ q: 'Lantus', ...IKORODU });
    expect(res.body.target.kind).toBe('drug');
    expect(res.body.expanded).toBe(true);
    expect(res.body.radiusKm).toBe(20);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it('falls back to 112 and the nearest general hospital when nothing is within 20 km', async () => {
    const res = await search({ target: 'resource:equipment:MRI scanner', ...YABA });
    expect(res.body.results).toEqual([]);
    expect(res.body.fallback.emergencyNumber).toBe('112');
    expect(res.body.fallback.nearestGeneralHospital.name).toBe('Mainland General Hospital');
  });

  it('understands misspellings, generic names and plain words (US-02)', async () => {
    const insulin = await search({ q: 'insullin', ...YABA });
    expect(insulin.body.target.kind).toBe('drug');
    expect(insulin.body.results.length).toBeGreaterThan(0);

    const para = await search({ q: 'paracetamol', ...YABA });
    expect(para.body.target.spec).toBe('drug-generic:Paracetamol');

    const blood = await search({ q: 'o negative', ...YABA });
    expect(blood.body.target.spec).toBe('resource:blood:O-');

    const heart = await search({ q: 'heart doctor', ...IKEJA });
    expect(heart.body.target.spec).toBe('specialist:Cardiology');
  });

  it('flags data older than 24 hours (US-08)', async () => {
    const res = await search({ q: 'Coartem', ...AJAH });
    const ajah = res.body.results.find((r: any) => r.facility.name === 'Ajah Community Pharmacy');
    expect(ajah).toBeDefined();
    expect(ajah.stale).toBe(true);
    const fresh = res.body.results.find((r: any) => r.facility.name !== 'Ajah Community Pharmacy');
    if (fresh) expect(fresh.stale).toBe(false);
  });

  it('hides facilities not updated within the freshness limit (72 h)', async () => {
    const id = await facilityId('festac');
    await query(`UPDATE facilities SET last_updated = now() - interval '80 hours' WHERE id = $1`, [id]);
    const res = await search({ q: 'Amatem Softgel', lat: 6.4664, lng: 3.2833 });
    expect(res.body.results.map((r: any) => r.facility.id)).not.toContain(id);
    await query(`UPDATE facilities SET last_updated = now() WHERE id = $1`, [id]);
  });

  it('applies filters', async () => {
    const res = await search({ q: 'Coartem', ...YABA, maxPrice: 3850, facilityType: 'pharmacy' });
    for (const r of res.body.results) {
      expect(r.facility.type).toBe('pharmacy');
      expect(r.price).toBeLessThanOrEqual(3850);
    }
  });

  it('does not show unverified facilities until an admin approves them (US-30)', async () => {
    const pendingId = await facilityId('gbagada-new');
    const before = await http().get(`/api/facilities/${pendingId}`);
    expect(before.status).toBe(403);

    const admin = await providerToken('admin');
    const reject = await http().post(`/api/admin/facilities/${pendingId}/verify`).set(auth(admin)).send({ decision: 'reject' });
    expect(reject.status).toBe(400); // reason required
    const ok = await http().post(`/api/admin/facilities/${pendingId}/verify`).set(auth(admin)).send({ decision: 'approve' });
    expect(ok.status).toBe(200);

    const after = await http().get(`/api/facilities/${pendingId}`);
    expect(after.status).toBe(200);
    expect(after.body.verified).toBe(true);
    const log = await query(`SELECT action FROM audit_log WHERE entity = 'facility' AND entity_id = $1`, [pendingId]);
    expect(log.map((l) => l.action)).toContain('facility.approve');
  });

  it('requires a location and a query', async () => {
    expect((await search({ q: 'Coartem' })).status).toBe(400);
    expect((await search({ ...YABA })).status).toBe(400);
  });
});
