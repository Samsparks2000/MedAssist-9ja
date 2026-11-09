import { routes } from '../../adapters/maps.js';
import { config } from '../../config.js';
import { db, one, query } from '../../db/pool.js';
import { boundingBox, haversineKm, haversineSql, type LatLng } from '../../lib/geo.js';
import { hoursStatus, isOpenNow, localNow, minutesAgo, type OpeningHours } from '../../lib/time.js';
import { DRUG_LABEL_SQL } from '../catalogue/service.js';
import type { Target } from './resolve.js';

export interface SearchFilters {
  maxDistanceKm?: number;
  maxPrice?: number;
  openNow?: boolean;
  facilityType?: 'pharmacy' | 'hospital';
  /** Facilities to skip, applied before radius expansion (used when forwarding bed requests). */
  excludeFacilityIds?: string[];
  /** Search exactly this area (the "Search up to 10 km" / map 5·10·20 km controls). */
  radiusKm?: number;
  /** "Updated this week": only listings whose data is newer than this. */
  maxAgeHours?: number;
  sort?: 'best' | 'nearest' | 'price' | 'updated';
}

interface FacilityHit {
  id: string;
  name: string;
  type: 'pharmacy' | 'hospital';
  address: string;
  area: string | null;
  landmark: string | null;
  phone: string;
  lat: number;
  lng: number;
  opening_hours: OpeningHours;
  open_24h: boolean;
  reliability_score: number;
  last_updated: string;
  distance_km: number;
}

export interface ResultItem {
  id: string;
  label: string;
  available: number;
  price: number | null;
  drugId?: string;
  resourceId?: string;
  detail?: string;
  needsPrescription?: boolean;
  refrigerated?: boolean;
}

export interface SearchResult {
  facility: {
    id: string;
    name: string;
    type: string;
    address: string;
    area: string | null;
    landmark: string | null;
    phone: string;
    lat: number;
    lng: number;
    verified: true;
    reliability: number;
  };
  distanceKm: number;
  etaMinutes: number;
  available: number;
  price: number | null;
  items: ResultItem[];
  openNow: boolean;
  /** "Open · closes 6 pm", "Open 24 hours", "Closed · opens 8 am". */
  hours: string;
  lastUpdated: string;
  minutesAgo: number;
  stale: boolean;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  radiusKm: number | null;
  expanded: boolean;
  fallback: null | {
    emergencyNumber: string;
    nearestGeneralHospital: { id: string; name: string; address: string; phone: string; lat: number; lng: number; distanceKm: number } | null;
  };
}

const facilityCols = `f.id, f.name, f.type, f.address, f.area, f.landmark, f.phone, f.lat, f.lng, f.opening_hours, f.open_24h,
  f.reliability_score, f.last_updated`;

/** Shared WHERE clause: verified, inside the bounding box of the largest radius (step 2 & 3). */
function geoWhere(startParam: number) {
  const p = (n: number) => `$${startParam + n}`;
  return `f.verification_status = 'approved'
    AND f.lat BETWEEN ${p(0)} AND ${p(1)} AND f.lng BETWEEN ${p(2)} AND ${p(3)}`;
}

/** Candidate facilities with what they have now, within maxRadius. Freshness is applied per kind. */
async function candidates(target: Target, origin: LatLng, maxRadiusKm: number) {
  const box = boundingBox(origin, maxRadiusKm);
  const geo = [box.minLat, box.maxLat, box.minLng, box.maxLng];
  const dist = haversineSql('f', '$1', '$2');
  const fresh = `f.last_updated > now() - make_interval(hours => ${Number(config.search.freshnessLimitHours)})`;

  type Row = FacilityHit & { items: ResultItem[] };
  if (target.kind === 'drug') {
    return query<Row>(
      `SELECT ${facilityCols}, ${dist} AS distance_km,
              json_agg(json_build_object(
                'id', x.drug_id, 'drugId', x.drug_id, 'label', x.label, 'available', x.available, 'price', x.price,
                'needsPrescription', x.rx, 'refrigerated', x.cold
              ) ORDER BY x.price) AS items
         FROM facilities f
         JOIN LATERAL (
           SELECT i.drug_id, ${DRUG_LABEL_SQL} AS label,
                  sum(i.quantity - i.reserved)::int AS available, min(i.price)::float AS price,
                  bool_or(i.needs_prescription) AS rx, bool_or(i.refrigerated) AS cold
             FROM inventory_items i JOIN drug_catalogue d ON d.id = i.drug_id
            WHERE i.facility_id = f.id AND i.drug_id = ANY($3) AND i.expiry_date > current_date AND i.quantity > i.reserved
            GROUP BY i.drug_id, d.brand_name, d.generic_name, d.strength, d.form
         ) x ON true
        WHERE ${geoWhere(4)} AND ${fresh}
        GROUP BY f.id`,
      [origin.lat, origin.lng, target.drugIds, ...geo],
    );
  }
  if (target.kind === 'resource') {
    return query<Row>(
      `SELECT ${facilityCols}, ${dist} AS distance_km,
              json_agg(json_build_object(
                'id', r.id, 'resourceId', r.id, 'label', r.sub_type, 'available', r.available, 'price', r.price::float,
                'detail', r.type
              ) ORDER BY r.sub_type) AS items
         FROM facilities f JOIN resources r ON r.facility_id = f.id
        WHERE r.type = $3 AND ($4::text IS NULL OR r.sub_type = $4) AND r.available > 0
          AND (r.status IS NULL OR r.status = 'available')
          AND ${geoWhere(5)} AND ${fresh}
        GROUP BY f.id`,
      [origin.lat, origin.lng, target.type, target.subType, ...geo],
    );
  }
  if (target.kind === 'facility') {
    // Open-now filtering happens in JS (opening hours are JSON); the item is the facility itself.
    return query<Row>(
      `SELECT ${facilityCols}, ${dist} AS distance_km,
              json_build_array(json_build_object('id', f.id, 'label', initcap(f.type), 'available', 1, 'price', null)) AS items
         FROM facilities f
        WHERE ($3::text IS NULL OR f.type = $3) AND ${geoWhere(4)} AND ${fresh}`,
      [origin.lat, origin.lng, target.facilityType, ...geo],
    );
  }
  // Specialists: toggled "available now", on duty by schedule, or on call today — and only at
  // hospitals that have confirmed the doctor works there.
  const { day } = localNow();
  return query<Row>(
    `SELECT ${facilityCols}, ${dist} AS distance_km,
            json_agg(DISTINCT jsonb_build_object(
              'id', s.id, 'label', u.name || ' · ' || s.specialty, 'available', 1, 'price', null,
              'detail', CASE WHEN s.available_now AND s.available_at = f.id THEN 'Available now'
                             WHEN EXISTS (SELECT 1 FROM duty_schedules d WHERE d.specialist_id = s.id AND d.facility_id = f.id
                                            AND d.day = $4 AND NOT d.on_call AND ${NOW_LOCAL_TIME} BETWEEN d.start_time AND d.end_time)
                             THEN 'On duty' ELSE 'On call' END
            )) AS items,
            greatest(f.last_updated, max(s.updated_at)) AS last_updated
       FROM facilities f
       JOIN specialists s ON s.verification_status = 'approved' AND ($3::text IS NULL OR s.specialty = $3)
       JOIN users u ON u.id = s.user_id
       JOIN specialist_hospitals sh ON sh.specialist_id = s.id AND sh.facility_id = f.id AND sh.status = 'confirmed'
      WHERE ${geoWhere(5)}
        AND ((s.available_now AND s.available_at = f.id)
          OR EXISTS (SELECT 1 FROM duty_schedules d
                      WHERE d.specialist_id = s.id AND d.facility_id = f.id AND d.day = $4
                        AND (d.on_call OR ${NOW_LOCAL_TIME} BETWEEN d.start_time AND d.end_time)))
      GROUP BY f.id`,
    [origin.lat, origin.lng, target.specialty, day, ...geo],
  );
}

const NOW_LOCAL_TIME = `(now() AT TIME ZONE '${config.timezone}')::time`;

/** Ranking score S = w1·d + w2·f + w3·(1 − q); lower is better (PRD section 10). */
export function rankingScore(distanceKm: number, radiusKm: number, ageHours: number, reliability: number): number {
  const { weights, freshnessLimitHours } = config.search;
  const d = Math.min(distanceKm / radiusKm, 1);
  const f = Math.min(ageHours / freshnessLimitHours, 1);
  const q = Math.min(Math.max(reliability, 0), 1);
  return weights.distance * d + weights.freshness * f + weights.reliability * (1 - q);
}

export async function nearestGeneralHospital(origin: LatLng) {
  const row = await one(
    `SELECT f.id, f.name, f.address, f.phone, f.lat, f.lng, ${haversineSql('f', '$1', '$2')} AS distance_km
       FROM facilities f
      WHERE f.verification_status = 'approved' AND f.type = 'hospital' AND f.is_general_hospital
      ORDER BY distance_km LIMIT 1`,
    [origin.lat, origin.lng],
    db(),
  );
  return row
    ? { id: row.id, name: row.name, address: row.address, phone: row.phone, lat: row.lat, lng: row.lng, distanceKm: round1(row.distance_km) }
    : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Neighbourhood search (O6, US-27, US-28): only available resources at verified facilities,
 * within 5 km, widening to 10 and 20 km when nothing matches, ranked nearest first.
 */
export async function neighbourhoodSearch(target: Target, origin: LatLng, filters: SearchFilters = {}): Promise<SearchResponse> {
  const cap = filters.maxDistanceKm;
  let radii = config.search.radiiKm.filter((r) => !cap || r <= cap);
  if (cap && (!radii.length || radii.at(-1)! < cap)) radii.push(cap);
  // An explicitly chosen area starts there, still widening if it is empty.
  if (filters.radiusKm) radii = [filters.radiusKm, ...config.search.radiiKm.filter((r) => r > filters.radiusKm!)];
  const maxRadius = radii.at(-1)!;

  const rows = await candidates(target, origin, maxRadius);
  const now = new Date();
  const filtered = rows
    .map((r) => {
      const items = filters.maxPrice !== undefined ? r.items.filter((i) => i.price === null || i.price <= filters.maxPrice!) : r.items;
      return { ...r, items, distance_km: haversineKm(origin, r) };
    })
    .filter((r) => r.items.length > 0)
    .filter((r) => !filters.excludeFacilityIds?.includes(r.id))
    .filter((r) => !filters.facilityType || r.type === filters.facilityType)
    .filter((r) => !filters.maxAgeHours || now.getTime() - new Date(r.last_updated).getTime() <= filters.maxAgeHours * 3_600_000)
    // "Open pharmacy" / "Open now" targets are open-now by definition.
    .filter((r) => (!filters.openNow && target.kind !== 'facility') || isOpenNow(r.opening_hours, r.open_24h, now));

  let radiusKm: number | null = null;
  let inRadius: typeof filtered = [];
  for (const r of radii) {
    inRadius = filtered.filter((x) => x.distance_km <= r);
    if (inRadius.length) {
      radiusKm = r;
      break;
    }
  }

  if (!radiusKm) {
    return {
      results: [],
      radiusKm: null,
      expanded: true,
      fallback: { emergencyNumber: '112', nearestGeneralHospital: await nearestGeneralHospital(origin) },
    };
  }

  const minPrice = (r: (typeof inRadius)[number]) => Math.min(...r.items.map((i) => i.price ?? Infinity));
  const compare: Record<NonNullable<SearchFilters['sort']>, (a: Scored, b: Scored) => number> = {
    best: (a, b) => a.score - b.score || a.r.distance_km - b.r.distance_km,
    nearest: (a, b) => a.r.distance_km - b.r.distance_km,
    price: (a, b) => minPrice(a.r) - minPrice(b.r) || a.r.distance_km - b.r.distance_km,
    updated: (a, b) => new Date(b.r.last_updated).getTime() - new Date(a.r.last_updated).getTime(),
  };
  type Scored = { r: (typeof inRadius)[number]; score: number };
  const scored: Scored[] = inRadius
    .map((r) => {
      const ageHours = (now.getTime() - new Date(r.last_updated).getTime()) / 3_600_000;
      return { r, score: rankingScore(r.distance_km, radiusKm!, ageHours, r.reliability_score) };
    })
    .sort(compare[filters.sort ?? 'best'])
    .slice(0, config.search.maxResults);

  // Step 5: road travel time only for the top candidates.
  const etas = await routes.etaMinutes(origin, scored.map((s) => s.r));

  const results: SearchResult[] = scored.map(({ r, score }, i) => {
    const age = minutesAgo(r.last_updated);
    const prices = r.items.map((it) => it.price).filter((p): p is number => p !== null);
    return {
      facility: {
        id: r.id, name: r.name, type: r.type, address: r.address, area: r.area, landmark: r.landmark, phone: r.phone,
        lat: r.lat, lng: r.lng, verified: true, reliability: r.reliability_score,
      },
      hours: hoursStatus(r.opening_hours, r.open_24h, now).label,
      distanceKm: round1(r.distance_km),
      etaMinutes: etas[i],
      available: r.items.reduce((s, it) => s + it.available, 0),
      price: prices.length ? Math.min(...prices) : null,
      items: r.items,
      openNow: isOpenNow(r.opening_hours, r.open_24h, now),
      lastUpdated: new Date(r.last_updated).toISOString(),
      minutesAgo: age,
      stale: age > config.search.staleFlagHours * 60,
      score: Math.round(score * 1000) / 1000,
    };
  });

  return { results, radiusKm, expanded: radiusKm !== radii[0], fallback: null };
}
