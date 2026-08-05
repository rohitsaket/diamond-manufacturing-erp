import { BaseRepository } from './BaseRepository';
import { ComplianceRule, ComplianceViolation, Paged, Severity, ViolationStatus } from '../types/attendance';
import { toDateString } from '../utils/dateUtils';

function iso(value: any): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** One aggregated observation the scanner compares against a threshold. */
export interface Observation {
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  value: number;
  detail: string;
}

export class AttendanceComplianceRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------
  async listRules(includeInactive = false): Promise<ComplianceRule[]> {
    const rows = await this.query<any[]>(
      `SELECT r.*, (
         SELECT COUNT(*) FROM attendance_compliance_violations v
         WHERE v.rule_id = r.id AND v.status = 'OPEN'
       ) AS open_violations
       FROM attendance_compliance_rules r
       WHERE r.deleted_at IS NULL ${includeInactive ? '' : "AND r.status = 'ACTIVE'"}
       ORDER BY FIELD(r.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'), r.code ASC`,
    );
    return rows.map((r) => this.toRule(r));
  }

  async findRuleById(id: number): Promise<ComplianceRule | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM attendance_compliance_rules WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    );
    return rows[0] ? this.toRule(rows[0]) : null;
  }

  async createRule(data: Partial<ComplianceRule>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO attendance_compliance_rules
         (code, name, rule_type, threshold_value, comparison, period, severity, country,
          company_id, branch_id, legal_reference, remediation, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.ruleType, data.thresholdValue, data.comparison ?? 'GT',
        data.period ?? 'DAY', data.severity ?? 'MEDIUM', data.country ?? null,
        data.companyId ?? null, data.branchId ?? null, data.legalReference ?? null,
        data.remediation ?? null, data.status ?? 'ACTIVE', userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateRule(id: number, data: Partial<ComplianceRule>, current: ComplianceRule): Promise<void> {
    await this.query(
      `UPDATE attendance_compliance_rules SET name = ?, rule_type = ?, threshold_value = ?,
         comparison = ?, period = ?, severity = ?, country = ?, legal_reference = ?,
         remediation = ?, status = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.name ?? current.name,
        data.ruleType ?? current.ruleType,
        data.thresholdValue ?? current.thresholdValue,
        data.comparison ?? current.comparison,
        data.period ?? current.period,
        data.severity ?? current.severity,
        data.country === undefined ? current.country : data.country,
        data.legalReference === undefined ? current.legalReference : data.legalReference,
        data.remediation === undefined ? current.remediation : data.remediation,
        data.status ?? current.status,
        id,
      ],
    );
  }

  async deleteRule(id: number): Promise<void> {
    await this.query('UPDATE attendance_compliance_rules SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Violations
  // -------------------------------------------------------------------------
  /**
   * Idempotent: the unique key on (rule, employee, period start) means a rescan
   * refreshes the observed value rather than stacking duplicate rows, and a
   * violation an HR user already resolved is not silently reopened.
   */
  async recordViolations(
    ruleId: number,
    severity: Severity,
    rows: (Observation & { thresholdValue: number })[],
  ): Promise<{ written: number }> {
    if (!rows.length) return { written: 0 };
    const cols = ['rule_id', 'employee_id', 'period_start', 'period_end', 'observed_value',
      'threshold_value', 'severity', 'detail', 'company_id', 'branch_id', 'department_id'];
    const CHUNK = 300;
    let written = 0;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const params: any[] = [];
      const placeholders: string[] = [];
      for (const o of chunk) {
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, (SELECT company_id FROM employees WHERE id = ?), (SELECT branch_id FROM employees WHERE id = ?), (SELECT department_id FROM employees WHERE id = ?))');
        params.push(
          ruleId, o.employeeId, o.periodStart, o.periodEnd, o.value, o.thresholdValue,
          severity, o.detail, o.employeeId, o.employeeId, o.employeeId,
        );
      }
      const result = await this.query<any>(
        `INSERT INTO attendance_compliance_violations (${cols.join(', ')})
         VALUES ${placeholders.join(', ')}
         ON DUPLICATE KEY UPDATE
           period_end = VALUES(period_end),
           observed_value = VALUES(observed_value),
           threshold_value = VALUES(threshold_value),
           severity = VALUES(severity),
           detail = VALUES(detail),
           detected_at = NOW()`,
        params,
      );
      written += Number(result?.affectedRows ?? 0);
    }
    return { written };
  }

  /** How many of these rule/period pairs did not already exist. */
  async countExisting(ruleId: number, periods: { employeeId: number; periodStart: string }[]): Promise<number> {
    if (!periods.length) return 0;
    const params: any[] = [ruleId];
    const pairs = periods.map((p) => { params.push(p.employeeId, p.periodStart); return '(?, ?)'; }).join(', ');
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n FROM attendance_compliance_violations
       WHERE rule_id = ? AND (employee_id, period_start) IN (${pairs})`,
      params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async listViolations(filters: {
    status?: ViolationStatus; severity?: Severity; ruleId?: number; employeeId?: number;
    from?: string; to?: string; page?: number; pageSize?: number;
  }): Promise<Paged<ComplianceViolation>> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.status) { where.push('v.status = ?'); params.push(filters.status); }
    if (filters.severity) { where.push('v.severity = ?'); params.push(filters.severity); }
    if (filters.ruleId) { where.push('v.rule_id = ?'); params.push(filters.ruleId); }
    if (filters.employeeId) { where.push('v.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.from) { where.push('v.period_end >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('v.period_start <= ?'); params.push(filters.to); }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 500);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(`SELECT COUNT(*) AS n FROM attendance_compliance_violations v WHERE ${clause}`, params),
      this.query<any[]>(
        `SELECT v.*, r.code AS rule_code, r.name AS rule_name, r.rule_type,
                r.legal_reference, r.remediation,
                e.full_name, e.emp_code, u.name AS resolved_by_name
         FROM attendance_compliance_violations v
         JOIN attendance_compliance_rules r ON r.id = v.rule_id
         JOIN employees e ON e.id = v.employee_id
         LEFT JOIN users u ON u.id = v.resolved_by
         WHERE ${clause}
         ORDER BY FIELD(v.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'),
                  v.period_start DESC, v.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => this.toViolation(r)),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  async resolveViolation(id: number, status: ViolationStatus, note: string | null, userId: number): Promise<void> {
    await this.query(
      `UPDATE attendance_compliance_violations
       SET status = ?, resolution_note = ?, resolved_by = ?,
           resolved_at = IF(? IN ('RESOLVED', 'WAIVED'), NOW(), NULL)
       WHERE id = ?`,
      [status, note, userId, status, id],
    );
  }

  async summary(): Promise<{ bySeverity: Record<string, number>; byStatus: Record<string, number>; total: number }> {
    const [sev, st] = await Promise.all([
      this.query<any[]>(
        "SELECT severity, COUNT(*) AS n FROM attendance_compliance_violations WHERE status = 'OPEN' GROUP BY severity",
      ),
      this.query<any[]>('SELECT status, COUNT(*) AS n FROM attendance_compliance_violations GROUP BY status'),
    ]);
    const bySeverity: Record<string, number> = {};
    for (const r of sev) bySeverity[r.severity] = Number(r.n);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of st) { byStatus[r.status] = Number(r.n); total += Number(r.n); }
    return { bySeverity, byStatus, total };
  }

  // -------------------------------------------------------------------------
  // Observations the scanner evaluates
  // -------------------------------------------------------------------------
  async dailyHours(from: string, to: string): Promise<Observation[]> {
    const rows = await this.query<any[]>(
      `SELECT a.employee_id, a.att_date,
              ROUND(COALESCE(a.worked_hours, 0) + COALESCE(a.ot_hours, 0), 2) AS value
       FROM attendance_records a
       WHERE a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL
         AND a.status IN ('PRESENT', 'HALF_DAY')`,
      [from, to],
    );
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      periodStart: toDateString(r.att_date),
      periodEnd: toDateString(r.att_date),
      value: Number(r.value ?? 0),
      detail: `Worked ${Number(r.value ?? 0).toFixed(2)} hours including overtime on ${toDateString(r.att_date)}`,
    }));
  }

  async weeklyHours(from: string, to: string): Promise<Observation[]> {
    const rows = await this.query<any[]>(
      `SELECT a.employee_id,
              DATE_SUB(a.att_date, INTERVAL WEEKDAY(a.att_date) DAY) AS week_start,
              ROUND(SUM(COALESCE(a.worked_hours, 0) + COALESCE(a.ot_hours, 0)), 2) AS value,
              COUNT(*) AS days
       FROM attendance_records a
       WHERE a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL
         AND a.status IN ('PRESENT', 'HALF_DAY')
       GROUP BY a.employee_id, week_start`,
      [from, to],
    );
    return rows.map((r) => {
      const start = toDateString(r.week_start);
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      return {
        employeeId: Number(r.employee_id),
        periodStart: start,
        periodEnd: end.toISOString().slice(0, 10),
        value: Number(r.value ?? 0),
        detail: `${Number(r.value ?? 0).toFixed(2)} hours across ${Number(r.days)} working days in the week of ${start}`,
      };
    });
  }

  /**
   * Rest between the previous day's exit and the next day's entry.
   * LAG over the ordered days gives the gap in one pass rather than a
   * self-join per employee-day.
   */
  async restGaps(from: string, to: string): Promise<Observation[]> {
    const rows = await this.query<any[]>(
      `SELECT employee_id, att_date, prev_date, prev_out, in_time,
              ROUND(TIMESTAMPDIFF(MINUTE, TIMESTAMP(prev_date, prev_out), TIMESTAMP(att_date, in_time)) / 60, 2) AS value
       FROM (
         SELECT a.employee_id, a.att_date, a.in_time,
                LAG(a.att_date) OVER w AS prev_date,
                LAG(COALESCE(a.last_out_time, a.out_time)) OVER w AS prev_out
         FROM attendance_records a
         WHERE a.att_date BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND ?
           AND a.deleted_at IS NULL AND a.in_time IS NOT NULL
           AND a.status IN ('PRESENT', 'HALF_DAY')
         WINDOW w AS (PARTITION BY a.employee_id ORDER BY a.att_date)
       ) g
       WHERE prev_date IS NOT NULL AND prev_out IS NOT NULL AND att_date BETWEEN ? AND ?`,
      [from, to, from, to],
    );
    return rows
      .filter((r) => r.value !== null && Number(r.value) >= 0)
      .map((r) => ({
        employeeId: Number(r.employee_id),
        periodStart: toDateString(r.att_date),
        periodEnd: toDateString(r.att_date),
        value: Number(r.value),
        detail: `Only ${Number(r.value).toFixed(2)} hours between leaving on ${toDateString(r.prev_date)} and arriving on ${toDateString(r.att_date)}`,
      }));
  }

  async monthlyOvertime(from: string, to: string): Promise<Observation[]> {
    const rows = await this.query<any[]>(
      `SELECT o.employee_id, DATE_FORMAT(o.att_date, '%Y-%m-01') AS month_start,
              ROUND(SUM(o.approved_hours), 2) AS value
       FROM overtime_records o
       WHERE o.att_date BETWEEN ? AND ? AND o.deleted_at IS NULL
         AND o.status IN ('APPROVED', 'PAID')
       GROUP BY o.employee_id, month_start`,
      [from, to],
    );
    return rows.map((r) => {
      const start = toDateString(r.month_start);
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(0);
      return {
        employeeId: Number(r.employee_id),
        periodStart: start,
        periodEnd: end.toISOString().slice(0, 10),
        value: Number(r.value ?? 0),
        detail: `${Number(r.value ?? 0).toFixed(2)} approved overtime hours in ${start.slice(0, 7)}`,
      };
    });
  }

  async weeklyOffCount(from: string, to: string): Promise<Observation[]> {
    const rows = await this.query<any[]>(
      `SELECT a.employee_id,
              DATE_SUB(a.att_date, INTERVAL WEEKDAY(a.att_date) DAY) AS week_start,
              COALESCE(SUM(a.status IN ('WEEK_OFF', 'HOLIDAY')), 0) AS value,
              COUNT(*) AS days
       FROM attendance_records a
       WHERE a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL
       GROUP BY a.employee_id, week_start
       HAVING days >= 7`,
      [from, to],
    );
    return rows.map((r) => {
      const start = toDateString(r.week_start);
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      return {
        employeeId: Number(r.employee_id),
        periodStart: start,
        periodEnd: end.toISOString().slice(0, 10),
        value: Number(r.value ?? 0),
        detail: `${Number(r.value ?? 0)} rest days in the full week beginning ${start}`,
      };
    });
  }

  /**
   * Longest run of consecutive worked days in the window.
   * The gaps-and-islands trick: date minus a dense row number is constant
   * across a run, so grouping on it counts the runs directly.
   */
  async consecutiveWorkDays(from: string, to: string): Promise<Observation[]> {
    const rows = await this.query<any[]>(
      `SELECT employee_id, MIN(att_date) AS run_start, MAX(att_date) AS run_end, COUNT(*) AS value
       FROM (
         SELECT a.employee_id, a.att_date,
                DATE_SUB(a.att_date, INTERVAL ROW_NUMBER() OVER (PARTITION BY a.employee_id ORDER BY a.att_date) DAY) AS grp
         FROM attendance_records a
         WHERE a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL
           AND a.status IN ('PRESENT', 'HALF_DAY')
       ) runs
       GROUP BY employee_id, grp`,
      [from, to],
    );
    // Keep only each employee's longest run so one person yields one observation.
    const best = new Map<number, Observation>();
    for (const r of rows) {
      const value = Number(r.value ?? 0);
      const employeeId = Number(r.employee_id);
      const existing = best.get(employeeId);
      if (!existing || value > existing.value) {
        best.set(employeeId, {
          employeeId,
          periodStart: toDateString(r.run_start),
          periodEnd: toDateString(r.run_end),
          value,
          detail: `${value} consecutive working days from ${toDateString(r.run_start)} to ${toDateString(r.run_end)}`,
        });
      }
    }
    return Array.from(best.values());
  }

  async missingBreaks(from: string, to: string, afterHours: number): Promise<Observation[]> {
    const rows = await this.query<any[]>(
      `SELECT a.employee_id, a.att_date, COALESCE(a.worked_hours, 0) AS worked,
              COALESCE(a.break_minutes, 0) AS break_minutes
       FROM attendance_records a
       WHERE a.att_date BETWEEN ? AND ? AND a.deleted_at IS NULL
         AND a.status = 'PRESENT' AND COALESCE(a.worked_hours, 0) >= ?
         AND COALESCE(a.break_minutes, 0) = 0`,
      [from, to, afterHours],
    );
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      periodStart: toDateString(r.att_date),
      periodEnd: toDateString(r.att_date),
      value: 0,
      detail: `Worked ${Number(r.worked).toFixed(2)} hours on ${toDateString(r.att_date)} with no break recorded`,
    }));
  }

  private toRule(r: any): ComplianceRule {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      ruleType: r.rule_type,
      thresholdValue: Number(r.threshold_value),
      comparison: r.comparison,
      period: r.period,
      severity: r.severity,
      country: r.country ?? null,
      companyId: r.company_id === null ? null : Number(r.company_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      legalReference: r.legal_reference ?? null,
      remediation: r.remediation ?? null,
      status: r.status,
      openViolations: r.open_violations === undefined ? undefined : Number(r.open_violations),
    };
  }

  private toViolation(r: any): ComplianceViolation {
    return {
      id: Number(r.id),
      ruleId: Number(r.rule_id),
      ruleCode: r.rule_code,
      ruleName: r.rule_name,
      ruleType: r.rule_type,
      legalReference: r.legal_reference ?? null,
      remediation: r.remediation ?? null,
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      periodStart: toDateString(r.period_start),
      periodEnd: toDateString(r.period_end),
      observedValue: Number(r.observed_value),
      thresholdValue: Number(r.threshold_value),
      severity: r.severity,
      detail: r.detail ?? null,
      status: r.status,
      resolvedByName: r.resolved_by_name ?? null,
      resolvedAt: iso(r.resolved_at),
      resolutionNote: r.resolution_note ?? null,
      detectedAt: iso(r.detected_at)!,
    };
  }
}
