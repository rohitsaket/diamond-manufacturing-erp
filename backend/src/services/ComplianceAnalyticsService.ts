import { ComplianceRepository } from '../repositories/ComplianceRepository';
import { ComplianceCheckService, ComplianceScore } from './ComplianceCheckService';
import { generateCsv } from '../utils/csv';
import { round2, toDateString } from '../utils/dateUtils';

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportPayload {
  type: ReportType;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  meta: Record<string, unknown>;
}

export type ReportType =
  | 'PF_REGISTER' | 'ESI_REGISTER' | 'PT_REGISTER' | 'TDS_REGISTER' | 'FORM16_REPORT'
  | 'TAX_LIABILITY' | 'INVESTMENT_DECLARATION' | 'PROOF_VERIFICATION' | 'COMPLIANCE_STATUS'
  | 'AUDIT_REPORT' | 'STATUTORY_FILING';

export const REPORT_TYPES: ReportType[] = [
  'PF_REGISTER', 'ESI_REGISTER', 'PT_REGISTER', 'TDS_REGISTER', 'FORM16_REPORT',
  'TAX_LIABILITY', 'INVESTMENT_DECLARATION', 'PROOF_VERIFICATION', 'COMPLIANCE_STATUS',
  'AUDIT_REPORT', 'STATUTORY_FILING',
];

export interface ReportParams {
  financialYear?: string;
  monthKey?: string;
  status?: string;
  auditId?: number;
  limit?: number;
}

interface MonthlySchemeTotals {
  monthKey: string;
  pf: number;
  esi: number;
  pt: number;
  lwf: number;
  tds: number;
  total: number;
}

function fyBounds(financialYear: string): { from: string; to: string } {
  const start = Number(String(financialYear).slice(0, 4));
  if (!Number.isFinite(start)) throw new Error("Financial year must look like '2026-2027'");
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

function currentFinancialYear(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/**
 * `YYYY-MM-DD` or null. mysql2 hands DATE columns back as Date objects, and
 * `String(date).slice(0, 10)` on one of those yields "Thu May 07" -- fine on a
 * screen, useless in a CSV somebody sorts.
 */
function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return toDateString(value);
}

/** Percentage with a guarded divisor, to one decimal. */
function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function addMonths(monthKey: string, count: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const zero = year * 12 + (month - 1) + count;
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, '0')}`;
}

/**
 * Compliance and statutory analytics.
 *
 * Every figure below is a single set-based aggregate; nothing walks employees
 * in application code. Divisions are guarded and percentages rounded to one
 * decimal, so an empty month reports zero rather than NaN.
 */
export class ComplianceAnalyticsService {
  private repo = new ComplianceRepository();
  private checks = new ComplianceCheckService();

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  async getDashboard(financialYear?: string): Promise<Record<string, unknown>> {
    const fy = financialYear ? this.normaliseFy(financialYear) : currentFinancialYear();
    const bounds = fyBounds(fy);

    const [
      contributions,
      taxTotals,
      pendingProofs,
      calendarStatus,
      upcoming,
      overdue,
      filingStatus,
      form16Count,
      openFindings,
      score,
    ] = await Promise.all([
      this.repo.getContributionTotals(fy),
      this.repo.getTaxLiabilityTotals(fy),
      this.repo.getPendingProofCount(fy),
      this.repo.getCalendarStatusCounts(fy),
      this.repo.getUpcoming(30),
      this.repo.getOverdue(50),
      this.repo.getFilingStatusCounts(fy),
      this.repo.getForm16Count(fy),
      this.repo.getOpenFindingsBySeverity(),
      this.checks.getComplianceScore(fy),
    ]);

    // The ledger is the primary source; payroll totals back it up when the
    // contribution ledger has not been populated for the year yet.
    const payrollTotals = await this.repo.getSalaryLineTotalsByMonth(bounds.from, bounds.to);
    const ledgerBySchemeled = new Map(contributions.map((c) => [c.scheme, c.total]));
    const ledgerEmpty = contributions.length === 0;
    const payrollSum = payrollTotals.reduce(
      (acc, m) => ({
        pf: acc.pf + m.pf,
        esi: acc.esi + m.esi,
        pt: acc.pt + m.pt,
        lwf: acc.lwf + m.lwf,
        tds: acc.tds + m.tds,
      }),
      { pf: 0, esi: 0, pt: 0, lwf: 0, tds: 0 },
    );

    const schemeTotal = (scheme: string, fallback: number): number =>
      round2(ledgerEmpty ? fallback : (ledgerBySchemeled.get(scheme) ?? 0));

    const contributionTotals = {
      pf: schemeTotal('PF', payrollSum.pf),
      eps: round2(ledgerBySchemeled.get('EPS') ?? 0),
      edli: round2(ledgerBySchemeled.get('EDLI') ?? 0),
      esi: schemeTotal('ESI', payrollSum.esi),
      pt: schemeTotal('PT', payrollSum.pt),
      lwf: schemeTotal('LWF', payrollSum.lwf),
      tds: schemeTotal('TDS', payrollSum.tds),
    };

    return {
      financialYear: fy,
      taxLiability: {
        totalAnnualTax: round2(taxTotals.totalTax),
        tdsDeductedToDate: round2(taxTotals.tdsDeducted),
        balance: round2(Math.max(0, taxTotals.totalTax - taxTotals.tdsDeducted)),
        employeesComputed: taxTotals.employees,
      },
      contributions: {
        ...contributionTotals,
        total: round2(Object.values(contributionTotals).reduce((s, v) => s + v, 0)),
        source: ledgerEmpty ? 'salary_lines (contribution ledger is empty for this year)' : 'statutory_contributions',
      },
      pendingInvestmentProofs: pendingProofs,
      complianceStatus: calendarStatus,
      upcomingDueDates: upcoming.map((e) => ({
        id: e.id,
        obligation: e.obligationCode,
        name: e.obligationName,
        category: e.category,
        periodLabel: e.periodLabel,
        dueDate: e.dueDate,
        daysToDue: e.daysToDue,
        status: e.status,
      })),
      overdueCount: overdue.length,
      filingStatus,
      form16Generated: form16Count,
      complianceScore: { score: score.score, grade: score.grade, evaluated: score.evaluated },
      openAuditFindings: openFindings,
    };
  }

  // -------------------------------------------------------------------------
  // Tax analytics
  // -------------------------------------------------------------------------

  async getTaxAnalytics(financialYear: string): Promise<Record<string, unknown>> {
    const fy = this.normaliseFy(financialYear);
    const bounds = fyBounds(fy);

    const [tdsByMonth, deductionMix, regimeCounts, totals] = await Promise.all([
      this.repo.getTdsByMonth(bounds.from, bounds.to),
      this.repo.getDeductionMix(fy),
      this.repo.getRegimeCounts(fy),
      this.repo.getTaxLiabilityTotals(fy),
    ]);

    const declared = deductionMix.reduce((s, d) => s + d.declared, 0);
    const approved = deductionMix.reduce((s, d) => s + d.approved, 0);

    return {
      financialYear: fy,
      taxLiabilityTrend: tdsByMonth.map((m) => ({
        monthKey: m.monthKey,
        grossPaid: round2(m.gross),
        tdsDeducted: round2(m.tds),
        effectiveRatePct: pct(m.tds, m.gross),
      })),
      tdsTrend: tdsByMonth.map((m) => ({ monthKey: m.monthKey, tds: round2(m.tds) })),
      declarations: {
        totalDeclared: round2(declared),
        totalApproved: round2(approved),
        approvalRatePct: pct(approved, declared),
        unverifiedAmount: round2(Math.max(0, declared - approved)),
        note: 'Tax saved is shown as the deduction amount claimed and approved, not as a rupee tax saving: '
          + 'the saving depends on each employee\'s marginal slab and is not a single company-wide number.',
      },
      deductionMixBySection: deductionMix.map((d) => ({
        code: d.code,
        name: d.name,
        declared: round2(d.declared),
        approved: round2(d.approved),
        sharePct: pct(d.declared, declared),
      })),
      employeesByRegime: regimeCounts,
      annual: {
        totalTax: round2(totals.totalTax),
        tdsDeductedToDate: round2(totals.tdsDeducted),
        employeesComputed: totals.employees,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Contribution trends
  // -------------------------------------------------------------------------

  async getContributionTrends(range: { from?: string; to?: string } = {}): Promise<Record<string, unknown>> {
    const fy = currentFinancialYear();
    const bounds = fyBounds(fy);
    const from = range.from ?? bounds.from.slice(0, 7);
    const to = range.to ?? bounds.to.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      throw new Error("Range months must look like '2026-04'");
    }

    const months = await this.buildMonthlyTotals(from, to);
    return {
      from,
      to,
      months,
      totals: months.reduce(
        (acc, m) => ({
          pf: round2(acc.pf + m.pf),
          esi: round2(acc.esi + m.esi),
          pt: round2(acc.pt + m.pt),
          lwf: round2(acc.lwf + m.lwf),
          tds: round2(acc.tds + m.tds),
          total: round2(acc.total + m.total),
        }),
        { pf: 0, esi: 0, pt: 0, lwf: 0, tds: 0, total: 0 },
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Filing status
  // -------------------------------------------------------------------------

  async getFilingStatus(financialYear: string): Promise<Record<string, unknown>> {
    const fy = this.normaliseFy(financialYear);
    const rows = await this.repo.getFilingStatusByObligation(fy);
    const obligations = rows.map((r) => {
      const applicable = Math.max(0, r.due - r.notApplicable);
      return {
        obligationId: r.obligationId,
        code: r.code,
        name: r.name,
        category: r.category,
        frequency: r.frequency,
        due: r.due,
        applicable,
        completed: r.completed,
        overdue: r.overdue,
        notApplicable: r.notApplicable,
        completionPct: pct(r.completed, applicable),
      };
    });

    const totalApplicable = obligations.reduce((s, o) => s + o.applicable, 0);
    const totalCompleted = obligations.reduce((s, o) => s + o.completed, 0);
    return {
      financialYear: fy,
      obligations,
      overall: {
        applicable: totalApplicable,
        completed: totalCompleted,
        overdue: obligations.reduce((s, o) => s + o.overdue, 0),
        completionPct: pct(totalCompleted, totalApplicable),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Forecast
  // -------------------------------------------------------------------------

  /**
   * Statutory outflow projected forward from the trailing three-month average.
   *
   * This is arithmetic on the last three months, not a model: it has no view of
   * headcount plans, rate changes, arrears or seasonality, and the payload says
   * so rather than letting a chart imply otherwise.
   */
  async getForecast(months = 6): Promise<Record<string, unknown>> {
    const horizon = Math.max(1, Math.min(24, Math.floor(Number(months)) || 6));
    const today = new Date();
    const currentMonth = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
    const historyFrom = addMonths(currentMonth, -11);

    const history = await this.buildMonthlyTotals(historyFrom, currentMonth);
    const withData = history.filter((m) => m.total > 0);
    const trailing = withData.slice(-3);

    if (trailing.length === 0) {
      return {
        method: 'trailing-average',
        available: false,
        reason: 'No statutory contribution or payroll data exists in the last twelve months to average.',
        history,
        projection: [],
      };
    }

    const average = (pick: (m: MonthlySchemeTotals) => number): number =>
      round2(trailing.reduce((s, m) => s + pick(m), 0) / trailing.length);

    const base = {
      pf: average((m) => m.pf),
      esi: average((m) => m.esi),
      pt: average((m) => m.pt),
      lwf: average((m) => m.lwf),
      tds: average((m) => m.tds),
    };
    const baseTotal = round2(base.pf + base.esi + base.pt + base.lwf + base.tds);

    const projection = Array.from({ length: horizon }, (_, index) => ({
      monthKey: addMonths(currentMonth, index + 1),
      ...base,
      total: baseTotal,
    }));

    return {
      method: 'trailing-average',
      available: true,
      monthsAveraged: trailing.map((m) => m.monthKey),
      basis: base,
      horizonMonths: horizon,
      projection,
      projectedTotal: round2(baseTotal * horizon),
      history,
      caveat: 'A flat projection of the trailing three-month average. It does not model headcount changes, '
        + 'statutory rate revisions, arrears, bonus months or seasonality, and should not be read as a forecast '
        + 'in any statistical sense.',
    };
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  async generateReport(type: string, params: ReportParams = {}): Promise<ReportPayload> {
    const reportType = String(type ?? '').toUpperCase() as ReportType;
    if (!REPORT_TYPES.includes(reportType)) {
      throw new Error(`Unknown report type ${type}. Valid types: ${REPORT_TYPES.join(', ')}`);
    }
    const fy = params.financialYear ? this.normaliseFy(params.financialYear) : currentFinancialYear();
    if (params.monthKey && !/^\d{4}-\d{2}$/.test(params.monthKey)) {
      throw new Error("Month must look like '2026-07'");
    }
    const limit = Math.max(1, Math.min(20000, Math.floor(Number(params.limit)) || 5000));

    switch (reportType) {
      case 'PF_REGISTER':
        return this.contributionRegister('PF_REGISTER', 'PF', fy, params.monthKey, limit);
      case 'ESI_REGISTER':
        return this.contributionRegister('ESI_REGISTER', 'ESI', fy, params.monthKey, limit);
      case 'PT_REGISTER':
        return this.contributionRegister('PT_REGISTER', 'PT', fy, params.monthKey, limit);
      case 'TDS_REGISTER':
        return this.tdsRegister(fy, params.monthKey, limit);
      case 'FORM16_REPORT':
        return this.form16Report(fy, limit);
      case 'TAX_LIABILITY':
        return this.taxLiabilityReport(fy, limit);
      case 'INVESTMENT_DECLARATION':
        return this.investmentDeclarationReport(fy, limit);
      case 'PROOF_VERIFICATION':
        return this.proofVerificationReport(fy, params.status, limit);
      case 'COMPLIANCE_STATUS':
        return this.complianceStatusReport(fy, params.status, limit);
      case 'AUDIT_REPORT':
        return this.auditReport(fy, params.auditId, limit);
      default:
        return this.statutoryFilingReport(fy, params.status, limit);
    }
  }

  async exportCsv(type: string, params: ReportParams = {}): Promise<{ fileName: string; csv: string }> {
    const report = await this.generateReport(type, params);
    const headers = report.columns.map((c) => c.label);
    const rows = report.rows.map((row) => report.columns.map((c) => row[c.key] ?? ''));
    const suffix = params.monthKey ?? params.financialYear ?? currentFinancialYear();
    return {
      fileName: `${report.type.toLowerCase()}-${suffix}.csv`,
      csv: generateCsv(headers, rows),
    };
  }

  // -------------------------------------------------------------------------
  // Report builders
  // -------------------------------------------------------------------------

  private async contributionRegister(
    type: ReportType,
    scheme: 'PF' | 'ESI' | 'PT',
    financialYear: string,
    monthKey: string | undefined,
    limit: number,
  ): Promise<ReportPayload> {
    const params: any[] = [scheme, financialYear];
    let sql = `SELECT e.emp_code, e.full_name, es.uan, es.esi_ip_number, sc.month_key, sc.state_code,
                      sc.wage_base, sc.uncapped_wage, sc.employee_amount, sc.employer_amount,
                      sc.admin_charges, sc.total_amount, sc.paid_days, sc.ncp_days, sc.status
               FROM statutory_contributions sc
               JOIN employees e ON e.id = sc.employee_id
               LEFT JOIN employee_statutory es ON es.employee_id = sc.employee_id
               WHERE sc.scheme = ? AND sc.financial_year = ?`;
    if (monthKey) {
      sql += ' AND sc.month_key = ?';
      params.push(monthKey);
    }
    sql += ` ORDER BY sc.month_key ASC, e.emp_code ASC LIMIT ${limit}`;

    const rows = await this.repo.runReportQuery(sql, params);
    const columns: ReportColumn[] = [
      { key: 'empCode', label: 'Employee Code' },
      { key: 'employeeName', label: 'Name' },
      ...(scheme === 'PF' ? [{ key: 'identifier', label: 'UAN' }] : []),
      ...(scheme === 'ESI' ? [{ key: 'identifier', label: 'IP Number' }] : []),
      { key: 'monthKey', label: 'Month' },
      { key: 'stateCode', label: 'State' },
      { key: 'wageBase', label: 'Wage Base' },
      { key: 'employeeAmount', label: 'Employee Share' },
      { key: 'employerAmount', label: 'Employer Share' },
      { key: 'adminCharges', label: 'Admin Charges' },
      { key: 'totalAmount', label: 'Total' },
      { key: 'status', label: 'Status' },
    ];

    const mapped = rows.map((r) => ({
      empCode: r.emp_code,
      employeeName: r.full_name,
      identifier: scheme === 'PF' ? r.uan : scheme === 'ESI' ? r.esi_ip_number : null,
      monthKey: r.month_key,
      stateCode: r.state_code,
      wageBase: round2(Number(r.wage_base) || 0),
      employeeAmount: round2(Number(r.employee_amount) || 0),
      employerAmount: round2(Number(r.employer_amount) || 0),
      adminCharges: round2(Number(r.admin_charges) || 0),
      totalAmount: round2(Number(r.total_amount) || 0),
      status: r.status,
    }));

    return {
      type,
      columns,
      rows: mapped,
      meta: {
        financialYear,
        monthKey: monthKey ?? null,
        scheme,
        rowCount: mapped.length,
        total: round2(mapped.reduce((s, r) => s + r.totalAmount, 0)),
        source: 'statutory_contributions',
        note: mapped.length === 0
          ? 'The contribution ledger has no rows for this filter. Run the statutory contribution computation first.'
          : null,
      },
    };
  }

  private async tdsRegister(financialYear: string, monthKey: string | undefined, limit: number): Promise<ReportPayload> {
    const bounds = fyBounds(financialYear);
    const params: any[] = [bounds.from, bounds.to];
    let sql = `SELECT e.emp_code, e.full_name, es.pan, es.pan_status,
                      DATE_FORMAT(p.to_date, '%Y-%m') AS month_key, p.label AS period_label,
                      sl.gross_amount, sl.taxable_income, sl.ded_income_tax
               FROM salary_lines sl
               JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
               JOIN employees e ON e.id = sl.employee_id
               LEFT JOIN employee_statutory es ON es.employee_id = e.id
               WHERE p.from_date >= ? AND p.to_date <= ?`;
    if (monthKey) {
      sql += " AND DATE_FORMAT(p.to_date, '%Y-%m') = ?";
      params.push(monthKey);
    }
    sql += ` ORDER BY p.to_date ASC, e.emp_code ASC LIMIT ${limit}`;

    const rows = await this.repo.runReportQuery(sql, params);
    const mapped = rows.map((r) => ({
      empCode: r.emp_code,
      employeeName: r.full_name,
      pan: r.pan,
      panStatus: r.pan_status,
      monthKey: r.month_key,
      periodLabel: r.period_label,
      grossAmount: round2(Number(r.gross_amount) || 0),
      taxableIncome: round2(Number(r.taxable_income) || 0),
      tds: round2(Number(r.ded_income_tax) || 0),
    }));

    return {
      type: 'TDS_REGISTER',
      columns: [
        { key: 'empCode', label: 'Employee Code' },
        { key: 'employeeName', label: 'Name' },
        { key: 'pan', label: 'PAN' },
        { key: 'panStatus', label: 'PAN Status' },
        { key: 'monthKey', label: 'Month' },
        { key: 'periodLabel', label: 'Period' },
        { key: 'grossAmount', label: 'Gross' },
        { key: 'taxableIncome', label: 'Taxable Income' },
        { key: 'tds', label: 'TDS Deducted' },
      ],
      rows: mapped,
      meta: {
        financialYear,
        monthKey: monthKey ?? null,
        rowCount: mapped.length,
        totalTds: round2(mapped.reduce((s, r) => s + r.tds, 0)),
        source: 'salary_lines',
      },
    };
  }

  private async form16Report(financialYear: string, limit: number): Promise<ReportPayload> {
    const rows = await this.repo.runReportQuery(
      `SELECT f.certificate_no, e.emp_code, e.full_name, f.pan, f.regime_code, f.gross_salary,
              f.taxable_income, f.total_tax, f.tds_deducted, f.tax_payable, f.refund_due,
              f.has_part_a, f.status, f.issued_at
       FROM form16_records f
       JOIN employees e ON e.id = f.employee_id
       WHERE f.financial_year = ? AND f.deleted_at IS NULL
       ORDER BY e.emp_code ASC LIMIT ${limit}`,
      [financialYear],
    );
    const mapped = rows.map((r) => ({
      certificateNo: r.certificate_no,
      empCode: r.emp_code,
      employeeName: r.full_name,
      pan: r.pan,
      regime: r.regime_code,
      grossSalary: round2(Number(r.gross_salary) || 0),
      taxableIncome: round2(Number(r.taxable_income) || 0),
      totalTax: round2(Number(r.total_tax) || 0),
      tdsDeducted: round2(Number(r.tds_deducted) || 0),
      taxPayable: round2(Number(r.tax_payable) || 0),
      refundDue: round2(Number(r.refund_due) || 0),
      hasPartA: r.has_part_a === 1 || r.has_part_a === true ? 'Yes' : 'No',
      status: r.status,
    }));
    return {
      type: 'FORM16_REPORT',
      columns: [
        { key: 'certificateNo', label: 'Certificate No' },
        { key: 'empCode', label: 'Employee Code' },
        { key: 'employeeName', label: 'Name' },
        { key: 'pan', label: 'PAN' },
        { key: 'regime', label: 'Regime' },
        { key: 'grossSalary', label: 'Gross Salary' },
        { key: 'taxableIncome', label: 'Taxable Income' },
        { key: 'totalTax', label: 'Total Tax' },
        { key: 'tdsDeducted', label: 'TDS Deducted' },
        { key: 'taxPayable', label: 'Tax Payable' },
        { key: 'refundDue', label: 'Refund Due' },
        { key: 'hasPartA', label: 'Part A Attached' },
        { key: 'status', label: 'Status' },
      ],
      rows: mapped,
      meta: {
        financialYear,
        rowCount: mapped.length,
        note: 'A legally valid Form 16 is issued and digitally signed through TRACES. Rows without Part A '
          + 'attached carry Part B figures only.',
      },
    };
  }

  private async taxLiabilityReport(financialYear: string, limit: number): Promise<ReportPayload> {
    const rows = await this.repo.runReportQuery(
      `SELECT e.emp_code, e.full_name, r.code AS regime_code, tc.gross_annual, tc.standard_deduction,
              tc.chapter_via_deductions, tc.taxable_income, tc.total_tax, tc.tax_paid_to_date,
              tc.remaining_tax, tc.monthly_tds, tc.months_remaining
       FROM tax_computations tc
       JOIN employees e ON e.id = tc.employee_id
       LEFT JOIN tax_regimes r ON r.id = tc.regime_id
       WHERE tc.financial_year = ?
       ORDER BY tc.total_tax DESC, e.emp_code ASC LIMIT ${limit}`,
      [financialYear],
    );
    const mapped = rows.map((r) => ({
      empCode: r.emp_code,
      employeeName: r.full_name,
      regime: r.regime_code,
      grossAnnual: round2(Number(r.gross_annual) || 0),
      standardDeduction: round2(Number(r.standard_deduction) || 0),
      chapterVia: round2(Number(r.chapter_via_deductions) || 0),
      taxableIncome: round2(Number(r.taxable_income) || 0),
      totalTax: round2(Number(r.total_tax) || 0),
      taxPaidToDate: round2(Number(r.tax_paid_to_date) || 0),
      remainingTax: round2(Number(r.remaining_tax) || 0),
      monthlyTds: round2(Number(r.monthly_tds) || 0),
      monthsRemaining: Number(r.months_remaining) || 0,
    }));
    return {
      type: 'TAX_LIABILITY',
      columns: [
        { key: 'empCode', label: 'Employee Code' },
        { key: 'employeeName', label: 'Name' },
        { key: 'regime', label: 'Regime' },
        { key: 'grossAnnual', label: 'Annual Gross' },
        { key: 'standardDeduction', label: 'Standard Deduction' },
        { key: 'chapterVia', label: 'Chapter VI-A' },
        { key: 'taxableIncome', label: 'Taxable Income' },
        { key: 'totalTax', label: 'Total Tax' },
        { key: 'taxPaidToDate', label: 'TDS To Date' },
        { key: 'remainingTax', label: 'Remaining' },
        { key: 'monthlyTds', label: 'Monthly TDS' },
        { key: 'monthsRemaining', label: 'Months Left' },
      ],
      rows: mapped,
      meta: {
        financialYear,
        rowCount: mapped.length,
        totalTax: round2(mapped.reduce((s, r) => s + r.totalTax, 0)),
      },
    };
  }

  private async investmentDeclarationReport(financialYear: string, limit: number): Promise<ReportPayload> {
    const rows = await this.repo.runReportQuery(
      `SELECT e.emp_code, e.full_name, d.status AS declaration_status, s.code AS section_code,
              s.name AS section_name, i.declared_amount, i.approved_amount, i.proof_status
       FROM tax_declaration_items i
       JOIN tax_declarations d ON d.id = i.declaration_id
       JOIN tax_declaration_sections s ON s.id = i.section_id
       JOIN employees e ON e.id = d.employee_id
       WHERE d.financial_year = ?
       ORDER BY e.emp_code ASC, s.code ASC LIMIT ${limit}`,
      [financialYear],
    );
    const mapped = rows.map((r) => ({
      empCode: r.emp_code,
      employeeName: r.full_name,
      declarationStatus: r.declaration_status,
      sectionCode: r.section_code,
      sectionName: r.section_name,
      declaredAmount: round2(Number(r.declared_amount) || 0),
      approvedAmount: round2(Number(r.approved_amount) || 0),
      proofStatus: r.proof_status,
    }));
    return {
      type: 'INVESTMENT_DECLARATION',
      columns: [
        { key: 'empCode', label: 'Employee Code' },
        { key: 'employeeName', label: 'Name' },
        { key: 'declarationStatus', label: 'Declaration Status' },
        { key: 'sectionCode', label: 'Section' },
        { key: 'sectionName', label: 'Section Name' },
        { key: 'declaredAmount', label: 'Declared' },
        { key: 'approvedAmount', label: 'Approved' },
        { key: 'proofStatus', label: 'Proof Status' },
      ],
      rows: mapped,
      meta: {
        financialYear,
        rowCount: mapped.length,
        totalDeclared: round2(mapped.reduce((s, r) => s + r.declaredAmount, 0)),
        totalApproved: round2(mapped.reduce((s, r) => s + r.approvedAmount, 0)),
      },
    };
  }

  private async proofVerificationReport(financialYear: string, status: string | undefined, limit: number): Promise<ReportPayload> {
    const params: any[] = [financialYear];
    let sql = `SELECT e.emp_code, e.full_name, p.proof_type, p.title, p.claimed_amount, p.verified_amount,
                      p.status, p.review_note, p.reviewed_at, u.name AS reviewer
               FROM tax_proofs p
               JOIN employees e ON e.id = p.employee_id
               LEFT JOIN users u ON u.id = p.reviewed_by
               WHERE p.deleted_at IS NULL AND p.financial_year = ?`;
    if (status) {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    sql += ` ORDER BY e.emp_code ASC, p.id ASC LIMIT ${limit}`;

    const rows = await this.repo.runReportQuery(sql, params);
    const mapped = rows.map((r) => ({
      empCode: r.emp_code,
      employeeName: r.full_name,
      proofType: r.proof_type,
      title: r.title,
      claimedAmount: round2(Number(r.claimed_amount) || 0),
      verifiedAmount: round2(Number(r.verified_amount) || 0),
      status: r.status,
      reviewer: r.reviewer,
      reviewNote: r.review_note,
    }));
    return {
      type: 'PROOF_VERIFICATION',
      columns: [
        { key: 'empCode', label: 'Employee Code' },
        { key: 'employeeName', label: 'Name' },
        { key: 'proofType', label: 'Proof Type' },
        { key: 'title', label: 'Title' },
        { key: 'claimedAmount', label: 'Claimed' },
        { key: 'verifiedAmount', label: 'Verified' },
        { key: 'status', label: 'Status' },
        { key: 'reviewer', label: 'Reviewed By' },
        { key: 'reviewNote', label: 'Note' },
      ],
      rows: mapped,
      meta: {
        financialYear,
        status: status ?? null,
        rowCount: mapped.length,
        totalClaimed: round2(mapped.reduce((s, r) => s + r.claimedAmount, 0)),
        totalVerified: round2(mapped.reduce((s, r) => s + r.verifiedAmount, 0)),
      },
    };
  }

  private async complianceStatusReport(financialYear: string, status: string | undefined, limit: number): Promise<ReportPayload> {
    const params: any[] = [financialYear];
    let sql = `SELECT o.code, o.name, o.category, o.authority, cc.period_label, cc.due_date,
                      cc.original_due_date, cc.status, cc.completed_on, cc.remarks, u.name AS owner
               FROM compliance_calendar cc
               JOIN compliance_obligations o ON o.id = cc.obligation_id
               LEFT JOIN users u ON u.id = cc.owner_user_id
               WHERE cc.financial_year = ?`;
    if (status) {
      sql += ' AND cc.status = ?';
      params.push(status);
    }
    sql += ` ORDER BY cc.due_date ASC LIMIT ${limit}`;

    const rows = await this.repo.runReportQuery(sql, params);
    const mapped = rows.map((r) => ({
      code: r.code,
      name: r.name,
      category: r.category,
      authority: r.authority,
      periodLabel: r.period_label,
      dueDate: dateOrNull(r.due_date),
      originalDueDate: dateOrNull(r.original_due_date),
      status: r.status,
      completedOn: dateOrNull(r.completed_on),
      owner: r.owner,
      remarks: r.remarks,
    }));
    return {
      type: 'COMPLIANCE_STATUS',
      columns: [
        { key: 'code', label: 'Obligation' },
        { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' },
        { key: 'authority', label: 'Authority' },
        { key: 'periodLabel', label: 'Period' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'originalDueDate', label: 'Original Due Date' },
        { key: 'status', label: 'Status' },
        { key: 'completedOn', label: 'Completed On' },
        { key: 'owner', label: 'Owner' },
        { key: 'remarks', label: 'Remarks' },
      ],
      rows: mapped,
      meta: { financialYear, status: status ?? null, rowCount: mapped.length },
    };
  }

  private async auditReport(financialYear: string, auditId: number | undefined, limit: number): Promise<ReportPayload> {
    const params: any[] = [];
    let sql = `SELECT a.title AS audit_title, a.audit_type, a.status AS audit_status, f.finding_no,
                      f.category, f.severity, f.title, f.affected_count, f.financial_impact,
                      f.status AS finding_status, f.identified_on, f.due_date, u.name AS owner,
                      (SELECT COUNT(*) FROM compliance_actions ca WHERE ca.finding_id = f.id) AS actions,
                      (SELECT COUNT(*) FROM compliance_actions ca WHERE ca.finding_id = f.id
                         AND ca.status IN ('PENDING', 'IN_PROGRESS')) AS open_actions
               FROM compliance_findings f
               LEFT JOIN compliance_audits a ON a.id = f.audit_id
               LEFT JOIN users u ON u.id = f.owner_user_id
               WHERE f.deleted_at IS NULL`;
    if (auditId) {
      sql += ' AND f.audit_id = ?';
      params.push(auditId);
    } else {
      sql += ' AND (a.financial_year = ? OR a.financial_year IS NULL)';
      params.push(financialYear);
    }
    sql += ` ORDER BY FIELD(f.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), f.identified_on DESC LIMIT ${limit}`;

    const rows = await this.repo.runReportQuery(sql, params);
    const mapped = rows.map((r) => ({
      auditTitle: r.audit_title,
      auditType: r.audit_type,
      auditStatus: r.audit_status,
      findingNo: r.finding_no,
      category: r.category,
      severity: r.severity,
      title: r.title,
      affectedCount: Number(r.affected_count) || 0,
      financialImpact: r.financial_impact === null ? null : round2(Number(r.financial_impact) || 0),
      findingStatus: r.finding_status,
      identifiedOn: dateOrNull(r.identified_on),
      dueDate: dateOrNull(r.due_date),
      owner: r.owner,
      actions: Number(r.actions) || 0,
      openActions: Number(r.open_actions) || 0,
    }));
    return {
      type: 'AUDIT_REPORT',
      columns: [
        { key: 'auditTitle', label: 'Audit' },
        { key: 'auditType', label: 'Audit Type' },
        { key: 'findingNo', label: 'Finding No' },
        { key: 'category', label: 'Category' },
        { key: 'severity', label: 'Severity' },
        { key: 'title', label: 'Finding' },
        { key: 'affectedCount', label: 'Affected' },
        { key: 'financialImpact', label: 'Financial Impact' },
        { key: 'findingStatus', label: 'Status' },
        { key: 'identifiedOn', label: 'Identified On' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'owner', label: 'Owner' },
        { key: 'openActions', label: 'Open Actions' },
      ],
      rows: mapped,
      meta: { financialYear, auditId: auditId ?? null, rowCount: mapped.length },
    };
  }

  private async statutoryFilingReport(financialYear: string, status: string | undefined, limit: number): Promise<ReportPayload> {
    const params: any[] = [financialYear];
    let sql = `SELECT f.filing_code, f.filing_type, f.scheme, f.frequency, f.month_key, f.quarter,
                      f.state_code, f.due_date, f.employee_count, f.total_amount, f.status,
                      f.filed_on, f.acknowledgement_no, f.submission_mode
               FROM regulatory_filings f
               WHERE f.deleted_at IS NULL AND f.financial_year = ?`;
    if (status) {
      sql += ' AND f.status = ?';
      params.push(status);
    }
    sql += ` ORDER BY f.due_date ASC, f.filing_code ASC LIMIT ${limit}`;

    const rows = await this.repo.runReportQuery(sql, params);
    const mapped = rows.map((r) => ({
      filingCode: r.filing_code,
      filingType: r.filing_type,
      scheme: r.scheme,
      frequency: r.frequency,
      monthKey: r.month_key,
      quarter: r.quarter,
      stateCode: r.state_code,
      dueDate: dateOrNull(r.due_date),
      employeeCount: Number(r.employee_count) || 0,
      totalAmount: round2(Number(r.total_amount) || 0),
      status: r.status,
      filedOn: dateOrNull(r.filed_on),
      acknowledgementNo: r.acknowledgement_no,
      submissionMode: r.submission_mode,
    }));
    return {
      type: 'STATUTORY_FILING',
      columns: [
        { key: 'filingCode', label: 'Filing Code' },
        { key: 'filingType', label: 'Type' },
        { key: 'scheme', label: 'Scheme' },
        { key: 'frequency', label: 'Frequency' },
        { key: 'monthKey', label: 'Month' },
        { key: 'quarter', label: 'Quarter' },
        { key: 'stateCode', label: 'State' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'employeeCount', label: 'Employees' },
        { key: 'totalAmount', label: 'Amount' },
        { key: 'status', label: 'Status' },
        { key: 'filedOn', label: 'Filed On' },
        { key: 'acknowledgementNo', label: 'Acknowledgement' },
        { key: 'submissionMode', label: 'Mode' },
      ],
      rows: mapped,
      meta: {
        financialYear,
        status: status ?? null,
        rowCount: mapped.length,
        note: 'Filing is prepared here and uploaded to the government portal by a person; '
          + 'this system has no e-filing integration.',
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Month-by-month statutory totals, from the contribution ledger where it has
   * been populated and from payroll deductions where it has not.
   */
  private async buildMonthlyTotals(from: string, to: string): Promise<MonthlySchemeTotals[]> {
    const [ledger, payroll] = await Promise.all([
      this.repo.getContributionsByMonth(from, to),
      this.repo.getSalaryLineTotalsByMonth(`${from}-01`, `${to}-31`),
    ]);

    const byMonth = new Map<string, MonthlySchemeTotals>();
    const ensure = (monthKey: string): MonthlySchemeTotals => {
      const existing = byMonth.get(monthKey);
      if (existing) return existing;
      const created: MonthlySchemeTotals = { monthKey, pf: 0, esi: 0, pt: 0, lwf: 0, tds: 0, total: 0 };
      byMonth.set(monthKey, created);
      return created;
    };

    for (const row of ledger) {
      const bucket = ensure(row.monthKey);
      if (row.scheme === 'PF' || row.scheme === 'EPS' || row.scheme === 'EDLI' || row.scheme === 'VPF') {
        bucket.pf = round2(bucket.pf + row.total);
      } else if (row.scheme === 'ESI') bucket.esi = round2(bucket.esi + row.total);
      else if (row.scheme === 'PT') bucket.pt = round2(bucket.pt + row.total);
      else if (row.scheme === 'LWF') bucket.lwf = round2(bucket.lwf + row.total);
      else if (row.scheme === 'TDS') bucket.tds = round2(bucket.tds + row.total);
    }

    for (const row of payroll) {
      if (byMonth.has(row.monthKey)) continue; // the ledger already covers this month
      const bucket = ensure(row.monthKey);
      bucket.pf = round2(row.pf);
      bucket.esi = round2(row.esi);
      bucket.pt = round2(row.pt);
      bucket.lwf = round2(row.lwf);
      bucket.tds = round2(row.tds);
    }

    for (const bucket of byMonth.values()) {
      bucket.total = round2(bucket.pf + bucket.esi + bucket.pt + bucket.lwf + bucket.tds);
    }
    return [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }

  private normaliseFy(financialYear: string): string {
    const fy = String(financialYear ?? '').trim();
    if (!/^\d{4}-\d{4}$/.test(fy)) throw new Error("Financial year must look like '2026-2027'");
    return fy;
  }
}

export type { ComplianceScore };
