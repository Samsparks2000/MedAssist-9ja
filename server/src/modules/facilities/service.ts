import { type Db, one, query } from '../../db/pool.js';
import type { AuthUser } from '../../lib/auth.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { bus, type AvailabilityChanged } from '../../lib/events.js';

export interface FacilityRow {
  id: string;
  owner_id: string | null;
  name: string;
  type: 'pharmacy' | 'hospital';
  is_general_hospital: boolean;
  licence_no: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  email: string | null;
  opening_hours: Record<string, [string, string] | null>;
  open_24h: boolean;
  verification_status: 'draft' | 'pending' | 'info_requested' | 'approved' | 'rejected' | 'suspended';
  area: string | null;
  landmark: string | null;
  lga: string | null;
  kind: string | null;
  emergency_phone: string | null;
  licence_expiry: string | null;
  lead_name: string | null;
  lead_reg_no: string | null;
  offers: string[];
  verification_note: string | null;
  reliability_score: number;
  payout_subaccount: string | null;
  last_updated: string;
}

/** The facility the signed-in account owns or is staff at, if any. */
export async function findOwnFacility(userId: string, client?: Db): Promise<FacilityRow | null> {
  return one<FacilityRow>(
    `SELECT f.* FROM facilities f
      WHERE f.owner_id = $1 OR EXISTS (SELECT 1 FROM facility_staff s WHERE s.facility_id = f.id AND s.user_id = $1)
      ORDER BY (f.owner_id = $1) DESC LIMIT 1`,
    [userId],
    client,
  );
}

/** The facility run by the signed-in pharmacy or hospital account (owner or staff). */
export async function ownFacility(user: AuthUser, client?: Db): Promise<FacilityRow> {
  if (user.role !== 'pharmacy' && user.role !== 'hospital') throw forbidden('Only facility accounts can do this');
  const f = await findOwnFacility(user.id, client);
  if (!f) throw notFound('Register your facility first');
  return f;
}

export type FacilityAccess = 'owner' | 'manager' | 'staff';

/** What the signed-in person may do at their facility (NFR-04): owner, manager or staff. */
export async function facilityAccess(userId: string, f: FacilityRow, client?: Db): Promise<FacilityAccess> {
  if (f.owner_id === userId) return 'owner';
  const row = await one<{ access: 'manager' | 'staff' }>(
    'SELECT access FROM facility_staff WHERE facility_id = $1 AND user_id = $2',
    [f.id, userId],
    client,
  );
  return row?.access ?? 'staff';
}

/** The facility, if the signed-in person is its owner or a manager; staff are refused. */
export async function managedFacility(user: AuthUser, client?: Db): Promise<FacilityRow & { access: FacilityAccess }> {
  const f = await ownFacility(user, client);
  const access = await facilityAccess(user.id, f, client);
  if (access === 'staff') throw forbidden('Only the owner or a manager can do this. Ask them to change it, or to make you a manager.');
  return { ...f, access };
}

/** Owner plus staff user ids, for notifications. */
export async function facilityTeam(facilityId: string, client?: Db): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT owner_id AS id FROM facilities WHERE id = $1 AND owner_id IS NOT NULL
     UNION SELECT user_id FROM facility_staff WHERE facility_id = $1`,
    [facilityId],
    client,
  );
  return rows.map((r) => r.id);
}

/** Bumps last_updated (US-08) inside the caller's transaction. Call publishChange after commit. */
export async function touchFacility(client: Db, facilityId: string): Promise<void> {
  await query('UPDATE facilities SET last_updated = now(), stale_reminded_at = NULL WHERE id = $1', [facilityId], client);
}

/** FR-06: pushes the change to connected clients so search results refresh within seconds. */
export function publishChange(facilityId: string, kind: AvailabilityChanged['kind']): void {
  bus.publish('availability.changed', { facilityId, kind });
}

export function publicFacility(f: FacilityRow) {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    address: f.address,
    lat: f.lat,
    lng: f.lng,
    phone: f.phone,
    openingHours: f.opening_hours,
    open24h: f.open_24h,
    verified: f.verification_status === 'approved',
    reliability: f.reliability_score,
    lastUpdated: f.last_updated,
  };
}
