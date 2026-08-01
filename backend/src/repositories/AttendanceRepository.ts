import { BaseRepository } from './BaseRepository';
import { AttendanceResponse, AttendanceStatus, AttendanceUpsertEntry } from '../types/hrms';
import { toDateString, toTimeString } from '../utils/dateUtils';

/** Raw row shape consumed by the register builder. */
export interface RegisterAttendanceRow {
  employee_id: number;
  att_date: any;
  status: AttendanceStatus;
  ot_hours: number;
}

/** Raw row shape consumed by the payroll engine (carries leave paid/unpaid). */
export interface WindowAttendanceRow {
  employee_id: number;
  att_date: any;
  status: AttendanceStatus;
  ot_hours: number;
  is_paid: number | null;
}

/** Columns written by every upsert, in placeholder order. */
const UPSERT_COLUMNS = [
  'employee_id', 'att_date', 'status', 'shift_id', 'leave_type_id', 'in_time', 'out_time',
  'worked_hours', 'ot_hours', 'is_late', 'source', 'remarks', 'created_by', 'updated_by',
];

/** Rows per INSERT statement; keeps the packet and placeholder count comfortable. */
const UPSERT_CHUNK_SIZE = 500;

const EMPTY_COUNTS: Record<AttendanceStatus, number> = {
  PRESENT: 0, ABSENT: 0, HALF_DAY: 0, LEAVE: 0, HOLIDAY: 0, WEEK_OFF: 0,
};

export class AttendanceRepository extends BaseRepository {
  /**
   * Every working employee for a date, whether or not attendance was marked.
   * Unmarked employees come back with a null status so the UI can render an
   * empty cell instead of guessing.
   */
  async findByDate(date: string): Promise<AttendanceResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT
         a.id AS att_id, e.id AS employee_id, e.full_name, e.emp_code, e.worker_type,
         a.status, a.shift_id, a.leave_type_id, a.in_time, a.out_time,
         a.worked_hours, a.ot_hours, a.is_late, a.source, a.remarks
       FROM employees e
       LEFT JOIN attendance_records a
         ON a.employee_id = e.id AND a.att_date = ? AND a.deleted_at IS NULL
       WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
       ORDER BY e.full_name ASC`,
      [date],
    );
    return rows.map((r) => this.toResponse(r, date));
  }

  async findForEmployee(employeeId: number, from: string, to: string): Promise<AttendanceResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT
         a.id AS att_id, a.employee_id, a.att_date, e.full_name, e.emp_code, e.worker_type,
         a.status, a.shift_id, a.leave_type_id, a.in_time, a.out_time,
         a.worked_hours, a.ot_hours, a.is_late, a.source, a.remarks
       FROM attendance_records a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.employee_id = ? AND a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL
       ORDER BY a.att_date ASC`,
      [employeeId, from, to],
    );
    return rows.map((r) => this.toResponse(r, toDateString(r.att_date)));
  }

  async findOne(employeeId: number, date: string): Promise<AttendanceResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT
         a.id AS att_id, a.employee_id, a.att_date, e.full_name, e.emp_code, e.worker_type,
         a.status, a.shift_id, a.leave_type_id, a.in_time, a.out_time,
         a.worked_hours, a.ot_hours, a.is_late, a.source, a.remarks
       FROM attendance_records a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.employee_id = ? AND a.att_date = ? AND a.deleted_at IS NULL
       LIMIT 1`,
      [employeeId, date],
    );
    const row = rows[0];
    return row ? this.toResponse(row, date) : null;
  }

  /**
   * Insert-or-update attendance in batches. The unique key (employee_id, att_date)
   * makes this idempotent, so re-importing the same punch file is safe.
   * Accepts an external connection so leave approval can write inside its transaction.
   */
  async bulkUpsert(entries: AttendanceUpsertEntry[], userId: number, conn?: any): Promise<number> {
    if (entries.length === 0) return 0;

    const rowPlaceholder = `(${UPSERT_COLUMNS.map(() => '?').join(', ')})`;
    let affected = 0;

    for (let offset = 0; offset < entries.length; offset += UPSERT_CHUNK_SIZE) {
      const chunk = entries.slice(offset, offset + UPSERT_CHUNK_SIZE);
      const params: any[] = [];
      for (const e of chunk) {
        params.push(
          e.employeeId,
          e.attDate,
          e.status,
          e.shiftId ?? null,
          e.leaveTypeId ?? null,
          e.inTime ?? null,
          e.outTime ?? null,
          e.workedHours ?? null,
          e.otHours ?? 0,
          e.isLate ? 1 : 0,
          e.source ?? 'MANUAL',
          e.remarks ?? null,
          userId,
          userId,
        );
      }

      const sql = `INSERT INTO attendance_records (${UPSERT_COLUMNS.join(', ')})
         VALUES ${chunk.map(() => rowPlaceholder).join(', ')}
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           shift_id = VALUES(shift_id),
           leave_type_id = VALUES(leave_type_id),
           in_time = VALUES(in_time),
           out_time = VALUES(out_time),
           worked_hours = VALUES(worked_hours),
           ot_hours = VALUES(ot_hours),
           is_late = VALUES(is_late),
           source = VALUES(source),
           remarks = VALUES(remarks),
           updated_by = VALUES(updated_by),
           deleted_at = NULL`;

      if (conn) {
        const [result] = await conn.query(sql, params);
        affected += Number((result as any)?.affectedRows ?? 0);
      } else {
        const result = await this.query<any>(sql, params);
        affected += Number(result?.affectedRows ?? 0);
      }
    }

    return affected;
  }

  /** Marked days in a range; the register derives everything else client-side. */
  async findRegisterRows(from: string, to: string, employeeId?: number): Promise<RegisterAttendanceRow[]> {
    let sql = `SELECT employee_id, att_date, status, ot_hours
               FROM attendance_records
               WHERE att_date BETWEEN ? AND ? AND deleted_at IS NULL`;
    const params: any[] = [from, to];
    if (employeeId) {
      sql += ' AND employee_id = ?';
      params.push(employeeId);
    }
    return this.query<RegisterAttendanceRow[]>(sql, params);
  }

  /** Payroll window feed: attendance plus whether the leave type was paid. */
  async getWindowRows(from: string, to: string, conn?: any): Promise<WindowAttendanceRow[]> {
    const sql = `SELECT a.employee_id, a.att_date, a.status, a.ot_hours, lt.is_paid
                 FROM attendance_records a
                 LEFT JOIN leave_types lt ON lt.id = a.leave_type_id
                 WHERE a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL`;
    if (conn) {
      const [rows] = await conn.query(sql, [from, to]);
      return rows as WindowAttendanceRow[];
    }
    return this.query<WindowAttendanceRow[]>(sql, [from, to]);
  }

  async getDayCounts(date: string): Promise<Record<AttendanceStatus, number>> {
    const rows = await this.query<any[]>(
      `SELECT status, COUNT(*) AS cnt
       FROM attendance_records
       WHERE att_date = ? AND deleted_at IS NULL
       GROUP BY status`,
      [date],
    );
    const counts: Record<AttendanceStatus, number> = { ...EMPTY_COUNTS };
    for (const r of rows) {
      counts[r.status as AttendanceStatus] = Number(r.cnt ?? 0);
    }
    return counts;
  }

  /** Single aggregate for dashboard attendance tiles. */
  async getPresentPctForRange(
    from: string,
    to: string,
  ): Promise<{ present: number; halfDay: number; total: number; pct: number }> {
    const rows = await this.query<any[]>(
      `SELECT
         COALESCE(SUM(status = 'PRESENT'), 0)  AS present,
         COALESCE(SUM(status = 'HALF_DAY'), 0) AS half_day,
         COUNT(*)                              AS total
       FROM attendance_records
       WHERE att_date BETWEEN ? AND ? AND deleted_at IS NULL`,
      [from, to],
    );
    const r = rows[0] ?? {};
    const present = Number(r.present ?? 0);
    const halfDay = Number(r.half_day ?? 0);
    const total = Number(r.total ?? 0);
    const pct = total === 0 ? 0 : Math.round(((present + halfDay * 0.5) / total) * 1000) / 10;
    return { present, halfDay, total, pct };
  }

  private toResponse(row: any, date: string): AttendanceResponse {
    return {
      id: row.att_id ?? null,
      employeeId: Number(row.employee_id),
      employeeName: row.full_name,
      empCode: row.emp_code,
      workerType: row.worker_type,
      date,
      status: (row.status as AttendanceStatus | null) ?? null,
      shiftId: row.shift_id ?? null,
      leaveTypeId: row.leave_type_id ?? null,
      inTime: toTimeString(row.in_time),
      outTime: toTimeString(row.out_time),
      workedHours: row.worked_hours === null || row.worked_hours === undefined ? null : Number(row.worked_hours),
      otHours: Number(row.ot_hours ?? 0),
      isLate: !!row.is_late,
      source: row.source ?? null,
      remarks: row.remarks ?? null,
    };
  }
}
