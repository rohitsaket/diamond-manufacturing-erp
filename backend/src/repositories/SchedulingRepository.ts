import { BaseRepository } from './BaseRepository';
import { Roster, RosterEntry, RotationPattern, ShiftAssignment, ShiftDetail } from '../types/attendance';
import { parseWeekOffDays } from '../utils/attendanceTime';
import { toDateString, toTimeString } from '../utils/dateUtils';

function iso(value: any): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function parsePattern(value: any): string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

export class SchedulingRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Shifts (enterprise view over the existing table)
  // -------------------------------------------------------------------------
  async listShifts(includeInactive = false): Promise<ShiftDetail[]> {
    const rows = await this.query<any[]>(
      `SELECT s.*, b.name AS branch_name,
              (SELECT COUNT(*) FROM employees e WHERE e.shift_id = s.id AND e.deleted_at IS NULL
                 AND e.work_status = 'WORKING') AS assigned_count
       FROM shifts s
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE s.deleted_at IS NULL ${includeInactive ? '' : "AND s.status = 'ACTIVE'"}
       ORDER BY s.is_default DESC, s.start_time ASC`,
    );
    return rows.map((r) => this.toShift(r));
  }

  async findShiftById(id: number): Promise<ShiftDetail | null> {
    const rows = await this.query<any[]>(
      `SELECT s.*, b.name AS branch_name FROM shifts s
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE s.id = ? AND s.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? this.toShift(rows[0]) : null;
  }

  async findShiftByCode(code: string): Promise<ShiftDetail | null> {
    const rows = await this.query<any[]>(
      'SELECT s.* FROM shifts s WHERE s.code = ? AND s.deleted_at IS NULL LIMIT 1',
      [code],
    );
    return rows[0] ? this.toShift(rows[0]) : null;
  }

  /**
   * Updates only the enterprise columns. Name, times, break, grace, week_off_day
   * and is_default stay under the original shift service so its validation and
   * the classic Shifts tab remain the single writer for those.
   */
  async updateShiftExtras(id: number, data: Partial<ShiftDetail>, current: ShiftDetail, userId: number): Promise<void> {
    await this.query(
      `UPDATE shifts SET code = ?, company_id = ?, branch_id = ?, shift_type = ?, crosses_midnight = ?,
         is_night_shift = ?, second_start_time = ?, second_end_time = ?, flexible_core_start = ?,
         flexible_core_end = ?, flexible_min_hours = ?, full_day_hours = ?, half_day_hours = ?,
         week_off_days = ?, ot_eligible = ?, timezone = ?, color = ?, max_employees = ?, status = ?,
         updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.code === undefined ? current.code : data.code,
        data.companyId === undefined ? current.companyId : data.companyId,
        data.branchId === undefined ? current.branchId : data.branchId,
        data.shiftType ?? current.shiftType,
        (data.crossesMidnight ?? current.crossesMidnight) ? 1 : 0,
        (data.isNightShift ?? current.isNightShift) ? 1 : 0,
        data.secondStartTime === undefined ? current.secondStartTime : data.secondStartTime,
        data.secondEndTime === undefined ? current.secondEndTime : data.secondEndTime,
        data.flexibleCoreStart === undefined ? current.flexibleCoreStart : data.flexibleCoreStart,
        data.flexibleCoreEnd === undefined ? current.flexibleCoreEnd : data.flexibleCoreEnd,
        data.flexibleMinHours === undefined ? current.flexibleMinHours : data.flexibleMinHours,
        data.fullDayHours === undefined ? current.fullDayHours : data.fullDayHours,
        data.halfDayHours === undefined ? current.halfDayHours : data.halfDayHours,
        (data.weekOffDays ?? current.weekOffDays).join(','),
        (data.otEligible ?? current.otEligible) ? 1 : 0,
        data.timezone === undefined ? current.timezone : data.timezone,
        data.color === undefined ? current.color : data.color,
        data.maxEmployees === undefined ? current.maxEmployees : data.maxEmployees,
        data.status ?? current.status,
        userId, id,
      ],
    );
  }

  /** Creates a shift including the enterprise columns, for cross-day and split shifts. */
  async createShift(data: Partial<ShiftDetail>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO shifts
         (code, name, company_id, branch_id, shift_type, start_time, end_time, crosses_midnight,
          is_night_shift, second_start_time, second_end_time, flexible_core_start, flexible_core_end,
          flexible_min_hours, full_day_hours, half_day_hours, break_minutes, grace_minutes,
          week_off_day, week_off_days, ot_eligible, timezone, color, max_employees, is_default,
          status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code ?? null, data.name, data.companyId ?? null, data.branchId ?? null,
        data.shiftType ?? 'FIXED', data.startTime, data.endTime, data.crossesMidnight ? 1 : 0,
        data.isNightShift ? 1 : 0, data.secondStartTime ?? null, data.secondEndTime ?? null,
        data.flexibleCoreStart ?? null, data.flexibleCoreEnd ?? null, data.flexibleMinHours ?? null,
        data.fullDayHours ?? null, data.halfDayHours ?? null, data.breakMinutes ?? 60,
        data.graceMinutes ?? 15, (data.weekOffDays ?? [0])[0] ?? 0,
        (data.weekOffDays ?? [0]).join(','), data.otEligible === false ? 0 : 1,
        data.timezone ?? null, data.color ?? null, data.maxEmployees ?? null,
        data.isDefault ? 1 : 0, data.status ?? 'ACTIVE', userId, userId,
      ],
    );
    return Number(result.insertId);
  }

  // -------------------------------------------------------------------------
  // Rotation patterns
  // -------------------------------------------------------------------------
  async listRotations(): Promise<RotationPattern[]> {
    const rows = await this.query<any[]>(
      "SELECT * FROM shift_rotation_patterns WHERE deleted_at IS NULL ORDER BY name ASC",
    );
    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      name: r.name,
      companyId: r.company_id === null ? null : Number(r.company_id),
      description: r.description ?? null,
      cycleDays: Number(r.cycle_days),
      pattern: parsePattern(r.pattern),
      status: r.status,
    }));
  }

  async findRotationById(id: number): Promise<RotationPattern | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM shift_rotation_patterns WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id), code: r.code, name: r.name,
      companyId: r.company_id === null ? null : Number(r.company_id),
      description: r.description ?? null, cycleDays: Number(r.cycle_days),
      pattern: parsePattern(r.pattern), status: r.status,
    };
  }

  async createRotation(data: Partial<RotationPattern>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO shift_rotation_patterns (code, name, company_id, description, cycle_days, pattern, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.companyId ?? null, data.description ?? null,
        data.cycleDays, JSON.stringify(data.pattern ?? []), data.status ?? 'ACTIVE', userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateRotation(id: number, data: Partial<RotationPattern>, current: RotationPattern): Promise<void> {
    await this.query(
      `UPDATE shift_rotation_patterns SET name = ?, description = ?, cycle_days = ?, pattern = ?, status = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.name ?? current.name,
        data.description === undefined ? current.description : data.description,
        data.cycleDays ?? current.cycleDays,
        JSON.stringify(data.pattern ?? current.pattern),
        data.status ?? current.status,
        id,
      ],
    );
  }

  async deleteRotation(id: number): Promise<void> {
    await this.query('UPDATE shift_rotation_patterns SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Effective-dated shift assignments
  // -------------------------------------------------------------------------
  async listAssignments(employeeId?: number, activeOn?: string): Promise<ShiftAssignment[]> {
    const where: string[] = ['a.deleted_at IS NULL'];
    const params: any[] = [];
    if (employeeId) { where.push('a.employee_id = ?'); params.push(employeeId); }
    if (activeOn) {
      where.push('a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?)');
      params.push(activeOn, activeOn);
    }
    const rows = await this.query<any[]>(
      `SELECT a.*, e.full_name, e.emp_code, s.name AS shift_name, s.code AS shift_code,
              rp.name AS rotation_name
       FROM employee_shift_assignments a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN shifts s ON s.id = a.shift_id
       LEFT JOIN shift_rotation_patterns rp ON rp.id = a.rotation_pattern_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.effective_from DESC, e.full_name ASC`,
      params,
    );
    return rows.map((r) => this.toAssignment(r));
  }

  /** The assignment in force for each employee on a date, in one query. */
  async resolveAssignments(employeeIds: number[], date: string): Promise<Map<number, ShiftAssignment>> {
    const out = new Map<number, ShiftAssignment>();
    if (!employeeIds.length) return out;
    const rows = await this.query<any[]>(
      `SELECT ranked.* FROM (
         SELECT a.*, e.full_name, e.emp_code, s.name AS shift_name, s.code AS shift_code,
                rp.name AS rotation_name,
                ROW_NUMBER() OVER (PARTITION BY a.employee_id
                  ORDER BY a.is_primary DESC, a.effective_from DESC, a.id DESC) AS rn
         FROM employee_shift_assignments a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN shifts s ON s.id = a.shift_id
         LEFT JOIN shift_rotation_patterns rp ON rp.id = a.rotation_pattern_id
         WHERE a.deleted_at IS NULL
           AND a.employee_id IN (${employeeIds.map(() => '?').join(', ')})
           AND a.effective_from <= ?
           AND (a.effective_to IS NULL OR a.effective_to >= ?)
       ) ranked WHERE ranked.rn = 1`,
      [...employeeIds, date, date],
    );
    for (const r of rows) out.set(Number(r.employee_id), this.toAssignment(r));
    return out;
  }

  async createAssignment(data: Partial<ShiftAssignment>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO employee_shift_assignments
         (employee_id, shift_id, rotation_pattern_id, rotation_anchor_date, rotation_offset,
          effective_from, effective_to, is_primary, assignment_reason, request_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId, data.shiftId ?? null, data.rotationPatternId ?? null,
        data.rotationAnchorDate ?? null, data.rotationOffset ?? 0,
        data.effectiveFrom, data.effectiveTo ?? null, data.isPrimary === false ? 0 : 1,
        data.assignmentReason ?? null, (data as any).requestId ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  /**
   * Closes any open primary assignment the day before a new one starts, so two
   * primary assignments never overlap and "which shift on date X" stays single
   * valued.
   */
  async closeOpenAssignments(employeeId: number, newFrom: string): Promise<void> {
    await this.query(
      `UPDATE employee_shift_assignments
       SET effective_to = DATE_SUB(?, INTERVAL 1 DAY)
       WHERE employee_id = ? AND is_primary = 1 AND deleted_at IS NULL
         AND effective_from < ? AND (effective_to IS NULL OR effective_to >= ?)`,
      [newFrom, employeeId, newFrom, newFrom],
    );
    // A same-day replacement supersedes the old row outright.
    await this.query(
      `UPDATE employee_shift_assignments SET deleted_at = NOW()
       WHERE employee_id = ? AND is_primary = 1 AND deleted_at IS NULL AND effective_from = ?`,
      [employeeId, newFrom],
    );
  }

  async deleteAssignment(id: number): Promise<void> {
    await this.query('UPDATE employee_shift_assignments SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Rosters
  // -------------------------------------------------------------------------
  async listRosters(filters: { branchId?: number; departmentId?: number; status?: string; from?: string; to?: string } = {}): Promise<Roster[]> {
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.branchId) { where.push('r.branch_id = ?'); params.push(filters.branchId); }
    if (filters.departmentId) { where.push('r.department_id = ?'); params.push(filters.departmentId); }
    if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
    if (filters.from) { where.push('r.to_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('r.from_date <= ?'); params.push(filters.to); }

    const rows = await this.query<any[]>(
      `SELECT r.*, b.name AS branch_name, d.name AS department_name, u.name AS published_by_name,
              (SELECT COUNT(*) FROM roster_entries re WHERE re.roster_id = r.id) AS entry_count,
              (SELECT COUNT(DISTINCT re.employee_id) FROM roster_entries re WHERE re.roster_id = r.id) AS employee_count
       FROM rosters r
       LEFT JOIN branches b ON b.id = r.branch_id
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN users u ON u.id = r.published_by
       WHERE ${where.join(' AND ')}
       ORDER BY r.from_date DESC`,
      params,
    );
    return rows.map((r) => this.toRoster(r));
  }

  async findRosterById(id: number): Promise<Roster | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, b.name AS branch_name, d.name AS department_name, u.name AS published_by_name,
              (SELECT COUNT(*) FROM roster_entries re WHERE re.roster_id = r.id) AS entry_count,
              (SELECT COUNT(DISTINCT re.employee_id) FROM roster_entries re WHERE re.roster_id = r.id) AS employee_count
       FROM rosters r
       LEFT JOIN branches b ON b.id = r.branch_id
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN users u ON u.id = r.published_by
       WHERE r.id = ? AND r.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? this.toRoster(rows[0]) : null;
  }

  async createRoster(data: Partial<Roster>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO rosters (code, name, company_id, branch_id, department_id, from_date, to_date, status, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.companyId ?? null, data.branchId ?? null, data.departmentId ?? null,
        data.fromDate, data.toDate, data.status ?? 'DRAFT', data.notes ?? null, userId, userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateRosterStatus(id: number, status: string, userId: number): Promise<void> {
    await this.query(
      `UPDATE rosters SET status = ?,
         published_by = IF(? = 'PUBLISHED', ?, published_by),
         published_at = IF(? = 'PUBLISHED', NOW(), published_at),
         updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [status, status, userId, status, userId, id],
    );
  }

  async deleteRoster(id: number): Promise<void> {
    await this.query('UPDATE rosters SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  async replaceRosterEntries(rosterId: number, entries: Partial<RosterEntry>[]): Promise<number> {
    await this.query('DELETE FROM roster_entries WHERE roster_id = ?', [rosterId]);
    if (!entries.length) return 0;

    const cols = ['roster_id', 'employee_id', 'work_date', 'shift_id', 'is_week_off', 'is_holiday',
      'is_leave', 'planned_hours', 'location_id', 'notes'];
    const CHUNK = 500;
    let written = 0;

    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const params: any[] = [];
      for (const e of chunk) {
        params.push(
          rosterId, e.employeeId, e.workDate, e.shiftId ?? null, e.isWeekOff ? 1 : 0,
          e.isHoliday ? 1 : 0, e.isLeave ? 1 : 0, e.plannedHours ?? null,
          e.locationId ?? null, e.notes ?? null,
        );
      }
      const result = await this.query<any>(
        `INSERT INTO roster_entries (${cols.join(', ')})
         VALUES ${chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}
         ON DUPLICATE KEY UPDATE shift_id = VALUES(shift_id), is_week_off = VALUES(is_week_off),
           is_holiday = VALUES(is_holiday), is_leave = VALUES(is_leave),
           planned_hours = VALUES(planned_hours), location_id = VALUES(location_id), notes = VALUES(notes)`,
        params,
      );
      written += Number(result?.affectedRows ?? 0);
    }
    return written;
  }

  async listRosterEntries(rosterId: number): Promise<RosterEntry[]> {
    const rows = await this.query<any[]>(
      `SELECT re.*, e.full_name, e.emp_code, s.code AS shift_code, s.name AS shift_name, s.color AS shift_color
       FROM roster_entries re
       JOIN employees e ON e.id = re.employee_id
       LEFT JOIN shifts s ON s.id = re.shift_id
       WHERE re.roster_id = ?
       ORDER BY e.full_name ASC, re.work_date ASC`,
      [rosterId],
    );
    return rows.map((r) => this.toRosterEntry(r));
  }

  /** Published roster entries for a date, keyed by employee -- feeds shift coverage. */
  async findPublishedEntriesForDate(date: string): Promise<Map<number, RosterEntry>> {
    const rows = await this.query<any[]>(
      `SELECT re.*, e.full_name, e.emp_code, s.code AS shift_code, s.name AS shift_name, s.color AS shift_color
       FROM roster_entries re
       JOIN rosters r ON r.id = re.roster_id AND r.deleted_at IS NULL AND r.status IN ('PUBLISHED', 'LOCKED')
       JOIN employees e ON e.id = re.employee_id
       LEFT JOIN shifts s ON s.id = re.shift_id
       WHERE re.work_date = ?`,
      [date],
    );
    const out = new Map<number, RosterEntry>();
    for (const r of rows) out.set(Number(r.employee_id), this.toRosterEntry(r));
    return out;
  }

  async swapRosterEntries(entryIdA: number, entryIdB: number): Promise<void> {
    await this.transaction(async (conn) => {
      const [rows] = await conn.query(
        'SELECT id, shift_id, is_week_off, planned_hours FROM roster_entries WHERE id IN (?, ?) FOR UPDATE',
        [entryIdA, entryIdB],
      );
      const list = rows as any[];
      if (list.length !== 2) throw new Error('Both roster entries must exist to swap');
      const [a, b] = list;
      await conn.query('UPDATE roster_entries SET shift_id = ?, is_week_off = ?, planned_hours = ? WHERE id = ?',
        [b.shift_id, b.is_week_off, b.planned_hours, a.id]);
      await conn.query('UPDATE roster_entries SET shift_id = ?, is_week_off = ?, planned_hours = ? WHERE id = ?',
        [a.shift_id, a.is_week_off, a.planned_hours, b.id]);
    });
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------
  private toShift(r: any): ShiftDetail {
    return {
      id: Number(r.id),
      code: r.code ?? null,
      name: r.name,
      companyId: r.company_id === null ? null : Number(r.company_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      branchName: r.branch_name ?? null,
      shiftType: r.shift_type ?? 'FIXED',
      startTime: toTimeString(r.start_time) ?? '00:00',
      endTime: toTimeString(r.end_time) ?? '00:00',
      crossesMidnight: !!r.crosses_midnight,
      isNightShift: !!r.is_night_shift,
      secondStartTime: toTimeString(r.second_start_time),
      secondEndTime: toTimeString(r.second_end_time),
      flexibleCoreStart: toTimeString(r.flexible_core_start),
      flexibleCoreEnd: toTimeString(r.flexible_core_end),
      flexibleMinHours: r.flexible_min_hours === null ? null : Number(r.flexible_min_hours),
      breakMinutes: Number(r.break_minutes ?? 0),
      graceMinutes: Number(r.grace_minutes ?? 0),
      weekOffDay: Number(r.week_off_day ?? 0),
      weekOffDays: parseWeekOffDays(r.week_off_days, Number(r.week_off_day ?? 0)),
      fullDayHours: r.full_day_hours === null ? null : Number(r.full_day_hours),
      halfDayHours: r.half_day_hours === null ? null : Number(r.half_day_hours),
      otEligible: r.ot_eligible === undefined ? true : !!r.ot_eligible,
      timezone: r.timezone ?? null,
      color: r.color ?? null,
      maxEmployees: r.max_employees === null ? null : Number(r.max_employees),
      isDefault: !!r.is_default,
      status: r.status ?? 'ACTIVE',
      assignedCount: r.assigned_count === undefined ? undefined : Number(r.assigned_count),
    };
  }

  private toAssignment(r: any): ShiftAssignment {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      shiftId: r.shift_id === null ? null : Number(r.shift_id),
      shiftName: r.shift_name ?? null,
      shiftCode: r.shift_code ?? null,
      rotationPatternId: r.rotation_pattern_id === null ? null : Number(r.rotation_pattern_id),
      rotationPatternName: r.rotation_name ?? null,
      rotationAnchorDate: r.rotation_anchor_date ? toDateString(r.rotation_anchor_date) : null,
      rotationOffset: Number(r.rotation_offset ?? 0),
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      isPrimary: !!r.is_primary,
      assignmentReason: r.assignment_reason ?? null,
    };
  }

  private toRoster(r: any): Roster {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      companyId: r.company_id === null ? null : Number(r.company_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      branchName: r.branch_name ?? null,
      departmentId: r.department_id === null ? null : Number(r.department_id),
      departmentName: r.department_name ?? null,
      fromDate: toDateString(r.from_date),
      toDate: toDateString(r.to_date),
      status: r.status,
      notes: r.notes ?? null,
      publishedAt: iso(r.published_at),
      publishedByName: r.published_by_name ?? null,
      entryCount: r.entry_count === undefined ? undefined : Number(r.entry_count),
      employeeCount: r.employee_count === undefined ? undefined : Number(r.employee_count),
    };
  }

  private toRosterEntry(r: any): RosterEntry {
    return {
      id: Number(r.id),
      rosterId: Number(r.roster_id),
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      workDate: toDateString(r.work_date),
      shiftId: r.shift_id === null ? null : Number(r.shift_id),
      shiftCode: r.shift_code ?? null,
      shiftName: r.shift_name ?? null,
      shiftColor: r.shift_color ?? null,
      isWeekOff: !!r.is_week_off,
      isHoliday: !!r.is_holiday,
      isLeave: !!r.is_leave,
      plannedHours: r.planned_hours === null ? null : Number(r.planned_hours),
      locationId: r.location_id === null ? null : Number(r.location_id),
      notes: r.notes ?? null,
    };
  }
}
