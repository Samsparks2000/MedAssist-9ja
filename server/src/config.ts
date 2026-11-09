import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';

dotenv.config({ quiet: true });

const env = process.env;

function num(name: string, fallback: number): number {
  const v = env[name];
  return v === undefined || v === '' ? fallback : Number(v);
}

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  // Not PORT: dev tooling sets PORT for the web server when both run under one command.
  port: num('API_PORT', 4000),
  webUrl: env.WEB_URL ?? 'http://localhost:5173',
  apiUrl: env.API_URL ?? 'http://localhost:4000',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-change-me',
  jwtTtl: env.JWT_TTL ?? '7d',

  db: {
    // When DATABASE_URL is set we connect to it (e.g. a managed PostGIS instance);
    // otherwise an embedded Postgres is started for local development.
    url: env.DATABASE_URL || undefined,
    // Kept outside OneDrive-synced folders by default: sync clients lock Postgres files.
    embeddedDir: env.EMBEDDED_PG_DIR ?? path.join(os.homedir(), '.medassist-9ja', 'pgdata'),
    embeddedPort: num('EMBEDDED_PG_PORT', 5433),
  },

  search: {
    radiiKm: [5, 10, 20],
    maxResults: 10,
    staleFlagHours: num('STALE_FLAG_HOURS', 24),
    freshnessLimitHours: num('FRESHNESS_LIMIT_HOURS', 72),
    weights: { distance: 0.7, freshness: 0.2, reliability: 0.1 },
  },

  reservations: {
    holdMinutes: num('RESERVATION_HOLD_MINUTES', 120),
    bedRequestTimeoutMinutes: num('BED_REQUEST_TIMEOUT_MINUTES', 3),
    bedRequestMaxForwards: 5,
  },

  payments: {
    provider: (env.PAYMENT_PROVIDER ?? 'mock') as 'mock' | 'paystack',
    secretKey: env.PAYSTACK_SECRET_KEY ?? 'mock_secret_key',
    platformFeePercent: num('PLATFORM_FEE_PERCENT', 2.5),
  },

  sms: {
    provider: (env.SMS_PROVIDER ?? 'console') as 'console' | 'termii',
    termiiApiKey: env.TERMII_API_KEY ?? '',
    termiiSenderId: env.TERMII_SENDER_ID ?? 'MedAssist',
  },

  maps: {
    geocoder: (env.GEOCODER ?? 'landmarks') as 'landmarks' | 'nominatim',
    avgSpeedKmh: num('AVG_ROAD_SPEED_KMH', 22),
  },

  otp: { ttlMinutes: 5, maxAttempts: 5 },

  timezone: 'Africa/Lagos',
};
