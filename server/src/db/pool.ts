import pg from 'pg';

// Return NUMERIC and BIGINT as JS numbers (prices are naira with 2 decimals, counts are small).
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));
// Keep DATE columns as 'YYYY-MM-DD' strings so expiry dates do not shift with time zones.
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function initPool(connectionString: string): pg.Pool {
  pool = new pg.Pool({ connectionString, max: 20 });
  return pool;
}

export function db(): pg.Pool {
  if (!pool) throw new Error('Database pool not initialised');
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  client: Db = db(),
): Promise<T[]> {
  const res = await client.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  client: Db = db(),
): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

/** Runs fn inside a transaction; NFR-09 relies on this plus row locks for stock changes. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
