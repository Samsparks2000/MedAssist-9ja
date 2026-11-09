import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

export type Role = 'patient' | 'pharmacy' | 'hospital' | 'specialist' | 'admin';

export interface Me {
  user: { id: string; name: string | null; phone: string | null; email: string | null; role: Role };
  facility: { id: string; name: string; type: 'pharmacy' | 'hospital'; verification_status: string; verification_note: string | null } | null;
  specialist: { id: string; specialty: string; verification_status: string; verification_note: string | null } | null;
  locations: { id: string; label: string; address: string | null; lat: number; lng: number }[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (token: string) => {
      setToken(token);
      setLoading(true);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);

  return <AuthContext.Provider value={{ me, loading, signIn, signOut, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const isProvider = (role?: Role) => role === 'pharmacy' || role === 'hospital' || role === 'specialist';
