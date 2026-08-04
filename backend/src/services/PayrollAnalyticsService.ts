import {
  PayrollAnalyticsRepository,
  AuditEntry,
  AuditEntryInput,
  AuditFilters,
  BucketAmount,
  DateRange,
  Paged,
  RunSummary,
  TrendPoint,
} from '../repositories/PayrollAnalyticsRepository';
import { BankPaymentRepository } from '../repositories/BankPaymentRepository';
import { ApprovalRepository } from '../repositories/ApprovalRepository';
import { jobQueueService } from './JobQueueService';
import { getStorageDriver } from './storage/StorageDriver';
import { generateCsv } from '../utils/csv';
import { round2, todayString } from '../utils/dateUtils';

export type ReportType =
  | 'PAYROLL_REGISTER' | 'SALARY_REGISTER' | 'PAYSLIP_SUMMARY' | 'TAX' | 'PF' | 'ESI' | 'PT'
  | 'BONUS' | 'INCENTIVE' | 'OVERTIME' | 'COMPLIANCE' | 'COST_ANALYSIS' | 'FINAL_SETTLEMENT'
  | 'BANK_TRANSFER' | 'AUDIT';

export const REPORT_TYPES: ReportType[] = [
  'PAYROLL_REGISTER', 'SALARY_REGISTER', 'PAYSLIP_SUMMARY', 'TAX', 'PF', 'ESI', 'PT',
  'BONUS', 'INCENTIVE', 'OVERTIME', 'COMPLIANCE', 'COST_ANALYSIS', 'FINAL_SETTLEMENT',
  'BANK_TRANSFER', 'AUDIT',
];

export interface ReportParams {
  periodId?: number;
  from?: string;
  to?: string;
  financialYear?: string;
  employeeId?: number;
  limit?: number;
}

export interface ReportResult {
  columns: string[];
  rows: any[][];
  meta: Record<string, unknown>;
}

export interface PayrollDashboard {
  period: { id: number; label: string; fromDate: string; toDate: string } | null;
  totalPayrollCost: number;
  employeesProcessed: number;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  employerCost: number;
  bonusPaid: number;
  overtimeCost: number;
  overtimeHours: number;
  taxLiability: number;
  statutory: { pf: number; esi: number; pt: number; tds: number; employerPf: number; employerEsi: number };
  pendingApprovals: number;
  payrollErrors: number;
  bankTransfer: { unpaid: number; queued: number; paid: number; failed: number; onHold: number; batches: number };
  latestRun: RunSummary | null;
  averages: { grossPerEmployee: number; netPerEmployee: number; deductionRatePct: number };
}

/** Percentages are reported to one decimal place and never divide by zero. */
function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function defaultRange(params: { from?: string; to?: string }): DateRange {
  const to = params.to ?? todayString();
  if (params.from) return { from: params.from, to };
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 11);
  d.setUTCDate(1);
  return { from: d.toISOString().slice(0, 10), to };
}

/** Indian financial year for a `YYYY-MM-DD`. */
function financialYearOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/**
 * Payroll analytics, statutory reports and the audit trail.
 *
 * Every figure here comes from a single aggregate query. Nothing iterates over
 * employees in application code, so a 100k-employee payroll costs the same
 * number of round trips as a 100-employee one.
 */
export class PayrollAnalyticsService {
  private repo = new PayrollAnalyticsRepository();
  private bankRepo = new BankPaymentRepository();
  private approvalRepo = new ApprovalRepository();

  constructor() {
    this.registerJobHandlers();
  }

  /**
   * Queued reports render to CSV in the background and land in storage, so a
   * year-wide register never has to survive an HTTP timeout.
   */
  private registerJobHandlers(): void {
    if (jobQueueService.hasHandler('PAYROLL_REPORT')) return;
    jobQueueService.registerHandler('PAYROLL_REPORT', async (payload, updateProgress) => {
      const input = (payload ?? {}) as { type: string; params?: ReportParams };
      await updateProgress(10, `Building ${input.type} report`);

      const report = await this.generateReport(input.type, input.params ?? {});
      await updateProgress(70, `Writing ${report.rows.length} rows`);

      const csv = generateCsv(report.columns, report.rows);
      const key = `payroll-reports/${String(input.type).toLowerCase()}-${Date.now()}.csv`;
      const stored = await getStorageDriver().put(key, Buffer.from(csv, 'utf8'));
      await updateProgress(100, 'Report ready');

      return { type: input.type, key: stored.key, size: stored.size, rowCount: report.rows.length, meta: report.meta };
    });
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  async getDashboard(periodId?: number): Promise<PayrollDashboard> {
    const period = periodId ? await this.repo.findPeriod(periodId) : await this.repo.findLatestPeriod();

    if (!period) {
      return {
        period: null,
        totalPayrollCost: 0,
        employeesProcessed: 0,
        totalGross: 0,
        totalNet: 0,
        totalDeductions: 0,
        employerCost: 0,
        bonusPaid: 0,
        overtimeCost: 0,
        overtimeHours: 0,
        taxLiability: 0,
        statutory: { pf: 0, esi: 0, pt: 0, tds: 0, employerPf: 0, employerEsi: 0 },
        pendingApprovals: await this.approvalRepo.countPending(),
        payrollErrors: 0,
        bankTransfer: { unpaid: 0, queued: 0, paid: 0, failed: 0, onHold: 0, batches: 0 },
        latestRun: null,
        averages: { grossPerEmployee: 0, netPerEmployee: 0, deductionRatePct: 0 },
      };
    }

    const [totals, payments, pendingApprovals, errors, runs, batches] = await Promise.all([
      this.repo.getPeriodTotals(period.id),
      this.repo.getPaymentStatusCounts(period.id),
      this.approvalRepo.countPending(),
      this.repo.countRunErrors(period.id),
      this.repo.listRuns({ periodId: period.id, limit: 1 }),
      this.bankRepo.listBatches({ periodId: period.id, limit: 500 }),
    ]);

    const headcount = totals.employeesProcessed;

    return {
      period,
      totalPayrollCost: round2(totals.totalGross + totals.employerPf + totals.employerEsi),
      employeesProcessed: headcount,
      totalGross: round2(totals.totalGross),
      totalNet: round2(totals.totalNet),
      totalDeductions: round2(totals.totalDeductions),
      employerCost: round2(totals.totalEmployerCost),
      bonusPaid: round2(totals.totalBonus + totals.totalIncentive),
      overtimeCost: round2(totals.totalOvertime),
      overtimeHours: round2(totals.overtimeHours),
      taxLiability: round2(totals.totalTax),
      statutory: {
        pf: round2(totals.totalPf),
        esi: round2(totals.totalEsi),
        pt: round2(totals.totalPt),
        tds: round2(totals.totalTax),
        employerPf: round2(totals.employerPf),
        employerEsi: round2(totals.employerEsi),
      },
      pendingApprovals,
      payrollErrors: errors,
      bankTransfer: {
        unpaid: payments.UNPAID ?? 0,
        queued: payments.QUEUED ?? 0,
        paid: payments.PAID ?? 0,
        failed: payments.FAILED ?? 0,
        onHold: payments.ON_HOLD ?? 0,
        batches: batches.length,
      },
      latestRun: runs[0] ?? null,
      averages: {
        grossPerEmployee: headcount ? round2(totals.totalGross / headcount) : 0,
        netPerEmployee: headcount ? round2(totals.totalNet / headcount) : 0,
        deductionRatePct: pct(totals.totalDeductions, totals.totalGross),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------

  async getCostAnalytics(params: { from?: string; to?: string } = {}): Promise<{
    range: DateRange;
    byDepartment: BucketAmount[];
    byBranch: BucketAmount[];
    byGrade: BucketAmount[];
    byWorkerType: BucketAmount[];
    monthlyTrend: TrendPoint[];
    totals: { gross: number; net: number; deductions: number; employerCost: number };
  }> {
    const range = defaultRange(params);
    const [byDepartment, byBranch, byGrade, byWorkerType, monthlyTrend] = await Promise.all([
      this.repo.costByDimension('department', range),
      this.repo.costByDimension('branch', range),
      this.repo.costByDimension('grade', range),
      this.repo.costByDimension('workerType', range),
      this.repo.periodTrend(12),
    ]);

    const totals = byDepartment.reduce(
      (acc, b) => ({
        gross: acc.gross + b.gross,
        net: acc.net + b.net,
        deductions: acc.deductions + b.deductions,
        employerCost: acc.employerCost + b.employerCost,
      }),
      { gross: 0, net: 0, deductions: 0, employerCost: 0 },
    );

    const withShare = (rows: BucketAmount[]) =>
      rows.map((r) => ({ ...r, sharePct: pct(r.gross, totals.gross) }));

    return {
      range,
      byDepartment: withShare(byDepartment),
      byBranch: withShare(byBranch),
      byGrade: withShare(byGrade),
      byWorkerType: withShare(byWorkerType),
      monthlyTrend,
      totals: {
        gross: round2(totals.gross),
        net: round2(totals.net),
        deductions: round2(totals.deductions),
        employerCost: round2(totals.employerCost),
      },
    };
  }

  async getSalaryTrends(employeeId?: number): Promise<{
    employeeId: number | null;
    points: TrendPoint[];
    changePct: number;
  }> {
    const points = await this.repo.periodTrend(12, employeeId);
    const first = points[0];
    const last = points[points.length - 1];
    const changePct = first && last && first.gross > 0 ? pct(last.gross - first.gross, first.gross) : 0;
    return { employeeId: employeeId ?? null, points, changePct };
  }

  async getIncrementAnalysis(): Promise<any> {
    const analysis = await this.repo.incrementAnalysis();
    return {
      ...analysis,
      byGrade: analysis.byGrade.map((r) => ({ ...r, avgPct: Math.round(r.avgPct * 10) / 10, avgAmount: round2(r.avgAmount) })),
      byType: analysis.byType.map((r) => ({ ...r, avgPct: Math.round(r.avgPct * 10) / 10, avgAmount: round2(r.avgAmount) })),
      overall: { ...analysis.overall, avgPct: Math.round(analysis.overall.avgPct * 10) / 10 },
    };
  }

  async getOvertimeAnalysis(params: { from?: string; to?: string } = {}): Promise<any> {
    const range = defaultRange(params);
    const analysis = await this.repo.overtimeAnalysis(range);
    const avgRate = analysis.totals.hours > 0 ? round2(analysis.totals.amount / analysis.totals.hours) : 0;
    return { range, ...analysis, averageHourlyRate: avgRate };
  }

  async getBonusAnalysis(params: { from?: string; to?: string } = {}): Promise<any> {
    const range = defaultRange(params);
    const analysis = await this.repo.bonusAnalysis(range);
    const paid = analysis.paidThroughPayroll;
    return {
      range,
      ...analysis,
      totalPaid: round2(paid.bonus + paid.incentive + paid.variable),
    };
  }

  async getSalaryHistory(employeeId: number): Promise<any[]> {
    return this.repo.listSalaryRevisions(employeeId);
  }

  async listPayslipsForEmployee(employeeId: number, limit?: number): Promise<any[]> {
    return this.repo.listLinesForEmployee(employeeId, limit ?? 24);
  }

  async assertLineBelongsTo(lineId: number, employeeId: number): Promise<void> {
    const owner = await this.repo.findLineOwner(lineId);
    if (owner === null) throw new Error('Payslip not found');
    if (owner !== employeeId) throw new Error('You can only view your own payslips');
  }

  /**
   * Projects payroll cost forward.
   *
   * This is arithmetic, not a model: the trailing three periods give the cost
   * base and the headcount growth rate, and both are extrapolated linearly. The
   * payload says so, because a number labelled "forecast" gets believed.
   */
  async getForecast(months = 6): Promise<{
    method: 'trailing-average';
    caveat: string;
    basePeriods: { periodLabel: string; gross: number; employerCost: number; headcount: number }[];
    baseMonthlyCost: number;
    headcountGrowthPct: number;
    projections: { monthIndex: number; projectedHeadcount: number; projectedCost: number }[];
    totalProjectedCost: number;
  }> {
    const horizon = Math.min(36, Math.max(1, Math.trunc(Number(months) || 6)));
    const [trend, headcounts] = await Promise.all([this.repo.periodTrend(3), this.repo.headcountTrend(3)]);

    const headcountByPeriod = new Map(headcounts.map((h) => [h.periodId, h.headcount]));
    const basePeriods = trend.map((t) => ({
      periodLabel: t.periodLabel,
      gross: round2(t.gross),
      employerCost: round2(t.employerCost),
      headcount: headcountByPeriod.get(t.periodId) ?? t.employees,
    }));

    const withData = basePeriods.filter((p) => p.headcount > 0);
    const baseMonthlyCost = withData.length
      ? round2(withData.reduce((s, p) => s + p.gross + p.employerCost, 0) / withData.length)
      : 0;

    // Average period-on-period headcount growth across the trailing window.
    let growthSum = 0;
    let growthPoints = 0;
    for (let i = 1; i < withData.length; i++) {
      const previous = withData[i - 1] as { headcount: number };
      const current = withData[i] as { headcount: number };
      if (previous.headcount > 0) {
        growthSum += (current.headcount - previous.headcount) / previous.headcount;
        growthPoints++;
      }
    }
    const growthRate = growthPoints ? growthSum / growthPoints : 0;
    const baseHeadcount = withData.length ? (withData[withData.length - 1] as { headcount: number }).headcount : 0;

    const projections: { monthIndex: number; projectedHeadcount: number; projectedCost: number }[] = [];
    for (let m = 1; m <= horizon; m++) {
      const factor = Math.pow(1 + growthRate, m);
      projections.push({
        monthIndex: m,
        projectedHeadcount: Math.max(0, Math.round(baseHeadcount * factor)),
        projectedCost: round2(baseMonthlyCost * factor),
      });
    }

    return {
      method: 'trailing-average',
      caveat:
        'Naive projection: the trailing three periods are averaged and the observed headcount growth is '
        + 'applied linearly. It carries no seasonality, no hiring plan and no revision cycle, and must not '
        + 'be used as a budget commitment.',
      basePeriods,
      baseMonthlyCost,
      headcountGrowthPct: Math.round(growthRate * 1000) / 10,
      projections,
      totalProjectedCost: round2(projections.reduce((s, p) => s + p.projectedCost, 0)),
    };
  }

  /**
   * Statutory position for a period plus the data gaps that would actually
   * cause a filing to be rejected.
   */
  async getComplianceStatus(periodId: number): Promise<any> {
    const period = await this.repo.findPeriod(periodId);
    if (!period) throw new Error('Salary period not found');

    const [totals, missing] = await Promise.all([
      this.repo.getPeriodTotals(periodId),
      this.repo.missingStatutoryData(periodId),
    ]);

    const blockers: string[] = [];
    if (missing.missingUan > 0) blockers.push(`${missing.missingUan} employee(s) with PF but no UAN`);
    if (missing.missingEsic > 0) blockers.push(`${missing.missingEsic} employee(s) with ESI but no ESIC number`);
    if (missing.missingPan > 0) blockers.push(`${missing.missingPan} employee(s) with TDS but no PAN`);
    if (missing.missingBank > 0) blockers.push(`${missing.missingBank} employee(s) with pay due but no bank details`);

    return {
      period,
      totals: {
        pfEmployee: round2(totals.totalPf),
        pfEmployer: round2(totals.employerPf),
        pfTotal: round2(totals.totalPf + totals.employerPf),
        esiEmployee: round2(totals.totalEsi),
        esiEmployer: round2(totals.employerEsi),
        esiTotal: round2(totals.totalEsi + totals.employerEsi),
        professionalTax: round2(totals.totalPt),
        tds: round2(totals.totalTax),
        grandTotal: round2(
          totals.totalPf + totals.employerPf + totals.totalEsi + totals.employerEsi
          + totals.totalPt + totals.totalTax,
        ),
      },
      coverage: {
        employeesProcessed: totals.employeesProcessed,
        pfCoveragePct: pct(totals.employeesProcessed - missing.missingUan, totals.employeesProcessed),
        panCoveragePct: pct(totals.employeesProcessed - missing.missingPan, totals.employeesProcessed),
        bankCoveragePct: pct(totals.employeesProcessed - missing.missingBank, totals.employeesProcessed),
      },
      missingData: missing,
      filingBlockers: blockers,
      readyToFile: blockers.length === 0,
    };
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  async generateReport(type: string, params: ReportParams = {}): Promise<ReportResult> {
    const reportType = String(type ?? '').toUpperCase() as ReportType;
    if (!REPORT_TYPES.includes(reportType)) {
      throw new Error(`Unknown report type '${type}'. Valid types: ${REPORT_TYPES.join(', ')}`);
    }

    switch (reportType) {
      case 'PAYROLL_REGISTER': return this.payrollRegister(params);
      case 'SALARY_REGISTER': return this.salaryRegister(params);
      case 'PAYSLIP_SUMMARY': return this.payslipSummary(params);
      case 'TAX': return this.taxReport(params);
      case 'PF': return this.pfReport(params);
      case 'ESI': return this.esiReport(params);
      case 'PT': return this.ptReport(params);
      case 'BONUS': return this.awardReport(params, 'BONUS');
      case 'INCENTIVE': return this.awardReport(params, 'INCENTIVE');
      case 'OVERTIME': return this.overtimeReport(params);
      case 'COMPLIANCE': return this.complianceReport(params);
      case 'COST_ANALYSIS': return this.costReport(params);
      case 'FINAL_SETTLEMENT': return this.settlementReport(params);
      case 'BANK_TRANSFER': return this.bankTransferReport(params);
      case 'AUDIT': return this.auditReport(params);
      default: throw new Error(`Unknown report type '${type}'`);
    }
  }

  async exportCsv(type: string, params: ReportParams = {}): Promise<{ csv: string; fileName: string; rowCount: number }> {
    const report = await this.generateReport(type, params);
    const stamp = todayString();
    return {
      csv: generateCsv(report.columns, report.rows),
      fileName: `${String(type).toLowerCase()}-${stamp}.csv`,
      rowCount: report.rows.length,
    };
  }

  /** Large exports are handed to the job queue instead of held on the socket. */
  async queueReport(type: string, params: ReportParams, userId: number): Promise<{ jobId: number; jobType: string }> {
    const reportType = String(type ?? '').toUpperCase() as ReportType;
    if (!REPORT_TYPES.includes(reportType)) {
      throw new Error(`Unknown report type '${type}'. Valid types: ${REPORT_TYPES.join(', ')}`);
    }
    const jobId = await jobQueueService.enqueue('PAYROLL_REPORT', { type: reportType, params }, userId);
    return { jobId: Number(jobId), jobType: 'PAYROLL_REPORT' };
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async logAudit(entry: AuditEntryInput): Promise<void> {
    await this.repo.logAudit(entry);
  }

  async listAudit(filters: AuditFilters): Promise<Paged<AuditEntry>> {
    return this.repo.listAudit(filters);
  }

  // -------------------------------------------------------------------------
  // Run register (read side; the engine owns writes)
  // -------------------------------------------------------------------------

  async listRuns(filters: { periodId?: number; status?: string; runType?: string; limit?: number }): Promise<RunSummary[]> {
    return this.repo.listRuns(filters);
  }

  async getRun(id: number): Promise<RunSummary> {
    const run = await this.repo.findRunById(id);
    if (!run) throw new Error('Payroll run not found');
    run.errors = await this.repo.listRunErrors(id);
    return run;
  }

  async setRunStatus(id: number, status: string, userId: number): Promise<RunSummary> {
    await this.getRun(id);
    await this.repo.setRunStatus(id, status, userId);
    return this.getRun(id);
  }

  // -------------------------------------------------------------------------
  // Report builders
  // -------------------------------------------------------------------------

  private async resolvePeriod(params: ReportParams): Promise<{ id: number; label: string; fromDate: string; toDate: string }> {
    const period = params.periodId
      ? await this.repo.findPeriod(params.periodId)
      : await this.repo.findLatestPeriod();
    if (!period) throw new Error('No salary period is available for this report');
    return period;
  }

  private async payrollRegister(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const rows = await this.repo.reportPayrollRegister(period.id);
    return {
      columns: [
        'Employee Code', 'Name', 'Department', 'Branch', 'Grade', 'Worker Type',
        'Paid Days', 'LOP Days', 'Gross', 'Deductions', 'Net Pay', 'Employer Cost',
        'Payment Status', 'Payment Reference',
      ],
      rows: rows.map((r) => [
        r.emp_code, r.full_name, r.department ?? '', r.branch ?? '', r.pay_grade ?? '', r.worker_type ?? '',
        Number(r.paid_days ?? 0), Number(r.lop_days ?? 0), round2(Number(r.gross_amount ?? 0)),
        round2(Number(r.total_deductions ?? 0)), round2(Number(r.net_amount ?? 0)),
        round2(Number(r.employer_cost ?? 0)), r.payment_status, r.payment_reference ?? '',
      ]),
      meta: {
        report: 'PAYROLL_REGISTER',
        period,
        employees: rows.length,
        totalNet: round2(rows.reduce((s, r) => s + Number(r.net_amount ?? 0), 0)),
      },
    };
  }

  private async salaryRegister(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const rows = await this.repo.reportSalaryRegister(period.id);
    return {
      columns: [
        'Employee Code', 'Name', 'Fixed', 'Piece Rate', 'Overtime', 'Bonus', 'Incentive',
        'Variable Pay', 'Arrears', 'Reimbursement', 'Gross', 'PF', 'ESI', 'PT', 'TDS',
        'Loan', 'Advance', 'LWF', 'Insurance', 'Other', 'Total Deductions', 'Net Pay',
      ],
      rows: rows.map((r) => [
        r.emp_code, r.full_name,
        round2(Number(r.earn_fixed ?? 0)), round2(Number(r.earn_piece ?? 0)), round2(Number(r.earn_ot ?? 0)),
        round2(Number(r.earn_bonus ?? 0)), round2(Number(r.earn_incentive ?? 0)), round2(Number(r.earn_variable ?? 0)),
        round2(Number(r.earn_arrears ?? 0)), round2(Number(r.earn_reimbursement ?? 0)),
        round2(Number(r.gross_amount ?? 0)),
        round2(Number(r.ded_pf ?? 0)), round2(Number(r.ded_esi ?? 0)), round2(Number(r.ded_pt ?? 0)),
        round2(Number(r.ded_income_tax ?? 0)), round2(Number(r.ded_loan ?? 0)), round2(Number(r.ded_advance ?? 0)),
        round2(Number(r.ded_lwf ?? 0)), round2(Number(r.ded_insurance ?? 0)), round2(Number(r.ded_other ?? 0)),
        round2(Number(r.total_deductions ?? 0)), round2(Number(r.net_amount ?? 0)),
      ]),
      meta: { report: 'SALARY_REGISTER', period, employees: rows.length },
    };
  }

  private async payslipSummary(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const rows = await this.repo.reportPayslipSummary(period.id);
    return {
      columns: ['Payslip Id', 'Employee Code', 'Name', 'Period', 'Gross', 'Deductions', 'Net Pay', 'Payment Status', 'Components'],
      rows: rows.map((r) => [
        Number(r.line_id), r.emp_code, r.full_name, r.period_label,
        round2(Number(r.gross_amount ?? 0)), round2(Number(r.total_deductions ?? 0)),
        round2(Number(r.net_amount ?? 0)), r.payment_status, Number(r.component_count ?? 0),
      ]),
      meta: { report: 'PAYSLIP_SUMMARY', period, payslips: rows.length },
    };
  }

  private async taxReport(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const fy = params.financialYear ?? financialYearOf(period.fromDate);
    const rows = await this.repo.reportTax(period.id, fy);
    return {
      columns: [
        'Employee Code', 'Name', 'PAN', 'Regime', 'Gross (period)', 'Taxable (period)', 'TDS (period)',
        'Annual Gross', 'Annual Taxable', 'Annual Tax', 'Tax Paid To Date', 'Monthly TDS',
      ],
      rows: rows.map((r) => [
        r.emp_code, r.full_name, r.pan ?? '', r.regime ?? '',
        round2(Number(r.gross_amount ?? 0)), round2(Number(r.taxable_income ?? 0)), round2(Number(r.ded_income_tax ?? 0)),
        round2(Number(r.gross_annual ?? 0)), round2(Number(r.annual_taxable ?? 0)), round2(Number(r.annual_tax ?? 0)),
        round2(Number(r.tax_paid_to_date ?? 0)), round2(Number(r.monthly_tds ?? 0)),
      ]),
      meta: {
        report: 'TAX',
        period,
        financialYear: fy,
        totalTds: round2(rows.reduce((s, r) => s + Number(r.ded_income_tax ?? 0), 0)),
      },
    };
  }

  private async pfReport(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const rows = await this.repo.reportPf(period.id);
    return {
      columns: ['Employee Code', 'Name', 'UAN', 'Gross', 'Employee PF', 'Employer PF', 'Total PF'],
      rows: rows.map((r) => [
        r.emp_code, r.full_name, r.uan_number ?? '',
        round2(Number(r.gross_amount ?? 0)), round2(Number(r.ded_pf ?? 0)),
        round2(Number(r.employer_pf ?? 0)), round2(Number(r.total_pf ?? 0)),
      ]),
      meta: {
        report: 'PF',
        period,
        employees: rows.length,
        missingUan: rows.filter((r) => !r.uan_number).length,
        total: round2(rows.reduce((s, r) => s + Number(r.total_pf ?? 0), 0)),
      },
    };
  }

  private async esiReport(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const rows = await this.repo.reportEsi(period.id);
    return {
      columns: ['Employee Code', 'Name', 'ESIC Number', 'Gross', 'Employee ESI', 'Employer ESI', 'Total ESI'],
      rows: rows.map((r) => [
        r.emp_code, r.full_name, r.esic_number ?? '',
        round2(Number(r.gross_amount ?? 0)), round2(Number(r.ded_esi ?? 0)),
        round2(Number(r.employer_esi ?? 0)), round2(Number(r.total_esi ?? 0)),
      ]),
      meta: {
        report: 'ESI',
        period,
        employees: rows.length,
        missingEsic: rows.filter((r) => !r.esic_number).length,
        total: round2(rows.reduce((s, r) => s + Number(r.total_esi ?? 0), 0)),
      },
    };
  }

  private async ptReport(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const rows = await this.repo.reportPt(period.id);
    return {
      columns: ['Employee Code', 'Name', 'State', 'Branch', 'Gross', 'Professional Tax'],
      rows: rows.map((r) => [
        r.emp_code, r.full_name, r.state ?? '', r.branch ?? '',
        round2(Number(r.gross_amount ?? 0)), round2(Number(r.ded_pt ?? 0)),
      ]),
      meta: {
        report: 'PT',
        period,
        employees: rows.length,
        total: round2(rows.reduce((s, r) => s + Number(r.ded_pt ?? 0), 0)),
      },
    };
  }

  private async awardReport(params: ReportParams, awardClass: 'BONUS' | 'INCENTIVE'): Promise<ReportResult> {
    const range = defaultRange(params);
    const rows = await this.repo.reportAwards(range, awardClass);
    return {
      columns: [
        'Employee Code', 'Name', 'Type', 'Title', 'Amount', 'Currency',
        'Target', 'Achieved', 'Achievement %', 'Effective Date', 'Status',
      ],
      rows: rows.map((r) => [
        r.emp_code, r.full_name, r.award_type, r.title, round2(Number(r.amount ?? 0)), r.currency,
        r.target_value === null ? '' : round2(Number(r.target_value)),
        r.achieved_value === null ? '' : round2(Number(r.achieved_value)),
        r.achievement_pct === null ? '' : Number(r.achievement_pct),
        r.effective_date instanceof Date ? r.effective_date.toISOString().slice(0, 10) : String(r.effective_date ?? ''),
        r.status,
      ]),
      meta: {
        report: awardClass,
        range,
        awards: rows.length,
        total: round2(rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)),
      },
    };
  }

  private async overtimeReport(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const rows = await this.repo.reportOvertime(period.id);
    const totalHours = rows.reduce((s, r) => s + Number(r.ot_hours ?? 0), 0);
    const totalAmount = rows.reduce((s, r) => s + Number(r.earn_ot ?? 0), 0);
    return {
      columns: ['Employee Code', 'Name', 'Department', 'Present Days', 'OT Hours', 'OT Amount', 'Effective Rate'],
      rows: rows.map((r) => {
        const hours = Number(r.ot_hours ?? 0);
        const amount = Number(r.earn_ot ?? 0);
        return [
          r.emp_code, r.full_name, r.department ?? '', Number(r.present_days ?? 0),
          round2(hours), round2(amount), hours > 0 ? round2(amount / hours) : 0,
        ];
      }),
      meta: {
        report: 'OVERTIME',
        period,
        employees: rows.length,
        totalHours: round2(totalHours),
        totalAmount: round2(totalAmount),
        averageRate: totalHours > 0 ? round2(totalAmount / totalHours) : 0,
      },
    };
  }

  private async complianceReport(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const status = await this.getComplianceStatus(period.id);
    const t = status.totals;
    const m = status.missingData;

    return {
      columns: ['Head', 'Employee Share', 'Employer Share', 'Total', 'Note'],
      rows: [
        ['Provident Fund', t.pfEmployee, t.pfEmployer, t.pfTotal, m.missingUan > 0 ? `${m.missingUan} without UAN` : 'Ready'],
        ['Employee State Insurance', t.esiEmployee, t.esiEmployer, t.esiTotal, m.missingEsic > 0 ? `${m.missingEsic} without ESIC` : 'Ready'],
        ['Professional Tax', t.professionalTax, 0, t.professionalTax, 'Ready'],
        ['Income Tax (TDS)', t.tds, 0, t.tds, m.missingPan > 0 ? `${m.missingPan} without PAN` : 'Ready'],
        ['Total statutory liability', '', '', t.grandTotal, status.readyToFile ? 'Ready to file' : 'Blocked'],
      ],
      meta: {
        report: 'COMPLIANCE',
        period,
        filingBlockers: status.filingBlockers,
        readyToFile: status.readyToFile,
        missingData: m,
      },
    };
  }

  private async costReport(params: ReportParams): Promise<ReportResult> {
    const analytics = await this.getCostAnalytics(params);
    const rows: any[][] = [];
    const push = (dimension: string, buckets: BucketAmount[]) => {
      for (const b of buckets) {
        rows.push([
          dimension, b.bucket, b.employees, round2(b.gross), round2(b.deductions),
          round2(b.net), round2(b.employerCost), pct(b.gross, analytics.totals.gross),
        ]);
      }
    };
    push('Department', analytics.byDepartment);
    push('Branch', analytics.byBranch);
    push('Grade', analytics.byGrade);
    push('Worker Type', analytics.byWorkerType);

    return {
      columns: ['Dimension', 'Bucket', 'Employees', 'Gross', 'Deductions', 'Net', 'Employer Cost', 'Share %'],
      rows,
      meta: { report: 'COST_ANALYSIS', range: analytics.range, totals: analytics.totals },
    };
  }

  private async settlementReport(params: ReportParams): Promise<ReportResult> {
    const range = defaultRange(params);
    const rows = await this.repo.reportFinalSettlement(range);
    return {
      columns: [
        'Employee Code', 'Name', 'Type', 'Last Working Date', 'Pending Salary', 'Leave Encashment',
        'Gratuity', 'Bonus', 'Other Earnings', 'Notice Recovery', 'Loan Recovery', 'Advance Recovery',
        'Tax', 'Gross Payable', 'Total Recovery', 'Net Settlement', 'Status',
      ],
      rows: rows.map((r) => [
        r.emp_code, r.full_name, r.settlement_type,
        r.last_working_date instanceof Date ? r.last_working_date.toISOString().slice(0, 10) : String(r.last_working_date ?? ''),
        round2(Number(r.pending_salary ?? 0)), round2(Number(r.leave_encashment_amount ?? 0)),
        round2(Number(r.gratuity_amount ?? 0)), round2(Number(r.bonus_payable ?? 0)),
        round2(Number(r.other_earnings ?? 0)), round2(Number(r.notice_recovery ?? 0)),
        round2(Number(r.loan_recovery ?? 0)), round2(Number(r.advance_recovery ?? 0)),
        round2(Number(r.tax_deduction ?? 0)), round2(Number(r.gross_payable ?? 0)),
        round2(Number(r.total_recovery ?? 0)), round2(Number(r.net_settlement ?? 0)), r.status,
      ]),
      meta: {
        report: 'FINAL_SETTLEMENT',
        range,
        settlements: rows.length,
        total: round2(rows.reduce((s, r) => s + Number(r.net_settlement ?? 0), 0)),
      },
    };
  }

  private async bankTransferReport(params: ReportParams): Promise<ReportResult> {
    const period = await this.resolvePeriod(params);
    const items = await this.bankRepo.listItemsForPeriod(period.id);
    return {
      columns: [
        'Batch No', 'Batch Status', 'Employee Code', 'Beneficiary', 'Account Number', 'IFSC',
        'Amount', 'Currency', 'Item Status', 'UTR Reference', 'Validation', 'Failure Reason',
      ],
      rows: items.map((i) => [
        i.batchNo, i.batchStatus, i.empCode ?? '', i.beneficiaryName, i.accountNumber ?? '', i.ifsc ?? '',
        round2(i.amount), i.currency, i.status, i.utrReference ?? '', i.validationStatus, i.failureReason ?? '',
      ]),
      meta: {
        report: 'BANK_TRANSFER',
        period,
        records: items.length,
        invalidRecords: items.filter((i) => i.validationStatus !== 'VALID').length,
        totalValid: round2(items.filter((i) => i.validationStatus === 'VALID').reduce((s, i) => s + i.amount, 0)),
      },
    };
  }

  private async auditReport(params: ReportParams): Promise<ReportResult> {
    const range = defaultRange(params);
    const page = await this.repo.listAudit({
      from: range.from,
      to: range.to,
      periodId: params.periodId,
      employeeId: params.employeeId,
      page: 1,
      pageSize: Math.min(500, Math.max(1, Number(params.limit) || 500)),
    });
    return {
      columns: [
        'When', 'Entity', 'Entity Id', 'Action', 'Summary', 'Field', 'Previous', 'New',
        'Actor', 'Role', 'IP', 'Device', 'Browser',
      ],
      rows: page.rows.map((r) => [
        r.createdAt ?? '', r.entityType, r.entityId ?? '', r.action, r.summary, r.fieldName ?? '',
        r.previousValue ?? '', r.newValue ?? '', r.actorName ?? '', r.actorRole ?? '',
        r.ipAddress ?? '', r.device ?? '', r.browser ?? '',
      ]),
      meta: { report: 'AUDIT', range, total: page.total, returned: page.rows.length },
    };
  }
}
