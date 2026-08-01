import { BaseRepository } from './BaseRepository';
import { SalaryLineRow, SalaryLineExtendedResponse, WorkerType } from '../types';
import { toDateString } from '../utils/dateUtils';

/** One fully computed salary line, ready to be written by the payroll engine. */
export interface ComputedSalaryLine {
  periodId: number;
  employeeId: number;
  workerType: WorkerType | null;
  totalCts: number;
  lotsCount: number;
  paidDays: number;
  periodDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  otHours: number;
  earnPiece: number;
  earnFixed: number;
  earnOt: number;
  grossAmount: number;
  dedPf: number;
  dedEsi: number;
  dedPt: number;
  dedAdvance: number;
  dedOther: number;
  totalDeductions: number;
  netAmount: number;
  userId: number;
}

export interface ComplianceTotals {
  employee_count: number;
  total_gross: number;
  total_pf: number;
  total_esi: number;
  total_pt: number;
  total_advance: number;
  total_deductions: number;
  total_net: number;
}

/** A salary line joined with its employee and period, used to render a payslip. */
export interface SalaryLineWithEmployee extends SalaryLineRow {
  employee_name: string;
  emp_code: string;
  grade: string;
  department: string | null;
  designation: string | null;
  joined_at: any;
  bank_account: string | null;
  bank_ifsc: string | null;
  whatsapp: string | null;
  period_label: string;
  period_from: any;
  period_to: any;
  period_status: string;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const bool = (value: unknown): boolean => value === 1 || value === true || value === '1';

const dateOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : toDateString(value));

export class SalaryLineRepository extends BaseRepository {
  /**
   * Backward-compatible period listing.
   *
   * The response is a superset of the legacy `SalaryLineResponse` shape: every
   * field the frontend already reads keeps its name, type and meaning, and the
   * computed payroll columns are added alongside.
   */
  async findByPeriod(periodId: number): Promise<SalaryLineExtendedResponse[]> {
    return this.findByPeriodExtended(periodId);
  }

  async findByPeriodExtended(periodId: number): Promise<SalaryLineExtendedResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT sl.*, e.full_name AS employee_name, e.emp_code, e.whatsapp
       FROM salary_lines sl
       JOIN employees e ON sl.employee_id = e.id
       WHERE sl.period_id = ?
       ORDER BY e.full_name`,
      [periodId],
    );
    return rows.map((r) => this.toExtendedResponse(r));
  }

  async findById(id: number): Promise<SalaryLineRow | null> {
    const rows = await this.query<SalaryLineRow[]>(
      'SELECT * FROM salary_lines WHERE id = ?',
      [id],
    );
    return rows[0] || null;
  }

  /** Salary line + employee + period, everything a payslip needs in one row. */
  async findByIdWithEmployee(lineId: number): Promise<SalaryLineWithEmployee | null> {
    const rows = await this.query<SalaryLineWithEmployee[]>(
      `SELECT sl.*,
              e.full_name AS employee_name, e.emp_code, e.grade, e.department, e.designation,
              e.joined_at, e.bank_account, e.bank_ifsc, e.whatsapp,
              p.label AS period_label, p.from_date AS period_from, p.to_date AS period_to,
              p.status AS period_status
       FROM salary_lines sl
       JOIN employees e ON sl.employee_id = e.id
       JOIN salary_periods p ON sl.period_id = p.id
       WHERE sl.id = ?`,
      [lineId],
    );
    return rows[0] || null;
  }

  /** Payslip history for one employee, newest period first. */
  async getEmployeeLines(
    employeeId: number,
    limit = 24,
  ): Promise<(SalaryLineExtendedResponse & { periodLabel: string; fromDate: string; toDate: string })[]> {
    const safeLimit = Math.min(200, Math.max(1, Math.floor(Number(limit) || 24)));
    const rows = await this.query<any[]>(
      `SELECT sl.*, e.full_name AS employee_name, e.emp_code, e.whatsapp,
              p.label AS period_label, p.from_date AS period_from, p.to_date AS period_to
       FROM salary_lines sl
       JOIN employees e ON sl.employee_id = e.id
       JOIN salary_periods p ON sl.period_id = p.id
       WHERE sl.employee_id = ? AND p.deleted_at IS NULL
       ORDER BY p.from_date DESC
       LIMIT ${safeLimit}`,
      [employeeId],
    );
    return rows.map((r) => ({
      ...this.toExtendedResponse(r),
      periodLabel: r.period_label,
      fromDate: toDateString(r.period_from),
      toDate: toDateString(r.period_to),
    }));
  }

  /** Statutory totals for a period, plus the number of lines they cover. */
  async getComplianceTotals(periodId: number): Promise<ComplianceTotals> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS employee_count,
              COALESCE(SUM(gross_amount), 0) AS total_gross,
              COALESCE(SUM(ded_pf), 0) AS total_pf,
              COALESCE(SUM(ded_esi), 0) AS total_esi,
              COALESCE(SUM(ded_pt), 0) AS total_pt,
              COALESCE(SUM(ded_advance), 0) AS total_advance,
              COALESCE(SUM(total_deductions), 0) AS total_deductions,
              COALESCE(SUM(net_amount), 0) AS total_net
       FROM salary_lines WHERE period_id = ?`,
      [periodId],
    );
    const r = rows[0] ?? {};
    return {
      employee_count: num(r.employee_count),
      total_gross: num(r.total_gross),
      total_pf: num(r.total_pf),
      total_esi: num(r.total_esi),
      total_pt: num(r.total_pt),
      total_advance: num(r.total_advance),
      total_deductions: num(r.total_deductions),
      total_net: num(r.total_net),
    };
  }

  /**
   * Insert or refresh the computed line for (period, employee).
   *
   * `total_amount` is kept equal to `gross_amount` so existing consumers of the
   * legacy column keep seeing the payable labour value. Recalculating invalidates
   * both verification signatures — numbers changed, so the approvals must be
   * re-obtained. `id = LAST_INSERT_ID(id)` makes `insertId` correct on the
   * update path too, which the advance-recovery rows depend on.
   */
  async upsertComputedLine(line: ComputedSalaryLine, conn: any): Promise<number> {
    const sql = `INSERT INTO salary_lines
        (period_id, employee_id, worker_type, total_cts, total_amount, lots_count,
         paid_days, period_days, present_days, absent_days, leave_days, ot_hours,
         earn_piece, earn_fixed, earn_ot, gross_amount,
         ded_pf, ded_esi, ded_pt, ded_advance, ded_other, total_deductions, net_amount,
         recalculated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         worker_type = VALUES(worker_type),
         total_cts = VALUES(total_cts),
         total_amount = VALUES(total_amount),
         lots_count = VALUES(lots_count),
         paid_days = VALUES(paid_days),
         period_days = VALUES(period_days),
         present_days = VALUES(present_days),
         absent_days = VALUES(absent_days),
         leave_days = VALUES(leave_days),
         ot_hours = VALUES(ot_hours),
         earn_piece = VALUES(earn_piece),
         earn_fixed = VALUES(earn_fixed),
         earn_ot = VALUES(earn_ot),
         gross_amount = VALUES(gross_amount),
         ded_pf = VALUES(ded_pf),
         ded_esi = VALUES(ded_esi),
         ded_pt = VALUES(ded_pt),
         ded_advance = VALUES(ded_advance),
         ded_other = VALUES(ded_other),
         total_deductions = VALUES(total_deductions),
         net_amount = VALUES(net_amount),
         recalculated_at = NOW(),
         updated_by = VALUES(updated_by),
         manager_verified = false,
         manager_verified_by = NULL,
         manager_verified_at = NULL,
         account_verified = false,
         account_verified_by = NULL,
         account_verified_at = NULL,
         paid_at = NULL`;
    const params = [
      line.periodId, line.employeeId, line.workerType, line.totalCts, line.grossAmount, line.lotsCount,
      line.paidDays, line.periodDays, line.presentDays, line.absentDays, line.leaveDays, line.otHours,
      line.earnPiece, line.earnFixed, line.earnOt, line.grossAmount,
      line.dedPf, line.dedEsi, line.dedPt, line.dedAdvance, line.dedOther, line.totalDeductions, line.netAmount,
      line.userId, line.userId,
    ];
    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }

  /** Second pass once advance recovery for a line is known. */
  async updateAdvanceDeduction(
    lineId: number,
    dedAdvance: number,
    totalDeductions: number,
    netAmount: number,
    conn: any,
  ): Promise<void> {
    await conn.query(
      'UPDATE salary_lines SET ded_advance = ?, total_deductions = ?, net_amount = ? WHERE id = ?',
      [dedAdvance, totalDeductions, netAmount, lineId],
    );
  }

  /**
   * Drop lines for employees the recalculation no longer produces (resigned
   * before the window, no earnings at all, …). `salary_lines` has no
   * `deleted_at`, so this is a hard delete; the rows are fully derived data.
   */
  async deleteLinesNotIn(periodId: number, employeeIds: number[], conn: any): Promise<number> {
    const ids = employeeIds
      .map((id) => Math.floor(Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (ids.length === 0) {
      const [result] = await conn.query('DELETE FROM salary_lines WHERE period_id = ?', [periodId]);
      return Number(result.affectedRows ?? 0);
    }
    // IDs are sanitised ints above, so inlining the IN list is safe and avoids
    // a placeholder explosion on large payrolls.
    const [result] = await conn.query(
      `DELETE FROM salary_lines WHERE period_id = ? AND employee_id NOT IN (${ids.join(',')})`,
      [periodId],
    );
    return Number(result.affectedRows ?? 0);
  }

  async managerVerify(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET manager_verified = true, manager_verified_by = ?, manager_verified_at = NOW() WHERE id = ?',
      [userId, id],
    );
  }

  async managerUnverify(id: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET manager_verified = false, manager_verified_by = NULL, manager_verified_at = NULL WHERE id = ?',
      [id],
    );
  }

  async accountVerify(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET account_verified = true, account_verified_by = ?, account_verified_at = NOW(), paid_at = CURDATE() WHERE id = ? AND manager_verified = true',
      [userId, id],
    );
  }

  async accountUnverify(id: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET account_verified = false, account_verified_by = NULL, account_verified_at = NULL, paid_at = NULL WHERE id = ?',
      [id],
    );
  }

  private toExtendedResponse(r: any): SalaryLineExtendedResponse {
    return {
      id: r.id,
      periodId: r.period_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      empCode: r.emp_code,
      whatsapp: r.whatsapp ?? null,
      workerType: r.worker_type ?? null,
      totalCts: num(r.total_cts),
      totalAmount: num(r.total_amount),
      lotsCount: num(r.lots_count),
      paidDays: num(r.paid_days),
      periodDays: num(r.period_days),
      presentDays: num(r.present_days),
      absentDays: num(r.absent_days),
      leaveDays: num(r.leave_days),
      otHours: num(r.ot_hours),
      earnPiece: num(r.earn_piece),
      earnFixed: num(r.earn_fixed),
      earnOt: num(r.earn_ot),
      grossAmount: num(r.gross_amount),
      dedPf: num(r.ded_pf),
      dedEsi: num(r.ded_esi),
      dedPt: num(r.ded_pt),
      dedAdvance: num(r.ded_advance),
      dedOther: num(r.ded_other),
      totalDeductions: num(r.total_deductions),
      netAmount: num(r.net_amount),
      managerVerified: bool(r.manager_verified),
      accountVerified: bool(r.account_verified),
      paidAt: dateOrNull(r.paid_at),
      recalculatedAt: r.recalculated_at ? new Date(r.recalculated_at).toISOString() : null,
    };
  }
}
