import { BaseRepository } from './BaseRepository';
import { AttendanceTrendPoint, WorkMode } from '../types/attendance';
import { toDateString } from '../utils/dateUtils';

export interface AnalyticsScope {
  from: string;
  to: string;
  branchId?: number;
  departmentId?: number;
  employeeId?: number;
}

/**
 * Read-only aggregate queries for the dashboards and analytics tab.
 *
 * Every query groups in SQL rather than pulling rows into Node, so the cost
 * scales with the number of buckets rather than the number of employee-days --
 * which is what makes these usable at six figures of headcount.
 */
export class AttendanceAnalyticsRepository extends BaseRepository {
  private scopeClause(scope: AnalyticsScope, alias = 'a'): { clause: string; params: any[] } {
    const where: string[] = [`${alias}.att_date BETWEEN ? AND ?`, `${alias}.deleted_at IS NULL`];
    const params: any[] = [scope.from, scope.to];
    if (scope.branchId) { where.push(`COALESCE(${alias}.branch_id, e.branch_id) = ?`); params.push(scope.branchId); }
    if (scope.departmentId) { where.push(`COALESCE(${alias}.department_id, e.department_id) = ?`); params.push(scope.departmentId); }
    if (scope.employeeId) { where.push(`${alias}.employee_id = ?`); params.push(scope.employeeId); }
    return { clause: where.join(' AND '), params };
  }

  /** Day, week or month buckets. */
  async trend(scope: AnalyticsScope, granularity: 'day' | 'week' | 'month'): Promise<AttendanceTrendPoint[]> {
    const bucket = granularity === 'month'
      ? "DATE_FORMAT(a.att_date, '%Y-%m')"
      : granularity === 'week'
        ? "DATE_FORMAT(DATE_SUB(a.att_date, INTERVAL WEEKDAY(a.att_date) DAY), '%Y-%m-%d')"
        : "DATE_FORMAT(a.att_date, '%Y-%m-%d')";

    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT ${bucket} AS bucket,
              COALESCE(SUM(a.status = 'PRESENT'), 0)  AS present,
              COALESCE(SUM(a.status = 'ABSENT'), 0)   AS absent,
              COALESCE(SUM(a.status = 'HALF_DAY'), 0) AS half_day,
              COALESCE(SUM(a.status = 'LEAVE'), 0)    AS leave_days,
              COALESCE(SUM(a.is_late), 0)             AS late,
              COALESCE(SUM(a.ot_hours), 0)            AS ot_hours
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE ${clause}
       GROUP BY bucket ORDER BY bucket ASC`,
      params,
    );

    return rows.map((r) => {
      const present = Number(r.present ?? 0);
      const halfDay = Number(r.half_day ?? 0);
      const absent = Number(r.absent ?? 0);
      const leave = Number(r.leave_days ?? 0);
      const expected = present + halfDay + absent + leave;
      return {
        bucket: String(r.bucket),
        present,
        absent,
        halfDay,
        leave,
        late: Number(r.late ?? 0),
        otHours: Math.round(Number(r.ot_hours ?? 0) * 100) / 100,
        attendancePct: expected === 0 ? 0 : Math.round(((present + halfDay * 0.5) / expected) * 1000) / 10,
      };
    });
  }

  async byDimension(
    scope: AnalyticsScope,
    dimension: 'department' | 'branch',
  ): Promise<{ name: string; present: number; absent: number; late: number; otHours: number; attendancePct: number }[]> {
    const join = dimension === 'department'
      ? 'LEFT JOIN departments dim ON dim.id = COALESCE(a.department_id, e.department_id)'
      : 'LEFT JOIN branches dim ON dim.id = COALESCE(a.branch_id, e.branch_id)';

    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT COALESCE(dim.name, 'Unassigned') AS name,
              COALESCE(SUM(a.status = 'PRESENT'), 0)  AS present,
              COALESCE(SUM(a.status = 'ABSENT'), 0)   AS absent,
              COALESCE(SUM(a.status = 'HALF_DAY'), 0) AS half_day,
              COALESCE(SUM(a.status = 'LEAVE'), 0)    AS leave_days,
              COALESCE(SUM(a.is_late), 0)             AS late,
              COALESCE(SUM(a.ot_hours), 0)            AS ot_hours
       FROM attendance_records a
       JOIN employees e ON e.id = a.employee_id
       ${join}
       WHERE ${clause}
       GROUP BY name ORDER BY present DESC`,
      params,
    );

    return rows.map((r) => {
      const present = Number(r.present ?? 0);
      const halfDay = Number(r.half_day ?? 0);
      const absent = Number(r.absent ?? 0);
      const leave = Number(r.leave_days ?? 0);
      const expected = present + halfDay + absent + leave;
      return {
        name: r.name,
        present,
        absent,
        late: Number(r.late ?? 0),
        otHours: Math.round(Number(r.ot_hours ?? 0) * 100) / 100,
        attendancePct: expected === 0 ? 0 : Math.round(((present + halfDay * 0.5) / expected) * 1000) / 10,
      };
    });
  }

  async absenteeism(scope: AnalyticsScope, limit = 15): Promise<{ employeeId: number; employeeName: string; empCode: string; absentDays: number; ratePct: number }[]> {
    const capped = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 15)));
    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT a.employee_id, e.full_name, e.emp_code,
              COALESCE(SUM(a.status = 'ABSENT'), 0) AS absent_days,
              COALESCE(SUM(a.status IN ('PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE')), 0) AS expected_days
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE ${clause}
       GROUP BY a.employee_id, e.full_name, e.emp_code
       HAVING absent_days > 0
       ORDER BY absent_days DESC LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => {
      const absent = Number(r.absent_days ?? 0);
      const expected = Number(r.expected_days ?? 0);
      return {
        employeeId: Number(r.employee_id),
        employeeName: r.full_name,
        empCode: r.emp_code,
        absentDays: absent,
        ratePct: expected === 0 ? 0 : Math.round((absent / expected) * 1000) / 10,
      };
    });
  }

  async overtimeLeaders(scope: AnalyticsScope, limit = 15): Promise<{ employeeId: number; employeeName: string; empCode: string; otHours: number; approvedHours: number }[]> {
    const capped = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 15)));
    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT a.employee_id, e.full_name, e.emp_code,
              ROUND(COALESCE(SUM(a.ot_hours), 0), 2) AS ot_hours,
              ROUND(COALESCE(SUM(a.ot_approved_hours), 0), 2) AS approved_hours
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE ${clause}
       GROUP BY a.employee_id, e.full_name, e.emp_code
       HAVING ot_hours > 0
       ORDER BY ot_hours DESC LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      otHours: Number(r.ot_hours ?? 0),
      approvedHours: Number(r.approved_hours ?? 0),
    }));
  }

  async punctuality(scope: AnalyticsScope, limit = 15): Promise<{ employeeId: number; employeeName: string; empCode: string; lateDays: number; avgLateMinutes: number }[]> {
    const capped = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 15)));
    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT a.employee_id, e.full_name, e.emp_code,
              COALESCE(SUM(a.is_late), 0) AS late_days,
              ROUND(COALESCE(AVG(NULLIF(a.late_minutes, 0)), 0), 1) AS avg_late
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE ${clause}
       GROUP BY a.employee_id, e.full_name, e.emp_code
       HAVING late_days > 0
       ORDER BY late_days DESC, avg_late DESC LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      lateDays: Number(r.late_days ?? 0),
      avgLateMinutes: Number(r.avg_late ?? 0),
    }));
  }

  async heatmap(scope: AnalyticsScope): Promise<{ date: string; dayOfWeek: number; present: number; total: number; pct: number }[]> {
    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT a.att_date, DAYOFWEEK(a.att_date) - 1 AS dow,
              COALESCE(SUM(a.status IN ('PRESENT', 'HALF_DAY')), 0) AS present,
              COUNT(*) AS total
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE ${clause}
       GROUP BY a.att_date, dow ORDER BY a.att_date ASC`,
      params,
    );
    return rows.map((r) => {
      const present = Number(r.present ?? 0);
      const total = Number(r.total ?? 0);
      return {
        date: toDateString(r.att_date),
        dayOfWeek: Number(r.dow ?? 0),
        present,
        total,
        pct: total === 0 ? 0 : Math.round((present / total) * 1000) / 10,
      };
    });
  }

  async workModeMix(scope: AnalyticsScope): Promise<{ mode: WorkMode; days: number; pct: number }[]> {
    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT a.work_mode, COUNT(*) AS n
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE ${clause} AND a.status IN ('PRESENT', 'HALF_DAY')
       GROUP BY a.work_mode ORDER BY n DESC`,
      params,
    );
    const total = rows.reduce((sum, r) => sum + Number(r.n ?? 0), 0);
    return rows.map((r) => ({
      mode: r.work_mode as WorkMode,
      days: Number(r.n ?? 0),
      pct: total === 0 ? 0 : Math.round((Number(r.n ?? 0) / total) * 1000) / 10,
    }));
  }

  async summary(scope: AnalyticsScope): Promise<{
    totalEmployees: number; avgAttendancePct: number; totalOtHours: number;
    totalLateInstances: number; totalAbsentDays: number; avgWorkedHours: number;
  }> {
    const { clause, params } = this.scopeClause(scope);
    const rows = await this.query<any[]>(
      `SELECT COUNT(DISTINCT a.employee_id) AS employees,
              COALESCE(SUM(a.status = 'PRESENT'), 0)  AS present,
              COALESCE(SUM(a.status = 'HALF_DAY'), 0) AS half_day,
              COALESCE(SUM(a.status = 'ABSENT'), 0)   AS absent,
              COALESCE(SUM(a.status = 'LEAVE'), 0)    AS leave_days,
              COALESCE(SUM(a.is_late), 0)             AS late,
              ROUND(COALESCE(SUM(a.ot_hours), 0), 2)  AS ot_hours,
              ROUND(COALESCE(AVG(NULLIF(a.worked_hours, 0)), 0), 2) AS avg_worked
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE ${clause}`,
      params,
    );
    const r = rows[0] ?? {};
    const present = Number(r.present ?? 0);
    const halfDay = Number(r.half_day ?? 0);
    const absent = Number(r.absent ?? 0);
    const leave = Number(r.leave_days ?? 0);
    const expected = present + halfDay + absent + leave;
    return {
      totalEmployees: Number(r.employees ?? 0),
      avgAttendancePct: expected === 0 ? 0 : Math.round(((present + halfDay * 0.5) / expected) * 1000) / 10,
      totalOtHours: Number(r.ot_hours ?? 0),
      totalLateInstances: Number(r.late ?? 0),
      totalAbsentDays: absent,
      avgWorkedHours: Number(r.avg_worked ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // Live board aggregates
  // -------------------------------------------------------------------------
  async dayTotals(date: string): Promise<{
    headcount: number; present: number; absent: number; late: number; onLeave: number;
    holiday: number; weekOff: number; remote: number; businessTravel: number; halfDay: number;
    marked: number; overtimeHours: number; exceptions: number; missingPunches: number;
  }> {
    const rows = await this.query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM employees WHERE work_status = 'WORKING' AND deleted_at IS NULL) AS headcount,
         COALESCE(SUM(a.status = 'PRESENT'), 0)  AS present,
         COALESCE(SUM(a.status = 'ABSENT'), 0)   AS absent,
         COALESCE(SUM(a.status = 'HALF_DAY'), 0) AS half_day,
         COALESCE(SUM(a.status = 'LEAVE'), 0)    AS on_leave,
         COALESCE(SUM(a.status = 'HOLIDAY'), 0)  AS holiday,
         COALESCE(SUM(a.status = 'WEEK_OFF'), 0) AS week_off,
         COALESCE(SUM(a.is_late), 0)             AS late,
         COALESCE(SUM(a.work_mode = 'REMOTE'), 0) AS remote,
         COALESCE(SUM(a.work_mode = 'BUSINESS_TRAVEL'), 0) AS business_travel,
         COALESCE(SUM(a.ot_hours), 0)            AS ot_hours,
         COALESCE(SUM(a.exception_flags IS NOT NULL), 0) AS exceptions,
         COALESCE(SUM(a.is_missing_punch), 0)    AS missing_punches,
         COUNT(*)                                AS marked
       FROM attendance_records a
       WHERE a.att_date = ? AND a.deleted_at IS NULL`,
      [date],
    );
    const r = rows[0] ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      headcount: n('headcount'), present: n('present'), absent: n('absent'), late: n('late'),
      onLeave: n('on_leave'), holiday: n('holiday'), weekOff: n('week_off'),
      remote: n('remote'), businessTravel: n('business_travel'), halfDay: n('half_day'),
      marked: n('marked'), overtimeHours: Math.round(n('ot_hours') * 100) / 100,
      exceptions: n('exceptions'), missingPunches: n('missing_punches'),
    };
  }

  async dayByDimension(
    date: string,
    dimension: 'department' | 'branch',
  ): Promise<{ id: number | null; name: string; headcount: number; present: number; absent: number; pct: number }[]> {
    const col = dimension === 'department' ? 'department_id' : 'branch_id';
    const table = dimension === 'department' ? 'departments' : 'branches';
    const rows = await this.query<any[]>(
      `SELECT dim.id AS dim_id, COALESCE(dim.name, 'Unassigned') AS name,
              COUNT(e.id) AS headcount,
              COALESCE(SUM(a.status IN ('PRESENT', 'HALF_DAY')), 0) AS present,
              COALESCE(SUM(a.status = 'ABSENT'), 0) AS absent
       FROM employees e
       LEFT JOIN ${table} dim ON dim.id = e.${col}
       LEFT JOIN attendance_records a ON a.employee_id = e.id AND a.att_date = ? AND a.deleted_at IS NULL
       WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
       GROUP BY dim.id, name ORDER BY headcount DESC`,
      [date],
    );
    return rows.map((r) => {
      const headcount = Number(r.headcount ?? 0);
      const present = Number(r.present ?? 0);
      return {
        id: r.dim_id === null ? null : Number(r.dim_id),
        name: r.name,
        headcount,
        present,
        absent: Number(r.absent ?? 0),
        pct: headcount === 0 ? 0 : Math.round((present / headcount) * 1000) / 10,
      };
    });
  }

  /**
   * Planned versus actual per shift for a date. Planned comes from the published
   * roster where one exists, otherwise from the employee's standing shift --
   * so coverage is never blank just because nobody built a roster.
   */
  async shiftCoverage(date: string): Promise<{ shiftId: number | null; shiftName: string; planned: number; present: number; coveragePct: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT s.id AS shift_id, COALESCE(s.name, 'Unassigned') AS shift_name,
              COUNT(*) AS planned,
              COALESCE(SUM(att.status IN ('PRESENT', 'HALF_DAY')), 0) AS present
       FROM employees e
       LEFT JOIN roster_entries re ON re.employee_id = e.id AND re.work_date = ?
       LEFT JOIN rosters r ON r.id = re.roster_id AND r.status IN ('PUBLISHED', 'LOCKED') AND r.deleted_at IS NULL
       LEFT JOIN shifts s ON s.id = COALESCE(IF(r.id IS NULL, NULL, re.shift_id), e.shift_id)
       LEFT JOIN attendance_records att ON att.employee_id = e.id AND att.att_date = ? AND att.deleted_at IS NULL
       WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
       GROUP BY s.id, shift_name ORDER BY planned DESC`,
      [date, date],
    );
    return rows.map((r) => {
      const planned = Number(r.planned ?? 0);
      const present = Number(r.present ?? 0);
      return {
        shiftId: r.shift_id === null ? null : Number(r.shift_id),
        shiftName: r.shift_name,
        planned,
        present,
        coveragePct: planned === 0 ? 0 : Math.round((present / planned) * 1000) / 10,
      };
    });
  }

  async dayExceptions(date: string, limit = 25): Promise<{ employeeId: number; employeeName: string; empCode: string; flags: string[]; detail: string }[]> {
    const capped = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 25)));
    const rows = await this.query<any[]>(
      `SELECT a.employee_id, e.full_name, e.emp_code, a.exception_flags,
              a.late_minutes, a.early_exit_minutes, a.ot_hours, a.status, a.is_missing_punch
       FROM attendance_records a JOIN employees e ON e.id = a.employee_id
       WHERE a.att_date = ? AND a.deleted_at IS NULL AND a.exception_flags IS NOT NULL
       ORDER BY a.late_minutes DESC, a.ot_hours DESC
       LIMIT ${capped}`,
      [date],
    );
    return rows.map((r) => {
      const flags = String(r.exception_flags ?? '').split(',').filter(Boolean);
      const parts: string[] = [];
      if (Number(r.late_minutes ?? 0) > 0) parts.push(`${Number(r.late_minutes)} min late`);
      if (Number(r.early_exit_minutes ?? 0) > 0) parts.push(`left ${Number(r.early_exit_minutes)} min early`);
      if (Number(r.ot_hours ?? 0) > 0) parts.push(`${Number(r.ot_hours)} h overtime`);
      if (r.is_missing_punch) parts.push('missing punch');
      if (r.status === 'ABSENT') parts.push('absent');
      return {
        employeeId: Number(r.employee_id),
        employeeName: r.full_name,
        empCode: r.emp_code,
        flags,
        detail: parts.join(' · ') || flags.join(', '),
      };
    });
  }
}
