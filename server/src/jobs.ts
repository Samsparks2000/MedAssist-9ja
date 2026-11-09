import { sendStaleReminders } from './modules/admin/service.js';
import { forwardTimedOutRequests } from './modules/bedRequests/service.js';
import { runExpiryAlerts } from './modules/inventory/service.js';
import { expireOverdueOrders } from './modules/orders/service.js';
import { sendDueRefillReminders } from './modules/patient/routes.js';
import { processPendingRefunds } from './modules/payments/service.js';

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

const JOBS: Job[] = [
  { name: 'forward-bed-requests', everyMs: 15_000, run: forwardTimedOutRequests },
  { name: 'expire-orders', everyMs: 30_000, run: expireOverdueOrders },
  { name: 'process-refunds', everyMs: 5 * 60_000, run: processPendingRefunds },
  { name: 'expiry-alerts', everyMs: 60 * 60_000, run: runExpiryAlerts },
  { name: 'stale-reminders', everyMs: 60 * 60_000, run: () => sendStaleReminders(false) },
  { name: 'refill-reminders', everyMs: 30 * 60_000, run: sendDueRefillReminders },
];

/** Simple in-process scheduler; each job never overlaps itself. Returns a stop function. */
export function startJobs(): () => void {
  const timers = JOBS.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        console.error(`[job ${job.name}]`, err);
      } finally {
        running = false;
      }
    };
    setTimeout(tick, 2_000);
    return setInterval(tick, job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
