import { db, query } from '../../db/pool.js';
import { MATCH_THRESHOLD, normalise, similarity } from '../../lib/fuzzy.js';

export interface Drug {
  id: string;
  brand_name: string;
  generic_name: string;
  strength: string | null;
  form: string | null;
  category: string | null;
}

let cache: Drug[] | null = null;

export async function allDrugs(): Promise<Drug[]> {
  if (!cache) {
    cache = await query<Drug>('SELECT * FROM drug_catalogue ORDER BY brand_name, strength', [], db());
  }
  return cache;
}

export function invalidateCatalogue(): void {
  cache = null;
}

/** Patient-facing name in the design's style: "Insulin glargine (Lantus) 100 IU/ml pen", "Panadol 500mg tablet". */
export function drugLabel(d: Pick<Drug, 'brand_name' | 'strength' | 'form'> & { generic_name?: string }): string {
  const brand = d.brand_name.replace(/ (SoloStar|KwikPen|FlexPen)$/, '');
  const isPen = /pen/i.test(d.strength ?? '') || /pen/i.test(d.form ?? '');
  const name = d.generic_name && d.generic_name.toLowerCase() !== d.brand_name.toLowerCase() && isPen ? `${d.generic_name} (${brand})` : d.brand_name;
  const strength = (d.strength ?? '').replace(/(\d)IU\/ml/i, '$1 IU/ml').replace(/\s*3ml pen/i, '');
  return [name, strength, isPen ? 'pen' : (d.form ?? '').toLowerCase()].filter(Boolean).join(' ');
}

/** The same naming in SQL, for queries over drug_catalogue aliased as `d`. */
export const DRUG_LABEL_SQL = `concat_ws(' ',
  CASE WHEN (d.strength ILIKE '%pen%' OR d.form ILIKE '%pen%') AND lower(d.generic_name) <> lower(d.brand_name)
       THEN d.generic_name || ' (' || regexp_replace(d.brand_name, ' (SoloStar|KwikPen|FlexPen)$', '') || ')' ELSE d.brand_name END,
  nullif(regexp_replace(regexp_replace(d.strength, '(\\d)IU/ml', '\\1 IU/ml', 'i'), '\\s*3ml pen', '', 'i'), ''),
  CASE WHEN d.strength ILIKE '%pen%' OR d.form ILIKE '%pen%' THEN 'pen' ELSE lower(d.form) END)`;

/** Ranked fuzzy matches on brand or generic name (US-02). */
export async function searchDrugs(text: string, limit = 20): Promise<(Drug & { score: number })[]> {
  const q = normalise(text);
  if (!q) return [];
  const drugs = await allDrugs();
  return drugs
    .map((d) => ({
      ...d,
      score: Math.max(
        similarity(q, d.brand_name),
        similarity(q, d.generic_name),
        similarity(q, drugLabel(d)),
        similarity(q, `${d.generic_name} ${d.strength ?? ''}`),
      ),
    }))
    .filter((d) => d.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.brand_name.localeCompare(b.brand_name))
    .slice(0, limit);
}

/**
 * Matches a spreadsheet row to the catalogue (US-16): exact name + strength first, then
 * the best fuzzy match whose strength agrees when one was given.
 */
export async function matchCatalogue(name: string, strength?: string, form?: string): Promise<Drug | null> {
  const n = normalise(name);
  const s = strength ? normalise(strength).replace(/\s/g, '') : '';
  const f = form ? normalise(form) : '';
  const sameStrength = (d: Drug) => !s || normalise(d.strength ?? '').replace(/\s/g, '') === s;
  const sameForm = (d: Drug) => !f || normalise(d.form ?? '').startsWith(f) || f.startsWith(normalise(d.form ?? ''));
  const drugs = await allDrugs();

  const exact = drugs.filter(
    (d) => (normalise(d.brand_name) === n || normalise(d.generic_name) === n) && sameStrength(d) && sameForm(d),
  );
  if (exact.length) return exact.find((d) => normalise(d.brand_name) === n) ?? exact[0];

  const ranked = (await searchDrugs(name, 50)).filter((d) => sameStrength(d) && sameForm(d));
  return ranked[0] && ranked[0].score >= 0.8 ? ranked[0] : null;
}
