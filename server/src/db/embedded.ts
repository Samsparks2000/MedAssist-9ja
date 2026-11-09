import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const USER = 'postgres';
const PASSWORD = 'postgres';

export interface EmbeddedDb {
  url: string;
  stop: () => Promise<void>;
}

/** Starts a local Postgres from npm binaries so development needs no system install. */
export async function startEmbeddedPostgres(dir: string, port: number, database = 'medassist'): Promise<EmbeddedDb> {
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: USER,
    password: PASSWORD,
    port,
    persistent: true,
    // Windows defaults to WIN1252, which cannot store ₦ or names with diacritics.
    initdbFlags: ['--encoding=UTF8', '--no-locale'],
    onLog: () => {},
    onError: (msg) => console.error('[postgres]', msg),
  });

  const initialised = fs.existsSync(path.join(dir, 'PG_VERSION'));
  if (!initialised) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch {
    // Already exists.
  }

  return {
    url: `postgres://${USER}:${PASSWORD}@localhost:${port}/${database}`,
    stop: () => pg.stop(),
  };
}
