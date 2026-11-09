import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startEmbeddedPostgres } from '../src/db/embedded.js';
import { migrate } from '../src/db/migrate.js';
import { closePool, initPool } from '../src/db/pool.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { TEST_DB_PORT } from './constants.js';

/** Starts a throwaway embedded Postgres, migrates and seeds it once for the whole run. */
export default async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medassist-test-'));
  const pg = await startEmbeddedPostgres(path.join(dir, 'data'), TEST_DB_PORT, 'medassist_test');
  const pool = initPool(pg.url);
  await migrate(pool);
  await seedIfEmpty();
  await closePool();
  return async () => {
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
