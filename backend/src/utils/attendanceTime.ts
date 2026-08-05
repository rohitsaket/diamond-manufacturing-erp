/**
 * Timezone and shift-window arithmetic.
 *
 * A punch is stored three ways: the absolute instant, and the local date and
 * time in the employee's own zone. A branch in Dubai and one in Surat punching
 * at the same instant belong on different rows of their own registers, and only
 * the local pair can express that.
 *
 * Zone conversion uses Intl, which ships with Node -- no tz database dependency
 * and no drift when the rules change under us.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export interface ZonedInstant {
  /** `YYYY-MM-DD` in the target zone. */
  date: string;
  /** `HH:MM` in the target zone. */
  time: string;
  /** `HH:MM:SS` in the target zone. */
  timeSeconds: string;
  /** `YYYY-MM-DD HH:MM:SS`, ready for a MySQL DATETIME column. */
  dateTime: string;
  /** Minutes east of UTC at that instant, so DST is handled per-instant. */
  offsetMinutes: number;
  timezone: string;
}

function partsFor(date: Date, timezone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Express an instant in a named zone. Falls back to IST for an unknown zone. */
export function toZoned(instant: Date, timezone: string = DEFAULT_TIMEZONE): ZonedInstant {
  const zone = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const p = partsFor(instant, zone);
  const date = `${p.year}-${p.month}-${p.day}`;
  const timeSeconds = `${p.hour}:${p.minute}:${p.second}`;

  // The offset is the gap between the wall clock in the zone and the same
  // wall clock read as UTC, which holds across DST boundaries.
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  const offsetMinutes = Math.round((asUtc - instant.getTime()) / 60000);

  return {
    date,
    time: `${p.hour}:${p.minute}`,
    timeSeconds,
    dateTime: `${date} ${timeSeconds}`,
    offsetMinutes,
    timezone: zone,
  };
}

export function zonedNow(timezone: string = DEFAULT_TIMEZONE): ZonedInstant {
  return toZoned(new Date(), timezone);
}

/** `YYYY-MM-DD HH:MM:SS` for a MySQL DATETIME, from a local date and time. */
export function localDateTime(date: string, time: string): string {
  const t = time.length === 5 ? `${time}:00` : time;
  return `${date} ${t}`;
}

// ---------------------------------------------------------------------------
// Shift windows
// ---------------------------------------------------------------------------

export interface ShiftWindow {
  startMinutes: number;
  /** Minutes from the shift's start-of-day. Exceeds 1440 for a cross-day shift. */
  endMinutes: number;
  crossesMidnight: boolean;
  lengthMinutes: number;
}

/**
 * Resolve a shift's start and end into a single monotonic minute range.
 * A 22:00-06:00 night shift becomes 1320 to 1800, so "is this punch inside the
 * shift" and "how much overtime" are plain comparisons instead of special cases.
 */
export function shiftWindow(startTime: string, endTime: string, crossesMidnight?: boolean): ShiftWindow {
  const start = hhmmToMinutes(startTime) ?? 0;
  let end = hhmmToMinutes(endTime) ?? 0;
  const wraps = crossesMidnight ?? end <= start;
  if (wraps && end <= start) end += 1440;
  return {
    startMinutes: start,
    endMinutes: end,
    crossesMidnight: wraps,
    lengthMinutes: Math.max(0, end - start),
  };
}

/** Minutes since midnight for `HH:MM` or `HH:MM:SS`. */
export function hhmmToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = String(time).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToHhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Lift a punch time onto the shift's timeline. A 01:30 punch on a 22:00-06:00
 * shift is minute 1530, not minute 90, which is what makes cross-day arithmetic
 * work without knowing which calendar date the punch landed on.
 */
export function alignToShift(punchMinutes: number, window: ShiftWindow): number {
  if (!window.crossesMidnight) return punchMinutes;
  // Anything before the shift start belongs to the following calendar day.
  return punchMinutes < window.startMinutes - 240 ? punchMinutes + 1440 : punchMinutes;
}

/** Round overtime down to whole blocks, e.g. 15-minute increments. */
export function roundOvertimeMinutes(minutes: number, blockMinutes: number): number {
  if (blockMinutes <= 0) return Math.max(0, minutes);
  return Math.max(0, Math.floor(minutes / blockMinutes) * blockMinutes);
}

/** Parse a CSV of weekday numbers, e.g. "0,6" -> [0, 6]. */
export function parseWeekOffDays(csv: string | null | undefined, fallback?: number): number[] {
  if (csv === null || csv === undefined || String(csv).trim() === '') {
    return fallback === undefined || fallback === null ? [] : [fallback];
  }
  const out = String(csv)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return out.length ? Array.from(new Set(out)) : fallback === undefined ? [] : [fallback];
}

/** Parse a CSV of enum-ish tokens into a trimmed, upper-cased list. */
export function parseCsvList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return String(csv)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** ISO week key `YYYY-Www`, used to bucket weekly compliance checks. */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Monday of the ISO week containing `date`, as `YYYY-MM-DD`. */
export function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}
