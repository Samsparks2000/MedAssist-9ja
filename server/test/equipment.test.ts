import { describe, expect, it } from 'vitest';
import { one } from '../src/db/pool.js';
import { auth, facilityId, http, providerToken, useDb } from './helpers.js';

useDb();

describe('equipment working status (FR-08)', () => {
  it('hides a machine from search when it is under repair, by equipment row or by hospital service', async () => {
    const token = await providerToken('bello');
    const facility = await facilityId('bello');
    const f = await one('SELECT lat, lng FROM facilities WHERE id = $1', [facility]);
    await http().post('/api/facilities/mine/confirm').set(auth(token));
    const search = async () => {
      const r = await http().get('/api/search').query({ target: 'resource:equipment:Ventilator', lat: f!.lat, lng: f!.lng, radiusKm: 5 });
      return (r.body.results as any[]).some((x) => x.facility.id === facility);
    };
    const setVentilator = (status: 'available' | 'maintenance', available: number) =>
      http().put('/api/resources').set(auth(token)).send({ items: [{ type: 'equipment', subType: 'Ventilator', capacity: 4, available, status }] });
    const setService = (status: 'available' | 'under_repair') =>
      http().put('/api/hospital/services').set(auth(token)).send({ items: [{ service: 'Ventilator', status }] });

    expect((await setVentilator('available', 1)).status).toBe(200);
    expect(await search()).toBe(true);

    await setVentilator('maintenance', 1);
    const row = await one(`SELECT available, status FROM resources WHERE facility_id = $1 AND sub_type = 'Ventilator'`, [facility]);
    expect(row).toMatchObject({ available: 0, status: 'maintenance' });
    expect(await search()).toBe(false);

    await setVentilator('available', 1);
    await setService('under_repair');
    expect(await search()).toBe(false);

    await setService('available');
    expect(await search()).toBe(true);
  });
});
