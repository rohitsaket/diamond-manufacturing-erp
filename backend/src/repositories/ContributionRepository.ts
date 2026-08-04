import { BaseRepository } from './BaseRepository';
import {
  ContributionRecord,
  ContributionRowInput,
  ContributionScheme,
  GratuityProvision,
  LedgerFilters,
  PfAccountEntry,
  SchemeSummary,
} from '../types/compliance';
import { round2, toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

/** One salary line with everything the contribution engine needs, in one row. */
export interface LedgerSourceRow {
  salaryLineId: number;
  employeeId: number;
  runId: number | null;
  empCode: string;
  fullName: string;
  gender: string | null;
  workerType: string | null;
  workStatus: string;
  /** `gross_amount`, or the legacy `total_amount` mirror when gross is zero. */
  grossAmount: number;
  /** True when the legacy fallback above was used, so callers can warn once. */
  grossFromLegacyTotal: boolean;
  paidDays: number;
  periodDays: number;
  incomeTax: number;
  uan: string | null;
  pan: string | null;
  esiIpNumber: string | null;
  pfStatus: string | null;
  esiStatus: string | null;
  vpfPercent: number;
  epsApplicable: boolean;
  ptStateCode: string | null;
  lwfStateCode: string | null;
}

/** Everything a register, muster roll or Form 24Q row needs from one payslip. */
export interface SalaryLineDetailRow {
  salaryLineId: number;
  periodId: number;
  periodLabel: string;
  monthKey: string;
  fromDate: string;
  toDate: string;
  employeeId: number;
  empCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  workerType: string | null;
  gender: string | null;
  joinedAt: string;
  pan: string | null;
  uan: string | null;
  esiIpNumber: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  periodDays: number;
  paidDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  lopDays: number;
  otHours: number;
  grossAmount: number;
  earnPiece: number;
  earnFixed: number;
  earnOt: number;
  earnBonus: number;
  earnIncentive: number;
  dedPf: number;
  dedEsi: number;
  dedPt: number;
  dedIncomeTax: number;
  dedAdvance: number;
  dedLwf: number;
  dedOther: number;
  totalDeductions: number;
  netAmount: number;
}

export interface PeriodRow {
  id: number;
  label: string;
  fromDate: string;
  toDate: string;
  status: string;
}

export interface GratuityCandidate {
  employeeId: number;
  empCode: string;
  fullName: string;
  workerType: string | null;
  joinedAt: string;
  monthlySalary: number | null;
  gratuityEligible: boolean;
}

export interface PfEntryInput {
  employeeId: number;
  financialYear: string;
  monthKey: string | null;
  entryType: 'CONTRIBUTION' | 'INTEREST' | 'TRANSFER_IN' | 'WITHDRAWAL' | 'ADJUSTMENT';
  employeeShare: number;
  employerShare: number;
  pensionShare: number;
  vpfShare: number;
  interestRatePct: number | null;
  closingBalance: number;
  entryDate: string;
  reference: string | null;
  remarks: string | null;
}

/** Sanitise an id list for the inline `IN (...)` clauses this file uses. */
function idList(ids: number[]): string {
  const clean = ids
    .map((id) => Math.floor(Number(id)))
    .filter((id) => Number.isFinite(id) && id > 0);
  return clean.length ? clean.join(',') : '';
}

/** Sanitise a scheme list for an inline `IN ('PF','EPS')` clause. */
function schemeList(schemes: string[]): string {
  const allowed = new Set(['PF', 'EPS', 'EDLI', 'ESI', 'PT', 'LWF', 'TDS', 'VPF']);
  const clean = schemes.map((s) => String(s).toUpperCase()).filter((s) => allowed.has(s));
  return clean.length ? clean.map((s) => `'${s}'`).join(',') : '';
}

/**
 * The contribution ledger, gratuity provisions and the PF passbook.
 *
 * `statutory_contributions` is the single source every register, challan and
 * return is built from, so writes go through `upsertContribution` and its unique
 * key `(employee_id, period_id, scheme)` — rebuilding a period updates rows in
 * place instead of duplicating them.
 */
export class ContributionRepository extends BaseRepository {
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // =========================================================================
  // Source data
  // =========================================================================

  async findPeriod(periodId: number, conn?: any): Promise<PeriodRow | null> {
    const sql = 'SELECT id, label, from_date, to_date, status FROM salary_periods WHERE id = ? AND deleted_at IS NULL';
    const rows = conn
      ? ((await conn.query(sql, [periodId]))[0] as any[])
      : await this.query<any[]>(sql, [periodId]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      label: String(r.label),
      fromDate: toDateString(r.from_date),
      toDate: toDateString(r.to_date),
      status: String(r.status),
    };
  }

  /** Period covering a `YYYY-MM` month, matched on the period end date. */
  async findPeriodByMonth(monthKey: string): Promise<PeriodRow | null> {
    const rows = await this.query<any[]>(
      `SELECT id, label, from_date, to_date, status FROM salary_periods
       WHERE deleted_at IS NULL AND DATE_FORMAT(to_date, '%Y-%m') = ?
       ORDER BY id DESC LIMIT 1`,
      [monthKey],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      label: String(r.label),
      fromDate: toDateString(r.from_date),
      toDate: toDateString(r.to_date),
      status: String(r.status),
    };
  }

  /**
   * One chunk of salary lines for a period, joined to the employee and their
   * statutory enrolment.
   *
   * `gross_amount` is the component-engine figure. Rows written by the legacy
   * piece-rate importer carry the same value in `total_amount` and leave
   * `gross_amount` at zero (migration 020 documents the two as equal), so the
   * mirror is used when gross is zero and the substitution is flagged rather
   * than made silently.
   */
  async findLedgerSource(
    periodId: number,
    limit: number,
    offset: number,
    employeeIds?: number[],
    conn?: any,
  ): Promise<LedgerSourceRow[]> {
    const safeLimit = Math.min(2000, Math.max(1, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    let sql = `SELECT sl.id AS salary_line_id, sl.employee_id, sl.run_id, sl.gross_amount, sl.total_amount,
                      sl.paid_days, sl.period_days, sl.ded_income_tax,
                      e.emp_code, e.full_name, e.gender, e.worker_type, e.work_status,
                      es.uan, es.pan, es.esi_ip_number, es.pf_status, es.esi_status,
                      es.vpf_percent, es.eps_applicable, es.pt_state_code, es.lwf_state_code
               FROM salary_lines sl
               JOIN employees e ON e.id = sl.employee_id
               LEFT JOIN employee_statutory es ON es.employee_id = sl.employee_id
               WHERE sl.period_id = ? AND e.deleted_at IS NULL`;
    const params: any[] = [periodId];
    if (employeeIds && employeeIds.length > 0) {
      const list = idList(employeeIds);
      if (!list) return [];
      sql += ` AND sl.employee_id IN (${list})`;
    }
    sql += ` ORDER BY sl.employee_id ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const rows = conn ? ((await conn.query(sql, params))[0] as any[]) : await this.query<any[]>(sql, params);
    return rows.map((r) => {
      const gross = num(r.gross_amount);
      const legacy = num(r.total_amount);
      const useLegacy = gross <= 0 && legacy > 0;
      return {
        salaryLineId: Number(r.salary_line_id),
        employeeId: Number(r.employee_id),
        runId: r.run_id === null ? null : Number(r.run_id),
        empCode: String(r.emp_code),
        fullName: String(r.full_name),
        gender: r.gender ?? null,
        workerType: r.worker_type ?? null,
        workStatus: String(r.work_status),
        grossAmount: round2(useLegacy ? legacy : gross),
        grossFromLegacyTotal: useLegacy,
        paidDays: num(r.paid_days),
        periodDays: num(r.period_days),
        incomeTax: num(r.ded_income_tax),
        uan: r.uan ?? null,
        pan: r.pan ?? null,
        esiIpNumber: r.esi_ip_number ?? null,
        pfStatus: r.pf_status ?? null,
        esiStatus: r.esi_status ?? null,
        vpfPercent: num(r.vpf_percent),
        epsApplicable: r.eps_applicable === null || r.eps_applicable === undefined ? true : !!r.eps_applicable,
        ptStateCode: r.pt_state_code ?? null,
        lwfStateCode: r.lwf_state_code ?? null,
      };
    });
  }

  async countLedgerSource(periodId: number, employeeIds?: number[], conn?: any): Promise<number> {
    let sql = `SELECT COUNT(*) AS n FROM salary_lines sl
               JOIN employees e ON e.id = sl.employee_id
               WHERE sl.period_id = ? AND e.deleted_at IS NULL`;
    const params: any[] = [periodId];
    if (employeeIds && employeeIds.length > 0) {
      const list = idList(employeeIds);
      if (!list) return 0;
      sql += ` AND sl.employee_id IN (${list})`;
    }
    const rows = conn ? ((await conn.query(sql, params))[0] as any[]) : await this.query<any[]>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * PF-applicable earnings per salary line, summed from the components flagged
   * `is_pf_applicable`. Lines with no component breakdown are simply absent from
   * the map and the caller falls back to gross.
   */
  async findPfApplicableWages(salaryLineIds: number[], conn?: any): Promise<Map<number, number>> {
    const list = idList(salaryLineIds);
    const map = new Map<number, number>();
    if (!list) return map;
    const sql = `SELECT slc.salary_line_id, SUM(slc.amount) AS pf_wage
                 FROM salary_line_components slc
                 JOIN pay_components pc ON pc.id = slc.component_id
                 WHERE slc.salary_line_id IN (${list})
                   AND slc.component_type = 'EARNING'
                   AND pc.is_pf_applicable = true
                   AND pc.deleted_at IS NULL
                 GROUP BY slc.salary_line_id`;
    const rows = conn ? ((await conn.query(sql, []))[0] as any[]) : await this.query<any[]>(sql, []);
    for (const r of rows) map.set(Number(r.salary_line_id), round2(num(r.pf_wage)));
    return map;
  }

  // =========================================================================
  // Ledger writes
  // =========================================================================

  /**
   * Rows already attached to a challan, or paid/filed/reconciled.
   *
   * A rebuild must never move a figure that has been remitted or returned, so
   * the service leaves these alone and reports them.
   */
  async findLockedContributions(periodId: number, conn?: any): Promise<{ employeeId: number; scheme: string; status: string }[]> {
    const sql = `SELECT employee_id, scheme, status FROM statutory_contributions
                 WHERE period_id = ? AND (status <> 'COMPUTED' OR challan_id IS NOT NULL)`;
    const rows = conn ? ((await conn.query(sql, [periodId]))[0] as any[]) : await this.query<any[]>(sql, [periodId]);
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      scheme: String(r.scheme),
      status: String(r.status),
    }));
  }

  async upsertContribution(conn: any, row: ContributionRowInput): Promise<void> {
    await conn.query(
      `INSERT INTO statutory_contributions
        (employee_id, period_id, salary_line_id, run_id, scheme, financial_year, month_key, state_code,
         wage_base, uncapped_wage, employee_amount, employer_amount, admin_charges, total_amount,
         rate_applied, ncp_days, paid_days, status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPUTED', ?)
       ON DUPLICATE KEY UPDATE
         salary_line_id = VALUES(salary_line_id),
         run_id = VALUES(run_id),
         financial_year = VALUES(financial_year),
         month_key = VALUES(month_key),
         state_code = VALUES(state_code),
         wage_base = VALUES(wage_base),
         uncapped_wage = VALUES(uncapped_wage),
         employee_amount = VALUES(employee_amount),
         employer_amount = VALUES(employer_amount),
         admin_charges = VALUES(admin_charges),
         total_amount = VALUES(total_amount),
         rate_applied = VALUES(rate_applied),
         ncp_days = VALUES(ncp_days),
         paid_days = VALUES(paid_days),
         status = 'COMPUTED',
         remarks = VALUES(remarks)`,
      [
        row.employeeId,
        row.periodId,
        row.salaryLineId,
        row.runId,
        row.scheme,
        row.financialYear,
        row.monthKey,
        row.stateCode,
        row.wageBase,
        row.uncappedWage,
        row.employeeAmount,
        row.employerAmount,
        row.adminCharges,
        row.totalAmount,
        row.rateApplied,
        row.ncpDays,
        row.paidDays,
        row.remarks,
      ],
    );
  }

  /**
   * Drop rows for schemes that no longer apply to these employees, so a rebuild
   * after (say) an ESI opt-out does not leave a stale contribution behind.
   * Rows already attached to a challan are protected by the WHERE clause.
   */
  async deleteSchemesNotIn(
    conn: any,
    periodId: number,
    employeeIds: number[],
    keepSchemes: ContributionScheme[],
  ): Promise<number> {
    const ids = idList(employeeIds);
    if (!ids) return 0;
    const keep = schemeList(keepSchemes);
    let sql = `DELETE FROM statutory_contributions
               WHERE period_id = ? AND employee_id IN (${ids})
                 AND status = 'COMPUTED' AND challan_id IS NULL`;
    if (keep) sql += ` AND scheme NOT IN (${keep})`;
    const [result] = await conn.query(sql, [periodId]);
    return Number((result as any)?.affectedRows ?? 0);
  }

  // =========================================================================
  // Ledger reads
  // =========================================================================

  async findContributions(filters: LedgerFilters): Promise<ContributionRecord[]> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.periodId) { where.push('c.period_id = ?'); params.push(filters.periodId); }
    if (filters.scheme) { where.push('c.scheme = ?'); params.push(filters.scheme); }
    if (filters.financialYear) { where.push('c.financial_year = ?'); params.push(filters.financialYear); }
    if (filters.monthKey) { where.push('c.month_key = ?'); params.push(filters.monthKey); }
    if (filters.employeeId) { where.push('c.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.status) { where.push('c.status = ?'); params.push(filters.status); }
    if (filters.stateCode) { where.push('c.state_code = ?'); params.push(filters.stateCode); }

    const limit = Math.min(20000, Math.max(1, Math.floor(Number(filters.limit) || 1000)));
    const rows = await this.query<any[]>(
      `SELECT c.*, e.emp_code, e.full_name, es.uan, es.esi_ip_number
       FROM statutory_contributions c
       JOIN employees e ON e.id = c.employee_id
       LEFT JOIN employee_statutory es ON es.employee_id = c.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.period_id DESC, c.scheme ASC, e.emp_code ASC
       LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => this.toContribution(r));
  }

  /** Contribution rows for a scheme set in a month; the challan aggregator's input. */
  async findContributionsForMonth(
    monthKey: string,
    schemes: ContributionScheme[],
    stateCode?: string | null,
    onlyUnchallaned = false,
  ): Promise<ContributionRecord[]> {
    const list = schemeList(schemes);
    if (!list) return [];
    let sql = `SELECT c.*, e.emp_code, e.full_name, es.uan, es.esi_ip_number
               FROM statutory_contributions c
               JOIN employees e ON e.id = c.employee_id
               LEFT JOIN employee_statutory es ON es.employee_id = c.employee_id
               WHERE c.month_key = ? AND c.scheme IN (${list})`;
    const params: any[] = [monthKey];
    if (stateCode) {
      sql += ' AND c.state_code = ?';
      params.push(stateCode);
    }
    if (onlyUnchallaned) sql += ' AND c.challan_id IS NULL';
    sql += ' ORDER BY e.emp_code ASC, c.scheme ASC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toContribution(r));
  }

  /** Contribution rows attached to one challan. */
  async findContributionsByChallan(challanId: number): Promise<ContributionRecord[]> {
    const rows = await this.query<any[]>(
      `SELECT c.*, e.emp_code, e.full_name, es.uan, es.esi_ip_number
       FROM statutory_contributions c
       JOIN employees e ON e.id = c.employee_id
       LEFT JOIN employee_statutory es ON es.employee_id = c.employee_id
       WHERE c.challan_id = ?
       ORDER BY e.emp_code ASC, c.scheme ASC`,
      [challanId],
    );
    return rows.map((r) => this.toContribution(r));
  }

  /** Contribution totals for a financial year, per employee and scheme. */
  async findYearlyTotals(
    financialYear: string,
    schemes: ContributionScheme[],
    employeeIds?: number[],
  ): Promise<{ employeeId: number; scheme: string; employeeAmount: number; employerAmount: number }[]> {
    const list = schemeList(schemes);
    if (!list) return [];
    let sql = `SELECT employee_id, scheme,
                      COALESCE(SUM(employee_amount), 0) AS employee_amount,
                      COALESCE(SUM(employer_amount), 0) AS employer_amount
               FROM statutory_contributions
               WHERE financial_year = ? AND scheme IN (${list})`;
    const params: any[] = [financialYear];
    if (employeeIds && employeeIds.length > 0) {
      const ids = idList(employeeIds);
      if (!ids) return [];
      sql += ` AND employee_id IN (${ids})`;
    }
    sql += ' GROUP BY employee_id, scheme';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      scheme: String(r.scheme),
      employeeAmount: round2(num(r.employee_amount)),
      employerAmount: round2(num(r.employer_amount)),
    }));
  }

  async summaryByScheme(periodId: number): Promise<SchemeSummary[]> {
    const rows = await this.query<any[]>(
      `SELECT scheme,
              COUNT(DISTINCT employee_id) AS employee_count,
              COALESCE(SUM(employee_amount), 0) AS employee_amount,
              COALESCE(SUM(employer_amount), 0) AS employer_amount,
              COALESCE(SUM(admin_charges), 0) AS admin_charges,
              COALESCE(SUM(total_amount), 0) AS total
       FROM statutory_contributions
       WHERE period_id = ?
       GROUP BY scheme
       ORDER BY scheme ASC`,
      [periodId],
    );
    return rows.map((r) => ({
      scheme: r.scheme as ContributionScheme,
      employeeCount: Number(r.employee_count),
      employeeAmount: round2(num(r.employee_amount)),
      employerAmount: round2(num(r.employer_amount)),
      adminCharges: round2(num(r.admin_charges)),
      total: round2(num(r.total)),
    }));
  }

  /** Attach a set of contribution rows to a challan. */
  async attachToChallan(
    conn: any,
    challanId: number,
    contributionIds: number[],
  ): Promise<number> {
    const ids = idList(contributionIds);
    if (!ids) return 0;
    const [result] = await conn.query(
      `UPDATE statutory_contributions SET challan_id = ?, status = 'CHALLAN_GENERATED' WHERE id IN (${ids})`,
      [challanId],
    );
    return Number((result as any)?.affectedRows ?? 0);
  }

  async setStatusForChallan(challanId: number, status: string, conn?: any): Promise<void> {
    const sql = 'UPDATE statutory_contributions SET status = ? WHERE challan_id = ?';
    if (conn) await conn.query(sql, [status, challanId]);
    else await this.query(sql, [status, challanId]);
  }

  /** Release rows from a cancelled challan back to COMPUTED. */
  async detachFromChallan(conn: any, challanId: number): Promise<void> {
    await conn.query(
      `UPDATE statutory_contributions SET challan_id = NULL, status = 'COMPUTED' WHERE challan_id = ?`,
      [challanId],
    );
  }

  async setFilingForContributions(filingId: number, contributionIds: number[]): Promise<void> {
    const ids = idList(contributionIds);
    if (!ids) return;
    await this.query(`UPDATE statutory_contributions SET filing_id = ? WHERE id IN (${ids})`, [filingId]);
  }

  // =========================================================================
  // Gratuity provisions
  // =========================================================================

  /** Everyone still on the books, with the wage a provision can be based on. */
  async findGratuityCandidates(asOfDate: string): Promise<GratuityCandidate[]> {
    const rows = await this.query<any[]>(
      `SELECT e.id, e.emp_code, e.full_name, e.worker_type, e.joined_at, e.monthly_salary,
              COALESCE(es.gratuity_eligible, true) AS gratuity_eligible
       FROM employees e
       LEFT JOIN employee_statutory es ON es.employee_id = e.id
       WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING' AND e.joined_at <= ?
       ORDER BY e.id ASC`,
      [asOfDate],
    );
    return rows.map((r) => ({
      employeeId: Number(r.id),
      empCode: String(r.emp_code),
      fullName: String(r.full_name),
      workerType: r.worker_type ?? null,
      joinedAt: toDateString(r.joined_at),
      monthlySalary: r.monthly_salary === null || r.monthly_salary === undefined ? null : num(r.monthly_salary),
      gratuityEligible: !!r.gratuity_eligible,
    }));
  }

  /** The most recent provision recorded strictly before `asOfDate`. */
  async findPreviousProvisions(asOfDate: string): Promise<Map<number, number>> {
    const rows = await this.query<any[]>(
      `SELECT g.employee_id, g.provision_amount
       FROM gratuity_provisions g
       JOIN (
         SELECT employee_id, MAX(as_of_date) AS latest
         FROM gratuity_provisions WHERE as_of_date < ? GROUP BY employee_id
       ) x ON x.employee_id = g.employee_id AND x.latest = g.as_of_date`,
      [asOfDate],
    );
    const map = new Map<number, number>();
    for (const r of rows) map.set(Number(r.employee_id), round2(num(r.provision_amount)));
    return map;
  }

  async upsertGratuityProvision(
    conn: any,
    row: {
      employeeId: number;
      asOfDate: string;
      financialYear: string;
      yearsOfService: number;
      lastDrawnWage: number;
      isEligible: boolean;
      provisionAmount: number;
      previousProvision: number;
      incrementalProvision: number;
    },
  ): Promise<void> {
    await conn.query(
      `INSERT INTO gratuity_provisions
        (employee_id, as_of_date, financial_year, years_of_service, last_drawn_wage, is_eligible,
         provision_amount, previous_provision, incremental_provision, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         financial_year = VALUES(financial_year),
         years_of_service = VALUES(years_of_service),
         last_drawn_wage = VALUES(last_drawn_wage),
         is_eligible = VALUES(is_eligible),
         provision_amount = VALUES(provision_amount),
         previous_provision = VALUES(previous_provision),
         incremental_provision = VALUES(incremental_provision),
         computed_at = NOW()`,
      [
        row.employeeId,
        row.asOfDate,
        row.financialYear,
        row.yearsOfService,
        row.lastDrawnWage,
        row.isEligible,
        row.provisionAmount,
        row.previousProvision,
        row.incrementalProvision,
      ],
    );
  }

  async findGratuityProvisions(
    filters: { asOfDate?: string; financialYear?: string; employeeId?: number; limit?: number } = {},
  ): Promise<GratuityProvision[]> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.asOfDate) { where.push('g.as_of_date = ?'); params.push(filters.asOfDate); }
    if (filters.financialYear) { where.push('g.financial_year = ?'); params.push(filters.financialYear); }
    if (filters.employeeId) { where.push('g.employee_id = ?'); params.push(filters.employeeId); }
    const limit = Math.min(10000, Math.max(1, Math.floor(Number(filters.limit) || 1000)));

    const rows = await this.query<any[]>(
      `SELECT g.*, e.emp_code, e.full_name
       FROM gratuity_provisions g
       JOIN employees e ON e.id = g.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY g.as_of_date DESC, e.emp_code ASC
       LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeCode: r.emp_code ?? null,
      employeeName: r.full_name ?? null,
      asOfDate: toDateString(r.as_of_date),
      financialYear: String(r.financial_year),
      yearsOfService: num(r.years_of_service),
      lastDrawnWage: round2(num(r.last_drawn_wage)),
      isEligible: !!r.is_eligible,
      provisionAmount: round2(num(r.provision_amount)),
      previousProvision: round2(num(r.previous_provision)),
      incrementalProvision: round2(num(r.incremental_provision)),
      settledAmount: round2(num(r.settled_amount)),
    }));
  }

  // =========================================================================
  // PF passbook
  // =========================================================================

  /** Latest closing balance per employee, so a new entry continues the ledger. */
  async findClosingBalances(employeeIds?: number[]): Promise<Map<number, number>> {
    let sql = `SELECT p.employee_id, p.closing_balance
               FROM pf_account_entries p
               JOIN (
                 SELECT employee_id, MAX(id) AS latest FROM pf_account_entries`;
    const params: any[] = [];
    if (employeeIds && employeeIds.length > 0) {
      const ids = idList(employeeIds);
      if (!ids) return new Map();
      sql += ` WHERE employee_id IN (${ids})`;
    }
    sql += ` GROUP BY employee_id
               ) x ON x.employee_id = p.employee_id AND x.latest = p.id`;
    const rows = await this.query<any[]>(sql, params);
    const map = new Map<number, number>();
    for (const r of rows) map.set(Number(r.employee_id), round2(num(r.closing_balance)));
    return map;
  }

  /** Existing references, used to keep posting idempotent. */
  async findEntryReferences(reference: string): Promise<Set<number>> {
    const rows = await this.query<any[]>(
      'SELECT DISTINCT employee_id FROM pf_account_entries WHERE reference = ?',
      [reference],
    );
    return new Set(rows.map((r) => Number(r.employee_id)));
  }

  async insertPfEntry(conn: any, entry: PfEntryInput, userId: number): Promise<void> {
    await conn.query(
      `INSERT INTO pf_account_entries
        (employee_id, financial_year, month_key, entry_type, employee_share, employer_share,
         pension_share, vpf_share, interest_rate_pct, closing_balance, entry_date, reference,
         remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.employeeId,
        entry.financialYear,
        entry.monthKey,
        entry.entryType,
        entry.employeeShare,
        entry.employerShare,
        entry.pensionShare,
        entry.vpfShare,
        entry.interestRatePct,
        entry.closingBalance,
        entry.entryDate,
        entry.reference,
        entry.remarks,
        userId,
      ],
    );
  }

  async findPfEntries(employeeId: number, financialYear?: string): Promise<PfAccountEntry[]> {
    let sql = 'SELECT * FROM pf_account_entries WHERE employee_id = ?';
    const params: any[] = [employeeId];
    if (financialYear) {
      sql += ' AND financial_year = ?';
      params.push(financialYear);
    }
    sql += ' ORDER BY entry_date ASC, id ASC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      financialYear: String(r.financial_year),
      monthKey: r.month_key ?? null,
      entryType: r.entry_type,
      employeeShare: round2(num(r.employee_share)),
      employerShare: round2(num(r.employer_share)),
      pensionShare: round2(num(r.pension_share)),
      vpfShare: round2(num(r.vpf_share)),
      interestRatePct: r.interest_rate_pct === null ? null : num(r.interest_rate_pct),
      closingBalance: round2(num(r.closing_balance)),
      entryDate: toDateString(r.entry_date),
      reference: r.reference ?? null,
      remarks: r.remarks ?? null,
    }));
  }

  /** Employees carrying a PF balance in a financial year, for the interest run. */
  async findEmployeesWithPfBalance(financialYear: string): Promise<number[]> {
    const rows = await this.query<any[]>(
      'SELECT DISTINCT employee_id FROM pf_account_entries WHERE financial_year = ?',
      [financialYear],
    );
    return rows.map((r) => Number(r.employee_id));
  }

  // =========================================================================
  // Registers and returns
  // =========================================================================

  /**
   * Full salary-line detail for the wage register, the muster roll and the
   * Form 24Q "amount paid" column, filtered by period, month set or financial
   * year. The same legacy `total_amount` fallback as `findLedgerSource` applies.
   */
  async findSalaryLineDetails(
    filters: { periodId?: number; monthKeys?: string[]; financialYear?: string; employeeIds?: number[] },
  ): Promise<SalaryLineDetailRow[]> {
    const where: string[] = ['e.deleted_at IS NULL', 'p.deleted_at IS NULL'];
    const params: any[] = [];

    if (filters.periodId) {
      where.push('sl.period_id = ?');
      params.push(filters.periodId);
    }
    if (filters.monthKeys && filters.monthKeys.length > 0) {
      const clean = filters.monthKeys.filter((m) => /^\d{4}-\d{2}$/.test(String(m)));
      if (clean.length === 0) return [];
      where.push(`DATE_FORMAT(p.to_date, '%Y-%m') IN (${clean.map(() => '?').join(',')})`);
      params.push(...clean);
    }
    if (filters.financialYear) {
      const startYear = Number(String(filters.financialYear).slice(0, 4));
      if (!Number.isFinite(startYear)) return [];
      where.push('p.from_date >= ? AND p.to_date <= ?');
      params.push(`${startYear}-04-01`, `${startYear + 1}-03-31`);
    }
    if (filters.employeeIds && filters.employeeIds.length > 0) {
      const ids = idList(filters.employeeIds);
      if (!ids) return [];
      where.push(`sl.employee_id IN (${ids})`);
    }

    const rows = await this.query<any[]>(
      `SELECT sl.id AS salary_line_id, sl.period_id, sl.employee_id,
              sl.period_days, sl.paid_days, sl.present_days, sl.absent_days, sl.leave_days,
              sl.lop_days, sl.ot_hours, sl.gross_amount, sl.total_amount,
              sl.earn_piece, sl.earn_fixed, sl.earn_ot, sl.earn_bonus, sl.earn_incentive,
              sl.ded_pf, sl.ded_esi, sl.ded_pt, sl.ded_income_tax, sl.ded_advance,
              sl.ded_lwf, sl.ded_other, sl.total_deductions, sl.net_amount,
              p.label AS period_label, DATE_FORMAT(p.to_date, '%Y-%m') AS month_key,
              p.from_date, p.to_date,
              e.emp_code, e.full_name, e.department, e.designation, e.worker_type, e.gender,
              e.joined_at, e.bank_name, e.bank_account, e.bank_ifsc,
              es.pan, es.uan, es.esi_ip_number
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id
       JOIN employees e ON e.id = sl.employee_id
       LEFT JOIN employee_statutory es ON es.employee_id = sl.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.to_date ASC, e.emp_code ASC`,
      params,
    );

    return rows.map((r) => {
      const gross = num(r.gross_amount);
      const legacy = num(r.total_amount);
      return {
        salaryLineId: Number(r.salary_line_id),
        periodId: Number(r.period_id),
        periodLabel: String(r.period_label),
        monthKey: String(r.month_key),
        fromDate: toDateString(r.from_date),
        toDate: toDateString(r.to_date),
        employeeId: Number(r.employee_id),
        empCode: String(r.emp_code),
        fullName: String(r.full_name),
        department: r.department ?? null,
        designation: r.designation ?? null,
        workerType: r.worker_type ?? null,
        gender: r.gender ?? null,
        joinedAt: toDateString(r.joined_at),
        pan: r.pan ?? null,
        uan: r.uan ?? null,
        esiIpNumber: r.esi_ip_number ?? null,
        bankName: r.bank_name ?? null,
        bankAccount: r.bank_account ?? null,
        bankIfsc: r.bank_ifsc ?? null,
        periodDays: num(r.period_days),
        paidDays: num(r.paid_days),
        presentDays: num(r.present_days),
        absentDays: num(r.absent_days),
        leaveDays: num(r.leave_days),
        lopDays: num(r.lop_days),
        otHours: num(r.ot_hours),
        grossAmount: round2(gross > 0 ? gross : legacy),
        earnPiece: round2(num(r.earn_piece)),
        earnFixed: round2(num(r.earn_fixed)),
        earnOt: round2(num(r.earn_ot)),
        earnBonus: round2(num(r.earn_bonus)),
        earnIncentive: round2(num(r.earn_incentive)),
        dedPf: round2(num(r.ded_pf)),
        dedEsi: round2(num(r.ded_esi)),
        dedPt: round2(num(r.ded_pt)),
        dedIncomeTax: round2(num(r.ded_income_tax)),
        dedAdvance: round2(num(r.ded_advance)),
        dedLwf: round2(num(r.ded_lwf)),
        dedOther: round2(num(r.ded_other)),
        totalDeductions: round2(num(r.total_deductions)),
        netAmount: round2(num(r.net_amount)),
      };
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private toContribution(r: any): ContributionRecord {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      periodId: Number(r.period_id),
      salaryLineId: r.salary_line_id === null ? null : Number(r.salary_line_id),
      runId: r.run_id === null ? null : Number(r.run_id),
      scheme: r.scheme,
      financialYear: String(r.financial_year),
      monthKey: String(r.month_key),
      stateCode: r.state_code ?? null,
      wageBase: round2(num(r.wage_base)),
      uncappedWage: round2(num(r.uncapped_wage)),
      employeeAmount: round2(num(r.employee_amount)),
      employerAmount: round2(num(r.employer_amount)),
      adminCharges: round2(num(r.admin_charges)),
      totalAmount: round2(num(r.total_amount)),
      rateApplied: r.rate_applied === null ? null : num(r.rate_applied),
      ncpDays: num(r.ncp_days),
      paidDays: num(r.paid_days),
      remarks: r.remarks ?? null,
      employeeCode: r.emp_code ?? null,
      employeeName: r.full_name ?? null,
      uan: r.uan ?? null,
      esiIpNumber: r.esi_ip_number ?? null,
      challanId: r.challan_id === null ? null : Number(r.challan_id),
      filingId: r.filing_id === null ? null : Number(r.filing_id),
      status: r.status,
    };
  }
}
