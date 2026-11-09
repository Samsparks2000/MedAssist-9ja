import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { startEmbeddedPostgres } from './db/embedded.js';
import { migrate } from './db/migrate.js';
import { closePool, initPool } from './db/pool.js';
import { seedIfEmpty } from './db/seed.js';
import { startJobs } from './jobs.js';
import { attachRealtime } from './realtime.js';

async function main() {
  let stopDb: (() => Promise<void>) | null = null;
  let url = config.db.url;
  if (!url) {
    console.log(`Starting embedded Postgres in ${config.db.embeddedDir} ...`);
    const embedded = await startEmbeddedPostgres(config.db.embeddedDir, config.db.embeddedPort);
    url = embedded.url;
    stopDb = embedded.stop;
  }

  const pool = initPool(url);
  await migrate(pool);
  if (!config.isProd) await seedIfEmpty();

  const server = http.createServer(createApp());
  attachRealtime(server);
  const stopJobs = startJobs();
  server.listen(config.port, () => console.log(`MedAssist-9ja API on http://localhost:${config.port}`));

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopJobs();
    server.close();
    await closePool();
    await stopDb?.();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
