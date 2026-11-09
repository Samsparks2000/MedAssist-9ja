import type http from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { one } from './db/pool.js';
import { userFromToken } from './lib/auth.js';
import { bus } from './lib/events.js';
import { findOwnFacility } from './modules/facilities/service.js';

/**
 * WebSocket push (FR-06): availability changes go to every client so open result lists refresh;
 * notifications, orders and bed requests go to the rooms of the people involved.
 */
export function attachRealtime(server: http.Server): Server {
  const io = new Server(server, { cors: { origin: config.webUrl }, path: '/socket.io' });

  io.on('connection', async (socket) => {
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (authToken) {
      const user = await userFromToken(authToken);
      if (user) {
        socket.join(`user:${user.id}`);
        if (user.role === 'pharmacy' || user.role === 'hospital') {
          const f = await findOwnFacility(user.id);
          if (f) socket.join(`facility:${f.id}`);
        }
      }
    }
    socket.on('watch-bed-request', async (msg: { id: string; token: string }) => {
      const r = await one('SELECT access_token FROM bed_requests WHERE id = $1', [msg?.id]).catch(() => null);
      if (r && r.access_token === msg.token) socket.join(`bed:${msg.id}`);
    });
  });

  bus.subscribe('availability.changed', (e) => io.emit('availability', e));
  bus.subscribe('notification.created', (e) => io.to(`user:${e.userId}`).emit('notification', e));
  bus.subscribe('order.updated', (e) => {
    io.to(`user:${e.userId}`).emit('order', e);
    io.to(`facility:${e.facilityId}`).emit('order', e);
  });
  bus.subscribe('bedRequest.updated', (e) => {
    io.to(`bed:${e.id}`).emit('bed-request', e);
    if (e.facilityId) io.to(`facility:${e.facilityId}`).emit('bed-request', e);
  });
  return io;
}
