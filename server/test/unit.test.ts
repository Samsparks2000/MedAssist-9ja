import { describe, expect, it } from 'vitest';
import { normalisePhone } from '../src/lib/codes.js';
import { MATCH_THRESHOLD, similarity } from '../src/lib/fuzzy.js';
import { boundingBox, haversineKm } from '../src/lib/geo.js';
import { isOpenNow } from '../src/lib/time.js';
import { rankingScore } from '../src/modules/search/service.js';

describe('haversine distance', () => {
  it('matches the known Yaba–Ikeja distance (~10.5 km)', () => {
    const d = haversineKm({ lat: 6.5095, lng: 3.3711 }, { lat: 6.6018, lng: 3.3515 });
    expect(d).toBeGreaterThan(10.2);
    expect(d).toBeLessThan(10.8);
  });

  it('is zero for the same point and symmetric', () => {
    const a = { lat: 6.45, lng: 3.4 };
    const b = { lat: 6.5, lng: 3.5 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it('bounding box encloses every point within the radius', () => {
    const c = { lat: 6.5, lng: 3.4 };
    const box = boundingBox(c, 5);
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      // A point ~4.99 km away in direction deg.
      const p = { lat: c.lat + (4.99 / 111.2) * Math.cos(rad), lng: c.lng + (4.99 / (111.2 * Math.cos((c.lat * Math.PI) / 180))) * Math.sin(rad) };
      expect(haversineKm(c, p)).toBeLessThan(5.01);
      expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(p.lat).toBeLessThanOrEqual(box.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(p.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });
});

describe('fuzzy matching (US-02)', () => {
  it('tolerates common misspellings', () => {
    expect(similarity('insullin', 'insulin')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(similarity('panadool', 'Panadol')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(similarity('coartim', 'Coartem')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(similarity('paracetamo', 'Paracetamol')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('does not match unrelated words', () => {
    expect(similarity('ventilator', 'Paracetamol')).toBeLessThan(MATCH_THRESHOLD);
    expect(similarity('icu', 'Insulin')).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('ranking score', () => {
  it('prefers nearer, fresher and more reliable facilities', () => {
    expect(rankingScore(1, 5, 1, 0.5)).toBeLessThan(rankingScore(4, 5, 1, 0.5));
    expect(rankingScore(2, 5, 1, 0.5)).toBeLessThan(rankingScore(2, 5, 48, 0.5));
    expect(rankingScore(2, 5, 1, 0.9)).toBeLessThan(rankingScore(2, 5, 1, 0.2));
  });

  it('weights distance most (w1 = 0.7)', () => {
    // A stale but very near facility still beats a fresh one at the edge of the radius.
    expect(rankingScore(0.5, 5, 30, 0.5)).toBeLessThan(rankingScore(4.8, 5, 0, 0.5));
  });
});

describe('opening hours in Lagos time', () => {
  const weekday = { mon: ['08:00', '20:00'] as [string, string] };
  it('is open during hours and closed outside them', () => {
    // 2026-10-26 is a Monday; Lagos is UTC+1.
    expect(isOpenNow(weekday, false, new Date('2026-10-26T09:00:00Z'))).toBe(true); // 10:00 Lagos
    expect(isOpenNow(weekday, false, new Date('2026-10-26T19:30:00Z'))).toBe(false); // 20:30 Lagos
    expect(isOpenNow(weekday, false, new Date('2026-10-27T09:00:00Z'))).toBe(false); // Tuesday, no hours
  });

  it('handles overnight hours and 24h facilities', () => {
    const night = { mon: ['20:00', '02:00'] as [string, string] };
    expect(isOpenNow(night, false, new Date('2026-10-27T00:30:00Z'))).toBe(true); // Tue 01:30 Lagos
    expect(isOpenNow({}, true, new Date('2026-10-27T03:00:00Z'))).toBe(true);
  });
});

describe('phone numbers', () => {
  it('normalises Nigerian formats to E.164', () => {
    expect(normalisePhone('0803 123 4567')).toBe('+2348031234567');
    expect(normalisePhone('+234 803 123 4567')).toBe('+2348031234567');
    expect(normalisePhone('12345')).toBeNull();
  });
});
