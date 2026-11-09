import { describe, expect, it } from 'vitest';
import { one, query } from '../src/db/pool.js';
import { forwardTimedOutRequests } from '../src/modules/bedRequests/service.js';
import { auth, facilityId, http, providerToken, useDb } from './helpers.js';

useDb();

// Bello (≈4 km) is the only ICU within 5 km; Lekki Heart (≈18 km) is next once the radius widens.
const MARYLAND = { lat: 6.5713, lng: 3.367 };

const create = (subType: string, at = MARYLAND) =>
  http().post('/api/bed-requests').send({ patientName: 'Mr. Chidi Senior', contactPhone: '08031234567', subType, ...at });

describe('bed requests (US-29)', () => {
  it('goes to the nearest hospital with a free bed and forwards on decline and timeout', async () => {
    const res = await create('ICU');
    expect(res.status).toBe(201);
    const { id, accessToken } = res.body;
    const status = () => http().get(`/api/bed-requests/${id}`).query({ token: accessToken });

    expect((await status()).body.facility_name).toBe('Bello Specialist Hospital');
    expect((await http().get(`/api/bed-requests/${id}`)).status).toBe(403); // token required for guests

    const bello = await providerToken('bello');
    const decline = await http().post(`/api/bed-requests/${id}/decline`).set(auth(bello));
    expect(decline.status).toBe(200);
    const second = (await status()).body;
    expect(second.facility_name).toBe('Lekki Heart & Critical Care Centre');
    expect(second.status).toBe('pending');
    expect(second.forwards).toBe(1);

    // Simulate the 3-minute timeout: no other ICU within 20 km, so the requester is told to call 112.
    await query(`UPDATE bed_requests SET respond_by = now() - interval '1 second' WHERE id = $1`, [id]);
    await forwardTimedOutRequests();
    const third = (await status()).body;
    expect(third.forwards).toBe(2);
    expect(third.status).toBe('unmatched');
  });

  it('accepting holds a bed and the old hospital can no longer accept', async () => {
    const res = await create('Maternity', { lat: 6.4969, lng: 3.3481 }); // Surulere
    const { id, accessToken } = res.body;
    const req = (await http().get(`/api/bed-requests/${id}`).query({ token: accessToken })).body;
    expect(req.facility_name).toBe('Surulere Mother & Child Hospital');

    const mch = await facilityId('surulere-mch');
    const before = await one(`SELECT available FROM resources WHERE facility_id = $1 AND type = 'bed' AND sub_type = 'Maternity'`, [mch]);
    const token = await providerToken('surulere-mch');
    const accept = await http().post(`/api/bed-requests/${id}/accept`).set(auth(token));
    expect(accept.status).toBe(200);
    const after = await one(`SELECT available FROM resources WHERE facility_id = $1 AND type = 'bed' AND sub_type = 'Maternity'`, [mch]);
    expect(after.available).toBe(before.available - 1);

    const again = await http().post(`/api/bed-requests/${id}/accept`).set(auth(token));
    expect(again.status).toBe(404);

    // Cancelling an accepted request frees the bed again.
    await http().post(`/api/bed-requests/${id}/cancel`).query({ token: accessToken });
    const freed = await one(`SELECT available FROM resources WHERE facility_id = $1 AND type = 'bed' AND sub_type = 'Maternity'`, [mch]);
    expect(freed.available).toBe(before.available);
  });

  it('reports unmatched when no hospital has that bed type', async () => {
    await query(`UPDATE resources SET available = 0 WHERE type = 'bed' AND sub_type = 'Paediatric'`);
    const res = await create('Paediatric');
    const s = await http().get(`/api/bed-requests/${res.body.id}`).query({ token: res.body.accessToken });
    expect(s.body.status).toBe('unmatched');
  });
});
