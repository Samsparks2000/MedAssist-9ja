import { describe, expect, it } from 'vitest';
import { one, query } from '../src/db/pool.js';
import { collectDeadline, hoursStatus } from '../src/lib/time.js';
import { auth, drugId, facilityId, http, patientToken, providerToken, useDb } from './helpers.js';

useDb();

const BODIJA = { lat: 7.424, lng: 3.913 };
const weekdays = { mon: ['08:00', '18:00'], tue: ['08:00', '18:00'], wed: ['08:00', '18:00'], thu: ['08:00', '18:00'], fri: ['08:00', '18:00'], sat: null, sun: null } as Record<string, [string, string] | null>;

describe('collect-by and opening hours (US-22)', () => {
  it('holds for two hours when the place stays open', () => {
    // Monday 10:00 Lagos = 09:00Z
    const at = new Date('2026-10-26T09:00:00Z');
    expect(collectDeadline(weekdays, false, 120, at).toISOString()).toBe('2026-10-26T11:00:00.000Z');
  });

  it('stops at closing time', () => {
    const at = new Date('2026-10-26T16:30:00Z'); // 17:30 Lagos, closes 18:00
    expect(collectDeadline(weekdays, false, 120, at).toISOString()).toBe('2026-10-26T17:00:00.000Z');
  });

  it('moves to the next opening when closed or about to close ("Reserve for tomorrow")', () => {
    const late = new Date('2026-10-26T16:45:00Z'); // 17:45 Lagos: 15 minutes left
    expect(collectDeadline(weekdays, false, 120, late).toISOString()).toBe('2026-10-27T09:00:00.000Z'); // Tue 08:00 + 2 h
    const friNight = new Date('2026-10-30T20:00:00Z'); // Fri 21:00 → Mon
    expect(collectDeadline(weekdays, false, 120, friNight).toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });

  it('labels hours like the design', () => {
    expect(hoursStatus(weekdays, false, new Date('2026-10-26T09:00:00Z')).label).toBe('Open · closes 6 pm');
    expect(hoursStatus(weekdays, false, new Date('2026-10-26T18:00:00Z')).label).toBe('Closed · opens 8 am tomorrow');
    expect(hoursStatus({}, true).label).toBe('Open 24 hours');
  });
});

describe('pay at pickup', () => {
  it('runs request → pharmacy confirms → code → collected and paid at the counter', async () => {
    const patient = await patientToken();
    const facility = await facilityId('ui-gate');
    const drug = await drugId('Lantus SoloStar', '100IU/ml 3ml pen');
    const order = await http().post('/api/orders').set(auth(patient)).send({ facilityId: facility, items: [{ drugId: drug, quantity: 1 }], paymentMode: 'at_pickup' });
    expect(order.status).toBe(201);
    expect(order.body.status).toBe('requested');
    expect(order.body.pickup_code).toBeNull();

    const pharmacist = await providerToken('ui-gate');
    const list = await http().get('/api/facility-orders?active=true').set(auth(pharmacist));
    const mine = list.body.find((o: any) => o.id === order.body.id);
    expect(mine.needs_answer).toBe(true);
    expect(mine.customer_phone).toMatch(/^0\d{3} \*\*\* \d{4}$/);

    // Cannot hand over before confirming.
    const early = await http().post('/api/facility-orders/collect').set(auth(pharmacist)).send({ code: '0000' });
    expect(early.status).toBe(404);

    const confirmed = await http().post(`/api/facility-orders/${order.body.id}/confirm`).set(auth(pharmacist));
    expect(confirmed.body.status).toBe('reserved');
    const seen = await http().get(`/api/orders/${order.body.id}`).set(auth(patient));
    expect(seen.body.pickup_code).toMatch(/^MA-\d{4}$/);
    expect(seen.body.needs_prescription).toBe(true); // insulin is flagged

    const collect = await http().post('/api/facility-orders/collect').set(auth(pharmacist)).send({ code: seen.body.pickup_code });
    expect(collect.status).toBe(200);
    const counter = await one(`SELECT gateway, status, amount FROM payments WHERE order_id = $1`, [order.body.id]);
    expect(counter).toMatchObject({ gateway: 'counter', status: 'success', amount: 13900 });
    // Counter money is not part of the online settlement statement.
    const settlements = await http().get('/api/payments/settlements').set(auth(pharmacist));
    expect(settlements.body.payments.some((p: any) => p.gateway === 'counter')).toBe(false);
  });

  it('declining a request releases the stock', async () => {
    const patient = await patientToken();
    const facility = await facilityId('dugbe-health');
    const drug = await drugId('Panadol', '500mg');
    const before = await one('SELECT sum(reserved)::int AS r FROM inventory_items WHERE facility_id = $1 AND drug_id = $2', [facility, drug]);
    const order = await http().post('/api/orders').set(auth(patient)).send({ facilityId: facility, items: [{ drugId: drug, quantity: 3 }], paymentMode: 'at_pickup' });
    const pharmacist = await providerToken('dugbe-health');
    await http().post(`/api/facility-orders/${order.body.id}/cancel`).set(auth(pharmacist)).send({ reason: 'Out of stock' });
    const after = await one('SELECT sum(reserved)::int AS r FROM inventory_items WHERE facility_id = $1 AND drug_id = $2', [facility, drug]);
    expect(after.r).toBe(before.r);
  });
});

describe('emergency screen search', () => {
  it('lists hospitals with an emergency unit nearest first, tagged for the situation', async () => {
    const res = await http().get('/api/search/emergency').query({ ...BODIJA, situation: 'chest' });
    expect(res.status).toBe(200);
    expect(res.body.hospitals[0].name).toBe('Bodija Specialist Hospital');
    const d = res.body.hospitals.map((h: any) => h.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    const tags = res.body.hospitals[0].tags.map((t: any) => t.label);
    expect(tags).toContain('Emergency unit 24 h');
    expect(tags.some((t: string) => t.startsWith('ICU'))).toBe(true);
    // Akobo has no emergency unit, so it is never listed.
    expect(res.body.hospitals.map((h: any) => h.name)).not.toContain('Akobo Kidney & Dialysis Centre');
  });
});

describe('registration and verification (US-30)', () => {
  it('registers a pharmacy with a phone code, then an admin approves it into search', async () => {
    const phone = '08051239999';
    const otp = await http().post('/api/auth/otp/request').send({ phone });
    const body = {
      draft: false,
      confirm: true,
      account: { name: 'Mr. Test Owner', phone, role: 'Owner', code: otp.body.devCode },
      name: 'Samonda Test Pharmacy',
      phone: '08051238888',
      address: '3 Samonda Road',
      area: 'Samonda',
      lga: 'Ibadan North',
      landmark: 'Near the filling station',
      lat: 7.4302,
      lng: 3.8968,
      licenceNo: 'PCN/TEST/1',
      leadName: 'Pharm. Test',
      openingHours: { mon: ['08:00', '20:00'] },
      offers: ['Fill prescriptions'],
      payout: { bankCode: '058', bankName: 'Guaranty Trust Bank', accountNumber: '0123456789' },
    };
    const reg = await http().post('/api/register/pharmacy').send(body);
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('pending');
    expect(reg.body.token).toBeTruthy();

    // Documents upload with the new account.
    const doc = await http().post('/api/documents').set(auth(reg.body.token)).field('kind', 'licence').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'licence.pdf', contentType: 'application/pdf' });
    expect(doc.status).toBe(201);

    const f = await one('SELECT * FROM facilities WHERE id = $1', [reg.body.facilityId]);
    expect(f.payout_account_name).toBe('SAMONDA TEST PHARMACY');
    expect(f.payout_subaccount).toMatch(/^ACCT_/);

    const admin = await providerToken('admin');
    const queue = await http().get('/api/admin/verifications').set(auth(admin));
    const item = queue.body.facilities.find((x: any) => x.id === reg.body.facilityId);
    expect(item.documents).toHaveLength(1);

    const info = await http().post(`/api/admin/facilities/${f.id}/verify`).set(auth(admin)).send({ decision: 'request_info', reason: 'Upload a clearer licence' });
    expect(info.body.verification_status).toBe('info_requested');
    const ok = await http().post(`/api/admin/facilities/${f.id}/verify`).set(auth(admin)).send({ decision: 'approve', checklist: { register: true } });
    expect(ok.body.verification_status).toBe('approved');

    // A second registration with the same phone is refused.
    const again = await http().post('/api/auth/otp/request').send({ phone });
    expect(again.body.isNewUser).toBe(false);
  });

  it('only shows a specialist at hospitals that confirmed them', async () => {
    const pending = await query(`SELECT s.id FROM specialists s JOIN users u ON u.id = s.user_id WHERE u.email = 's-lawal@medassist.test'`);
    expect(pending).toHaveLength(1);
    const admin = await providerToken('admin');
    await http().post(`/api/admin/specialists/${pending[0].id}/verify`).set(auth(admin)).send({ decision: 'approve' });
    await http().post('/api/specialists/me/availability').set(auth(await providerToken('s-lawal'))).send({ availableNow: true, facilityId: await facilityId('bodija-specialist') });

    // Bodija Specialist confirmed Dr. Lawal (first-listed hospital), so he appears there.
    const res = await http().get('/api/search').query({ target: 'specialist:Neurology', ...BODIJA });
    expect(res.body.results.map((r: any) => r.facility.name)).toContain('Bodija Specialist Hospital');

    const hospital = await providerToken('bodija-specialist');
    await http().post(`/api/hospital/specialists/${pending[0].id}/decline`).set(auth(hospital));
    const after = await http().get('/api/search').query({ target: 'specialist:Neurology', ...BODIJA });
    expect(after.body.results.map((r: any) => r.facility.name)).not.toContain('Bodija Specialist Hospital');
  });
});

describe('back in stock', () => {
  it('notifies a watching patient when stock returns', async () => {
    const patient = await patientToken();
    const facility = await facilityId('iwo-road-chemists');
    const epipen = await drugId('EpiPen', '0.3mg');
    await query(`UPDATE inventory_items SET quantity = 0 WHERE facility_id = $1 AND drug_id = $2`, [facility, epipen]);
    const watch = await http().post('/api/me/watches').set(auth(patient)).send({ facilityId: facility, drugId: epipen });
    expect(watch.status).toBe(201);
    const pharmacist = await providerToken('iwo-road-chemists');
    await http().post('/api/inventory').set(auth(pharmacist)).send({ drugId: epipen, quantity: 2, price: 66000, batchNo: 'NEW-1', expiryDate: '2028-01-31', nafdacNo: 'A4-0101' });
    const notes = await http().get('/api/notifications').set(auth(patient));
    expect(notes.body.items.some((n: any) => n.kind === 'back_in_stock')).toBe(true);
  });
});
