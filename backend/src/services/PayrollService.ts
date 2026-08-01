import { SalaryPeriodRepository } from '../repositories/SalaryPeriodRepository';
import { SalaryLineRepository } from '../repositories/SalaryLineRepository';
import { AdvanceRepository } from '../repositories/AdvanceRepository';
import { PayrollCalculationService } from './PayrollCalculationService';
import { NotificationService } from './NotificationService';
import { generateCsv } from '../utils/csv';
import { isValidDateString, toDateString, round2 } from '../utils/dateUtils';
import {
  ComplianceSummaryResponse,
  PayslipResponse,
  RecalculateResult,
  SalaryLineExtendedResponse,
  WorkerType,
} from '../types';

export class PayrollService {
  private periodRepo = new SalaryPeriodRepository();
  private lineRepo = new SalaryLineRepository();
  private advanceRepo = new AdvanceRepository();
  private calcService = new PayrollCalculationService();
  private notificationService = new NotificationService();

  async getPeriods() {
    return this.periodRepo.findAll();
  }

  async getOpenPeriod() {
    return this.periodRepo.findOpenPeriod();
  }

  async getPeriodLines(periodId: number) {
    return this.lineRepo.findByPeriod(periodId);
  }

  async lockPeriod(periodId: number, userId: number) {
    await this.periodRepo.lock(periodId, userId);
    return this.periodRepo.findById(periodId);
  }

  async markPaid(periodId: number, userId: number) {
    await this.periodRepo.markPaid(periodId, userId);
    return this.periodRepo.findById(periodId);
  }

  async managerVerify(lineId: number, userId: number) {
    await this.lineRepo.managerVerify(lineId, userId);
  }

  async managerUnverify(lineId: number) {
    await this.lineRepo.managerUnverify(lineId);
  }

  async accountVerify(lineId: number, userId: number) {
    const line = await this.lineRepo.findById(lineId);
    if (!line) throw new Error('Salary line not found');
    if (!line.manager_verified) throw new Error('Manager must verify first');
    await this.lineRepo.accountVerify(lineId, userId);
  }

  async accountUnverify(lineId: number) {
    await this.lineRepo.accountUnverify(lineId);
  }

  async createPeriod(data: { label: string; fromDate: string; toDate: string; createdBy: number }) {
    if (!isValidDateString(data.fromDate) || !isValidDateString(data.toDate)) {
      throw new Error('From and to dates must be valid YYYY-MM-DD dates');
    }
    if (data.fromDate > data.toDate) {
      throw new Error('The from date must not be after the to date');
    }
    // Overlapping periods would let the same work be paid twice.
    await this.calcService.validateNoOverlap(data.fromDate, data.toDate);
    return this.periodRepo.create(data);
  }

  /**
   * Rebuild all salary lines of a period from attendance, lots and advances,
   * then tell the payroll approvers that the figures moved.
   */
  async recalculatePeriod(periodId: number, userId: number, actorName: string): Promise<RecalculateResult> {
    const result = await this.calcService.recalculatePeriod(periodId, userId, actorName);
    const period = await this.periodRepo.findById(periodId);
    const label = period?.label ?? `#${periodId}`;

    await this.notificationService.notifyRoles(['admin', 'manager', 'accountant'], {
      category: 'PAYROLL',
      title: `Payroll recalculated — ${label}`,
      body:
        `${result.linesWritten} salary lines recomputed by ${actorName}. ` +
        `Gross ₹${result.totalGross.toFixed(2)}, net ₹${result.totalNet.toFixed(2)}. ` +
        'Verification has been reset and must be redone.' +
        (result.warnings.length > 0 ? ` ${result.warnings.length} warning(s).` : ''),
      linkPage: 'payroll',
    });

    return result;
  }

  /** Full payslip for one salary line. */
  async getPayslip(lineId: number): Promise<PayslipResponse> {
    const row = await this.lineRepo.findByIdWithEmployee(lineId);
    if (!row) throw new Error('Salary line not found');

    const n = (value: unknown): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    // Only components that actually paid out are printed.
    const earnings = [
      { label: 'Piece work', amount: n(row.earn_piece) },
      { label: 'Fixed pay', amount: n(row.earn_fixed) },
      { label: 'Overtime', amount: n(row.earn_ot) },
    ].filter((e) => e.amount !== 0);

    const deductions = [
      { label: 'Provident Fund', amount: n(row.ded_pf) },
      { label: 'ESI', amount: n(row.ded_esi) },
      { label: 'Professional Tax', amount: n(row.ded_pt) },
      { label: 'Advance recovery', amount: n(row.ded_advance) },
      { label: 'Other', amount: n(row.ded_other) },
    ].filter((d) => d.amount !== 0);

    const advanceRecoveries = await this.advanceRepo.getRecoveriesForSalaryLine(lineId);

    return {
      lineId: row.id,
      period: {
        id: row.period_id,
        label: row.period_label,
        fromDate: toDateString(row.period_from),
        toDate: toDateString(row.period_to),
        status: row.period_status,
      },
      employee: {
        id: row.employee_id,
        empCode: row.emp_code,
        fullName: row.employee_name,
        grade: row.grade,
        workerType: (row.worker_type ?? 'PIECE_RATE') as WorkerType,
        department: row.department ?? null,
        designation: row.designation ?? null,
        joinedAt: toDateString(row.joined_at),
        bankAccount: row.bank_account ?? null,
        bankIfsc: row.bank_ifsc ?? null,
        whatsapp: row.whatsapp ?? null,
      },
      attendance: {
        paidDays: n(row.paid_days),
        periodDays: n(row.period_days),
        presentDays: n(row.present_days),
        absentDays: n(row.absent_days),
        leaveDays: n(row.leave_days),
        otHours: n(row.ot_hours),
      },
      earnings,
      deductions,
      grossAmount: n(row.gross_amount),
      totalDeductions: n(row.total_deductions),
      netAmount: n(row.net_amount),
      advanceRecoveries,
    };
  }

  /** PF / ESI / PT register for a period. */
  async getComplianceSummary(periodId: number): Promise<ComplianceSummaryResponse> {
    const period = await this.periodRepo.findById(periodId);
    if (!period) throw new Error('Salary period not found');

    const [totals, lines] = await Promise.all([
      this.lineRepo.getComplianceTotals(periodId),
      this.lineRepo.findByPeriodExtended(periodId),
    ]);

    return {
      periodId,
      periodLabel: period.label,
      fromDate: period.fromDate,
      toDate: period.toDate,
      employeeCount: totals.employee_count,
      totalGross: round2(totals.total_gross),
      totalPf: round2(totals.total_pf),
      totalEsi: round2(totals.total_esi),
      totalPt: round2(totals.total_pt),
      totalAdvance: round2(totals.total_advance),
      totalDeductions: round2(totals.total_deductions),
      totalNet: round2(totals.total_net),
      rows: lines.map((l) => ({
        employeeId: l.employeeId,
        empCode: l.empCode,
        employeeName: l.employeeName,
        grossAmount: l.grossAmount,
        dedPf: l.dedPf,
        dedEsi: l.dedEsi,
        dedPt: l.dedPt,
        netAmount: l.netAmount,
      })),
    };
  }

  /** Payslip history for a self-service user. */
  async getMyPayslips(employeeId: number, limit = 24) {
    return this.lineRepo.getEmployeeLines(employeeId, limit);
  }

  /** Payslip for a self-service user, refusing any line that is not theirs. */
  async getMyPayslip(employeeId: number, lineId: number): Promise<PayslipResponse> {
    const line = await this.lineRepo.findById(lineId);
    if (!line) throw new Error('Salary line not found');
    if (line.employee_id !== employeeId) throw new Error('You can only view your own payslips');
    return this.getPayslip(lineId);
  }

  async exportCsv(periodId: number): Promise<string> {
    const lines = await this.lineRepo.findByPeriodExtended(periodId);

    const headers = [
      'Worker', 'Code', 'Worker Type', 'Paid Days', 'Total Carats', 'Lots',
      'Piece', 'Fixed', 'OT', 'Gross', 'PF', 'ESI', 'PT', 'Advance',
      'Total Deductions', 'Net', 'Mgr Verified', 'Acct Verified', 'Paid At',
    ];
    const data: unknown[][] = lines.map((l) => [
      l.employeeName,
      l.empCode,
      l.workerType ?? '',
      l.paidDays,
      l.totalCts,
      l.lotsCount,
      l.earnPiece,
      l.earnFixed,
      l.earnOt,
      l.grossAmount,
      l.dedPf,
      l.dedEsi,
      l.dedPt,
      l.dedAdvance,
      l.totalDeductions,
      l.netAmount,
      l.managerVerified ? 'Yes' : 'No',
      l.accountVerified ? 'Yes' : 'No',
      l.paidAt ?? '',
    ]);

    const sum = (pick: (l: SalaryLineExtendedResponse) => number): number =>
      round2(lines.reduce((acc, l) => acc + pick(l), 0));

    data.push([
      'TOTAL',
      '',
      '',
      sum((l) => l.paidDays),
      sum((l) => l.totalCts),
      sum((l) => l.lotsCount),
      sum((l) => l.earnPiece),
      sum((l) => l.earnFixed),
      sum((l) => l.earnOt),
      sum((l) => l.grossAmount),
      sum((l) => l.dedPf),
      sum((l) => l.dedEsi),
      sum((l) => l.dedPt),
      sum((l) => l.dedAdvance),
      sum((l) => l.totalDeductions),
      sum((l) => l.netAmount),
      '',
      '',
      '',
    ]);

    return generateCsv(headers, data);
  }
}
