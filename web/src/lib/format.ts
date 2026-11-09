export const naira = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₦${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export function ago(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** "Updated today", "Updated yesterday", "Updated 9 days ago" (design wording). */
export function updatedLabel(minutes: number): string {
  if (minutes < 60) return `Updated ${ago(minutes)}`;
  const h = minutes / 60;
  if (h < 12) return `Updated ${Math.floor(h)} h ago`;
  if (h < 24) return 'Updated today';
  if (h < 48) return 'Updated yesterday';
  return `Updated ${Math.floor(h / 24)} days ago`;
}

export const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

const LAGOS = 'Africa/Lagos';

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-NG', { timeZone: LAGOS, dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { timeZone: LAGOS, day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const monthYear = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: LAGOS, month: 'short', year: 'numeric' }) : '—';

/** "10:52 am" */
export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-NG', { timeZone: LAGOS, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([AP])M/i, (_, x) => ` ${x.toLowerCase()}m`);

/** "6:00 pm today", "8:00 am tomorrow", "10:00 am Mon" */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: LAGOS });
  const today = key(new Date());
  const tomorrow = key(new Date(Date.now() + 86_400_000));
  const day = key(d) === today ? 'today' : key(d) === tomorrow ? 'tomorrow' : d.toLocaleDateString('en-NG', { timeZone: LAGOS, weekday: 'short' });
  return `${time(iso)} ${day}`;
}

export const directionsUrl = (dest: { lat: number; lng: number }, origin?: { lat: number; lng: number } | null) =>
  `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}` +
  (origin ? `&origin=${origin.lat},${origin.lng}` : '') +
  '&travelmode=driving';

export const telUrl = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

export const WARD_LABEL: Record<string, string> = {
  Emergency: 'Emergency (A&E)',
  Paediatric: "Children's ward",
  ICU: 'ICU',
  'General ward': 'General ward',
  Maternity: 'Maternity',
};

export const STATUS_LABEL: Record<string, string> = {
  requested: 'Waiting for pharmacy',
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  reserved: 'Reserved',
  collected: 'Collected',
  cancelled: 'Cancelled',
  expired: 'Expired',
  success: 'Paid',
  refund_pending: 'Refund in progress',
  refunded: 'Refunded',
  failed: 'Failed',
  pending: 'Waiting for review',
  info_requested: 'More information needed',
  draft: 'Draft',
  approved: 'Verified',
  rejected: 'Rejected',
  suspended: 'Suspended',
  accepted: 'Accepted',
  unmatched: 'No hospital found',
  confirmed: 'Confirmed',
  declined: 'Declined',
  available: 'Available',
  under_repair: 'Under repair',
  not_available: 'Not available',
};

/** "Insulin glargine (Lantus) 100 IU/ml pen" style naming used across the design. */
export function drugName(d: { brand_name: string; generic_name?: string | null; strength?: string | null; form?: string | null }): string {
  const generic = d.generic_name && d.generic_name.toLowerCase() !== d.brand_name.toLowerCase() ? d.generic_name : null;
  const brand = d.brand_name.replace(/\s+(SoloStar|KwikPen|FlexPen)$/i, '');
  const name = generic ? `${generic} (${brand})` : d.brand_name;
  const strength = (d.strength ?? '').replace(/(\d)IU\/ml/i, '$1 IU/ml').replace(/\s*3ml pen/i, '');
  const form = /pen/i.test(d.strength ?? '') || /pen/i.test(d.form ?? '') ? 'pen' : (d.form ?? '').toLowerCase();
  return [name, strength, form].filter(Boolean).join(' ');
}
