import { config } from '../../config.js';
import { db, one, query, tx } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { token } from '../../lib/codes.js';
import { conflict, notFound } from '../../lib/errors.js';
import { bus } from '../../lib/events.js';
import { publishChange, touchFacility } from '../facilities/service.js';
import { notify, notifyFacilityOwner, smsDirect } from '../notifications/service.js';
import { targetFromSpec } from '../search/resolve.js';
import { nearestGeneralHospital, neighbourhoodSearch } from '../search/service.js';
import { endOrder, freshPickupCode } from '../orders/service.js';

export interface BedRequestInput {
  userId: string | null;
  patientName: string;
  contactPhone: string;
  subType: string;
  notes?: string;
  lat: number;
  lng: number;
}

/** Nearest hospital with a free bed of this type that has not already been tried. */
async function nextHospital(subType: string, lat: number, lng: number, tried: string[]) {
  const target = await targetFromSpec(`resource:bed:${subType}`);
  if (!target) return null;
  const { results } = await neighbourhoodSearch(target, { lat, lng }, { facilityType: 'hospital', excludeFacilityIds: tried });
  return results[0] ?? null;
}

async function assign(requestId: string, tried: string[]) {
  const req = await one('SELECT * FROM bed_requests WHERE id = $1', [requestId]);
  const next = tried.length > config.reservations.bedRequestMaxForwards ? null : await nextHospital(req.sub_type, req.lat, req.lng, tried);

  if (!next) {
    await query(
      `UPDATE bed_requests SET status = 'unmatched', facility_id = NULL, respond_by = NULL, tried_facility_ids = $2 WHERE id = $1`,
      [requestId, tried],
    );
    const general = await nearestGeneralHospital({ lat: req.lat, lng: req.lng });
    smsDirect(
      req.contact_phone,
      `MedAssist-9ja: no hospital confirmed a ${req.sub_type} bed yet. Call 112 now.` +
        (general ? ` Nearest general hospital: ${general.name}, ${general.phone}.` : ''),
    );
    bus.publish('bedRequest.updated', { id: requestId, status: 'unmatched', facilityId: null });
    return;
  }

  await query(
    `UPDATE bed_requests SET facility_id = $2, status = 'pending', tried_facility_ids = $3,
            respond_by = now() + make_interval(mins => $4) WHERE id = $1`,
    [requestId, next.facility.id, tried, config.reservations.bedRequestTimeoutMinutes],
  );
  await notifyFacilityOwner(next.facility.id, {
    kind: 'bed_request',
    title: `Urgent: ${req.sub_type} bed request`,
    body: `${req.patient_name} is ${next.distanceKm} km away. Respond within ${config.reservations.bedRequestTimeoutMinutes} minutes or it moves to the next hospital.`,
    link: '/dashboard/bed-requests',
    channels: ['sms'],
  });
  bus.publish('bedRequest.updated', { id: requestId, status: 'pending', facilityId: next.facility.id });
}

export async function createBedRequest(input: BedRequestInput) {
  const row = await one(
    `INSERT INTO bed_requests (user_id, patient_name, contact_phone, sub_type, notes, lat, lng, status, access_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING id, access_token`,
    [input.userId, input.patientName, input.contactPhone, input.subType, input.notes ?? null, input.lat, input.lng, token()],
  );
  await assign(row.id, []);
  return row as { id: string; access_token: string };
}

/** US-29: moves a request to the next nearest hospital (on decline or timeout). */
export async function forwardRequest(requestId: string, reason: string) {
  const req = await tx(async (c) => {
    const r = await one(`SELECT * FROM bed_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`, [requestId], c);
    if (!r) return null;
    await audit(c, null, 'bed_request.forward', 'bed_request', r.id, { from: r.facility_id, reason });
    // Mark the current hospital as tried while the row is locked so a late accept fails.
    await query(`UPDATE bed_requests SET facility_id = NULL WHERE id = $1`, [r.id], c);
    return r;
  });
  if (!req) return;
  await assign(requestId, [...req.tried_facility_ids, ...(req.facility_id ? [req.facility_id] : [])]);
}

export async function acceptRequest(requestId: string, facilityId: string, actorId: string) {
  const result = await tx(async (c) => {
    const r = await one(
      `SELECT * FROM bed_requests WHERE id = $1 AND facility_id = $2 AND status = 'pending' FOR UPDATE`,
      [requestId, facilityId],
      c,
    );
    if (!r) throw notFound('This request is no longer waiting for you');
    const bed = await one(
      `SELECT * FROM resources WHERE facility_id = $1 AND type = 'bed' AND sub_type = $2 FOR UPDATE`,
      [facilityId, r.sub_type],
      c,
    );
    if (!bed || bed.available < 1) throw conflict(`No free ${r.sub_type} bed is recorded. Update your bed count first.`);
    await query('UPDATE resources SET available = available - 1, updated_at = now() WHERE id = $1', [bed.id], c);
    await query(`UPDATE bed_requests SET status = 'accepted', responded_at = now(), respond_by = NULL WHERE id = $1`, [r.id], c);

    // Optional deposit: only for signed-in requesters, so payment has an account and receipt.
    let order = null;
    if (bed.price && bed.price > 0 && r.user_id) {
      order = await one(
        `INSERT INTO orders (user_id, facility_id, type, status, pickup_code, expires_at, total, bed_request_id)
         VALUES ($1, $2, 'bed', 'pending_payment', $3, now() + make_interval(mins => $4), $5, $6) RETURNING *`,
        [r.user_id, facilityId, await freshPickupCode(c, facilityId), config.reservations.holdMinutes, bed.price, r.id],
        c,
      );
      await query(
        'INSERT INTO order_items (order_id, resource_id, description, quantity, unit_price) VALUES ($1, $2, $3, 1, $4)',
        [order.id, bed.id, `${r.sub_type} bed deposit`, bed.price],
        c,
      );
    }
    await touchFacility(c, facilityId);
    await audit(c, actorId, 'bed_request.accept', 'bed_request', r.id, { bedId: bed.id, depositOrder: order?.id });
    const facility = await one('SELECT name, phone, address FROM facilities WHERE id = $1', [facilityId], c);
    return { r, facility, order };
  });

  const { r, facility, order } = result;
  publishChange(facilityId, 'resource');
  bus.publish('bedRequest.updated', { id: r.id, status: 'accepted', facilityId });
  smsDirect(
    r.contact_phone,
    `MedAssist-9ja: ${facility.name} accepted the ${r.sub_type} bed request for ${r.patient_name}. ` +
      `Go to ${facility.address}. Call ${facility.phone}.`,
  );
  if (r.user_id) {
    await notify({
      userId: r.user_id,
      kind: 'bed_accepted',
      title: 'Bed confirmed',
      body: `${facility.name} has a ${r.sub_type} bed ready.${order ? ' Pay the deposit to hold it.' : ''}`,
      link: order ? `/orders/${order.id}` : `/bed-requests/${r.id}`,
    });
  }
  return { request: r, order };
}

export async function cancelRequest(requestId: string, actorId: string | null) {
  const r = await one('SELECT * FROM bed_requests WHERE id = $1', [requestId]);
  if (!r) throw notFound();
  if (r.status === 'pending' || r.status === 'unmatched') {
    await query(`UPDATE bed_requests SET status = 'cancelled', respond_by = NULL WHERE id = $1`, [r.id]);
  } else if (r.status === 'accepted') {
    const order = await one(`SELECT id FROM orders WHERE bed_request_id = $1 AND status IN ('pending_payment', 'paid')`, [r.id]);
    if (order) {
      await endOrder(order.id, actorId, 'cancelled', 'Bed request cancelled by the requester');
    } else {
      await tx(async (c) => {
        await query(
          `UPDATE resources SET available = least(available + 1, capacity), updated_at = now()
            WHERE facility_id = $1 AND type = 'bed' AND sub_type = $2`,
          [r.facility_id, r.sub_type],
          c,
        );
        await query(`UPDATE bed_requests SET status = 'cancelled' WHERE id = $1`, [r.id], c);
        await touchFacility(c, r.facility_id);
      });
      publishChange(r.facility_id, 'resource');
    }
    await notifyFacilityOwner(r.facility_id, {
      kind: 'bed_request_cancelled',
      title: 'Bed request cancelled',
      body: `${r.patient_name} no longer needs the ${r.sub_type} bed; it is free again.`,
      link: '/dashboard/bed-requests',
    });
  } else {
    return;
  }
  await audit(db(), actorId, 'bed_request.cancel', 'bed_request', r.id);
  bus.publish('bedRequest.updated', { id: r.id, status: 'cancelled', facilityId: r.facility_id });
}

/** Scheduler: forwards requests the current hospital did not answer in time. */
export async function forwardTimedOutRequests(): Promise<number> {
  const due = await query<{ id: string }>(`SELECT id FROM bed_requests WHERE status = 'pending' AND respond_by < now() LIMIT 50`);
  for (const r of due) await forwardRequest(r.id, 'No response within the time limit');
  return due.length;
}
