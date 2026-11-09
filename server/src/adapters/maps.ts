import { config } from '../config.js';
import { normalise, similarity } from '../lib/fuzzy.js';
import { haversineKm, type LatLng } from '../lib/geo.js';

export interface Place extends LatLng {
  label: string;
  /** Second line in pickers, e.g. "Agbowo, Ibadan". */
  detail?: string;
}

export interface Geocoder {
  autocomplete(text: string): Promise<Place[]>;
}

export interface RoutePlanner {
  /** Travel time in minutes for each destination. */
  etaMinutes(origin: LatLng, destinations: LatLng[]): Promise<number[]>;
}

type Seed = [name: string, area: string, lat: number, lng: number];

// Pilot-city landmarks so address entry works offline and without an API key (US-13).
const LAGOS: Seed[] = [
  ['Yaba', 'Yaba', 6.5095, 3.3711], ['Ikeja', 'Ikeja', 6.6018, 3.3515], ['Ikeja GRA', 'Ikeja', 6.5833, 3.35],
  ['Allen Avenue', 'Ikeja', 6.6, 3.356], ['Computer Village', 'Ikeja', 6.596, 3.342],
  ['Maryland', 'Maryland', 6.5713, 3.367], ['Surulere', 'Surulere', 6.4969, 3.3481], ['National Stadium', 'Surulere', 6.499, 3.365],
  ['Lekki Phase 1', 'Lekki', 6.4474, 3.4723], ['Victoria Island', 'Victoria Island', 6.4281, 3.4219], ['Ikoyi', 'Ikoyi', 6.4541, 3.4316],
  ['Obalende', 'Lagos Island', 6.4489, 3.4083], ['CMS, Marina', 'Lagos Island', 6.452, 3.389], ['Idumota', 'Lagos Island', 6.458, 3.387],
  ['Ajah', 'Ajah', 6.4698, 3.5852], ['Festac Town', 'Festac', 6.4664, 3.2833], ['Mile 2', 'Amuwo-Odofin', 6.463, 3.31], ['Apapa', 'Apapa', 6.4489, 3.359],
  ['Oshodi', 'Oshodi', 6.555, 3.3436], ['Mushin', 'Mushin', 6.5273, 3.354], ['Gbagada', 'Gbagada', 6.555, 3.389], ['Ketu', 'Kosofe', 6.596, 3.392],
  ['Ojota', 'Kosofe', 6.587, 3.379], ['Ogba', 'Ikeja', 6.63, 3.34], ['Agege', 'Agege', 6.618, 3.3209], ['Ikorodu', 'Ikorodu', 6.6194, 3.5105],
  ['Egbeda', 'Alimosho', 6.59, 3.29], ['Ikotun', 'Alimosho', 6.548, 3.264], ['Isolo', 'Isolo', 6.537, 3.323], ['Ojuelegba', 'Surulere', 6.509, 3.364],
  ['University of Lagos (UNILAG)', 'Akoka', 6.5158, 3.3896], ['LUTH', 'Idi-Araba', 6.517, 3.353],
  ['LASUTH', 'Ikeja', 6.596, 3.352], ['Ebute Metta', 'Ebute Metta', 6.485, 3.38], ['Magodo', 'Kosofe', 6.615, 3.38],
  ['Ilupeju', 'Ilupeju', 6.553, 3.357], ['Anthony Village', 'Kosofe', 6.56, 3.37], ['Sangotedo', 'Eti-Osa', 6.47, 3.63],
  ['Chevron', 'Lekki', 6.439, 3.53], ['Ojo', 'Ojo', 6.46, 3.18],
];

const IBADAN: Seed[] = [
  ['Bodija', 'Bodija', 7.424, 3.913], ['Bodija Market', 'Bodija', 7.42, 3.915], ['Agbowo', 'Agbowo', 7.44, 3.91],
  ['12 Agbowo Road', 'Agbowo', 7.4405, 3.9098], ['University of Ibadan (UI)', 'Agbowo', 7.444, 3.899],
  ['University of Ibadan, Second Gate', 'Agbowo', 7.4452, 3.9078], ['University College Hospital (UCH)', 'Agodi', 7.404, 3.902],
  ['Mokola', 'Mokola', 7.405, 3.893], ['Dugbe', 'Dugbe', 7.39, 3.888], ['Ring Road', 'Ring Road', 7.361, 3.876],
  ['Challenge', 'Challenge', 7.353, 3.88], ['Iwo Road', 'Iwo Road', 7.408, 3.947], ['Sango', 'Sango', 7.429, 3.89],
  ['Ojoo', 'Ojoo', 7.468, 3.911], ['Agodi', 'Agodi', 7.406, 3.915], ['Oke-Ado', 'Oke-Ado', 7.375, 3.88],
  ['Jericho', 'Jericho', 7.4, 3.865], ['Apata', 'Apata', 7.38, 3.83], ['Samonda', 'Samonda', 7.43, 3.897],
  ['Secretariat', 'Agodi', 7.417, 3.905], ['Akobo', 'Akobo', 7.425, 3.955], ['Oluyole Estate', 'Oluyole', 7.355, 3.865],
  ['Eleyele', 'Eleyele', 7.413, 3.864], ['Mokola Roundabout', 'Mokola', 7.4062, 3.8935],
];

const PLACES: Place[] = [
  ...LAGOS.map(([n, area, lat, lng]) => ({ label: n, detail: `${area}, Lagos`, lat, lng })),
  ...IBADAN.map(([n, area, lat, lng]) => ({ label: n, detail: `${area}, Ibadan`, lat, lng })),
];

/** Neighbourhoods for the "Your area" picker: one entry per area, positioned at its main landmark. */
export function areas(): { city: string; areas: Place[] }[] {
  const pick = (city: string, seeds: Seed[]) => {
    const seen = new Map<string, Place>();
    for (const [name, area, lat, lng] of seeds) {
      if (!seen.has(area) || name === area) seen.set(area, { label: area, detail: `${area}, ${city}`, lat, lng });
    }
    return { city, areas: [...seen.values()].sort((a, b) => a.label.localeCompare(b.label)) };
  };
  return [pick('Ibadan', IBADAN), pick('Lagos', LAGOS)];
}

const CITY_SUFFIX = /,?\s*(lagos|ibadan)\s*$/i;

class LandmarkGeocoder implements Geocoder {
  async autocomplete(text: string): Promise<Place[]> {
    const city = text.match(CITY_SUFFIX)?.[1]?.toLowerCase();
    const q = normalise(text.replace(CITY_SUFFIX, ''));
    if (q.length < 2) return [];
    return PLACES.filter((p) => !city || p.detail!.toLowerCase().endsWith(city))
      .map((p) => ({ p, s: Math.max(similarity(q, p.label), similarity(q, `${p.label} ${p.detail}`)) }))
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.p);
  }
}

/** Nearest known landmark, used to label a GPS fix or a map pin ("Near Agbowo, Ibadan"). */
export function nearestPlace(at: LatLng): (Place & { distanceKm: number }) | null {
  let best: (Place & { distanceKm: number }) | null = null;
  for (const p of PLACES) {
    const d = haversineKm(at, p);
    if (!best || d < best.distanceKm) best = { ...p, distanceKm: d };
  }
  return best && best.distanceKm <= 15 ? best : null;
}

/** OpenStreetMap Nominatim (no key; max 1 request/s under its usage policy). Set GEOCODER=nominatim. */
class NominatimGeocoder implements Geocoder {
  async autocomplete(text: string): Promise<Place[]> {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', `${text}, Nigeria`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '6');
    url.searchParams.set('countrycodes', 'ng');
    const res = await fetch(url, { headers: { 'User-Agent': 'MedAssist-9ja/0.1 (pilot)' } });
    if (!res.ok) return new LandmarkGeocoder().autocomplete(text);
    const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return rows.map((r) => {
      const [first, ...rest] = r.display_name.split(', ');
      return { label: first, detail: rest.slice(0, 2).join(', '), lat: Number(r.lat), lng: Number(r.lon) };
    });
  }
}

/** Estimates road time from straight-line distance; replace with a Google/Mapbox matrix call in production. */
class EstimatedRoutes implements RoutePlanner {
  async etaMinutes(origin: LatLng, destinations: LatLng[]): Promise<number[]> {
    const roadFactor = 1.4;
    return destinations.map((d) =>
      Math.max(2, Math.round(((haversineKm(origin, d) * roadFactor) / config.maps.avgSpeedKmh) * 60)),
    );
  }
}

export const geocoder: Geocoder = config.maps.geocoder === 'nominatim' ? new NominatimGeocoder() : new LandmarkGeocoder();
export const routes: RoutePlanner = new EstimatedRoutes();
