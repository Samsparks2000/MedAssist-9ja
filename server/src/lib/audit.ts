import { type Db, query } from '../db/pool.js';

/** NFR-11: admin actions, stock changes and payments are logged with actor and timestamp. */
export async function audit(
  client: Db,
  actorId: string | null | undefined,
  action: string,
  entity: string,
  entityId: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await query(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [actorId ?? null, action, entity, entityId, details ? JSON.stringify(details) : null],
    client,
  );
}
