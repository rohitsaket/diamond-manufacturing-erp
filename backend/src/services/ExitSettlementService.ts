import PDFDocument from 'pdfkit';
import { env } from '../config/env';
import { ExitSettlementRepository } from '../repositories/ExitSettlementRepository';
import { PerfActionContext } from '../types/performance';
import { StatutoryConfigRow } from '../types/compliance';
import { daysBetween, minDate, round2, toDateString, todayString } from '../utils/dateUtils';
import { num, yearsOfService } from '../utils/payrollMath';
import { computeGratuityProvision, financialYearOf, resolveConfig } from '../utils/statutoryRules';
import { ExitAuditService } from './ExitAuditService';
import { NotificationService } from './NotificationService';
import { numberToWords } from './PayslipService';

/**
 * Full-and-final settlement computation and workflow.
 *
 * Honesty contract: every figure carries a `componentBasis` entry naming the
 * records it came from. Components with no backing data are 0 with a reason,
 * never an invented number. The componentBasis is persisted in the row's
 * `clearance_json` column at compute time (the payroll table has no dedicated
 * column for it) and returned verbatim on reads.
 *
 * Basis decisions, stated once here:
 * - pendingSalary: sum of the employee's salary_lines whose salary_period
 *   status is not 'PAID' AND whose own paid_at is null. salary_periods uses
 *   OPEN/LOCKED/PAID, so "not PAID" = OPEN or LOCKED.
 * - per-day rate: fixed-pay workers (DHAR/MAXI with a compensation record) use
 *   monthly gross / 26; piece-rate workers use the average of the last three
 *   salary_lines' total_amount / 26 (total_amount is the line's gross).
 * - notice buyout is money the EMPLOYEE pays: when a buyout was recorded on
 *   the separation it appears as a recovery, never as an earning.
 */

export interface ComponentBasisEntry {
  component: string;
  amount: number;
  basis: string;
}

export interface SettlementResponse {
  id: number;
  employeeId: number;
  employeeName: string | null;
  empCode: string | null;
  workerType: string | null;
  settlementType: string;
  lastWorkingDate: string | null;
  noticePeriodDays: number | null;
  noticeServedDays: number | null;
  noticeShortfallDays: number | null;
  currency: string;
  pendingSalary: number;
  leaveEncashmentDays: number;
  leaveEncashmentAmount: number;
  gratuityYears: number;
  gratuityAmount: number;
  bonusPayable: number;
  otherEarnings: number;
  noticeRecovery: number;
  loanRecovery: number;
  advanceRecovery: number;
  assetRecovery: number;
  taxDeduction: number;
  otherDeductions: number;
  grossPayable: number;
  totalRecovery: number;
  netSettlement: number;
  status: string;
  approvedBy: number | null;
  approvedAt: string | null;
  paidAt: string | null;
  remarks: string | null;
  createdAt: string | null;
  componentBasis?: ComponentBasisEntry[];
}

const COMPUTABLE_SEPARATION_STATUSES = ['APPROVED', 'IN_NOTICE', 'CLEARANCE', 'SETTLEMENT', 'COMPLETED'];

const SETTLEMENT_TYPE_BY_SEPARATION: Record<string, string> = {
  RESIGNATION: 'RESIGNATION',
  RETIREMENT: 'RETIREMENT',
  TERMINATION: 'TERMINATION',
  LAYOFF: 'TERMINATION',
  ABSCONDING: 'TERMINATION',
  DEATH_IN_SERVICE: 'DEATH',
  CONTRACT_END: 'END_OF_CONTRACT',
  MUTUAL: 'RESIGNATION',
  ENTITY_TRANSFER: 'END_OF_CONTRACT',
};

function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export class ExitSettlementService {
  private repo = new ExitSettlementRepository();
  private audit = new ExitAuditService();
  private notifications = new NotificationService();

  // ===========================================================================
  // Compute
  // ===========================================================================

  async compute(separationId: number, ctx: PerfActionContext): Promise<{ settlement: SettlementResponse; componentBasis: ComponentBasisEntry[]; warnings: string[] }> {
    const sep = await this.repo.findSeparation(separationId);
    if (!sep) throw new Error(`Separation ${separationId} was not found`);
    if (!COMPUTABLE_SEPARATION_STATUSES.includes(String(sep.status))) {
      throw new Error(`Settlement cannot be computed while the separation is ${sep.status}; it must be approved first`);
    }

    const employeeId = Number(sep.employee_id);
    const locked = await this.repo.findLockedForEmployee(employeeId);
    if (locked) {
      throw new Error(
        `Settlement ${locked.id} for this employee is ${locked.status} and cannot be recomputed. `
        + 'Approved or paid settlements are never overwritten.',
      );
    }

    const basis: ComponentBasisEntry[] = [];
    const warnings: string[] = [];

    const lwd = sep.last_working_day
      ? toDateString(sep.last_working_day)
      : (sep.notice_end ? toDateString(sep.notice_end) : todayString());
    if (!sep.last_working_day) {
      warnings.push('The separation has no last working day on record; the notice end (or today) was used instead.');
    }

    // --- per-day rate --------------------------------------------------------
    const rate = await this.resolvePerDayRate(sep, lwd);
    basis.push({ component: 'perDayRate', amount: rate.perDay, basis: rate.basis });
    warnings.push(...rate.warnings);

    // --- pending salary ------------------------------------------------------
    const unpaidLines = await this.repo.findUnpaidSalaryLines(employeeId);
    const pendingSalary = round2(unpaidLines.reduce((s, l) => s + num(l.total_amount), 0));
    if (unpaidLines.length > 0) {
      basis.push({
        component: 'pendingSalary',
        amount: pendingSalary,
        basis: `Sum of ${unpaidLines.length} salary line(s) in periods not yet PAID (period status OPEN/LOCKED, line not individually paid): `
          + unpaidLines.map((l) => `${l.period_label} (${l.period_status}) ${num(l.total_amount).toFixed(2)}`).join('; '),
      });
    } else {
      basis.push({
        component: 'pendingSalary',
        amount: 0,
        basis: 'No unpaid salary lines exist: every salary line for this employee sits in a PAID period or is itself marked paid.',
      });
    }

    // --- leave encashment ----------------------------------------------------
    const year = Number(lwd.slice(0, 4));
    const balances = await this.repo.findLeaveBalances(employeeId, year);
    const paidBalances = balances.filter((b) => b.is_paid === 1 || b.is_paid === true);
    const remainingDays = round2(paidBalances.reduce((s, b) => s + Math.max(0, num(b.allocated) - num(b.used)), 0));
    const leaveEncashmentAmount = round2(remainingDays * rate.perDay);
    if (paidBalances.length > 0) {
      basis.push({
        component: 'leaveEncashment',
        amount: leaveEncashmentAmount,
        basis: `${remainingDays} remaining paid-leave day(s) for ${year} (`
          + paidBalances.map((b) => `${b.leave_code}: ${num(b.allocated)}-${num(b.used)}`).join(', ')
          + `) x per-day rate ${rate.perDay.toFixed(2)}`,
      });
    } else {
      basis.push({
        component: 'leaveEncashment',
        amount: 0,
        basis: `No paid-leave balance rows exist for ${year}, so there is nothing to encash.`,
      });
    }

    // --- gratuity --------------------------------------------------------------
    const joinedAt = toDateString(sep.joined_at);
    const years = yearsOfService(joinedAt, lwd);
    const gratuityConfigs = await this.repo.findGratuityConfigs();
    const gratuityCfg = resolveConfig(gratuityConfigs as unknown as StatutoryConfigRow[], 'GRATUITY', lwd);
    const monthlyWage = round2(rate.perDay * 26);
    const gratuityAmount = computeGratuityProvision(monthlyWage, years, gratuityCfg);
    if (!gratuityCfg) {
      basis.push({
        component: 'gratuity',
        amount: 0,
        basis: `No GRATUITY row in statutory_config is effective on ${lwd}; the amount is 0 rather than a guessed statutory figure.`,
      });
    } else if (gratuityAmount === 0) {
      basis.push({
        component: 'gratuity',
        amount: 0,
        basis: `Service of ${years} year(s) (${joinedAt} to ${lwd}) is below the configured minimum of ${num((gratuityCfg as any).gratuity_min_years)} year(s); nothing accrues.`,
      });
    } else {
      basis.push({
        component: 'gratuity',
        amount: gratuityAmount,
        basis: `computeGratuityProvision on last drawn monthly wage ${monthlyWage.toFixed(2)} (per-day x 26) for ${years} year(s) of service, `
          + `using the configured ${num((gratuityCfg as any).gratuity_days_per_year)}/${num((gratuityCfg as any).gratuity_denominator)} basis.`,
      });
    }
    if (String(sep.worker_type) === 'PIECE_RATE') {
      warnings.push(
        'Piece-rate worker: the gratuity wage basis is a piece-rate earnings average, not a fixed basic+DA. Treat the gratuity figure as an estimate to be confirmed by HR.',
      );
    }

    // --- notice recovery ---------------------------------------------------------
    const noticeDays = sep.notice_days === null || sep.notice_days === undefined ? null : Number(sep.notice_days);
    let noticeServedDays: number | null = null;
    let noticeShortfallDays: number | null = null;
    let noticeRecovery = 0;
    const noticeStart = sep.notice_start ? toDateString(sep.notice_start) : (sep.resignation_date ? toDateString(sep.resignation_date) : null);
    if (noticeStart && noticeDays !== null) {
      const servedUntil = minDate(lwd, todayString());
      noticeServedDays = servedUntil >= noticeStart ? daysBetween(noticeStart, servedUntil) : 0;
      noticeShortfallDays = Math.max(0, noticeDays - noticeServedDays);
    }
    if (sep.notice_waived === 1 || sep.notice_waived === true) {
      basis.push({
        component: 'noticeRecovery',
        amount: 0,
        basis: `Notice was waived on the separation record${sep.notice_waiver_reason ? ` (${sep.notice_waiver_reason})` : ''}; nothing is recovered.`,
      });
    } else if (num(sep.notice_buyout_amount) > 0) {
      noticeRecovery = round2(num(sep.notice_buyout_amount));
      basis.push({
        component: 'noticeRecovery',
        amount: noticeRecovery,
        basis: `Notice buyout of ${noticeRecovery.toFixed(2)} recorded on the separation`
          + `${sep.notice_buyout_days ? ` for ${sep.notice_buyout_days} day(s)` : ''}. A buyout is payable BY the employee, so it enters as a recovery.`,
      });
    } else if (noticeShortfallDays !== null && noticeShortfallDays > 0) {
      noticeRecovery = round2(noticeShortfallDays * rate.perDay);
      basis.push({
        component: 'noticeRecovery',
        amount: noticeRecovery,
        basis: `${noticeShortfallDays} day(s) short of the ${noticeDays}-day notice (served ${noticeServedDays} from ${noticeStart}) x per-day rate ${rate.perDay.toFixed(2)}`,
      });
    } else {
      basis.push({
        component: 'noticeRecovery',
        amount: 0,
        basis: noticeDays === null
          ? 'The separation records no notice period, so there is no shortfall to recover.'
          : `The full ${noticeDays}-day notice was served (${noticeServedDays ?? 0} day(s) from ${noticeStart ?? 'n/a'}); nothing to recover.`,
      });
    }

    // --- loan and advance recovery -------------------------------------------------
    const loans = await this.repo.findOutstandingLoans(employeeId);
    const loanRecovery = round2(loans.reduce((s, l) => s + num(l.outstanding), 0));
    basis.push({
      component: 'loanRecovery',
      amount: loanRecovery,
      basis: loans.length > 0
        ? 'Outstanding principal of PENDING installments on active loans: '
          + loans.map((l) => `loan #${l.id} (${l.loan_type}) ${num(l.outstanding).toFixed(2)}`).join('; ')
        : 'No active employee_loans rows exist for this employee.',
    });

    const advances = await this.repo.findOutstandingAdvances(employeeId);
    const advanceRecovery = round2(advances.reduce((s, a) => s + Math.max(0, num(a.amount) - num(a.recovered)), 0));
    basis.push({
      component: 'advanceRecovery',
      amount: advanceRecovery,
      basis: advances.length > 0
        ? 'Active advances less recorded recoveries: '
          + advances.map((a) => `advance #${a.id} ${num(a.amount).toFixed(2)} - recovered ${num(a.recovered).toFixed(2)}`).join('; ')
        : 'No active advances rows exist for this employee.',
    });

    // --- asset recovery ---------------------------------------------------------
    const assetDamage = await this.repo.findAssetDamage(separationId);
    const assetRecovery = round2(assetDamage.total);
    basis.push({
      component: 'assetRecovery',
      amount: assetRecovery,
      basis: assetDamage.chargedRows > 0
        ? `Sum of damage charges on ${assetDamage.chargedRows} asset return(s) for this separation.`
        : 'No asset returns for this separation carry a damage charge.',
    });

    // --- tax --------------------------------------------------------------------
    const financialYear = financialYearOf(lwd);
    const taxComp = await this.repo.findTaxComputation(employeeId, financialYear);
    const taxDeduction = taxComp ? round2(num(taxComp.monthly_tds)) : 0;
    basis.push({
      component: 'taxDeduction',
      amount: taxDeduction,
      basis: taxComp
        ? `Monthly TDS ${taxDeduction.toFixed(2)} from the ${financialYear} tax computation on record. Final tax on the settlement components themselves is not computed by this system.`
        : `No tax computation exists for ${financialYear}; TDS on the settlement must be assessed manually, so 0 is recorded rather than a guess.`,
    });

    // --- totals -----------------------------------------------------------------
    const existing = await this.repo.findOpenForEmployee(employeeId);
    const bonusPayable = existing ? round2(num(existing.bonus_payable)) : 0;
    const otherEarnings = existing ? round2(num(existing.other_earnings)) : 0;
    const otherDeductions = existing ? round2(num(existing.other_deductions)) : 0;
    if (existing && (bonusPayable !== 0 || otherEarnings !== 0 || otherDeductions !== 0)) {
      basis.push({
        component: 'manualAdjustments',
        amount: round2(bonusPayable + otherEarnings - otherDeductions),
        basis: `Manual adjustments preserved from the existing draft: bonus ${bonusPayable.toFixed(2)}, other earnings ${otherEarnings.toFixed(2)}, other deductions ${otherDeductions.toFixed(2)}.`,
      });
    }

    const grossPayable = round2(pendingSalary + leaveEncashmentAmount + gratuityAmount + bonusPayable + otherEarnings);
    const totalRecovery = round2(noticeRecovery + loanRecovery + advanceRecovery + assetRecovery + taxDeduction + otherDeductions);
    const netSettlement = round2(grossPayable - totalRecovery);

    const clearanceJson = JSON.stringify({
      componentBasis: basis,
      warnings,
      computedAt: new Date().toISOString(),
      separationId,
      sepCode: sep.sep_code,
    });

    const data = {
      employeeId,
      settlementType: SETTLEMENT_TYPE_BY_SEPARATION[String(sep.separation_type)] ?? 'RESIGNATION',
      lastWorkingDate: lwd,
      noticePeriodDays: noticeDays,
      noticeServedDays,
      noticeShortfallDays,
      pendingSalary,
      leaveEncashmentDays: remainingDays,
      leaveEncashmentAmount,
      gratuityYears: round2(years),
      gratuityAmount,
      bonusPayable,
      otherEarnings,
      noticeRecovery,
      loanRecovery,
      advanceRecovery,
      assetRecovery,
      taxDeduction,
      otherDeductions,
      grossPayable,
      totalRecovery,
      netSettlement,
      status: 'CALCULATED',
      clearanceJson,
    };

    let id: number;
    if (existing) {
      id = Number(existing.id);
      await this.repo.updateComputed(id, data, ctx.userId);
    } else {
      id = await this.repo.insert(data, ctx.userId);
    }

    await this.audit.record('FINAL_SETTLEMENT', id, existing ? 'RECOMPUTE' : 'COMPUTE', ctx,
      existing ? { status: existing.status, netSettlement: num(existing.net_settlement) } : null,
      { separationId, grossPayable, totalRecovery, netSettlement });

    const settlement = await this.requireRow(id);
    return { settlement: this.toResponse(settlement, basis), componentBasis: basis, warnings };
  }

  /**
   * Per-day pay rate with an honest provenance string.
   * Fixed-pay workers (DHAR/MAXI) divide their monthly gross by 26; piece-rate
   * workers average their last three salary lines. 26 is the statutory
   * working-days-per-month convention used across this payroll.
   */
  private async resolvePerDayRate(
    sep: any,
    lwd: string,
  ): Promise<{ perDay: number; basis: string; warnings: string[] }> {
    const warnings: string[] = [];
    const workerType = String(sep.worker_type ?? '');
    const employeeId = Number(sep.employee_id);

    if (workerType === 'DHAR' || workerType === 'MAXI') {
      const revision = await this.repo.findSalaryRevision(employeeId, lwd);
      if (revision && num(revision.monthly_gross) > 0) {
        const perDay = round2(num(revision.monthly_gross) / 26);
        return {
          perDay,
          basis: `Fixed pay: employee_salary revision #${revision.id} monthly gross ${num(revision.monthly_gross).toFixed(2)} / 26 = ${perDay.toFixed(2)}`,
          warnings,
        };
      }
      if (num(sep.monthly_salary) > 0) {
        const perDay = round2(num(sep.monthly_salary) / 26);
        return {
          perDay,
          basis: `Fixed pay: employees.monthly_salary ${num(sep.monthly_salary).toFixed(2)} / 26 = ${perDay.toFixed(2)} (no employee_salary revision covers ${lwd})`,
          warnings,
        };
      }
      warnings.push(`${workerType} worker has no monthly salary on record; fell back to the piece-rate average basis.`);
    }

    const recent = await this.repo.findRecentSalaryLines(employeeId, 3);
    if (recent.length === 0) {
      warnings.push('No salary lines exist for this employee, so the per-day rate is 0 and every rate-based component is 0.');
      return { perDay: 0, basis: 'No salary history exists; per-day rate is 0.', warnings };
    }
    const avg = round2(recent.reduce((s, l) => s + num(l.total_amount), 0) / recent.length);
    const perDay = round2(avg / 26);
    return {
      perDay,
      basis: `Piece-rate: average of last ${recent.length} salary line(s) (`
        + recent.map((l) => `${l.period_label}: ${num(l.total_amount).toFixed(2)}`).join(', ')
        + `) = ${avg.toFixed(2)} / 26 = ${perDay.toFixed(2)}`,
      warnings,
    };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async list(filters: { status?: string; separationId?: number; limit?: number }): Promise<SettlementResponse[]> {
    let employeeId: number | undefined;
    if (filters.separationId) {
      const sep = await this.repo.findSeparation(filters.separationId);
      if (!sep) throw new Error(`Separation ${filters.separationId} was not found`);
      employeeId = Number(sep.employee_id);
    }
    const rows = await this.repo.findMany({ status: filters.status, employeeId, limit: filters.limit });
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: number): Promise<SettlementResponse> {
    const row = await this.requireRow(id);
    return this.toResponse(row, this.readStoredBasis(row));
  }

  /** ESS: the employee's own settlement, only once it is APPROVED or PAID. */
  async getForEmployee(employeeId: number): Promise<{ settlement: SettlementResponse | null; note: string }> {
    const row = await this.repo.findForEmployee(employeeId, ['APPROVED', 'PAID']);
    return {
      settlement: row ? this.toResponse(row, this.readStoredBasis(row)) : null,
      note: row
        ? 'Payment executes through Payroll → Bank Transfers; the paid status here records the completion.'
        : 'No approved or paid settlement is on record for you yet. Settlements appear here only after HR approval.',
    };
  }

  // ===========================================================================
  // Workflow
  // ===========================================================================

  async updateManual(
    id: number,
    input: { bonusPayable?: number; otherEarnings?: number; otherDeductions?: number; notes?: string | null },
    ctx: PerfActionContext,
  ): Promise<SettlementResponse> {
    const row = await this.requireRow(id);
    if (row.status !== 'DRAFT' && row.status !== 'CALCULATED') {
      throw new Error(`Settlement ${id} is ${row.status} and cannot be adjusted; only DRAFT or CALCULATED settlements accept manual changes`);
    }
    const bonusPayable = input.bonusPayable === undefined ? round2(num(row.bonus_payable)) : round2(num(input.bonusPayable));
    const otherEarnings = input.otherEarnings === undefined ? round2(num(row.other_earnings)) : round2(num(input.otherEarnings));
    const otherDeductions = input.otherDeductions === undefined ? round2(num(row.other_deductions)) : round2(num(input.otherDeductions));
    const remarks = input.notes === undefined ? (row.remarks ?? null) : (input.notes || null);

    const grossPayable = round2(
      num(row.pending_salary) + num(row.leave_encashment_amount) + num(row.gratuity_amount) + bonusPayable + otherEarnings,
    );
    const totalRecovery = round2(
      num(row.notice_recovery) + num(row.loan_recovery) + num(row.advance_recovery)
      + num(row.asset_recovery) + num(row.tax_deduction) + otherDeductions,
    );
    const netSettlement = round2(grossPayable - totalRecovery);

    await this.repo.updateManual(id, { bonusPayable, otherEarnings, otherDeductions, remarks }, { grossPayable, totalRecovery, netSettlement }, ctx.userId);
    await this.audit.record('FINAL_SETTLEMENT', id, 'ADJUST', ctx,
      { bonusPayable: num(row.bonus_payable), otherEarnings: num(row.other_earnings), otherDeductions: num(row.other_deductions) },
      { bonusPayable, otherEarnings, otherDeductions, netSettlement });
    return this.get(id);
  }

  async submit(id: number, ctx: PerfActionContext): Promise<SettlementResponse> {
    const row = await this.requireRow(id);
    if (row.status !== 'CALCULATED') {
      throw new Error(`Settlement ${id} is ${row.status}; only a CALCULATED settlement can be submitted for approval`);
    }
    await this.repo.updateStatus(id, 'PENDING_APPROVAL', ctx.userId);
    await this.audit.record('FINAL_SETTLEMENT', id, 'SUBMIT', ctx, { status: row.status }, { status: 'PENDING_APPROVAL' });
    return this.get(id);
  }

  async approve(id: number, ctx: PerfActionContext): Promise<SettlementResponse> {
    const row = await this.requireRow(id);
    if (row.status !== 'PENDING_APPROVAL') {
      throw new Error(`Settlement ${id} is ${row.status}; only a PENDING_APPROVAL settlement can be approved`);
    }
    await this.repo.updateStatus(id, 'APPROVED', ctx.userId, { approvedBy: ctx.userId, approvedAt: new Date() });
    await this.audit.record('FINAL_SETTLEMENT', id, 'APPROVE', ctx, { status: row.status }, { status: 'APPROVED', netSettlement: num(row.net_settlement) });

    // Notify the employee's self-service account if one is still active.
    try {
      const user = await this.repo.findEmployeeUser(Number(row.employee_id));
      if (user && (user.is_active === 1 || user.is_active === true)) {
        await this.notifications.notify({
          userId: Number(user.id),
          category: 'OFFBOARDING',
          title: 'Your final settlement has been approved',
          body: `Net settlement of INR ${num(row.net_settlement).toFixed(2)} was approved. Payment executes through Payroll → Bank Transfers.`,
        });
      }
    } catch (err) {
      console.error('settlement approval notification failed:', err);
    }
    return this.get(id);
  }

  async reject(id: number, reason: string, ctx: PerfActionContext): Promise<SettlementResponse> {
    if (!reason || !reason.trim()) throw new Error('A rejection reason is required');
    const row = await this.requireRow(id);
    if (row.status !== 'PENDING_APPROVAL') {
      throw new Error(`Settlement ${id} is ${row.status}; only a PENDING_APPROVAL settlement can be rejected`);
    }
    const remarks = `Rejected: ${reason.trim()}`.slice(0, 1000);
    await this.repo.updateStatus(id, 'DRAFT', ctx.userId, { remarks });
    await this.audit.record('FINAL_SETTLEMENT', id, 'REJECT', ctx, { status: row.status }, { status: 'DRAFT', reason });
    return this.get(id);
  }

  async markPaid(id: number, paidAt: string | undefined, ctx: PerfActionContext): Promise<{ settlement: SettlementResponse; note: string }> {
    const row = await this.requireRow(id);
    if (row.status !== 'APPROVED') {
      throw new Error(`Settlement ${id} is ${row.status}; only an APPROVED settlement can be marked paid`);
    }
    const when = paidAt ? new Date(`${toDateString(paidAt)}T00:00:00Z`) : new Date();
    if (Number.isNaN(when.getTime())) throw new Error('paidAt is not a valid date');
    await this.repo.updateStatus(id, 'PAID', ctx.userId, { paidAt: when });
    await this.audit.record('FINAL_SETTLEMENT', id, 'MARK_PAID', ctx, { status: row.status }, { status: 'PAID', paidAt: when.toISOString() });
    return {
      settlement: await this.get(id),
      note: 'payment executes through Payroll → Bank Transfers; this records the completion',
    };
  }

  // ===========================================================================
  // Statement PDF
  // ===========================================================================

  async generateStatementPdf(id: number): Promise<{ buffer: Buffer; fileName: string }> {
    const row = await this.requireRow(id);
    const componentBasis = this.readStoredBasis(row) ?? [];
    const buffer = await this.renderStatement(this.toResponse(row), componentBasis);
    const safeCode = String(row.emp_code ?? row.employee_id).replace(/[^a-zA-Z0-9._-]/g, '_');
    return { buffer, fileName: `Final_Settlement_${safeCode}_${id}.pdf` };
  }

  private renderStatement(s: SettlementResponse, componentBasis: ComponentBasisEntry[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: { Title: `Final Settlement Statement ${s.empCode ?? s.employeeId}`, Author: env.company.name },
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const left = 40;
        const right = 555;
        const width = right - left;
        const money = (n: number) => n.toFixed(2);

        // --- header (PayslipService document style) --------------------------
        doc.fontSize(18).font('Helvetica-Bold').text(env.company.name, left, 40, { width, align: 'center' });
        doc.fontSize(11).font('Helvetica').text('FULL AND FINAL SETTLEMENT STATEMENT', { width, align: 'center' });
        doc.fontSize(8).fillColor('#666')
          .text(`Settlement #${s.id}   ·   Status: ${s.status}   ·   This is a settlement statement, NOT a payslip`, { width, align: 'center' });
        doc.fillColor('#000');
        doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).stroke();
        doc.moveDown(1.2);

        // --- employee block ---------------------------------------------------
        const blockTop = doc.y;
        const col2 = left + width / 2;
        const detail = (label: string, value: string, x: number, y: number) => {
          doc.fontSize(8).font('Helvetica').fillColor('#666').text(label, x, y, { width: width / 2 - 10 });
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#000').text(value || '-', x, y + 10, { width: width / 2 - 10 });
        };
        detail('Employee', `${s.employeeName ?? ''} (${s.empCode ?? s.employeeId})`, left, blockTop);
        detail('Settlement type', s.settlementType, col2, blockTop);
        detail('Last working date', s.lastWorkingDate ?? '-', left, blockTop + 26);
        detail(
          'Notice (period / served / shortfall)',
          `${s.noticePeriodDays ?? '-'} / ${s.noticeServedDays ?? '-'} / ${s.noticeShortfallDays ?? '-'} days`,
          col2,
          blockTop + 26,
        );
        doc.y = blockTop + 56;
        doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
        doc.moveDown(0.8);

        // --- earnings vs recoveries table --------------------------------------
        const earnings: [string, number][] = [
          ['Pending salary', s.pendingSalary],
          [`Leave encashment (${s.leaveEncashmentDays} days)`, s.leaveEncashmentAmount],
          [`Gratuity (${s.gratuityYears} yrs)`, s.gratuityAmount],
          ['Bonus payable', s.bonusPayable],
          ['Other earnings', s.otherEarnings],
        ];
        const recoveries: [string, number][] = [
          ['Notice recovery', s.noticeRecovery],
          ['Loan recovery', s.loanRecovery],
          ['Advance recovery', s.advanceRecovery],
          ['Asset recovery', s.assetRecovery],
          ['Tax deduction', s.taxDeduction],
          ['Other deductions', s.otherDeductions],
        ];

        const tableTop = doc.y;
        const midX = left + width / 2;
        const rowHeight = 15;
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Earnings', left + 4, tableTop + 4, { width: width / 2 - 60 });
        doc.text('Amount', midX - 64, tableTop + 4, { width: 60, align: 'right' });
        doc.text('Recoveries', midX + 4, tableTop + 4, { width: width / 2 - 60 });
        doc.text('Amount', right - 64, tableTop + 4, { width: 60, align: 'right' });

        const bodyTop = tableTop + 20;
        const maxRows = Math.max(earnings.length, recoveries.length);
        doc.font('Helvetica').fontSize(8.5);
        for (let i = 0; i < maxRows; i++) {
          const y = bodyTop + i * rowHeight;
          const e = earnings[i];
          const r = recoveries[i];
          if (e) {
            doc.text(e[0], left + 4, y, { width: width / 2 - 70, ellipsis: true });
            doc.text(money(e[1]), midX - 64, y, { width: 60, align: 'right' });
          }
          if (r) {
            doc.text(r[0], midX + 4, y, { width: width / 2 - 70, ellipsis: true });
            doc.text(money(r[1]), right - 64, y, { width: 60, align: 'right' });
          }
        }

        const totalsY = bodyTop + maxRows * rowHeight + 6;
        doc.moveTo(left, totalsY - 3).lineTo(right, totalsY - 3).stroke();
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text('Gross payable', left + 4, totalsY, { width: width / 2 - 70 });
        doc.text(money(s.grossPayable), midX - 64, totalsY, { width: 60, align: 'right' });
        doc.text('Total recovery', midX + 4, totalsY, { width: width / 2 - 70 });
        doc.text(money(s.totalRecovery), right - 64, totalsY, { width: 60, align: 'right' });

        const tableBottom = totalsY + rowHeight;
        doc.rect(left, tableTop, width, tableBottom - tableTop).stroke();
        doc.moveTo(midX, tableTop).lineTo(midX, tableBottom).stroke();
        doc.moveTo(left, tableTop + 16).lineTo(right, tableTop + 16).stroke();

        // --- net box -----------------------------------------------------------
        const netY = tableBottom + 12;
        doc.rect(left, netY, width, 40).fillAndStroke('#f2f4f7', '#000');
        doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('NET SETTLEMENT', left + 10, netY + 8);
        doc.fontSize(14).text(`${s.currency} ${money(s.netSettlement)}`, left + 10, netY + 8, { width: width - 20, align: 'right' });
        doc.fontSize(8).font('Helvetica').text(numberToWords(s.netSettlement), left + 10, netY + 26, { width: width - 20 });

        // --- component basis notes ----------------------------------------------
        let cursor = netY + 54;
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#111').text('How each figure was computed', left, cursor, { width });
        cursor = doc.y + 4;
        doc.fontSize(7.2).font('Helvetica').fillColor('#444');
        for (const entry of componentBasis) {
          doc.text(`• ${entry.component} = ${money(entry.amount)} — ${entry.basis}`, left, cursor, { width });
          cursor = doc.y + 3;
          if (cursor > 745) break; // keep to one page; the API payload carries the full list
        }

        // --- footer --------------------------------------------------------------
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#b45309').text(
          'This statement is not a payslip. Payment executes through Payroll → Bank Transfers; the PAID status in the system records completion.',
          left, 780, { width, align: 'center' },
        );
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async requireRow(id: number): Promise<any> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Settlement ${id} was not found`);
    return row;
  }

  /** componentBasis is stored in clearance_json at compute time; read it back. */
  private readStoredBasis(row: any): ComponentBasisEntry[] | undefined {
    if (!row.clearance_json) return undefined;
    try {
      const parsed = JSON.parse(String(row.clearance_json));
      return Array.isArray(parsed?.componentBasis) ? parsed.componentBasis : undefined;
    } catch {
      return undefined;
    }
  }

  private toResponse(row: any, componentBasis?: ComponentBasisEntry[]): SettlementResponse {
    return {
      id: Number(row.id),
      employeeId: Number(row.employee_id),
      employeeName: row.full_name ?? null,
      empCode: row.emp_code ?? null,
      workerType: row.worker_type ?? null,
      settlementType: String(row.settlement_type),
      lastWorkingDate: row.last_working_date ? toDateString(row.last_working_date) : null,
      noticePeriodDays: row.notice_period_days === null || row.notice_period_days === undefined ? null : Number(row.notice_period_days),
      noticeServedDays: row.notice_served_days === null || row.notice_served_days === undefined ? null : Number(row.notice_served_days),
      noticeShortfallDays: row.notice_shortfall_days === null || row.notice_shortfall_days === undefined ? null : Number(row.notice_shortfall_days),
      currency: String(row.currency ?? 'INR'),
      pendingSalary: round2(num(row.pending_salary)),
      leaveEncashmentDays: round2(num(row.leave_encashment_days)),
      leaveEncashmentAmount: round2(num(row.leave_encashment_amount)),
      gratuityYears: round2(num(row.gratuity_years)),
      gratuityAmount: round2(num(row.gratuity_amount)),
      bonusPayable: round2(num(row.bonus_payable)),
      otherEarnings: round2(num(row.other_earnings)),
      noticeRecovery: round2(num(row.notice_recovery)),
      loanRecovery: round2(num(row.loan_recovery)),
      advanceRecovery: round2(num(row.advance_recovery)),
      assetRecovery: round2(num(row.asset_recovery)),
      taxDeduction: round2(num(row.tax_deduction)),
      otherDeductions: round2(num(row.other_deductions)),
      grossPayable: round2(num(row.gross_payable)),
      totalRecovery: round2(num(row.total_recovery)),
      netSettlement: round2(num(row.net_settlement)),
      status: String(row.status),
      approvedBy: row.approved_by === null || row.approved_by === undefined ? null : Number(row.approved_by),
      approvedAt: toIso(row.approved_at),
      paidAt: toIso(row.paid_at),
      remarks: row.remarks ?? null,
      createdAt: toIso(row.created_at),
      ...(componentBasis ? { componentBasis } : {}),
    };
  }
}
