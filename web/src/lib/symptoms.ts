import { useEffect, useState } from 'react';
import { api } from './api';
import { load, save } from './storage';

export interface Symptom {
  key: string;
  label: string;
  icon: string;
  targets: { spec: string; label: string; kind: 'drug' | 'resource' | 'specialist' }[];
}

const KEY = 'ma9.symptoms';

/** Symptom categories, cached so emergency mode still renders offline. */
export function useSymptoms(): Symptom[] {
  const [list, setList] = useState<Symptom[]>(() => load<Symptom[]>(KEY, []));
  useEffect(() => {
    api<Symptom[]>('/search/symptoms')
      .then((s) => {
        setList(s);
        save(KEY, s);
      })
      .catch(() => {});
  }, []);
  return list;
}

const RECENT_KEY = 'ma9.recentFacilities';
export interface RecentFacility {
  id: string;
  name: string;
  phone: string;
  distanceKm: number;
}

/** Last facilities seen in results; shown with call buttons if the network fails (NFR-02). */
export const recentFacilities = () => load<RecentFacility[]>(RECENT_KEY, []);
export function rememberFacilities(list: RecentFacility[]) {
  const merged = [...list, ...recentFacilities().filter((r) => !list.some((l) => l.id === r.id))].slice(0, 8);
  save(RECENT_KEY, merged);
}
