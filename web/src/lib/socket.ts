import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';

let socket: Socket | null = null;
let socketToken: string | null = null;

/** One shared connection; reconnects when the signed-in user changes. */
export function getSocket(): Socket {
  const token = getToken();
  if (!socket || socketToken !== token) {
    socket?.disconnect();
    socket = io({ path: '/socket.io', auth: token ? { token } : {}, transports: ['websocket', 'polling'] });
    socketToken = token;
  }
  return socket;
}

export function useSocketEvent<T>(event: string, handler: (payload: T) => void, deps: unknown[] = []) {
  useEffect(() => {
    const s = getSocket();
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
