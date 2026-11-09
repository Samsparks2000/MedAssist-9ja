import { config } from '../config.js';

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type OpeningHours = Partial<Record<(typeof DAY_KEYS)[number], [string, string] | null>>;

/** Day of week (0 = Sunday) and minutes since midnight in the pilot city's time zone. */
export function localNow(date = new Date()): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = DAY_KEYS.indexOf(get('weekday').toLowerCase().slice(0, 3) as (typeof DAY_KEYS)[number]);
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function isOpenNow(hours: OpeningHours, open24h: boolean, date = new Date()): boolean {
  if (open24h) return true;
  const { day, minutes } = localNow(date);
  const today = hours[DAY_KEYS[day]];
  if (today) {
    const [start, end] = today.map(toMinutes);
    if (end > start ? minutes >= start && minutes < end : minutes >= start || minutes < end) return true;
  }
  // Overnight hours from the previous day (e.g. 20:00–02:00).
  const yesterday = hours[DAY_KEYS[(day + 6) % 7]];
  if (yesterday) {
    const [start, end] = yesterday.map(toMinutes);
    if (end <= start && minutes < end) return true;
  }
  return false;
}

// Nigeria has no daylight saving: local time is always UTC+1.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

function lagosDateString(d: Date): string {
  return new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

function atLagos(dateStr: string, hhmm: string, addDays = 0): Date {
  const base = new Date(`${dateStr}T${hhmm}:00+01:00`);
  return new Date(base.getTime() + addDays * 86_400_000);
}

/** The opening window in effect at `from`, or the next one within a week. */
export function nextOpenWindow(hours: OpeningHours, open24h: boolean, from = new Date()): { open: Date; close: Date } | null {
  if (open24h) return { open: from, close: new Date(from.getTime() + 7 * 86_400_000) };
  for (let i = -1; i <= 7; i++) {
    const dayDate = new Date(from.getTime() + i * 86_400_000);
    const dateStr = lagosDateString(dayDate);
    const dow = new Date(`${dateStr}T12:00:00+01:00`).getUTCDay();
    const h = hours[DAY_KEYS[dow]];
    if (!h) continue;
    const open = atLagos(dateStr, h[0]);
    const close = atLagos(dateStr, h[1], h[1] <= h[0] ? 1 : 0);
    if (close > from) return { open: open > from ? open : from, close };
  }
  return null;
}

/**
 * When a reservation must be collected by (US-22): the hold window from now, cut off at closing
 * time. If the place is closed or closes within 30 minutes, the hold starts at the next opening.
 */
export function collectDeadline(hours: OpeningHours, open24h: boolean, holdMinutes: number, from = new Date()): Date {
  const holdMs = holdMinutes * 60_000;
  let window = nextOpenWindow(hours, open24h, from);
  if (window && window.close.getTime() - window.open.getTime() < 30 * 60_000) {
    window = nextOpenWindow(hours, open24h, new Date(window.close.getTime() + 60_000));
  }
  if (!window) return new Date(from.getTime() + holdMs);
  return new Date(Math.min(window.open.getTime() + holdMs, window.close.getTime()));
}

/** Text for result cards: "Open · closes 6 pm", "Open 24 hours", "Closed · opens 8 am". */
export function hoursStatus(hours: OpeningHours, open24h: boolean, now = new Date()) {
  if (open24h) return { open: true, label: 'Open 24 hours', closesAt: null as string | null, opensAt: null as string | null };
  const open = isOpenNow(hours, open24h, now);
  const window = nextOpenWindow(hours, open24h, now);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-NG', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(d)
      .replace(':00', '')
      .replace(/\s?([ap])\.?m\.?/i, ' $1m')
      .toLowerCase();
  if (open && window) return { open, label: `Open · closes ${fmt(window.close)}`, closesAt: window.close.toISOString(), opensAt: null };
  if (!window) return { open: false, label: 'Closed', closesAt: null, opensAt: null };
  const sameDay = lagosDateString(window.open) === lagosDateString(now);
  const day = sameDay ? '' : lagosDateString(window.open) === lagosDateString(new Date(now.getTime() + 86_400_000)) ? ' tomorrow' : ` ${new Intl.DateTimeFormat('en-NG', { timeZone: config.timezone, weekday: 'short' }).format(window.open)}`;
  return { open: false, label: `Closed · opens ${fmt(window.open)}${day}`, closesAt: null, opensAt: window.open.toISOString() };
}

export function minutesAgo(date: Date | string): number {
  return Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
}
