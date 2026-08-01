import { BaseRepository } from '../repositories/BaseRepository';
import { CalendarEventResponse } from '../types/hrms';
import { daysBetween, isValidDateString } from '../utils/dateUtils';

class CalendarQueryRepository extends BaseRepository {
  async run<T = any[]>(sql: string, params: any[] = []): Promise<T> {
    return this.query<T>(sql, params);
  }
}

const MAX_RANGE_DAYS = 400;

export interface CalendarOptions {
  /** Restricts leave to a single employee; company-wide entries are still returned. */
  employeeId?: number;
}

/**
 * Unified calendar: holidays, approved leave, birthdays, work anniversaries,
 * trainings, company events and payroll period ends, merged into one feed with
 * stable `type-id` keys so the frontend can diff without a server round-trip.
 */
export class CalendarService {
  private db = new CalendarQueryRepository();

  async getEvents(from: string, to: string, opts: CalendarOptions = {}): Promise<CalendarEventResponse[]> {
    if (!from || !to) throw new Error('Both from and to dates are required');
    if (!isValidDateString(from) || !isValidDateString(to)) {
      throw new Error('Dates must be in YYYY-MM-DD format');
    }
    if (to < from) throw new Error('The to date must not be before the from date');
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new Error('Date range is too large');

    const employeeId = opts.employeeId && opts.employeeId > 0 ? opts.employeeId : null;
    const years = yearsInRange(from, to);

    const [holidays, leaves, birthdayGroups, anniversaryGroups, trainings, events, periods] =
      await Promise.all([
        this.db.run<any[]>(
          `SELECT id, holiday_date, name, is_optional
             FROM holidays
            WHERE deleted_at IS NULL AND holiday_date BETWEEN ? AND ?
            ORDER BY holiday_date ASC`,
          [from, to],
        ),
        this.db.run<any[]>(
          `SELECT lr.id, lr.employee_id, lr.from_date, lr.to_date, lr.days,
                  e.full_name, e.emp_code, lt.name AS leave_type_name
             FROM leave_requests lr
             JOIN employees e ON e.id = lr.employee_id
             JOIN leave_types lt ON lt.id = lr.leave_type_id
            WHERE lr.deleted_at IS NULL AND lr.status = 'APPROVED'
              AND lr.from_date <= ? AND lr.to_date >= ?
              ${employeeId ? 'AND lr.employee_id = ?' : ''}
            ORDER BY lr.from_date ASC
            LIMIT 1000`,
          employeeId ? [to, from, employeeId] : [to, from],
        ),
        Promise.all(
          years.map((year) =>
            this.db.run<any[]>(
              `SELECT id, full_name, emp_code,
                      DATE_FORMAT(dob, CONCAT(?, '-%m-%d')) AS projected
                 FROM employees
                WHERE deleted_at IS NULL AND work_status = 'WORKING' AND dob IS NOT NULL
               HAVING projected BETWEEN ? AND ?
                ORDER BY projected ASC
                LIMIT 1000`,
              [String(year), from, to],
            ),
          ),
        ),
        Promise.all(
          years.map((year) =>
            this.db.run<any[]>(
              `SELECT id, full_name, emp_code, joined_at,
                      DATE_FORMAT(joined_at, CONCAT(?, '-%m-%d')) AS projected,
                      CAST(? AS SIGNED) - YEAR(joined_at) AS years
                 FROM employees
                WHERE deleted_at IS NULL AND work_status = 'WORKING'
               HAVING projected BETWEEN ? AND ? AND years > 0
                ORDER BY projected ASC
                LIMIT 1000`,
              [String(year), year, from, to],
            ),
          ),
        ),
        this.db.run<any[]>(
          `SELECT id, title, trainer, start_date, end_date, status
             FROM trainings
            WHERE deleted_at IS NULL
              AND start_date <= ? AND COALESCE(end_date, start_date) >= ?
            ORDER BY start_date ASC`,
          [to, from],
        ),
        this.db.run<any[]>(
          `SELECT id, title, event_type, start_at, end_at, location
             FROM company_events
            WHERE deleted_at IS NULL AND DATE(start_at) BETWEEN ? AND ?
            ORDER BY start_at ASC`,
          [from, to],
        ),
        this.db.run<any[]>(
          `SELECT id, label, from_date, to_date, status
             FROM salary_periods
            WHERE deleted_at IS NULL AND to_date BETWEEN ? AND ?
            ORDER BY to_date ASC`,
          [from, to],
        ),
      ]);

    const out: CalendarEventResponse[] = [];

    for (const r of holidays) {
      out.push({
        id: `holiday-${r.id}`,
        type: 'HOLIDAY',
        title: r.name,
        date: dateOnly(r.holiday_date),
        endDate: null,
        detail: r.is_optional ? 'Optional holiday' : 'Company holiday',
        employeeId: null,
      });
    }

    for (const r of leaves) {
      out.push({
        id: `leave-${r.id}`,
        type: 'LEAVE',
        title: `${r.full_name} — ${r.leave_type_name}`,
        date: dateOnly(r.from_date),
        endDate: dateOnly(r.to_date),
        detail: `${Number(r.days ?? 0)} day(s) · ${r.emp_code}`,
        employeeId: Number(r.employee_id),
      });
    }

    for (const group of birthdayGroups) {
      for (const r of group) {
        out.push({
          id: `birthday-${r.id}`,
          type: 'BIRTHDAY',
          title: `${r.full_name}'s birthday`,
          date: dateOnly(r.projected),
          endDate: null,
          detail: r.emp_code,
          employeeId: Number(r.id),
        });
      }
    }

    for (const group of anniversaryGroups) {
      for (const r of group) {
        const years = Number(r.years ?? 0);
        out.push({
          id: `anniversary-${r.id}`,
          type: 'ANNIVERSARY',
          title: `${r.full_name} — ${years} year${years === 1 ? '' : 's'}`,
          date: dateOnly(r.projected),
          endDate: null,
          detail: `Joined ${dateOnly(r.joined_at)}`,
          employeeId: Number(r.id),
        });
      }
    }

    for (const r of trainings) {
      out.push({
        id: `training-${r.id}`,
        type: 'TRAINING',
        title: r.title,
        date: dateOnly(r.start_date),
        endDate: r.end_date ? dateOnly(r.end_date) : null,
        detail: [r.trainer, r.status].filter(Boolean).join(' · ') || null,
        employeeId: null,
      });
    }

    for (const r of events) {
      const eventType = String(r.event_type ?? '');
      out.push({
        id: `event-${r.id}`,
        type: eventType === 'MEETING' ? 'MEETING' : eventType === 'TRAINING' ? 'TRAINING' : 'EVENT',
        title: r.title,
        date: dateOnly(r.start_at),
        endDate: r.end_at ? dateOnly(r.end_at) : null,
        detail: r.location ?? null,
        employeeId: null,
      });
    }

    for (const r of periods) {
      out.push({
        id: `payroll-${r.id}`,
        type: 'PAYROLL',
        title: `Payroll: ${r.label}`,
        date: dateOnly(r.to_date),
        endDate: null,
        detail: `${dateOnly(r.from_date)} → ${dateOnly(r.to_date)} · ${r.status}`,
        employeeId: null,
      });
    }

    out.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
    return out;
  }
}

/** Every calendar year touched by the range (at most two given the 400-day cap). */
function yearsInRange(from: string, to: string): number[] {
  const start = Number(from.slice(0, 4));
  const end = Number(to.slice(0, 4));
  const out: number[] = [];
  for (let y = start; y <= end; y++) out.push(y);
  return out;
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? '');
  return s.length > 10 ? s.slice(0, 10) : s;
}
