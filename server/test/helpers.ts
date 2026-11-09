import request from 'supertest';
import { afterAll, beforeAll } from 'vitest';
import { createApp } from '../src/app.js';
import { closePool, initPool, one } from '../src/db/pool.js';
import { TEST_DB_URL } from './constants.js';

export const SEED_PASSWORD = process.env.SEED_PASSWORD || 'MedAssist#2026';

export const YABA = { lat: 6.5095, lng: 3.3711 };
export const IKEJA = { lat: 6.6018, lng: 3.3515 };
export const IKORODU = { lat: 6.6194, lng: 3.5105 };
export const AJAH = { lat: 6.4698, lng: 3.5852 };

export function useDb() {
  beforeAll(() => {
    initPool(TEST_DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });
}

export const app = createApp();
export const http = () => request(app);

export async function providerToken(slug: string): Promise<string> {
  const res = await http().post('/api/auth/login').send({ email: `${slug}@medassist.test`, password: SEED_PASSWORD });
  if (res.status !== 200) throw new Error(`login ${slug} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

let phoneSeq = 100;
/** Signs up a new patient through the real OTP flow (the dev code is echoed in test mode). */
export async function patientToken(): Promise<string> {
  const phone = `0803${String(phoneSeq++).padStart(7, '0')}`;
  const req = await http().post('/api/auth/otp/request').send({ phone });
  const res = await http().post('/api/auth/otp/verify').send({ phone, code: req.body.devCode, name: 'Test Patient', consent: true });
  if (res.status !== 200) throw new Error(`otp failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function facilityId(slug: string): Promise<string> {
  const row = await one(`SELECT f.id FROM facilities f JOIN users u ON u.id = f.owner_id WHERE u.email = $1`, [`${slug}@medassist.test`]);
  return row!.id;
}

export async function drugId(brand: string, strength: string): Promise<string> {
  const row = await one('SELECT id FROM drug_catalogue WHERE brand_name = $1 AND strength = $2', [brand, strength]);
  return row!.id;
}
