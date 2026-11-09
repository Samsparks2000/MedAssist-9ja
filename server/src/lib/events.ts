import { EventEmitter } from 'node:events';

/**
 * In-process event bus. The PRD routes live updates through Redis pub/sub; this has the same
 * publish/subscribe shape, so a Redis-backed bus can replace it when running several API nodes.
 */
export interface AvailabilityChanged {
  facilityId: string;
  kind: 'inventory' | 'resource' | 'specialist' | 'facility';
}

type Events = {
  'availability.changed': AvailabilityChanged;
  'notification.created': { userId: string; id: string; title: string };
  'bedRequest.updated': { id: string; status: string; facilityId: string | null };
  'order.updated': { id: string; userId: string; facilityId: string; status: string };
};

class Bus {
  private emitter = new EventEmitter().setMaxListeners(50);
  publish<K extends keyof Events>(event: K, payload: Events[K]) {
    this.emitter.emit(event, payload);
  }
  subscribe<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void) {
    this.emitter.on(event, fn);
    return () => this.emitter.off(event, fn);
  }
}

export const bus = new Bus();
