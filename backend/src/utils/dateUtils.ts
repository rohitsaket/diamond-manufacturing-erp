/**
 * Date helpers for HRMS.
 *
 * All dates crossing the DB/API boundary are plain `YYYY-MM-DD` strings.
 * Arithmetic uses UTC so a server in IST never shifts a date by a day.
 */

/** Normalise whatever mysql2 hands back (Date | string) to `YYYY-MM-DD`. */
export function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().split('T')[0] as string;
  const s = String(value ?? '');
  return s.length > 10 ? s.slice(0, 10) : s;
}

/** Normalise a TIME/DATETIME value to `HH:MM` (or null). */
export function toTimeString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  const s = String(value);
  const match = s.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && toDateString(d) === value;
}

export function todayString(): string {
  return toDateString(new Date());
}

/** Inclusive list of `YYYY-MM-DD` between from and to. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(toDateString(d));
  }
  return out;
}

/** Inclusive day count between two dates. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

/** 0 = Sunday … 6 = Saturday, computed in UTC. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** `YYYY-MM` bucket for a date. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y as number, m as number, 0)).getUTCDate();
}

export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}

/** Later of two dates. */
export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Earlier of two dates. */
export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/** Minutes since midnight for `HH:MM` / `HH:MM:SS`. */
export function timeToMinutes(time: string): number | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Round to 2 decimals without float drift on typical currency values. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
