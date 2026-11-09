import { MATCH_THRESHOLD, normalise, similarity } from '../../lib/fuzzy.js';
import { allDrugs, type Drug } from '../catalogue/service.js';
import { RESOURCE_SUBTYPES, SPECIALTIES, VOCABULARY } from './vocabulary.js';

export type Target =
  | { kind: 'drug'; spec: string; label: string; drugIds: string[] }
  | { kind: 'resource'; spec: string; label: string; type: keyof typeof RESOURCE_SUBTYPES; subType: string | null }
  | { kind: 'specialist'; spec: string; label: string; specialty: string | null }
  | { kind: 'facility'; spec: string; label: string; facilityType: 'pharmacy' | 'hospital' | null };

export interface Suggestion {
  spec: string;
  label: string;
  kind: Target['kind'];
  score: number;
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

/** Turns a spec string (from a symptom icon, suggestion chip or URL) into a search target. */
export async function targetFromSpec(spec: string): Promise<Target | null> {
  const [prefix, ...rest] = spec.split(':');
  const value = rest.join(':');
  const drugs = await allDrugs();
  switch (prefix) {
    case 'resource': {
      const [type, subType] = [rest[0], rest.slice(1).join(':') || null];
      if (!(type in RESOURCE_SUBTYPES)) return null;
      const subs = RESOURCE_SUBTYPES[type as keyof typeof RESOURCE_SUBTYPES] as readonly string[];
      if (subType && !subs.includes(subType)) return null;
      const label = VOCABULARY.find((v) => v.target === spec)?.label ?? (subType ?? type);
      return { kind: 'resource', spec, label, type: type as keyof typeof RESOURCE_SUBTYPES, subType };
    }
    case 'specialist':
      if (value === 'any') return { kind: 'specialist', spec, label: 'Doctor on duty', specialty: null };
      if (!(SPECIALTIES as readonly string[]).includes(value)) return null;
      return { kind: 'specialist', spec, label: value, specialty: value };
    case 'facility': {
      // Open places of a type, for "Open pharmacy" / "Open now" tiles.
      const type = value === 'pharmacy' || value === 'hospital' ? value : null;
      if (value !== 'any' && !type) return null;
      return { kind: 'facility', spec, label: type === 'pharmacy' ? 'Open pharmacy' : type === 'hospital' ? 'Open hospital' : 'Open now', facilityType: type };
    }
    case 'drug-id': {
      const d = drugs.find((x) => x.id === value);
      return d ? { kind: 'drug', spec, label: [d.brand_name, d.strength].filter(Boolean).join(' '), drugIds: [d.id] } : null;
    }
    case 'drug-brand': {
      const ids = drugs.filter((d) => normalise(d.brand_name) === normalise(value)).map((d) => d.id);
      return ids.length ? { kind: 'drug', spec, label: value, drugIds: ids } : null;
    }
    case 'drug-generic': {
      const ids = drugs.filter((d) => normalise(d.generic_name) === normalise(value)).map((d) => d.id);
      return ids.length ? { kind: 'drug', spec, label: value, drugIds: ids } : null;
    }
    case 'drug-category': {
      const ids = drugs.filter((d) => normalise(d.category ?? '') === normalise(value)).map((d) => d.id);
      return ids.length ? { kind: 'drug', spec, label: value, drugIds: ids } : null;
    }
    default:
      return null;
  }
}

function drugCandidates(drugs: Drug[]): { term: string; spec: string; label: string }[] {
  const out: { term: string; spec: string; label: string }[] = [];
  for (const brand of unique(drugs.map((d) => d.brand_name))) out.push({ term: brand, spec: `drug-brand:${brand}`, label: brand });
  for (const g of unique(drugs.map((d) => d.generic_name))) out.push({ term: g, spec: `drug-generic:${g}`, label: g });
  for (const c of unique(drugs.map((d) => d.category).filter((c): c is string => !!c))) {
    out.push({ term: c, spec: `drug-category:${c}`, label: c });
  }
  for (const d of drugs) {
    if (d.strength) {
      const label = `${d.brand_name} ${d.strength}`;
      out.push({ term: label, spec: `drug-id:${d.id}`, label });
    }
  }
  return out;
}

/**
 * Resolves free text to the best target plus "did you mean" alternatives (PRD section 10 step 1).
 * Brand, generic and category names come from the catalogue; spelling mistakes are tolerated.
 */
export async function resolveQuery(text: string, limit = 6): Promise<Suggestion[]> {
  const q = normalise(text.replace(/−/g, '-'));
  if (!q) return [];
  const drugs = await allDrugs();
  const candidates = [
    ...VOCABULARY.map((v) => ({ term: v.term, spec: v.target, label: v.label })),
    ...drugCandidates(drugs),
  ];
  const best = new Map<string, Suggestion>();
  for (const c of candidates) {
    const score = similarity(q, c.term);
    if (score < MATCH_THRESHOLD) continue;
    const prev = best.get(c.spec);
    if (!prev || score > prev.score) {
      const kind: Target['kind'] = c.spec.startsWith('drug') ? 'drug' : c.spec.startsWith('specialist') ? 'specialist' : 'resource';
      best.set(c.spec, { spec: c.spec, label: c.label, kind, score });
    }
  }
  // On ties prefer broader targets (a generic name over one brand, any blood group over one group).
  const breadth = (s: Suggestion) =>
    s.spec.startsWith('drug-generic') || s.spec.startsWith('drug-category') ? 2 : s.spec.split(':').length === 2 ? 1 : 0;
  return [...best.values()]
    .sort((a, b) => b.score - a.score || breadth(b) - breadth(a) || a.label.localeCompare(b.label))
    .slice(0, limit);
}
