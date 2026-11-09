import { describe, expect, it } from 'vitest';
import { sentSms } from '../src/adapters/messaging.js';
import { one, query } from '../src/db/pool.js';
import { runExpiryAlerts } from '../src/modules/inventory/service.js';
import { auth, drugId, facilityId, http, providerToken, useDb } from './helpers.js';

useDb();

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('inventory (US-16 – US-19)', () => {
  it('imports a CSV with per-row errors and matches the catalogue fuzzily', async () => {
    const token = await providerToken('surulere-family');
    const csv = [
      'name,strength,form,quantity,price,batch_no,expiry_date,reorder_level',
      `Panadol,500mg,Tablet,100,55,SF-1,${future(300)},20`,
      `augmentn,625mg,Tablet,12,6400,SF-2,${future(200)},3`,
      `Unknownium,5mg,Tablet,10,100,SF-3,${future(200)},1`,
      `Flagyl,400mg,Tablet,10,900,SF-4,2020-01-01,1`,
      `Brufen,400mg,Tablet,ten,900,SF-5,${future(200)},1`,
    ].join('\n');

    const dry = await http().post('/api/inventory/upload?dryRun=true').set(auth(token)).attach('file', Buffer.from(csv), 'stock.csv');
    expect(dry.status).toBe(200);
    expect(dry.body.valid).toBe(2);
    expect(dry.body.created).toBe(0);
    expect(dry.body.errors.map((e: any) => e.row)).toEqual([4, 5, 6]);
    expect(dry.body.errors[0].message).toMatch(/not in the drug catalogue/);
    expect(dry.body.errors[1].message).toMatch(/expired/i);
    expect(dry.body.errors[1].kind).toBe('expired');
    expect(dry.body.errors[2].message).toMatch(/quantity/);

    const real = await http().post('/api/inventory/upload').set(auth(token)).attach('file', Buffer.from(csv), 'stock.csv');
    expect(real.body.created).toBe(2);
    // Uploading the same batch again updates it instead of duplicating.
    const again = await http().post('/api/inventory/upload').set(auth(token)).attach('file', Buffer.from(csv), 'stock.csv');
    expect(again.body.updated).toBe(2);
  });

  it('deducts sales first-expiry-first-out and never sells expired stock (US-17, US-19)', async () => {
    const token = await providerToken('vi-medicare');
    const facility = await facilityId('vi-medicare');
    const clarityne = await drugId('Clarityne', '10mg'); // 40 seeded
    await query(
      `INSERT INTO inventory_items (facility_id, drug_id, quantity, price, batch_no, expiry_date, reorder_level)
       VALUES ($1, $2, 5, 2600, 'OLD-1', current_date + 10, 0), ($1, $2, 7, 2600, 'EXPIRED-1', current_date - 1, 0)`,
      [facility, clarityne],
    );
    const sale = await http().post('/api/inventory/sales').set(auth(token)).send({ items: [{ drugId: clarityne, quantity: 8 }] });
    expect(sale.status).toBe(201);
    const batches = await query('SELECT batch_no, quantity FROM inventory_items WHERE facility_id = $1 AND drug_id = $2 ORDER BY expiry_date', [facility, clarityne]);
    const byBatch = Object.fromEntries(batches.map((b) => [b.batch_no, b.quantity]));
    expect(byBatch['EXPIRED-1']).toBe(7); // untouched
    expect(byBatch['OLD-1']).toBe(0); // used first
    const total = await one(`SELECT sum(quantity)::int AS q FROM inventory_items WHERE facility_id = $1 AND drug_id = $2 AND expiry_date > current_date`, [facility, clarityne]);
    expect(total.q).toBe(40 + 5 - 8);

    const tooMany = await http().post('/api/inventory/sales').set(auth(token)).send({ items: [{ drugId: clarityne, quantity: 1000 }] });
    expect(tooMany.status).toBe(409);
  });

  it('sends a low-stock alert by in-app and SMS once the level is reached (US-18)', async () => {
    const token = await providerToken('lekki-wellness');
    const lantus = await drugId('Lantus', '100IU/ml'); // 5 seeded, reorder level 2
    sentSms.length = 0;
    await http().post('/api/inventory/sales').set(auth(token)).send({ items: [{ drugId: lantus, quantity: 3 }] });
    const notes = await http().get('/api/notifications').set(auth(token));
    expect(notes.body.items.some((n: any) => n.kind === 'low_stock' && n.body.includes('Lantus'))).toBe(true);
    expect(sentSms.some((s) => s.message.includes('Low stock'))).toBe(true);
    // A second sale below the level does not repeat the alert.
    const before = notes.body.items.filter((n: any) => n.kind === 'low_stock').length;
    await http().post('/api/inventory/sales').set(auth(token)).send({ items: [{ drugId: lantus, quantity: 1 }] });
    const after = (await http().get('/api/notifications').set(auth(token))).body.items.filter((n: any) => n.kind === 'low_stock').length;
    expect(after).toBe(before);
  });

  it('alerts at 90/60/30 days before expiry', async () => {
    await runExpiryAlerts();
    const token = await providerToken('tunde'); // seeded batch TUN-EXP1 expires in 25 days
    const notes = await http().get('/api/notifications').set(auth(token));
    expect(notes.body.items.some((n: any) => n.kind === 'expiry' && n.body.includes('TUN-EXP1'))).toBe(true);
    const sentAgain = await runExpiryAlerts();
    expect(sentAgain).toBe(0);
  });

  it('publishes hospital resource updates in one save (US-09)', async () => {
    const token = await providerToken('bello');
    const save = await http()
      .put('/api/resources')
      .set(auth(token))
      .send({
        items: [
          { type: 'bed', subType: 'ICU', capacity: 6, available: 4 },
          { type: 'blood', subType: 'O-', capacity: 0, available: 2 },
          { type: 'equipment', subType: 'Ventilator', capacity: 4, available: 2, status: 'maintenance' },
        ],
      });
    expect(save.status).toBe(200);
    const vent = save.body.find((r: any) => r.sub_type === 'Ventilator');
    expect(vent.available).toBe(0); // under maintenance is not available
    const bad = await http().put('/api/resources').set(auth(token)).send({ items: [{ type: 'bed', subType: 'ICU', capacity: 2, available: 5 }] });
    expect(bad.status).toBe(400);
  });

  it('keeps pharmacies out of other facilities’ stock', async () => {
    const token = await providerToken('festac');
    const other = await one('SELECT id FROM inventory_items WHERE facility_id = $1 LIMIT 1', [await facilityId('tunde')]);
    const res = await http().patch(`/api/inventory/${other.id}`).set(auth(token)).send({ quantity: 0 });
    expect(res.status).toBe(404);
  });
});
