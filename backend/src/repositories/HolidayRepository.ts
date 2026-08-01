import { BaseRepository } from './BaseRepository';
import { HolidayRow, HolidayResponse } from '../types/hrms';
import { toDateString } from '../utils/dateUtils';

export interface HolidayInput {
  date: string;
  name: string;
  isOptional?: boolean;
}

export class HolidayRepository extends BaseRepository {
  async findByYear(year: number): Promise<HolidayResponse[]> {
    const rows = await this.query<HolidayRow[]>(
      'SELECT * FROM holidays WHERE year_hint = ? AND deleted_at IS NULL ORDER BY holiday_date ASC',
      [year],
    );
    return rows.map((r) => this.toResponse(r));
  }

  async findInRange(from: string, to: string): Promise<HolidayResponse[]> {
    const rows = await this.query<HolidayRow[]>(
      'SELECT * FROM holidays WHERE holiday_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY holiday_date ASC',
      [from, to],
    );
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: number): Promise<HolidayResponse | null> {
    const rows = await this.query<HolidayRow[]>(
      'SELECT * FROM holidays WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  /**
   * Company-wide non-working dates in a range.
   *
   * Optional (restricted) holidays are excluded: they are elected per employee,
   * so treating them as paid days for everybody would over-count paid days in
   * both the payroll engine and the attendance register.
   */
  async findDateSet(from: string, to: string): Promise<Set<string>> {
    const rows = await this.query<any[]>(
      `SELECT holiday_date FROM holidays
       WHERE holiday_date BETWEEN ? AND ? AND is_optional = false AND deleted_at IS NULL`,
      [from, to],
    );
    return new Set(rows.map((r) => toDateString(r.holiday_date)));
  }

  async create(data: HolidayInput, userId: number): Promise<number> {
    const yearHint = Number(data.date.slice(0, 4));
    const result = await this.query<any>(
      `INSERT INTO holidays (holiday_date, name, year_hint, is_optional, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), year_hint = VALUES(year_hint), is_optional = VALUES(is_optional),
         updated_by = VALUES(updated_by), deleted_at = NULL`,
      [data.date, data.name, yearHint, data.isOptional ? 1 : 0, userId, userId],
    );
    if (result.insertId) return result.insertId;
    const existing = await this.findByDate(data.date);
    return existing?.id ?? 0;
  }

  async findByDate(date: string): Promise<HolidayResponse | null> {
    const rows = await this.query<HolidayRow[]>(
      'SELECT * FROM holidays WHERE holiday_date = ? AND deleted_at IS NULL LIMIT 1',
      [date],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  async softDelete(id: number): Promise<void> {
    await this.query('UPDATE holidays SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  private toResponse(row: HolidayRow): HolidayResponse {
    return {
      id: row.id,
      date: toDateString(row.holiday_date),
      name: row.name,
      isOptional: !!row.is_optional,
    };
  }
}
