import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { load, save } from './storage';

export interface UserLocation {
  lat: number;
  lng: number;
  label: string;
  source: 'gps' | 'address' | 'map';
  at: number;
}

type Status = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

interface LocationState {
  location: UserLocation | null;
  status: Status;
  /** US-12: asks for GPS and resolves within ~10 s. */
  locate: () => Promise<UserLocation | null>;
  setLocation: (l: Omit<UserLocation, 'at'>) => void;
}

const KEY = 'ma9.location';
const Ctx = createContext<LocationState>(null as never);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLoc] = useState<UserLocation | null>(() => load<UserLocation | null>(KEY, null));
  const [status, setStatus] = useState<Status>(location ? 'ready' : 'idle');

  const setLocation = useCallback((l: Omit<UserLocation, 'at'>) => {
    const next = { ...l, at: Date.now() };
    setLoc(next);
    setStatus('ready');
    save(KEY, next);
  }, []);

  const locate = useCallback(
    () =>
      new Promise<UserLocation | null>((resolve) => {
        if (!('geolocation' in navigator)) {
          setStatus('unavailable');
          resolve(null);
          return;
        }
        setStatus('locating');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Your current location', source: 'gps' as const, at: Date.now() };
            setLoc(next);
            setStatus('ready');
            save(KEY, next);
            resolve(next);
          },
          (err) => {
            setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
      }),
    [],
  );

  return <Ctx.Provider value={{ location, status, locate, setLocation }}>{children}</Ctx.Provider>;
}

export const useUserLocation = () => useContext(Ctx);
