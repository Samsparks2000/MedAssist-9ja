import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useUserLocation } from '../lib/location';
import { load, save } from '../lib/storage';

interface Area {
  label: string;
  detail: string;
  lat: number;
  lng: number;
}

const KEY = 'ma9.areas';

export function useAreas() {
  const [groups, setGroups] = useState<{ city: string; areas: Area[] }[]>(() => load(KEY, []));
  useEffect(() => {
    api<{ city: string; areas: Area[] }[]>('/geo/areas')
      .then((g) => {
        setGroups(g);
        save(KEY, g);
      })
      .catch(() => {});
  }, []);
  return groups;
}

/** "Your area" picker from the design, with "Use my location" (GPS) as the first choice. */
export function AreaSelect({ id = 'area', className = '' }: { id?: string; className?: string }) {
  const groups = useAreas();
  const { location, status, locate, setLocation } = useUserLocation();
  const current = location?.source === 'gps' ? '__gps' : location ? location.label : '';
  const known = groups.some((g) => g.areas.some((a) => a.label === current));

  return (
    <select
      id={id}
      className={className}
      aria-label="Your area"
      value={known || current === '__gps' ? current : current ? '__custom' : ''}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__gps') {
          locate();
          return;
        }
        for (const g of groups) {
          const a = g.areas.find((x) => x.label === v);
          if (a) setLocation({ lat: a.lat, lng: a.lng, label: a.label, source: 'address' });
        }
      }}
    >
      {!location && <option value="">Choose your area</option>}
      <option value="__gps">{status === 'locating' ? 'Finding you…' : location?.source === 'gps' ? `📍 ${location.label}` : '📍 Use my location'}</option>
      {location && !known && current !== '__gps' && <option value="__custom">{location.label}</option>}
      {groups.map((g) => (
        <optgroup key={g.city} label={g.city}>
          {g.areas.map((a) => (
            <option key={`${g.city}-${a.label}`} value={a.label}>
              {a.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
