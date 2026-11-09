import { config } from '../../config.js';
import { one, query } from '../../db/pool.js';
import { sha256 } from '../../lib/codes.js';
import { badRequest } from '../../lib/errors.js';

/** Checks and consumes a one-time code sent by /auth/otp/request. Throws a 400 on failure. */
export async function consumeOtp(phone: string, code: string): Promise<void> {
  const otp = await one<{ code_hash: string; expires_at: Date; attempts: number }>(
    'SELECT code_hash, expires_at, attempts FROM otp_codes WHERE phone = $1',
    [phone],
  );
  if (!otp || otp.expires_at < new Date()) throw badRequest('Code expired. Request a new one.');
  if (otp.attempts >= config.otp.maxAttempts) throw badRequest('Too many wrong attempts. Request a new code.');
  if (otp.code_hash !== sha256(phone + code)) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1', [phone]);
    throw badRequest('Incorrect code');
  }
  await query('DELETE FROM otp_codes WHERE phone = $1', [phone]);
}
