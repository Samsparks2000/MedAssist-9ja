export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Similarity in [0, 1] between a user query and a candidate term.
 * Exact and prefix matches score highest; otherwise the best per-word edit similarity is used
 * so "insullin" matches "insulin" and "panadol extra" matches "Panadol Extra".
 */
export function similarity(query: string, term: string): number {
  const q = normalise(query);
  const t = normalise(term);
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.startsWith(q) && q.length >= 3) return 0.95;
  if (t.includes(q) && q.length >= 4) return 0.9;

  const whole = 1 - editDistance(q, t) / Math.max(q.length, t.length);
  const qWords = q.split(' ');
  const tWords = t.split(' ');
  let wordScore = 0;
  for (const qw of qWords) {
    let best = 0;
    for (const tw of tWords) {
      const s = qw === tw ? 1 : 1 - editDistance(qw, tw) / Math.max(qw.length, tw.length);
      if (s > best) best = s;
    }
    wordScore += best;
  }
  wordScore /= qWords.length;
  // Penalise when the query covers only a small part of a long term.
  const coverage = Math.min(1, q.length / t.length);
  return Math.max(whole, wordScore * (0.85 + 0.15 * coverage));
}

export const MATCH_THRESHOLD = 0.72;
