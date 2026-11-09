const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in km (PRD section 10). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bounding box enclosing a circle, used to prefilter with the (lat, lng) index. */
export function boundingBox(center: LatLng, radiusKm: number) {
  const dLat = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(toRad(center.lat)), 1e-6);
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

/** SQL expression computing Haversine km from params ($latParam, $lngParam) to table alias columns. */
export function haversineSql(alias: string, latParam: string, lngParam: string): string {
  return `(2 * ${EARTH_RADIUS_KM} * asin(least(1, sqrt(
    power(sin(radians(${alias}.lat - ${latParam}) / 2), 2) +
    cos(radians(${latParam})) * cos(radians(${alias}.lat)) *
    power(sin(radians(${alias}.lng - ${lngParam}) / 2), 2)))))`;
}
