// Override with TEST_DB_PORT if a previous run left a Postgres on the default port.
export const TEST_DB_PORT = Number(process.env.TEST_DB_PORT ?? 5544);
export const TEST_DB_URL = `postgres://postgres:postgres@localhost:${TEST_DB_PORT}/medassist_test`;
