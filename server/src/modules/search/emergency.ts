import { routes } from '../../adapters/maps.js';
import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { boundingBox, haversineKm, haversineSql, type LatLng } from '../../lib/geo.js';
import { localNow, minutesAgo } from '../../lib/time.js';
import { nearestGeneralHospital } from './service.js';

/** "What is happening?" choices on the Emergency screen and what each needs. */
export const SITUATIONS = {
  chest: { label: 'Chest pain or heart', specialty: 'Cardiology', doctor: 'Cardiologist', beds: ['ICU'], services: ['Intensive care (ICU)'] },
  breathing: { label: 'Trouble breathing', specialty: 'Pulmonology', doctor: 'Chest physician', beds: ['ICU'], services: ['Oxygen', 'Ventilator'] },
  bleeding: { label: 'Bleeding or injury', specialty: 'General Surgery', doctor: 'Surgeon', beds: ['Emergency'], services: ['Blood bank', 'Surgery'] },
  pregnancy: { label: 'Pregnancy or labour', specialty: 'Obstetrics & Gynaecology', doctor: 'Obstetrician', beds: ['Maternity'], services: ['Maternity and delivery'] },
  unconscious: { label: 'Unconscious or fainting', specialty: 'Neurology', doctor: 'Neurologist', beds: ['ICU'], services: ['CT scan'] },
  child: { label: 'Child emergency', specialty: 'Paediatrics', doctor: 'Paediatrician', beds: ['Paediatric'], services: ["Children's care"] },
  poisoning: { label: 'Poisoning or overdose', specialty: 'Emergency Medicine', doctor: 'Emergency doctor', beds: ['Emergency', 'ICU'], services: [] },
  other: { label: 'Something else', specialty: null, doctor: null, beds: ['Emergency'], services: [] },
} as const;
export const SITUATION_KEYS = Object.keys(SITUATIONS) as [keyof typeof SITUATIONS, ...(keyof typeof SITUATIONS)[]];

const BED_LABEL: Record<string, string> = { ICU: 'ICU', Emergency: 'A&E', Maternity: 'Maternity', Paediatric: "Children's ward", 'General ward': 'General ward' };

interface Row {
  id: string;
  name: string;
  area: string | null;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  emergency_phone: string | null;
  last_updated: string;
  services: { service: string; status: string }[] | null;
  beds: { sub_type: string; available: number }[] | null;
  doctors: { specialty: string; status: 'now' | 'today' | 'on_call' }[] | null;
}

/**
 * Hospitals listing a 24-hour emergency unit, nearest first, within 5 km and widening to 10 and
 * 20 km (US-28). Each card carries tags for the chosen situation: the right doctor on duty or on
 * call, free beds of the right kind and relevant services.
 */
export async function emergencySearch(origin: LatLng, situation?: keyof typeof SITUATIONS, radiusKm?: number) {
  const sit = situation ? SITUATIONS[situation] : null;
  const radii = radiusKm ? [radiusKm, ...config.search.radiiKm.filter((r) => r > radiusKm)] : config.search.radiiKm;
  const box = boundingBox(origin, radii.at(-1)!);
  const { day } = localNow();
  const rows = await query<Row & { distance_km: number }>(
    `SELECT f.id, f.name, f.area, f.address, f.lat, f.lng, f.phone, f.emergency_phone, f.last_updated,
            ${haversineSql('f', '$1', '$2')} AS distance_km,
            (SELECT json_agg(json_build_object('service', s.service, 'status', s.status)) FROM facility_services s WHERE s.facility_id = f.id) AS services,
            (SELECT json_agg(json_build_object('sub_type', r.sub_type, 'available', r.available)) FROM resources r
              WHERE r.facility_id = f.id AND r.type = 'bed') AS beds,
            (SELECT json_agg(DISTINCT jsonb_build_object('specialty', sp.specialty, 'status',
                      CASE WHEN (sp.available_now AND sp.available_at = f.id) OR (NOT d.on_call AND (now() AT TIME ZONE '${config.timezone}')::time BETWEEN d.start_time AND d.end_time) THEN 'now'
                           WHEN d.on_call THEN 'on_call' ELSE 'today' END))
               FROM specialists sp
               JOIN specialist_hospitals sh ON sh.specialist_id = sp.id AND sh.facility_id = f.id AND sh.status = 'confirmed'
               LEFT JOIN duty_schedules d ON d.specialist_id = sp.id AND d.facility_id = f.id AND d.day = $7
              WHERE sp.verification_status = 'approved' AND (d.id IS NOT NULL OR (sp.available_now AND sp.available_at = f.id))) AS doctors
       FROM facilities f
      WHERE f.type = 'hospital' AND f.verification_status = 'approved'
        AND f.lat BETWEEN $3 AND $4 AND f.lng BETWEEN $5 AND $6
        AND f.last_updated > now() - make_interval(hours => ${Number(config.search.freshnessLimitHours)})
        AND EXISTS (SELECT 1 FROM facility_services s WHERE s.facility_id = f.id AND s.service = 'Emergency unit, 24 hours' AND s.status = 'available')`,
    [origin.lat, origin.lng, box.minLat, box.maxLat, box.minLng, box.maxLng, day],
  );
  const withDistance = rows.map((r) => ({ ...r, distance_km: haversineKm(origin, r) }));
  let chosen: number | null = null;
  let inRadius: typeof withDistance = [];
  for (const r of radii) {
    inRadius = withDistance.filter((x) => x.distance_km <= r);
    if (inRadius.length) {
      chosen = r;
      break;
    }
  }
  inRadius.sort((a, b) => a.distance_km - b.distance_km);
  const top = inRadius.slice(0, 6);
  const etas = await routes.etaMinutes(origin, top);

  const hospitals = top.map((r, i) => {
    const services = new Map((r.services ?? []).map((s) => [s.service, s.status]));
    const tags: { label: string; strong: boolean }[] = [{ label: 'Emergency unit 24 h', strong: true }];
    if (sit?.specialty) {
      const docs = (r.doctors ?? []).filter((d) => d.specialty === sit.specialty);
      const best = docs.find((d) => d.status === 'now') ?? docs.find((d) => d.status === 'today') ?? docs.find((d) => d.status === 'on_call');
      if (best) tags.push({ label: `${sit.doctor} ${best.status === 'now' ? 'on duty now' : best.status === 'today' ? 'on duty today' : 'on call'}`, strong: true });
    }
    for (const b of r.beds ?? []) {
      if (sit?.beds.includes(b.sub_type as never) && b.available > 0) tags.push({ label: `${BED_LABEL[b.sub_type] ?? b.sub_type} · ${b.available} beds`, strong: false });
    }
    for (const s of ['Oxygen', 'Ambulance', ...(sit?.services ?? [])]) {
      if (services.get(s) === 'available' && !tags.some((t) => t.label.startsWith(s))) tags.push({ label: s, strong: false });
    }
    const age = minutesAgo(r.last_updated);
    return {
      id: r.id,
      name: r.name,
      area: r.area,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      emergencyPhone: r.emergency_phone ?? r.phone,
      distanceKm: Math.round(r.distance_km * 10) / 10,
      etaMinutes: etas[i],
      minutesAgo: age,
      stale: age > config.search.staleFlagHours * 60,
      tags,
    };
  });

  return {
    situation: situation ? { key: situation, label: SITUATIONS[situation].label } : null,
    radiusKm: chosen,
    hospitals,
    emergencyNumber: '112',
    nearestGeneralHospital: hospitals.length ? null : await nearestGeneralHospital(origin),
  };
}
