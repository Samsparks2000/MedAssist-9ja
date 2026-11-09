import { query } from '../../db/pool.js';
import { notifyFacilityOwner } from '../notifications/service.js';

/** US-11: reminds facilities whose data is over 24 h old (once per stale period unless forced). */
export async function sendStaleReminders(force = false): Promise<number> {
  const stale = await query<{ id: string; name: string; hours: number }>(
    `UPDATE facilities SET stale_reminded_at = now()
      WHERE verification_status = 'approved' AND last_updated < now() - interval '24 hours'
        AND ($1 OR stale_reminded_at IS NULL)
      RETURNING id, name, round(extract(epoch FROM now() - last_updated) / 3600)::int AS hours`,
    [force],
  );
  for (const f of stale) {
    await notifyFacilityOwner(f.id, {
      kind: 'stale_data',
      title: 'Please update your availability',
      body: `${f.name} has not updated in ${f.hours} hours. Patients see a warning and you rank lower until you update; listings are hidden after 72 hours.`,
      link: '/dashboard',
      channels: ['sms'],
    });
  }
  return stale.length;
}
