import crypto from 'node:crypto';

/** Six-digit numeric code (OTPs), uniformly random. */
export function numericCode(length = 6): string {
  return Array.from({ length }, () => crypto.randomInt(10)).join('');
}

/** Short pickup code read aloud at the counter, e.g. "MA-4827". Uniqueness is per facility (see orders). */
export function pickupCode(): string {
  return `MA-${String(crypto.randomInt(10_000)).padStart(4, '0')}`;
}

/** Accepts "MA-4827", "ma 4827" or just "4827" as typed by a pharmacist. */
export function normalisePickupCode(raw: string): string {
  const digits = raw.toUpperCase().replace(/^\s*MA/, '').replace(/\D/g, '');
  return `MA-${digits}`;
}

export function paymentReference(): string {
  return `MA9-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export function token(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Normalises Nigerian phone numbers to E.164 (+234...). */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  let n = digits.startsWith('+') ? digits.slice(1) : digits;
  if (n.startsWith('0') && n.length === 11) n = '234' + n.slice(1);
  if (!/^234[789]\d{9}$/.test(n)) return null;
  return '+' + n;
}
