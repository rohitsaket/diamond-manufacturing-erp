import { isValidDateString, timeToMinutes } from './dateUtils';

export interface ParsedPunch {
  empCode: string;
  date: string;
  inTime: string | null;
  outTime: string | null;
  line: number;
}

export interface PunchParseResult {
  rows: ParsedPunch[];
  errors: { line: number; reason: string }[];
}

const REQUIRED_HEADERS = ['emp_code', 'date'];

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

/** Accept `2026-07-15`, `15/07/2026`, `15-07-2026`. */
function normaliseDate(raw: string): string | null {
  const value = raw.trim();
  if (isValidDateString(value)) return value;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const candidate = `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    return isValidDateString(candidate) ? candidate : null;
  }
  // Datetime column: take the leading date part.
  if (value.length > 10 && isValidDateString(value.slice(0, 10))) return value.slice(0, 10);
  return null;
}

function normaliseTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  // Datetime column: take the time part.
  const dt = value.match(/\d{4}-\d{2}-\d{2}[ T](\d{1,2}:\d{2})/);
  const candidate = dt ? (dt[1] as string) : value;
  return timeToMinutes(candidate) === null ? null : candidate.padStart(5, '0');
}

/**
 * Parse a biometric punch export.
 *
 * Expected header: `emp_code,date,in_time,out_time`. Punch-log style exports
 * with several rows per employee per day are collapsed to the earliest in-time
 * and the latest out-time for that day.
 */
export function parsePunchCsv(csvText: string): PunchParseResult {
  const errors: { line: number; reason: string }[] = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) return { rows: [], errors: [{ line: 0, reason: 'File is empty' }] };

  const headers = splitCsvLine(lines[0] as string).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      return { rows: [], errors: [{ line: 1, reason: `Missing required column "${required}". Expected header: emp_code,date,in_time,out_time` }] };
    }
  }

  const idx = {
    empCode: headers.indexOf('emp_code'),
    date: headers.indexOf('date'),
    inTime: headers.indexOf('in_time'),
    outTime: headers.indexOf('out_time'),
  };

  // Collapse multiple punches per (employee, date).
  const merged = new Map<string, ParsedPunch>();

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = splitCsvLine(lines[i] as string);
    const empCode = (cells[idx.empCode] ?? '').trim();
    if (!empCode) {
      errors.push({ line: lineNo, reason: 'Missing emp_code' });
      continue;
    }

    const date = normaliseDate(cells[idx.date] ?? '');
    if (!date) {
      errors.push({ line: lineNo, reason: `Unreadable date "${cells[idx.date] ?? ''}"` });
      continue;
    }

    const inTime = idx.inTime >= 0 ? normaliseTime(cells[idx.inTime]) : null;
    const outTime = idx.outTime >= 0 ? normaliseTime(cells[idx.outTime]) : null;

    if (!inTime && !outTime) {
      errors.push({ line: lineNo, reason: 'Row has neither in_time nor out_time' });
      continue;
    }

    const key = `${empCode}|${date}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { empCode, date, inTime, outTime, line: lineNo });
    } else {
      if (inTime && (!existing.inTime || inTime < existing.inTime)) existing.inTime = inTime;
      if (outTime && (!existing.outTime || outTime > existing.outTime)) existing.outTime = outTime;
    }
  }

  return { rows: [...merged.values()], errors };
}
