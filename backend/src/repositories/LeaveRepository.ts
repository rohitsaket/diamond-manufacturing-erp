import { BaseRepository } from './BaseRepository';
import {
  LeaveTypeRow,
  LeaveTypeResponse,
  LeaveRequestRow,
  LeaveRequestResponse,
  LeaveBalanceResponse,
  LeaveRequestStatus,
} from '../types/hrms';
import { toDateString } from '../utils/dateUtils';

export interface CreateLeaveTypeInput {
  code: string;
  name: string;
  annualQuota?: number;
  isPaid?: boolean;
  color?: string;
}

export interface UpdateLeaveTypeInput {
  code?: string;
  name?: string;
  annualQuota?: number;
  isPaid?: boolean;
  color?: string;
}

export interface CreateLeaveRequestInput {
  employeeId: number;
  leaveTypeId: number;
  fromDate: string;
  toDate: string;
  days: number;
  reason?: string | null;
  appliedBySelf?: boolean;
}

export interface LeaveRequestFilters {
  status?: LeaveRequestStatus | string;
  employeeId?: number;
  from?: string;
  to?: string;
  limit?: number;
}

/** Columns updateType is allowed to write, mapped to their DB names. */
const TYPE_COLUMNS: Record<keyof UpdateLeaveTypeInput, string> = {
  code: 'code',
  name: 'name',
  annualQuota: 'annual_quota',
  isPaid: 'is_paid',
  color: 'color',
};

/**
 * Leave master data, requests and yearly balances.
 *
 * Balances follow one rule everywhere: when no `leave_balances` row exists yet
 * for (employee, type, year), the entitlement is the type's `annual_quota`.
 * `getBalances`, `getBalanceFor` and `addUsed` all honour that, so reading a
 * balance before `initYear` has run reports the same number as reading it after.
 */
export class LeaveRepository extends BaseRepository {
  /** Public escape hatch so services can wrap multi-table writes in one txn. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // -------------------------------------------------------------------------
  // Leave types
  // -------------------------------------------------------------------------
  async findTypes(): Promise<LeaveTypeResponse[]> {
    const rows = await this.query<LeaveTypeRow[]>(
      'SELECT * FROM leave_types WHERE deleted_at IS NULL ORDER BY code ASC',
    );
    return rows.map((r) => this.typeToResponse(r));
  }

  async findTypeById(id: number): Promise<LeaveTypeResponse | null> {
    const row = await this.findTypeRowById(id);
    return row ? this.typeToResponse(row) : null;
  }

  async findTypeRowById(id: number, conn?: any): Promise<LeaveTypeRow | null> {
    const sql = 'SELECT * FROM leave_types WHERE id = ? AND deleted_at IS NULL';
    if (conn) {
      const [rows] = await conn.query(sql, [id]);
      return (rows as LeaveTypeRow[])[0] || null;
    }
    const rows = await this.query<LeaveTypeRow[]>(sql, [id]);
    return rows[0] || null;
  }

  async findTypeByCode(code: string): Promise<LeaveTypeRow | null> {
    const rows = await this.query<LeaveTypeRow[]>(
      'SELECT * FROM leave_types WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] || null;
  }

  async createType(data: CreateLeaveTypeInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO leave_types (code, name, annual_quota, is_paid, color, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code,
        data.name,
        data.annualQuota ?? 0,
        data.isPaid === undefined ? true : data.isPaid,
        data.color ?? 'info',
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async updateType(id: number, data: UpdateLeaveTypeInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(TYPE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE leave_types SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteType(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE leave_types SET deleted_at = NOW(), updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [userId, id],
    );
  }

  /** Live (non-cancelled/rejected) requests blocking a type from being retired. */
  async countLiveRequestsForType(leaveTypeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM leave_requests
       WHERE leave_type_id = ? AND deleted_at IS NULL AND status IN ('PENDING', 'APPROVED')`,
      [leaveTypeId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  // -------------------------------------------------------------------------
  // Leave requests
  // -------------------------------------------------------------------------
  async findRequests(filters: LeaveRequestFilters = {}): Promise<LeaveRequestResponse[]> {
    let sql = `
      SELECT lr.*,
             e.full_name  AS employee_name,
             e.emp_code   AS emp_code,
             lt.name      AS leave_type_name,
             lt.code      AS leave_type_code,
             lt.is_paid   AS is_paid,
             u.name       AS decided_by_name
      FROM leave_requests lr
      JOIN employees e   ON e.id  = lr.employee_id
      JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN users u  ON u.id  = lr.decided_by
      WHERE lr.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND lr.status = ?';
      params.push(filters.status);
    }
    if (filters.employeeId) {
      sql += ' AND lr.employee_id = ?';
      params.push(filters.employeeId);
    }
    // Overlap semantics: any request touching the [from, to] window.
    if (filters.from) {
      sql += ' AND lr.to_date >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      sql += ' AND lr.from_date <= ?';
      params.push(filters.to);
    }

    // LIMIT cannot be bound in a prepared statement; inline a sanitised int.
    const limit = Math.min(1000, Math.max(1, Math.floor(filters.limit ?? 300)));
    sql += ` ORDER BY lr.from_date DESC, lr.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.requestToResponse(r));
  }

  async findRequestById(id: number): Promise<LeaveRequestResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT lr.*,
              e.full_name  AS employee_name,
              e.emp_code   AS emp_code,
              lt.name      AS leave_type_name,
              lt.code      AS leave_type_code,
              lt.is_paid   AS is_paid,
              u.name       AS decided_by_name
       FROM leave_requests lr
       JOIN employees e   ON e.id  = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN users u  ON u.id  = lr.decided_by
       WHERE lr.id = ? AND lr.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.requestToResponse(rows[0]) : null;
  }

  /** Row-level read used inside a transaction before a decision is written. */
  async findRequestRowForUpdate(id: number, conn: any): Promise<LeaveRequestRow | null> {
    const [rows] = await conn.query(
      'SELECT * FROM leave_requests WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [id],
    );
    return (rows as LeaveRequestRow[])[0] || null;
  }

  async createRequest(data: CreateLeaveRequestInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO leave_requests
         (employee_id, leave_type_id, from_date, to_date, days, reason, status,
          applied_by_self, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [
        data.employeeId,
        data.leaveTypeId,
        data.fromDate,
        data.toDate,
        data.days,
        data.reason ?? null,
        data.appliedBySelf ? 1 : 0,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async decide(
    id: number,
    status: LeaveRequestStatus,
    userId: number,
    note: string | null,
    conn?: any,
  ): Promise<void> {
    const sql = `UPDATE leave_requests
                 SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ?, updated_by = ?
                 WHERE id = ? AND deleted_at IS NULL`;
    const params = [status, userId, note, userId, id];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async countPending(): Promise<number> {
    const rows = await this.query<any[]>(
      "SELECT COUNT(*) AS cnt FROM leave_requests WHERE status = 'PENDING' AND deleted_at IS NULL",
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** PENDING/APPROVED requests for the same employee overlapping [from, to]. */
  async findOverlapping(
    employeeId: number,
    from: string,
    to: string,
    excludeRequestId?: number,
  ): Promise<LeaveRequestRow[]> {
    let sql = `SELECT * FROM leave_requests
               WHERE employee_id = ? AND deleted_at IS NULL
                 AND status IN ('PENDING', 'APPROVED')
                 AND from_date <= ? AND to_date >= ?`;
    const params: any[] = [employeeId, to, from];
    if (excludeRequestId) {
      sql += ' AND id <> ?';
      params.push(excludeRequestId);
    }
    return this.query<LeaveRequestRow[]>(sql, params);
  }

  // -------------------------------------------------------------------------
  // Calendar helpers (shift week-off lives here so ShiftRepository stays untouched)
  // -------------------------------------------------------------------------
  /** Weekly off weekday for an employee's shift; 0 (Sunday) when unassigned. */
  async getWeekOffDay(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT s.week_off_day
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id AND s.deleted_at IS NULL
       WHERE e.id = ? AND e.deleted_at IS NULL`,
      [employeeId],
    );
    const value = rows[0]?.week_off_day;
    return value === null || value === undefined ? 0 : Number(value);
  }

  /** Dates in [from, to] that already carry a non-LEAVE attendance record. */
  async findNonLeaveAttendanceDates(
    employeeId: number,
    from: string,
    to: string,
    conn?: any,
  ): Promise<Set<string>> {
    const sql = `SELECT att_date FROM attendance_records
                 WHERE employee_id = ? AND att_date BETWEEN ? AND ?
                   AND status <> 'LEAVE' AND deleted_at IS NULL`;
    const params = [employeeId, from, to];
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, params);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, params);
    }
    return new Set(rows.map((r) => toDateString(r.att_date)));
  }

  // -------------------------------------------------------------------------
  // Balances
  // -------------------------------------------------------------------------
  /**
   * Every leave type for every (matching) employee, whether or not a balance
   * row exists. Missing rows fall back to the type's annual quota.
   */
  async getBalances(year: number, employeeId?: number): Promise<LeaveBalanceResponse[]> {
    let sql = `
      SELECT e.id AS employee_id, e.full_name AS employee_name, e.emp_code AS emp_code,
             lt.id AS leave_type_id, lt.code AS leave_type_code, lt.name AS leave_type_name,
             lt.is_paid AS is_paid,
             COALESCE(lb.allocated, lt.annual_quota) AS allocated,
             COALESCE(lb.used, 0) AS used
      FROM employees e
      CROSS JOIN leave_types lt
      LEFT JOIN leave_balances lb
        ON lb.employee_id = e.id AND lb.leave_type_id = lt.id AND lb.year = ?
      WHERE e.deleted_at IS NULL AND lt.deleted_at IS NULL
    `;
    const params: any[] = [year];

    if (employeeId) {
      sql += ' AND e.id = ?';
      params.push(employeeId);
    } else {
      sql += " AND e.work_status = 'WORKING'";
    }
    sql += ' ORDER BY e.full_name ASC, lt.code ASC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.balanceToResponse(r, year));
  }

  async getBalanceFor(
    employeeId: number,
    leaveTypeId: number,
    year: number,
  ): Promise<LeaveBalanceResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT e.id AS employee_id, e.full_name AS employee_name, e.emp_code AS emp_code,
              lt.id AS leave_type_id, lt.code AS leave_type_code, lt.name AS leave_type_name,
              lt.is_paid AS is_paid,
              COALESCE(lb.allocated, lt.annual_quota) AS allocated,
              COALESCE(lb.used, 0) AS used
       FROM employees e
       CROSS JOIN leave_types lt
       LEFT JOIN leave_balances lb
         ON lb.employee_id = e.id AND lb.leave_type_id = lt.id AND lb.year = ?
       WHERE e.id = ? AND lt.id = ? AND e.deleted_at IS NULL AND lt.deleted_at IS NULL`,
      [year, employeeId, leaveTypeId],
    );
    return rows[0] ? this.balanceToResponse(rows[0], year) : null;
  }

  /** Materialises a balance row per working employee per type for a year. */
  async initYear(year: number, _userId: number): Promise<number> {
    // leave_balances carries no audit columns, so _userId is signature parity only.
    const result = await this.query<any>(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated)
       SELECT e.id, lt.id, ?, lt.annual_quota
       FROM employees e
       CROSS JOIN leave_types lt
       WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL AND lt.deleted_at IS NULL
       ON DUPLICATE KEY UPDATE allocated = VALUES(allocated)`,
      [year],
    );
    return Number(result?.affectedRows ?? 0);
  }

  /**
   * Adds consumed days, creating the row when the year was never initialised.
   * The seeded `allocated` comes from the type's quota so the derived balance
   * matches what `getBalances` reported before the first approval.
   */
  async addUsed(
    employeeId: number,
    leaveTypeId: number,
    year: number,
    days: number,
    conn?: any,
  ): Promise<void> {
    const sql = `INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated, used)
                 SELECT ?, lt.id, ?, lt.annual_quota, ?
                 FROM leave_types lt
                 WHERE lt.id = ?
                 ON DUPLICATE KEY UPDATE used = used + VALUES(used)`;
    const params = [employeeId, year, days, leaveTypeId];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------
  private typeToResponse(row: LeaveTypeRow): LeaveTypeResponse {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      annualQuota: Number(row.annual_quota ?? 0),
      isPaid: !!row.is_paid,
      color: row.color,
    };
  }

  private requestToResponse(r: any): LeaveRequestResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      empCode: r.emp_code,
      leaveTypeId: r.leave_type_id,
      leaveTypeName: r.leave_type_name,
      leaveTypeCode: r.leave_type_code,
      isPaid: !!r.is_paid,
      fromDate: toDateString(r.from_date),
      toDate: toDateString(r.to_date),
      days: Number(r.days ?? 0),
      reason: r.reason,
      status: r.status,
      appliedBySelf: !!r.applied_by_self,
      decidedBy: r.decided_by_name ?? null,
      decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
      decisionNote: r.decision_note,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private balanceToResponse(r: any, year: number): LeaveBalanceResponse {
    const allocated = Number(r.allocated ?? 0);
    const used = Number(r.used ?? 0);
    return {
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      empCode: r.emp_code,
      leaveTypeId: r.leave_type_id,
      leaveTypeCode: r.leave_type_code,
      leaveTypeName: r.leave_type_name,
      isPaid: !!r.is_paid,
      year,
      allocated,
      used,
      balance: Math.round((allocated - used) * 10) / 10,
    };
  }
}
