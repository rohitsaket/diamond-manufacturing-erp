import { BaseRepository } from './BaseRepository';
import {
  PayrollRunType,
  PayrollRunStatus,
  SalaryLineComponentRow,
  FinalSettlementResult,
} from '../types/payroll';
import { toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

/** The salary period row the engine works against. */
export interface PayrollPeriodRow {
  id: number;
  label: string;
  from_date: string;
  to_date: string;
  status: 'OPEN' | 'LOCKED' | 'PAID';
  cycle_id: number | null;
  currency: string;
  pay_date: string | null;
}

export interface CreateRunInput {
  periodId: number;
  runType: PayrollRunType;
  label?: string | null;
  currency?: string;
  isSimulation: boolean;
  employeeFilter?: unknown;
  totalEmployees?: number;
  userId: number;
}

export interface FinishRunInput {
  status: PayrollRunStatus;
  processedEmployees: number;
  failedEmployees: number;
  totalEmployees: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  durationMs: number;
  errorMessage?: string | null;
  warnings?: string[];
}

/** A salary line ready to be persisted, including the enterprise columns. */
export interface EnterpriseSalaryLine {
  periodId: number;
  runId: number | null;
  employeeId: number;
  workerType: 'PIECE_RATE' | 'DHAR' | 'MAXI' | null;
  structureId: number | null;
  currency: string;
  totalCts: number;
  lotsCount: number;
  paidDays: number;
  periodDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  lopDays: number;
  payableDays: number;
  otHours: number;
  earnPiece: number;
  earnFixed: number;
  earnOt: number;
  earnBonus: number;
  earnIncentive: number;
  earnVariable: number;
  earnArrears: number;
  earnReimbursement: number;
  grossAmount: number;
  taxableIncome: number;
  dedPf: number;
  dedEsi: number;
  dedPt: number;
  dedIncomeTax: number;
  dedLoan: number;
  dedAdvance: number;
  dedLwf: number;
  dedInsurance: number;
  dedOther: number;
  totalDeductions: number;
  netAmount: number;
  employerPf: number;
  employerEsi: number;
  employerCost: number;
  isFinalSettlement: boolean;
  remarks: string | null;
  userId: number;
}

export interface DueLoanInstallment {
  id: number;
  loanId: number;
  employeeId: number;
  seq: number;
  dueDate: string;
  emiAmount: number;
  principalComponent: number;
  interestComponent: number;
  recoveredAmount: number;
}

export interface ActiveAdvanceRow {
  id: number;
  employeeId: number;
  amount: number;
  installmentAmount: number;
  recovered: number;
  outstanding: number;
}

export interface ApprovedAwardRow {
  id: number;
  employeeId: number;
  awardClass: 'BONUS' | 'INCENTIVE' | 'VARIABLE_PAY';
  componentId: number | null;
  title: string;
  amount: number;
  isTaxable: boolean;
}

export interface ApprovedReimbursementRow {
  id: number;
  employeeId: number;
  componentId: number | null;
  claimNo: string;
  amount: number;
  isTaxable: boolean;
}

/**
 * Write side of a payroll run: the run header, its per-employee errors, the
 * salary lines it produces and the component breakdown behind every line.
 *
 * All batch loaders here take the whole window at once so the engine can process
 * 100k employees without a single per-employee query.
 */
export class PayrollRunRepository extends BaseRepository {
  private static idList(ids: number[]): string {
    const clean = ids
      .map((id) => Math.floor(Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);
    return clean.length ? clean.join(',') : '';
  }

  private async run<T = any[]>(sql: string, params: any[], conn?: any): Promise<T> {
    if (conn) {
      const [rows] = await conn.query(sql, params);
      return rows as T;
    }
    return this.query<T>(sql, params);
  }

  /** Public escape hatch so the engine can own its own chunk transactions. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  async getPeriod(periodId: number, conn?: any): Promise<PayrollPeriodRow | null> {
    const rows = await this.run<any[]>(
      'SELECT * FROM salary_periods WHERE id = ? AND deleted_at IS NULL',
      [periodId],
      conn,
    );
    return rows[0] ? this.toPeriod(rows[0]) : null;
  }

  /** Periods that start on or after `fromPeriod` and before `beforeDate`. */
  async getPeriodsInRange(fromDate: string, beforeDate: string): Promise<PayrollPeriodRow[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM salary_periods
       WHERE deleted_at IS NULL AND from_date >= ? AND from_date < ?
       ORDER BY from_date ASC`,
      [fromDate, beforeDate],
    );
    return rows.map((r) => this.toPeriod(r));
  }

  /** The period whose window contains a date (used by final settlement). */
  async getPeriodCovering(date: string): Promise<PayrollPeriodRow | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM salary_periods
       WHERE deleted_at IS NULL AND from_date <= ? AND to_date >= ?
       ORDER BY from_date DESC LIMIT 1`,
      [date, date],
    );
    return rows[0] ? this.toPeriod(rows[0]) : null;
  }

  private toPeriod(r: any): PayrollPeriodRow {
    return {
      id: Number(r.id),
      label: r.label,
      from_date: toDateString(r.from_date),
      to_date: toDateString(r.to_date),
      status: r.status,
      cycle_id: r.cycle_id === null || r.cycle_id === undefined ? null : Number(r.cycle_id),
      currency: r.currency ?? 'INR',
      pay_date: r.pay_date ? toDateString(r.pay_date) : null,
    };
  }

  async getShifts(conn?: any): Promise<{ id: number; week_off_day: number; is_default: number | boolean }[]> {
    return this.run(
      'SELECT id, week_off_day, is_default FROM shifts WHERE deleted_at IS NULL',
      [],
      conn,
    );
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  /**
   * A non-simulation run already executing against this period. Two concurrent
   * runs would double-recover advances and race on the same salary lines.
   */
  async findActiveRun(periodId: number): Promise<{ id: number; run_type: string } | null> {
    const rows = await this.query<any[]>(
      `SELECT id, run_type FROM payroll_runs
       WHERE period_id = ? AND status = 'RUNNING' AND is_simulation = false AND deleted_at IS NULL
       LIMIT 1`,
      [periodId],
    );
    return rows[0] ?? null;
  }

  async createRun(input: CreateRunInput): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO payroll_runs
        (period_id, run_type, status, label, currency, is_simulation, employee_filter_json,
         total_employees, started_at, created_by, updated_by)
       VALUES (?, ?, 'RUNNING', ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [
        input.periodId,
        input.runType,
        input.label ?? null,
        input.currency ?? 'INR',
        input.isSimulation,
        input.employeeFilter ? JSON.stringify(input.employeeFilter) : null,
        input.totalEmployees ?? 0,
        input.userId,
        input.userId,
      ],
    );
    return Number(result.insertId);
  }

  async setRunTotalEmployees(runId: number, total: number): Promise<void> {
    await this.query('UPDATE payroll_runs SET total_employees = ? WHERE id = ?', [total, runId]);
  }

  /** Progress is written after each chunk so a long run is observable live. */
  async updateRunProgress(runId: number, processed: number, failed: number): Promise<void> {
    await this.query(
      'UPDATE payroll_runs SET processed_employees = ?, failed_employees = ? WHERE id = ?',
      [processed, failed, runId],
    );
  }

  async finishRun(runId: number, input: FinishRunInput): Promise<void> {
    await this.query(
      `UPDATE payroll_runs
       SET status = ?, total_employees = ?, processed_employees = ?, failed_employees = ?,
           total_gross = ?, total_deductions = ?, total_net = ?, total_employer_cost = ?,
           finished_at = NOW(), duration_ms = ?, error_message = ?, warnings_json = ?
       WHERE id = ?`,
      [
        input.status,
        input.totalEmployees,
        input.processedEmployees,
        input.failedEmployees,
        input.totalGross,
        input.totalDeductions,
        input.totalNet,
        input.totalEmployerCost,
        input.durationMs,
        input.errorMessage ? String(input.errorMessage).slice(0, 1000) : null,
        input.warnings && input.warnings.length ? JSON.stringify(input.warnings.slice(0, 500)) : null,
        runId,
      ],
    );
  }

  async failRun(runId: number, message: string, durationMs: number): Promise<void> {
    await this.query(
      `UPDATE payroll_runs
       SET status = 'FAILED', finished_at = NOW(), duration_ms = ?, error_message = ?
       WHERE id = ?`,
      [durationMs, String(message).slice(0, 1000), runId],
    );
  }

  async recordRunError(
    runId: number,
    employeeId: number | null,
    code: string,
    message: string,
    severity: 'WARNING' | 'ERROR' = 'ERROR',
  ): Promise<void> {
    await this.query(
      `INSERT INTO payroll_run_errors (run_id, employee_id, severity, code, message)
       VALUES (?, ?, ?, ?, ?)`,
      [runId, employeeId, severity, code.slice(0, 60), String(message).slice(0, 1000)],
    );
  }

  async getRun(runId: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM payroll_runs WHERE id = ?', [runId]);
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Salary lines
  // -------------------------------------------------------------------------

  /**
   * Insert or refresh one salary line, including every enterprise column.
   *
   * `total_amount` is kept equal to `gross_amount` so the legacy consumers of
   * that column keep working. Both verification signatures are cleared because
   * the numbers just changed. `id = LAST_INSERT_ID(id)` makes `insertId` correct
   * on the update path too, which the component rows and recovery rows depend on.
   */
  async upsertSalaryLine(line: EnterpriseSalaryLine, conn: any): Promise<number> {
    const sql = `INSERT INTO salary_lines
        (period_id, run_id, employee_id, worker_type, structure_id, currency,
         total_cts, total_amount, lots_count,
         paid_days, period_days, present_days, absent_days, leave_days, lop_days, payable_days, ot_hours,
         earn_piece, earn_fixed, earn_ot, earn_bonus, earn_incentive, earn_variable, earn_arrears,
         earn_reimbursement, gross_amount, taxable_income,
         ded_pf, ded_esi, ded_pt, ded_income_tax, ded_loan, ded_advance, ded_lwf, ded_insurance, ded_other,
         total_deductions, net_amount,
         employer_pf, employer_esi, employer_cost,
         is_final_settlement, remarks, recalculated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         run_id = VALUES(run_id),
         worker_type = VALUES(worker_type),
         structure_id = VALUES(structure_id),
         currency = VALUES(currency),
         total_cts = VALUES(total_cts),
         total_amount = VALUES(total_amount),
         lots_count = VALUES(lots_count),
         paid_days = VALUES(paid_days),
         period_days = VALUES(period_days),
         present_days = VALUES(present_days),
         absent_days = VALUES(absent_days),
         leave_days = VALUES(leave_days),
         lop_days = VALUES(lop_days),
         payable_days = VALUES(payable_days),
         ot_hours = VALUES(ot_hours),
         earn_piece = VALUES(earn_piece),
         earn_fixed = VALUES(earn_fixed),
         earn_ot = VALUES(earn_ot),
         earn_bonus = VALUES(earn_bonus),
         earn_incentive = VALUES(earn_incentive),
         earn_variable = VALUES(earn_variable),
         earn_arrears = VALUES(earn_arrears),
         earn_reimbursement = VALUES(earn_reimbursement),
         gross_amount = VALUES(gross_amount),
         taxable_income = VALUES(taxable_income),
         ded_pf = VALUES(ded_pf),
         ded_esi = VALUES(ded_esi),
         ded_pt = VALUES(ded_pt),
         ded_income_tax = VALUES(ded_income_tax),
         ded_loan = VALUES(ded_loan),
         ded_advance = VALUES(ded_advance),
         ded_lwf = VALUES(ded_lwf),
         ded_insurance = VALUES(ded_insurance),
         ded_other = VALUES(ded_other),
         total_deductions = VALUES(total_deductions),
         net_amount = VALUES(net_amount),
         employer_pf = VALUES(employer_pf),
         employer_esi = VALUES(employer_esi),
         employer_cost = VALUES(employer_cost),
         is_final_settlement = VALUES(is_final_settlement),
         remarks = VALUES(remarks),
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
      line.periodId, line.runId, line.employeeId, line.workerType, line.structureId, line.currency,
      line.totalCts, line.grossAmount, line.lotsCount,
      line.paidDays, line.periodDays, line.presentDays, line.absentDays, line.leaveDays,
      line.lopDays, line.payableDays, line.otHours,
      line.earnPiece, line.earnFixed, line.earnOt, line.earnBonus, line.earnIncentive,
      line.earnVariable, line.earnArrears, line.earnReimbursement, line.grossAmount, line.taxableIncome,
      line.dedPf, line.dedEsi, line.dedPt, line.dedIncomeTax, line.dedLoan, line.dedAdvance,
      line.dedLwf, line.dedInsurance, line.dedOther,
      line.totalDeductions, line.netAmount,
      line.employerPf, line.employerEsi, line.employerCost,
      line.isFinalSettlement, line.remarks,
      line.userId, line.userId,
    ];

    const [result] = await conn.query(sql, params);
    return Number(result.insertId);
  }

  /**
   * Replace a line's component breakdown.
   *
   * Old rows are deleted first, so re-running a period is idempotent instead of
   * appending a second copy of every component.
   */
  async replaceLineComponents(
    salaryLineId: number,
    components: SalaryLineComponentRow[],
    conn: any,
  ): Promise<void> {
    await conn.query('DELETE FROM salary_line_components WHERE salary_line_id = ?', [salaryLineId]);
    if (components.length === 0) return;

    const values: any[] = [];
    const placeholders: string[] = [];
    for (const c of components) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        salaryLineId,
        c.componentId,
        c.componentCode.slice(0, 40),
        c.componentName.slice(0, 160),
        c.componentType,
        c.category ? String(c.category).slice(0, 40) : null,
        c.amount,
        c.baseAmount,
        c.percentApplied,
        c.isTaxable,
        c.isProrated,
        c.displayOrder,
      );
    }

    await conn.query(
      `INSERT INTO salary_line_components
        (salary_line_id, component_id, component_code, component_name, component_type, category,
         amount, base_amount, percent_applied, is_taxable, is_prorated, display_order)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  /** Existing gross per employee for a period, used to size a retro correction. */
  async getGrossByEmployee(periodId: number, employeeIds?: number[]): Promise<Map<number, number>> {
    let sql = 'SELECT employee_id, gross_amount FROM salary_lines WHERE period_id = ?';
    if (employeeIds && employeeIds.length > 0) {
      const list = PayrollRunRepository.idList(employeeIds);
      if (!list) return new Map();
      sql += ` AND employee_id IN (${list})`;
    }
    const rows = await this.query<any[]>(sql, [periodId]);
    const map = new Map<number, number>();
    for (const r of rows) map.set(Number(r.employee_id), num(r.gross_amount));
    return map;
  }

  // -------------------------------------------------------------------------
  // Variable pay, loans, advances and reimbursements
  // -------------------------------------------------------------------------

  async getApprovedAwards(periodId: number, conn?: any): Promise<ApprovedAwardRow[]> {
    const rows = await this.run<any[]>(
      `SELECT id, employee_id, award_class, component_id, title, amount, is_taxable
       FROM pay_awards
       WHERE payout_period_id = ? AND status = 'APPROVED' AND deleted_at IS NULL`,
      [periodId],
      conn,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      awardClass: r.award_class,
      componentId: r.component_id === null ? null : Number(r.component_id),
      title: r.title,
      amount: num(r.amount),
      isTaxable: r.is_taxable === 1 || r.is_taxable === true,
    }));
  }

  async getApprovedReimbursements(periodId: number, conn?: any): Promise<ApprovedReimbursementRow[]> {
    const rows = await this.run<any[]>(
      `SELECT rc.id, rc.employee_id, rc.claim_no,
              COALESCE(rc.approved_amount, rc.amount) AS amount,
              rt.component_id, rt.is_taxable
       FROM reimbursement_claims rc
       JOIN reimbursement_types rt ON rt.id = rc.type_id
       WHERE rc.payout_period_id = ? AND rc.status = 'APPROVED' AND rc.deleted_at IS NULL`,
      [periodId],
      conn,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      componentId: r.component_id === null ? null : Number(r.component_id),
      claimNo: r.claim_no,
      amount: num(r.amount),
      isTaxable: r.is_taxable === 1 || r.is_taxable === true,
    }));
  }

  /**
   * Installments due on or before the period end for loans that are still live.
   * Only PENDING rows qualify, so an installment already recovered in an earlier
   * period can never be taken twice.
   */
  async getDueLoanInstallments(dueOnOrBefore: string, employeeIds?: number[], conn?: any): Promise<DueLoanInstallment[]> {
    let sql = `SELECT li.id, li.loan_id, li.seq, li.due_date, li.emi_amount,
                      li.principal_component, li.interest_component, li.recovered_amount,
                      l.employee_id
               FROM loan_installments li
               JOIN employee_loans l ON l.id = li.loan_id
               WHERE li.status = 'PENDING' AND li.due_date <= ?
                 AND l.status = 'ACTIVE' AND l.deleted_at IS NULL`;
    if (employeeIds && employeeIds.length > 0) {
      const list = PayrollRunRepository.idList(employeeIds);
      if (!list) return [];
      sql += ` AND l.employee_id IN (${list})`;
    }
    sql += ' ORDER BY l.employee_id ASC, li.due_date ASC, li.seq ASC';

    const rows = await this.run<any[]>(sql, [dueOnOrBefore], conn);
    return rows.map((r) => ({
      id: Number(r.id),
      loanId: Number(r.loan_id),
      employeeId: Number(r.employee_id),
      seq: Number(r.seq),
      dueDate: toDateString(r.due_date),
      emiAmount: num(r.emi_amount),
      principalComponent: num(r.principal_component),
      interestComponent: num(r.interest_component),
      recoveredAmount: num(r.recovered_amount),
    }));
  }

  /**
   * Undo the loan recoveries a previous run of this period posted, so a re-run
   * recomputes them from scratch instead of skipping already-RECOVERED rows.
   */
  async resetLoanInstallmentsForPeriod(periodId: number, employeeIds: number[] | null, conn: any): Promise<number> {
    let sql = `UPDATE loan_installments li
               JOIN employee_loans l ON l.id = li.loan_id
               SET li.status = 'PENDING', li.recovered_amount = 0, li.recovered_on = NULL,
                   li.salary_line_id = NULL, li.period_id = NULL
               WHERE li.period_id = ? AND li.status = 'RECOVERED'`;
    if (employeeIds && employeeIds.length > 0) {
      const list = PayrollRunRepository.idList(employeeIds);
      if (!list) return 0;
      sql += ` AND l.employee_id IN (${list})`;
    }
    const [result] = await conn.query(sql, [periodId]);
    return Number(result.affectedRows ?? 0);
  }

  async markInstallmentRecovered(
    installmentId: number,
    amount: number,
    recoveredOn: string,
    salaryLineId: number,
    periodId: number,
    conn: any,
  ): Promise<void> {
    await conn.query(
      `UPDATE loan_installments
       SET status = 'RECOVERED', recovered_amount = ?, recovered_on = ?, salary_line_id = ?, period_id = ?
       WHERE id = ?`,
      [amount, recoveredOn, salaryLineId, periodId, installmentId],
    );
  }

  /** Close loans whose installments are all settled. */
  async closeSettledLoans(loanIds: number[], conn: any): Promise<void> {
    const list = PayrollRunRepository.idList(loanIds);
    if (!list) return;
    await conn.query(
      `UPDATE employee_loans l
       SET l.status = 'CLOSED', l.closed_at = NOW()
       WHERE l.id IN (${list}) AND l.status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM loan_installments li
           WHERE li.loan_id = l.id AND li.status = 'PENDING'
         )`,
    );
  }

  /** Outstanding principal on a live loan, for a final settlement recovery. */
  async getOutstandingLoans(employeeId: number): Promise<{ loanId: number; outstanding: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT l.id AS loan_id,
              COALESCE(SUM(CASE WHEN li.status = 'PENDING' THEN li.emi_amount ELSE 0 END), 0) AS outstanding
       FROM employee_loans l
       LEFT JOIN loan_installments li ON li.loan_id = l.id
       WHERE l.employee_id = ? AND l.status = 'ACTIVE' AND l.deleted_at IS NULL
       GROUP BY l.id`,
      [employeeId],
    );
    return rows.map((r) => ({ loanId: Number(r.loan_id), outstanding: num(r.outstanding) }));
  }

  /** All open advances with their outstanding balance, one query for everybody. */
  async getActiveAdvances(employeeIds?: number[], conn?: any): Promise<ActiveAdvanceRow[]> {
    const recovered = `COALESCE((SELECT SUM(r.amount) FROM advance_recoveries r WHERE r.advance_id = a.id), 0)`;
    let sql = `SELECT a.id, a.employee_id, a.amount, a.installment_amount, ${recovered} AS recovered
               FROM advances a
               WHERE a.status = 'ACTIVE' AND a.deleted_at IS NULL AND ${recovered} < a.amount`;
    if (employeeIds && employeeIds.length > 0) {
      const list = PayrollRunRepository.idList(employeeIds);
      if (!list) return [];
      sql += ` AND a.employee_id IN (${list})`;
    }
    sql += ' ORDER BY a.employee_id ASC, a.advance_date ASC, a.id ASC';

    const rows = await this.run<any[]>(sql, [], conn);
    return rows.map((r) => {
      const amount = num(r.amount);
      const rec = num(r.recovered);
      return {
        id: Number(r.id),
        employeeId: Number(r.employee_id),
        amount,
        installmentAmount: num(r.installment_amount),
        recovered: rec,
        outstanding: Math.round((amount - rec) * 100) / 100,
      };
    });
  }

  /**
   * Clear machine-generated advance recoveries so a re-run cannot double-count.
   * MANUAL recoveries are somebody's cash receipt and always survive.
   */
  async deletePayrollAdvanceRecoveries(periodId: number, employeeIds: number[] | null, conn: any): Promise<number> {
    let sql = `DELETE ar FROM advance_recoveries ar
               JOIN advances a ON a.id = ar.advance_id
               WHERE ar.period_id = ? AND ar.source = 'PAYROLL'`;
    if (employeeIds && employeeIds.length > 0) {
      const list = PayrollRunRepository.idList(employeeIds);
      if (!list) return 0;
      sql += ` AND a.employee_id IN (${list})`;
    }
    const [result] = await conn.query(sql, [periodId]);
    return Number(result.affectedRows ?? 0);
  }

  // -------------------------------------------------------------------------
  // Leave balances and settlements
  // -------------------------------------------------------------------------

  /** Encashable balance: allocated minus used on paid leave types. */
  async getEncashableLeaveDays(employeeId: number, year: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(GREATEST(lb.allocated - lb.used, 0)), 0) AS balance
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
       WHERE lb.employee_id = ? AND lb.year = ? AND lt.is_paid = true AND lt.deleted_at IS NULL`,
      [employeeId, year],
    );
    return num(rows[0]?.balance);
  }

  async insertFinalSettlement(
    result: FinalSettlementResult,
    settlementType: string,
    userId: number,
  ): Promise<number> {
    const inserted = await this.query<any>(
      `INSERT INTO final_settlements
        (employee_id, settlement_type, last_working_date, notice_period_days, notice_served_days,
         notice_shortfall_days, currency, pending_salary, leave_encashment_days, leave_encashment_amount,
         gratuity_years, gratuity_amount, bonus_payable, other_earnings, notice_recovery, loan_recovery,
         advance_recovery, asset_recovery, tax_deduction, other_deductions, gross_payable, total_recovery,
         net_settlement, status, remarks, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CALCULATED', ?, ?, ?)`,
      [
        result.employeeId,
        settlementType,
        result.lastWorkingDate,
        result.noticePeriodDays,
        result.noticeServedDays,
        result.noticeShortfallDays,
        result.pendingSalary,
        result.leaveEncashmentDays,
        result.leaveEncashmentAmount,
        result.gratuityYears,
        result.gratuityAmount,
        result.bonusPayable,
        result.otherEarnings,
        result.noticeRecovery,
        result.loanRecovery,
        result.advanceRecovery,
        result.assetRecovery,
        result.taxDeduction,
        result.otherDeductions,
        result.grossPayable,
        result.totalRecovery,
        result.netSettlement,
        result.warnings.length ? result.warnings.join(' | ').slice(0, 1000) : null,
        userId,
        userId,
      ],
    );
    return Number(inserted.insertId);
  }
}
