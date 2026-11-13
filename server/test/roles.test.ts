import { describe, expect, it } from 'vitest';
import { auth, drugId, http, providerToken, useDb } from './helpers.js';

useDb();

/** Signs in an existing staff account through the phone-code flow (the dev code is echoed in test mode). */
async function phoneToken(phone: string): Promise<string> {
  const req = await http().post('/api/auth/otp/request').send({ phone });
  const res = await http().post('/api/auth/otp/verify').send({ phone, code: req.body.devCode, consent: true });
  if (res.status !== 200) throw new Error(`otp failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('role-based access set by facility management (NFR-04)', () => {
  it('lets staff do daily updates but keeps profile, payouts, reports and staff for owner and managers', async () => {
    const owner = await providerToken('tunde');
    const added = await http().post('/api/staff').set(auth(owner)).send({ name: 'Ada Staff', role: 'Pharmacy technician', phone: '08035550101' });
    expect(added.status).toBe(201);
    const staff = await phoneToken('08035550101');

    const me = await http().get('/api/auth/me').set(auth(staff));
    expect(me.body.facility.access).toBe('staff');

    // Daily work is allowed.
    const stock = await http().post('/api/inventory').set(auth(staff)).send({
      drugId: await drugId('Panadol', '500mg'), quantity: 5, price: 60, batchNo: 'ROLE-1', expiryDate: future(300), nafdacNo: 'A4-3001',
    });
    expect(stock.status).toBe(201);

    // Management actions are refused.
    expect((await http().patch('/api/facilities/mine').set(auth(staff)).send({ phone: '08030000001' })).status).toBe(403);
    expect((await http().get('/api/payments/settlements').set(auth(staff))).status).toBe(403);
    expect((await http().get('/api/reports/sales').set(auth(staff))).status).toBe(403);
    expect((await http().post('/api/staff').set(auth(staff)).send({ name: 'Someone', role: 'Pharmacist', phone: '08035550102' })).status).toBe(403);
    const list = await http().get('/api/staff').set(auth(staff));
    expect(list.body.canManage).toBe(false);

    // The owner promotes them; now they can manage.
    const promoted = await http().patch(`/api/staff/${added.body.id}`).set(auth(owner)).send({ access: 'manager' });
    expect(promoted.status).toBe(200);
    expect((await http().get('/api/payments/settlements').set(auth(staff))).status).toBe(200);
    expect((await http().get('/api/reports/sales').set(auth(staff))).status).toBe(200);
    const helper = await http().post('/api/staff').set(auth(staff)).send({ name: 'New Helper', role: 'Pharmacist', phone: '08035550103' });
    expect(helper.status).toBe(201);

    // A manager cannot create or change managers; only the owner can.
    expect((await http().post('/api/staff').set(auth(staff)).send({ name: 'Boss Two', role: 'Manager', phone: '08035550104', access: 'manager' })).status).toBe(403);
    expect((await http().patch(`/api/staff/${helper.body.id}`).set(auth(staff)).send({ access: 'manager' })).status).toBe(403);
    // ...and cannot remove a manager.
    await http().patch(`/api/staff/${helper.body.id}`).set(auth(owner)).send({ access: 'manager' });
    expect((await http().delete(`/api/staff/${helper.body.id}`).set(auth(staff))).status).toBe(403);
    expect((await http().delete(`/api/staff/${helper.body.id}`).set(auth(owner))).status).toBe(204);
  });
});
