import { BaseRepository } from './BaseRepository';
import { ShiftRow, ShiftResponse } from '../types/hrms';
import { toTimeString } from '../utils/dateUtils';

export interface ShiftInput {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes?: number;
  graceMinutes?: number;
  weekOffDay?: number;
  isDefault?: boolean;
}

/** Writable columns, mapped to their DB names. */
const SHIFT_COLUMNS: Record<keyof ShiftInput, string> = {
  name: 'name',
  startTime: 'start_time',
  endTime: 'end_time',
  breakMinutes: 'break_minutes',
  graceMinutes: 'grace_minutes',
  weekOffDay: 'week_off_day',
  isDefault: 'is_default',
};

export class ShiftRepository extends BaseRepository {
  async findAll(): Promise<ShiftResponse[]> {
    const rows = await this.query<ShiftRow[]>(
      'SELECT * FROM shifts WHERE deleted_at IS NULL ORDER BY is_default DESC, name ASC',
    );
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: number): Promise<ShiftResponse | null> {
    const rows = await this.query<ShiftRow[]>(
      'SELECT * FROM shifts WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  /** The shift applied to employees that have no shift of their own. */
  async findDefault(): Promise<ShiftResponse | null> {
    const rows = await this.query<ShiftRow[]>(
      'SELECT * FROM shifts WHERE is_default = true AND deleted_at IS NULL ORDER BY id ASC LIMIT 1',
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  async findByName(name: string): Promise<ShiftResponse | null> {
    const rows = await this.query<ShiftRow[]>(
      'SELECT * FROM shifts WHERE name = ? AND deleted_at IS NULL LIMIT 1',
      [name],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  async create(data: ShiftInput, userId: number): Promise<number> {
    if (data.isDefault) await this.clearDefault();

    const result = await this.query<any>(
      `INSERT INTO shifts
         (name, start_time, end_time, break_minutes, grace_minutes, week_off_day, is_default, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.startTime,
        data.endTime,
        data.breakMinutes ?? 60,
        data.graceMinutes ?? 15,
        data.weekOffDay ?? 0,
        data.isDefault ? 1 : 0,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async update(id: number, data: Partial<ShiftInput>, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(SHIFT_COLUMNS)) {
      const value = (data as Record<string, unknown>)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }

    if (sets.length === 0) return;
    if (data.isDefault) await this.clearDefault(id);

    sets.push('updated_by = ?');
    params.push(userId, id);

    await this.query(`UPDATE shifts SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  async softDelete(id: number): Promise<void> {
    await this.query('UPDATE shifts SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  /** Only one shift may carry the default flag. */
  private async clearDefault(exceptId?: number): Promise<void> {
    if (exceptId === undefined) {
      await this.query('UPDATE shifts SET is_default = false WHERE is_default = true AND deleted_at IS NULL');
      return;
    }
    await this.query(
      'UPDATE shifts SET is_default = false WHERE is_default = true AND id <> ? AND deleted_at IS NULL',
      [exceptId],
    );
  }

  private toResponse(row: ShiftRow): ShiftResponse {
    return {
      id: row.id,
      name: row.name,
      startTime: toTimeString(row.start_time) ?? '00:00',
      endTime: toTimeString(row.end_time) ?? '00:00',
      breakMinutes: Number(row.break_minutes ?? 0),
      graceMinutes: Number(row.grace_minutes ?? 0),
      weekOffDay: Number(row.week_off_day ?? 0),
      isDefault: !!row.is_default,
    };
  }
}
