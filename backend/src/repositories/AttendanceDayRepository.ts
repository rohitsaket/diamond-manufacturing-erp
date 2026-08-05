import { BaseRepository } from './BaseRepository';
import { mapDailyDetail } from './AttendancePunchRepository';
import { DailyAttendanceDetail, OvertimeType, Paged, WorkMode } from '../types/attendance';
import { AttendanceStatus } from '../types/hrms';
import { toDateString } from '../utils/dateUtils';

/**
 * The enterprise read/write surface over `attendance_records`.
 *
 * The original AttendanceRepository is untouched -- the daily sheet, the
 * monthly register and payroll keep reading through it exactly as before. This
 * class only adds the computed-day upsert and the wider queries the new screens
 * need, and it never writes a column the old code owns without being asked to.
 */

export interface ComputedDay {
  employeeId: number;
  attDate: string;
  status: AttendanceStatus;
  shiftId: number | null;
  workMode: WorkMode;
  leaveTypeId: number | null;
  inTime: string | null;
  outTime: string | null;
  firstInTime: string | null;
  lastOutTime: string | null;
  punchCount: number;
  breakMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  grossHours: number | null;
  workedHours: number | null;
  expectedHours: number | null;
  deficitHours: number | null;
  otHours: number;
  otType: 'NONE' | OvertimeType;
  isLate: boolean;
  lateMinutes: number;
  isEarlyExit: boolean;
  earlyExitMinutes: number;
  isMissingPunch: boolean;
  exceptionFlags: string[];
  isCrossDay: boolean;
  shiftEndDate: string | null;
  timezone: string;
  policyId: number | null;
  deviceId: number | null;
  companyId: number | null;
  branchId: number | null;
  departmentId: number | null;
  source: string;
  remarks: string | null;
}

export interface DayFilters {
  date?: string;
  from?: string;
  to?: string;
  employeeId?: number;
  branchId?: number;
  departmentId?: number;
  shiftId?: number;
  status?: AttendanceStatus;
  workMode?: WorkMode;
  exception?: 'LATE' | 'EARLY_EXIT' | 'OVERTIME' | 'ABSENT' | 'MISSING_PUNCH' | 'ANY';
  search?: string;
  page?: number;
  pageSize?: number;
}

const SELECT_DAY = `
  SELECT a.id AS att_id, a.employee_id, e.full_name, e.emp_code, a.att_date, a.status,
         a.work_mode, a.shift_id, s.name AS shift_name, s.code AS shift_code,
         a.in_time, a.out_time, a.first_in_time, a.last_out_time, a.punch_count,
         a.break_minutes, a.paid_break_minutes, a.unpaid_break_minutes,
         a.gross_hours, a.worked_hours, a.expected_hours, a.deficit_hours,
         a.ot_hours, a.ot_approved_hours, a.ot_status, a.ot_type,
         a.is_late, a.late_minutes, a.is_early_exit, a.early_exit_minutes,
         a.is_missing_punch, a.exception_flags, a.is_cross_day, a.shift_end_date,
         a.timezone, a.policy_id, p.name AS policy_name, a.device_id,
         a.branch_id, a.department_id, a.approval_status, a.is_regularized,
         a.is_locked, a.locked_reason, a.source, a.remarks
  FROM attendance_records a
  JOIN employees e ON e.id = a.employee_id
  LEFT JOIN shifts s ON s.id = a.shift_id
  LEFT JOIN attendance_policies p ON p.id = a.policy_id
`;

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export class AttendanceDayRepository extends BaseRepository {
  /**
   * Write a recomputed day.
   *
   * Locked days are skipped: once a period is closed and paid, a late punch
   * must not silently move the figure payroll already used. The caller is told
   * so it can surface that rather than reporting a write that did not happen.
   */
  async upsertComputed(day: ComputedDay, userId: number | null, conn?: any): Promise<{ id: number | null; skippedLocked: boolean }> {
    const run = async (sql: string, params: any[]): Promise<any> => {
      if (conn) { const [r] = await conn.query(sql, params); return r; }
      return this.query<any>(sql, params);
    };

    const existing = await run(
      'SELECT id, is_locked FROM attendance_records WHERE employee_id = ? AND att_date = ? LIMIT 1',
      [day.employeeId, day.attDate],
    );
    const current = (existing as any[])[0];
    if (current?.is_locked) return { id: Number(current.id), skippedLocked: true };

    const columns = [
      'employee_id', 'att_date', 'status', 'shift_id', 'work_mode', 'leave_type_id',
      'in_time', 'out_time', 'first_in_time', 'last_out_time', 'punch_count',
      'break_minutes', 'paid_break_minutes', 'unpaid_break_minutes',
      'gross_hours', 'worked_hours', 'expected_hours', 'deficit_hours',
      'ot_hours', 'ot_type', 'is_late', 'late_minutes', 'is_early_exit', 'early_exit_minutes',
      'is_missing_punch', 'exception_flags', 'is_cross_day', 'shift_end_date', 'timezone',
      'policy_id', 'device_id', 'company_id', 'branch_id', 'department_id',
      'source', 'remarks', 'recomputed_at', 'created_by', 'updated_by',
    ];
    const values = [
      day.employeeId, day.attDate, day.status, day.shiftId, day.workMode, day.leaveTypeId,
      day.inTime, day.outTime, day.firstInTime, day.lastOutTime, day.punchCount,
      day.breakMinutes, day.paidBreakMinutes, day.unpaidBreakMinutes,
      day.grossHours, day.workedHours, day.expectedHours, day.deficitHours,
      day.otHours, day.otType, day.isLate ? 1 : 0, day.lateMinutes, day.isEarlyExit ? 1 : 0,
      day.earlyExitMinutes, day.isMissingPunch ? 1 : 0,
      day.exceptionFlags.length ? day.exceptionFlags.join(',') : null,
      day.isCrossDay ? 1 : 0, day.shiftEndDate, day.timezone,
      day.policyId, day.deviceId, day.companyId, day.branchId, day.departmentId,
      day.source, day.remarks, new Date(), userId || null, userId || null,
    ];

    // ot_approved_hours and ot_status are deliberately absent from the update
    // list: an approved overtime decision is not the punch engine's to revoke.
    const updates = columns
      .filter((c) => c !== 'employee_id' && c !== 'att_date' && c !== 'created_by')
      .map((c) => `${c} = VALUES(${c})`)
      .join(', ');

    const result = await run(
      `INSERT INTO attendance_records (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${updates}, deleted_at = NULL`,
      values,
    );

    const id = current?.id ? Number(current.id) : Number(result?.insertId ?? 0) || null;
    return { id, skippedLocked: false };
  }

  async findDetail(employeeId: number, date: string): Promise<DailyAttendanceDetail | null> {
    const rows = await this.query<any[]>(
      `${SELECT_DAY} WHERE a.employee_id = ? AND a.att_date = ? AND a.deleted_at IS NULL LIMIT 1`,
      [employeeId, date],
    );
    return rows[0] ? mapDailyDetail(rows[0]) : null;
  }

  async findById(id: number): Promise<DailyAttendanceDetail | null> {
    const rows = await this.query<any[]>(`${SELECT_DAY} WHERE a.id = ? AND a.deleted_at IS NULL LIMIT 1`, [id]);
    return rows[0] ? mapDailyDetail(rows[0]) : null;
  }

  /**
   * Every working employee for a date with their record, marked or not.
   * Unmarked employees come back with a null status, same contract as the
   * original daily sheet.
   */
  async findDayBoard(date: string): Promise<DailyAttendanceDetail[]> {
    const rows = await this.query<any[]>(
      `SELECT a.id AS att_id, e.id AS employee_id, e.full_name, e.emp_code, ? AS att_date, a.status,
              COALESCE(a.work_mode, 'OFFICE') AS work_mode, COALESCE(a.shift_id, e.shift_id) AS shift_id,
              s.name AS shift_name, s.code AS shift_code,
              a.in_time, a.out_time, a.first_in_time, a.last_out_time, a.punch_count,
              a.break_minutes, a.paid_break_minutes, a.unpaid_break_minutes,
              a.gross_hours, a.worked_hours, a.expected_hours, a.deficit_hours,
              a.ot_hours, a.ot_approved_hours, a.ot_status, a.ot_type,
              a.is_late, a.late_minutes, a.is_early_exit, a.early_exit_minutes,
              a.is_missing_punch, a.exception_flags, a.is_cross_day, a.shift_end_date,
              a.timezone, a.policy_id, p.name AS policy_name, a.device_id,
              COALESCE(a.branch_id, e.branch_id) AS branch_id,
              COALESCE(a.department_id, e.department_id) AS department_id,
              a.approval_status, a.is_regularized, a.is_locked, a.locked_reason, a.source, a.remarks
       FROM employees e
       LEFT JOIN attendance_records a ON a.employee_id = e.id AND a.att_date = ? AND a.deleted_at IS NULL
       LEFT JOIN shifts s ON s.id = COALESCE(a.shift_id, e.shift_id)
       LEFT JOIN attendance_policies p ON p.id = a.policy_id
       WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
       ORDER BY e.full_name ASC`,
      [date, date],
    );
    return rows.map((r) => mapDailyDetail(r));
  }

  async list(filters: DayFilters): Promise<Paged<DailyAttendanceDetail>> {
    const where: string[] = ['a.deleted_at IS NULL'];
    const params: any[] = [];

    if (filters.date) { where.push('a.att_date = ?'); params.push(filters.date); }
    if (filters.from) { where.push('a.att_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('a.att_date <= ?'); params.push(filters.to); }
    if (filters.employeeId) { where.push('a.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.branchId) { where.push('COALESCE(a.branch_id, e.branch_id) = ?'); params.push(filters.branchId); }
    if (filters.departmentId) { where.push('COALESCE(a.department_id, e.department_id) = ?'); params.push(filters.departmentId); }
    if (filters.shiftId) { where.push('a.shift_id = ?'); params.push(filters.shiftId); }
    if (filters.status) { where.push('a.status = ?'); params.push(filters.status); }
    if (filters.workMode) { where.push('a.work_mode = ?'); params.push(filters.workMode); }
    if (filters.search) {
      where.push('(e.full_name LIKE ? OR e.emp_code LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    switch (filters.exception) {
      case 'LATE': where.push('a.is_late = 1'); break;
      case 'EARLY_EXIT': where.push('a.is_early_exit = 1'); break;
      case 'OVERTIME': where.push('a.ot_hours > 0'); break;
      case 'ABSENT': where.push("a.status = 'ABSENT'"); break;
      case 'MISSING_PUNCH': where.push('a.is_missing_punch = 1'); break;
      case 'ANY': where.push('a.exception_flags IS NOT NULL'); break;
      default: break;
    }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 1000);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(
        `SELECT COUNT(*) AS n FROM attendance_records a JOIN employees e ON e.id = a.employee_id WHERE ${clause}`,
        params,
      ),
      this.query<any[]>(
        `${SELECT_DAY} WHERE ${clause} ORDER BY a.att_date DESC, e.full_name ASC LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => mapDailyDetail(r)),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  async findRange(from: string, to: string, employeeId?: number): Promise<DailyAttendanceDetail[]> {
    const params: any[] = [from, to];
    let clause = '';
    if (employeeId) { clause = ' AND a.employee_id = ?'; params.push(employeeId); }
    const rows = await this.query<any[]>(
      `${SELECT_DAY} WHERE a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL${clause}
       ORDER BY a.att_date ASC, e.full_name ASC`,
      params,
    );
    return rows.map((r) => mapDailyDetail(r));
  }

  /** Applies an approved regularization or correction to a day. */
  async applyCorrection(
    attendanceId: number,
    patch: Partial<ComputedDay>,
    requestId: number,
    userId: number,
    conn?: any,
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, value: any) => { sets.push(`${col} = ?`); params.push(value); };

    if (patch.status !== undefined) push('status', patch.status);
    if (patch.inTime !== undefined) { push('in_time', patch.inTime); push('first_in_time', patch.inTime); }
    if (patch.outTime !== undefined) { push('out_time', patch.outTime); push('last_out_time', patch.outTime); }
    if (patch.workedHours !== undefined) push('worked_hours', patch.workedHours);
    if (patch.workMode !== undefined) push('work_mode', patch.workMode);
    if (patch.otHours !== undefined) push('ot_hours', patch.otHours);
    if (patch.remarks !== undefined) push('remarks', patch.remarks);

    push('is_regularized', 1);
    push('regularized_request_id', requestId);
    push('approval_status', 'APPROVED');
    push('approved_by', userId);
    push('approved_at', new Date());
    push('source', 'REGULARIZED');
    push('is_missing_punch', 0);
    push('updated_by', userId);

    params.push(attendanceId);
    const sql = `UPDATE attendance_records SET ${sets.join(', ')} WHERE id = ? AND is_locked = 0`;
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  /** Creates the day row a regularization needs when none exists yet. */
  async ensureDay(employeeId: number, date: string, userId: number | null, conn?: any): Promise<number> {
    const run = async (sql: string, params: any[]): Promise<any> => {
      if (conn) { const [r] = await conn.query(sql, params); return r; }
      return this.query<any>(sql, params);
    };
    const found = await run(
      'SELECT id FROM attendance_records WHERE employee_id = ? AND att_date = ? LIMIT 1',
      [employeeId, date],
    );
    const existing = (found as any[])[0];
    if (existing) return Number(existing.id);

    const result = await run(
      `INSERT INTO attendance_records
         (employee_id, att_date, status, source, company_id, branch_id, department_id, created_by, updated_by)
       SELECT ?, ?, 'ABSENT', 'SYSTEM', e.company_id, e.branch_id, e.department_id, ?, ?
       FROM employees e WHERE e.id = ?`,
      [employeeId, date, userId || null, userId || null, employeeId],
    );
    return Number(result.insertId);
  }

  async setOvertimeDecision(
    employeeId: number,
    date: string,
    approvedHours: number,
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    userId: number,
    conn?: any,
  ): Promise<void> {
    const sql = `UPDATE attendance_records
                 SET ot_approved_hours = ?, ot_status = ?, updated_by = ?
                 WHERE employee_id = ? AND att_date = ? AND is_locked = 0`;
    const params = [approvedHours, status, userId, employeeId, date];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async setLock(from: string, to: string, locked: boolean, reason: string | null, userId: number): Promise<number> {
    const result = await this.query<any>(
      `UPDATE attendance_records SET is_locked = ?, locked_reason = ?, updated_by = ?
       WHERE att_date BETWEEN ? AND ? AND deleted_at IS NULL`,
      [locked ? 1 : 0, locked ? reason : null, userId, from, to],
    );
    return Number(result?.affectedRows ?? 0);
  }

  /** Employee ids with at least one punch in a range but no computed day yet. */
  async findStaleDays(from: string, to: string): Promise<{ employeeId: number; date: string }[]> {
    const rows = await this.query<any[]>(
      `SELECT DISTINCT p.employee_id, p.punch_date
       FROM attendance_punches p
       LEFT JOIN attendance_records a
         ON a.employee_id = p.employee_id AND a.att_date = p.punch_date AND a.deleted_at IS NULL
       WHERE p.punch_date BETWEEN ? AND ? AND p.deleted_at IS NULL AND p.status = 'ACCEPTED'
         AND (a.id IS NULL OR a.recomputed_at IS NULL OR a.recomputed_at < p.created_at)`,
      [from, to],
    );
    return rows.map((r) => ({ employeeId: Number(r.employee_id), date: toDateString(r.punch_date) }));
  }
}
