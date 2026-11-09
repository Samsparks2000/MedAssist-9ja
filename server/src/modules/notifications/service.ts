import { email, sms } from '../../adapters/messaging.js';
import { type Db, db, one, query } from '../../db/pool.js';
import { bus } from '../../lib/events.js';

export interface NotifyInput {
  userId: string;
  kind: string;
  title: string;
  body: string;
  link?: string;
  channels?: ('sms' | 'email')[];
}

/** FR-11: always stores an in-app notification, optionally fanning out to SMS and email. */
export async function notify(input: NotifyInput, client: Db = db()): Promise<void> {
  const row = await one<{ id: string }>(
    `INSERT INTO notifications (user_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.userId, input.kind, input.title, input.body, input.link ?? null],
    client,
  );
  bus.publish('notification.created', { userId: input.userId, id: row!.id, title: input.title });

  if (!input.channels?.length) return;
  const user = await one<{ phone: string | null; email: string | null }>(
    'SELECT phone, email FROM users WHERE id = $1',
    [input.userId],
    client,
  );
  // Outbound delivery must not fail the business transaction that triggered it.
  if (input.channels.includes('sms') && user?.phone) {
    sms.send(user.phone, `${input.title}: ${input.body}`).catch((e) => console.error('SMS failed', e));
  }
  // People who signed up with only an email get their SMS messages (pickup codes etc.) by email instead.
  const smsFallback = input.channels.includes('sms') && !user?.phone;
  if ((input.channels.includes('email') || smsFallback) && user?.email) {
    email.send(user.email, input.title, input.body).catch((e) => console.error('Email failed', e));
  }
}

/** Notifies the facility's owner and staff. */
export async function notifyFacilityOwner(
  facilityId: string,
  input: Omit<NotifyInput, 'userId'>,
  client: Db = db(),
): Promise<void> {
  const team = await query<{ id: string }>(
    `SELECT owner_id AS id FROM facilities WHERE id = $1 AND owner_id IS NOT NULL
     UNION SELECT user_id FROM facility_staff WHERE facility_id = $1`,
    [facilityId],
    client,
  );
  for (const m of team) await notify({ ...input, userId: m.id }, client);
}

export function smsDirect(phone: string, message: string): void {
  sms.send(phone, message).catch((e) => console.error('SMS failed', e));
}
