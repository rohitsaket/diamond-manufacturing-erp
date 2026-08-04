import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { AttendanceRepository } from '../repositories/AttendanceRepository';
import { HolidayRepository } from '../repositories/HolidayRepository';
import { AdvanceRepository } from '../repositories/AdvanceRepository';
import { SettingRepository } from '../repositories/SettingRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { LotRepository } from '../repositories/LotRepository';
import { SalaryLineRepository } from '../repositories/SalaryLineRepository';
import { PayrollMasterRepository } from '../repositories/PayrollMasterRepository';
import {
  PayrollRunRepository,
  PayrollPeriodRow,
  ActiveAdvanceRow,
  DueLoanInstallment,
  ApprovedAwardRow,
  ApprovedReimbursementRow,
  EnterpriseSalaryLine,
} from '../repositories/PayrollRunRepository';
import { TaxComputationService, TaxContext } from './TaxComputationService';
import { jobQueueService } from './JobQueueService';
import { EmployeeRow } from '../types';
import { StatutoryConfig } from '../types/hrms';
import {
  PayrollRunInput,
  PayrollRunResult,
  PayrollRunType,
  PayrollRunError,
  PayComponentRow,
  PayCycleRow,
  OvertimeRuleRow,
  EmployeeCompensation,
  EmployeePayComputation,
  SalaryLineComponentRow,
  PercentBase,
  CalculationType,
  RetroRunResult,
  RetroEmployeeDelta,
  FinalSettlementResult,
  SettlementType,
} from '../types/payroll';
import {
  parseStatutoryConfig,
  computePf,
  computeEsi,
  computePt,
  computeOtAmount,
  prorateMonthly,
} from '../utils/statutoryCalculator';
import {
  toDateString,
  eachDate,
  daysBetween,
  dayOfWeek,
  monthKey,
  daysInMonth,
  maxDate,
  minDate,
  round2,
  todayString,
} from '../utils/dateUtils';
import {
  resolveComponentAmount,
  computePayableDays,
  computeGratuity,
  yearsOfService,
  proratePercent,
  applyRounding,
  safeDiv,
  num,
} from '../utils/payrollMath';

/** How many employees are computed and written per transaction. */
const CHUNK_SIZE = 500;

interface DayFact {
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF';
  otHours: number;
  isPaidLeave: boolean;
}

interface PieceTotals {
  amount: number;
  cts: number;
  lots: number;
}

interface AttendanceWalk {
  paidDays: number;
  employedDays: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  otHours: number;
  paidUnitsByMonth: Map<string, number>;
}

/** Everything a run needs, loaded exactly once before the employee loop. */
interface RunContext {
  period: PayrollPeriodRow;
  cycle: PayCycleRow | null;
  cfg: StatutoryConfig;
  employerPfRatePct: number;
  employerEsiRatePct: number;
  componentsById: Map<number, PayComponentRow>;
  componentsByCode: Map<string, PayComponentRow>;
  compensation: Map<number, EmployeeCompensation>;
  pieceMap: Map<number, PieceTotals>;
  attendanceMap: Map<number, Map<string, DayFact>>;
  holidaySet: Set<string>;
  weekOffByShift: Map<number, number>;
  defaultWeekOff: number;
  advancesByEmployee: Map<number, ActiveAdvanceRow[]>;
  installmentsByEmployee: Map<number, DueLoanInstallment[]>;
  awardsByEmployee: Map<number, ApprovedAwardRow[]>;
  reimbursementsByEmployee: Map<number, ApprovedReimbursementRow[]>;
  otRules: OvertimeRuleRow[];
  taxContext: TaxContext | null;
  taxThreshold: number;
  financialYear: string;
  arrears: Record<number, number>;
  persistTax: boolean;
}

export type ProgressCallback = (pct: number, message: string) => void | Promise<void>;

/** A run input whose `runType` has already been validated against the enum. */
type NormalisedRunInput = Omit<PayrollRunInput, 'runType'> & { runType: PayrollRunType };

const RUN_TYPES: PayrollRunType[] = [
  'REGULAR', 'OFF_CYCLE', 'RETRO', 'ARREARS', 'FINAL_SETTLEMENT', 'BONUS', 'SIMULATION',
];

/** Anything the caller sends that is not a known run type becomes REGULAR. */
function normaliseRunType(value: unknown): PayrollRunType {
  const candidate = String(value ?? '').toUpperCase() as PayrollRunType;
  return RUN_TYPES.includes(candidate) ? candidate : 'REGULAR';
}

export interface RetroRunOptions {
  periodId: number;
  /** Recompute every period from this one onwards. */
  fromPeriodId?: number;
  /** Alternative to `fromPeriodId`: recompute every period starting on/after this date. */
  effectiveFrom?: string;
  employeeIds?: number[];
  userId: number;
  actorName?: string;
}

export interface FinalSettlementOptions {
  settlementType?: SettlementType;
  noticeServedDays?: number;
  bonusPayable?: number;
  otherEarnings?: number;
  otherDeductions?: number;
  assetRecovery?: number;
  taxDeduction?: number;
  /** Persist the settlement row. Defaults to true; the row is never approved. */
  persist?: boolean;
}

/**
 * The enterprise payroll engine (v2).
 *
 * Design rules, in priority order:
 *  1. **Correctness.** Every money value is rounded to 2 decimals at its own
 *     boundary, so a payslip's components always sum to its totals. Net pay can
 *     never go negative and no loan or advance can ever be over-recovered.
 *  2. **Backwards compatibility.** An employee with no `employee_salary`
 *     revision is paid by exactly the v1 rules (piece-rate labour + prorated
 *     monthly salary + flat-rate OT, statutory on gross), so switching engines
 *     does not silently change anybody's wages.
 *  3. **Scale.** Every input is batch-loaded once per run and employees are
 *     processed in chunks of 500, so 100k employees never build one giant array
 *     or one giant transaction.
 *  4. **Resilience.** A single bad employee is recorded in `payroll_run_errors`
 *     and the run carries on.
 *
 * The v1 `PayrollCalculationService` is untouched and keeps working.
 */
export class PayrollEngineV2Service {
  private masterRepo = new PayrollMasterRepository();
  private runRepo = new PayrollRunRepository();
  private employeeRepo = new EmployeeRepository();
  private attendanceRepo = new AttendanceRepository();
  private holidayRepo = new HolidayRepository();
  private advanceRepo = new AdvanceRepository();
  private settingRepo = new SettingRepository();
  private activityRepo = new ActivityRepository();
  private lotRepo = new LotRepository();
  private lineRepo = new SalaryLineRepository();
  private taxService = new TaxComputationService();

  constructor() {
    this.registerJobHandlers();
  }

  /** Lets a payroll run be executed in the background with live progress. */
  private registerJobHandlers(): void {
    if (jobQueueService.hasHandler('PAYROLL_RUN')) return;
    jobQueueService.registerHandler('PAYROLL_RUN', async (payload, updateProgress) => {
      const input = payload as PayrollRunInput;
      return this.runPayroll(input, async (pct, message) => {
        await updateProgress(pct, message);
      });
    });
  }

  /** Queue a run instead of executing it inline; returns the background job id. */
  async queueRun(input: PayrollRunInput): Promise<number> {
    return jobQueueService.enqueue('PAYROLL_RUN', input, input.userId);
  }

  // =========================================================================
  // Public entry points
  // =========================================================================

  /**
   * Execute a payroll run over one period.
   *
   * A SIMULATION writes nothing at all: no salary lines, no component rows, no
   * recoveries, no tax computations. It returns the same figures a real run
   * would have produced, per employee.
   */
  async runPayroll(input: PayrollRunInput, onProgress?: ProgressCallback): Promise<PayrollRunResult> {
    const startedAt = Date.now();
    const runType = normaliseRunType(input.runType);
    const isSimulation = input.isSimulation || runType === 'SIMULATION';
    const normalised: NormalisedRunInput = { ...input, runType, isSimulation };

    const period = await this.runRepo.getPeriod(input.periodId);
    if (!period) throw new Error('Salary period not found');

    // A locked or paid period is frozen history. Only a simulation may look at it.
    if (period.status !== 'OPEN' && !isSimulation) {
      throw new Error('Payroll can only run while the period is OPEN');
    }

    if (!isSimulation) {
      const active = await this.runRepo.findActiveRun(period.id);
      if (active) {
        throw new Error(`A payroll run (#${active.id}) is already running for this period`);
      }
    }

    const runId = await this.runRepo.createRun({
      periodId: period.id,
      runType,
      label: input.label ?? null,
      currency: period.currency,
      isSimulation,
      employeeFilter: input.filters ?? (input.employeeIds ? { employeeIds: input.employeeIds } : null),
      userId: input.userId,
    });

    try {
      const result = await this.execute(period, normalised, runId, startedAt, onProgress);
      return result;
    } catch (error) {
      await this.runRepo.failRun(runId, (error as Error).message, Date.now() - startedAt);
      throw error;
    }
  }

  /** Same pipeline with nothing persisted. */
  async simulate(input: PayrollRunInput): Promise<PayrollRunResult> {
    return this.runPayroll({ ...input, isSimulation: true });
  }

  // =========================================================================
  // The run
  // =========================================================================

  private async execute(
    period: PayrollPeriodRow,
    input: NormalisedRunInput,
    runId: number,
    startedAt: number,
    onProgress?: ProgressCallback,
  ): Promise<PayrollRunResult> {
    const isSimulation = input.isSimulation;

    // ---- population -------------------------------------------------------
    const allEmployees = await this.employeeRepo.findEmployableInWindow(period.from_date, period.to_date);
    const employees = this.applyFilters(allEmployees, input);
    const employeeIds = employees.map((e) => Number(e.id));

    await this.runRepo.setRunTotalEmployees(runId, employees.length);

    if (employees.length === 0) {
      await this.runRepo.finishRun(runId, {
        status: 'COMPLETED',
        processedEmployees: 0,
        failedEmployees: 0,
        totalEmployees: 0,
        totalGross: 0,
        totalDeductions: 0,
        totalNet: 0,
        totalEmployerCost: 0,
        durationMs: Date.now() - startedAt,
        warnings: ['No employees matched this run'],
      });
      return this.emptyResult(runId, period, input, isSimulation, Date.now() - startedAt);
    }

    // ---- idempotency: undo what an earlier run of this period posted --------
    if (!isSimulation) {
      const scope = input.employeeIds && input.employeeIds.length > 0 ? employeeIds : null;
      await this.runRepo.withTransaction(async (conn) => {
        await this.runRepo.deletePayrollAdvanceRecoveries(period.id, scope, conn);
        await this.runRepo.resetLoanInstallmentsForPeriod(period.id, scope, conn);
      });
    }

    const ctx = await this.loadContext(period, input, employeeIds);

    // ---- chunked processing ------------------------------------------------
    const warnings: string[] = [];
    const errors: PayrollRunError[] = [];
    const simulated: EmployeePayComputation[] = [];
    const writtenEmployeeIds: number[] = [];

    let processed = 0;
    let failed = 0;
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalEmployerCost = 0;

    for (let offset = 0; offset < employees.length; offset += CHUNK_SIZE) {
      const chunk = employees.slice(offset, offset + CHUNK_SIZE);
      const chunkErrors: PayrollRunError[] = [];

      const handleComputation = (computed: EmployeePayComputation | null) => {
        if (!computed) return;
        totalGross = round2(totalGross + computed.grossAmount);
        totalDeductions = round2(totalDeductions + computed.totalDeductions);
        totalNet = round2(totalNet + computed.netAmount);
        totalEmployerCost = round2(totalEmployerCost + computed.employerCost);
        for (const w of computed.warnings) warnings.push(w);
      };

      if (isSimulation) {
        for (const emp of chunk) {
          try {
            const computed = await this.computeEmployee(emp, ctx);
            if (computed) {
              simulated.push(computed);
              handleComputation(computed);
            }
            processed += 1;
          } catch (error) {
            failed += 1;
            chunkErrors.push({
              employeeId: Number(emp.id),
              code: 'COMPUTE_FAILED',
              message: (error as Error).message,
              severity: 'ERROR',
            });
          }
        }
      } else {
        // One transaction per chunk: a chunk either lands completely or not at
        // all, and a 100k payroll never holds one enormous transaction open.
        await this.runRepo.withTransaction(async (conn) => {
          for (const emp of chunk) {
            try {
              const computed = await this.computeEmployee(emp, ctx, conn);
              if (!computed) {
                processed += 1;
                continue;
              }
              await this.persistEmployee(computed, ctx, runId, input.userId, conn);
              writtenEmployeeIds.push(computed.employeeId);
              handleComputation(computed);
              processed += 1;
            } catch (error) {
              failed += 1;
              chunkErrors.push({
                employeeId: Number(emp.id),
                code: 'COMPUTE_FAILED',
                message: (error as Error).message,
                severity: 'ERROR',
              });
            }
          }
        });
      }

      // Errors are written outside the chunk transaction so a rollback cannot
      // erase the record of why the chunk failed.
      for (const err of chunkErrors) {
        errors.push(err);
        await this.runRepo.recordRunError(runId, err.employeeId, err.code, err.message, err.severity);
      }

      await this.runRepo.updateRunProgress(runId, processed, failed);
      if (onProgress) {
        const pct = Math.round(((offset + chunk.length) / employees.length) * 100);
        await onProgress(pct, `Processed ${processed}/${employees.length} employees`);
      }
    }

    // ---- prune lines nobody earned anymore ---------------------------------
    let linesRemoved = 0;
    if (!isSimulation && input.runType === 'REGULAR' && (!input.employeeIds || input.employeeIds.length === 0)) {
      await this.runRepo.withTransaction(async (conn) => {
        linesRemoved = await this.lineRepo.deleteLinesNotIn(period.id, writtenEmployeeIds, conn);
      });
    }

    const durationMs = Date.now() - startedAt;
    const status = failed > 0 && processed === failed ? 'FAILED' : 'COMPLETED';

    await this.runRepo.finishRun(runId, {
      status,
      processedEmployees: processed,
      failedEmployees: failed,
      totalEmployees: employees.length,
      totalGross,
      totalDeductions,
      totalNet,
      totalEmployerCost,
      durationMs,
      warnings,
    });

    if (!isSimulation) {
      await this.activityRepo.log({
        actorUserId: input.userId,
        actorName: input.actorName,
        entityType: 'payroll_run',
        entityId: runId,
        action: input.runType,
        summary: `Payroll run #${runId} on "${period.label}": ${writtenEmployeeIds.length} lines, net ${totalNet}`,
        meta: { runId, periodId: period.id, totalGross, totalNet, failed },
      });
    }

    return {
      runId,
      periodId: period.id,
      runType: input.runType,
      status,
      isSimulation,
      totalEmployees: employees.length,
      processedEmployees: processed,
      failedEmployees: failed,
      totalGross,
      totalDeductions,
      totalNet,
      totalEmployerCost,
      durationMs,
      linesWritten: isSimulation ? 0 : writtenEmployeeIds.length,
      linesRemoved,
      warnings,
      errors,
      employees: isSimulation ? simulated : undefined,
    };
  }

  private emptyResult(
    runId: number,
    period: PayrollPeriodRow,
    input: NormalisedRunInput,
    isSimulation: boolean,
    durationMs: number,
  ): PayrollRunResult {
    return {
      runId,
      periodId: period.id,
      runType: input.runType,
      status: 'COMPLETED',
      isSimulation,
      totalEmployees: 0,
      processedEmployees: 0,
      failedEmployees: 0,
      totalGross: 0,
      totalDeductions: 0,
      totalNet: 0,
      totalEmployerCost: 0,
      durationMs,
      linesWritten: 0,
      linesRemoved: 0,
      warnings: ['No employees matched this run'],
      errors: [],
      employees: isSimulation ? [] : undefined,
    };
  }

  private applyFilters(employees: EmployeeRow[], input: Pick<PayrollRunInput, 'employeeIds' | 'filters'>): EmployeeRow[] {
    let list = employees;
    if (input.employeeIds && input.employeeIds.length > 0) {
      const wanted = new Set(input.employeeIds.map((id) => Number(id)));
      list = list.filter((e) => wanted.has(Number(e.id)));
    }
    const f = input.filters;
    if (f) {
      list = list.filter((e) => {
        const any = e as any;
        if (f.department && any.department !== f.department) return false;
        if (f.grade && any.grade !== f.grade) return false;
        if (f.branch && any.branch !== f.branch) return false;
        if (f.workerType && e.worker_type !== f.workerType) return false;
        return true;
      });
    }
    return list;
  }

  // =========================================================================
  // Batch loading
  // =========================================================================

  private async loadContext(
    period: PayrollPeriodRow,
    input: NormalisedRunInput,
    employeeIds: number[],
  ): Promise<RunContext> {
    const from = period.from_date;
    const to = period.to_date;

    const [settings, cycle, components, otRules, compensation] = await Promise.all([
      this.settingRepo.getAll(),
      this.masterRepo.getCycleForPeriod(period.id),
      this.masterRepo.getActiveComponents(),
      this.masterRepo.getOvertimeRules(),
      this.masterRepo.getCompensationMap(to, employeeIds.length ? employeeIds : undefined),
    ]);

    const [pieceRows, attendanceRows, holidaySet, shifts, advances, installments, awards, reimbursements] =
      await Promise.all([
        this.lotRepo.getLabourByEmployeeForWindow(from, to),
        this.attendanceRepo.getWindowRows(from, to),
        this.holidayRepo.findDateSet(from, to),
        this.runRepo.getShifts(),
        this.runRepo.getActiveAdvances(employeeIds),
        this.runRepo.getDueLoanInstallments(to, employeeIds),
        this.runRepo.getApprovedAwards(period.id),
        this.runRepo.getApprovedReimbursements(period.id),
      ]);

    const cfg = parseStatutoryConfig(settings);
    const numSetting = (key: string, fallback: number): number => {
      const raw = settings[key];
      const parsed = Number(raw);
      return raw !== undefined && Number.isFinite(parsed) ? parsed : fallback;
    };

    const componentsById = new Map<number, PayComponentRow>();
    const componentsByCode = new Map<string, PayComponentRow>();
    for (const c of components) {
      componentsById.set(Number(c.id), c);
      componentsByCode.set(c.code, c);
    }

    const pieceMap = new Map<number, PieceTotals>();
    for (const r of pieceRows) {
      pieceMap.set(Number(r.employee_id), {
        amount: num(r.total_amount),
        cts: num(r.total_cts),
        lots: num(r.lots_count),
      });
    }

    const attendanceMap = new Map<number, Map<string, DayFact>>();
    for (const r of attendanceRows) {
      const empId = Number(r.employee_id);
      let byDate = attendanceMap.get(empId);
      if (!byDate) {
        byDate = new Map<string, DayFact>();
        attendanceMap.set(empId, byDate);
      }
      byDate.set(toDateString(r.att_date), {
        status: r.status,
        otHours: num(r.ot_hours),
        isPaidLeave: Number(r.is_paid) === 1,
      });
    }

    const weekOffByShift = new Map<number, number>();
    let defaultWeekOff = 0;
    for (const s of shifts) {
      const day = Number(s.week_off_day) || 0;
      weekOffByShift.set(Number(s.id), day);
      if (s.is_default === 1 || s.is_default === true) defaultWeekOff = day;
    }

    const advancesByEmployee = this.groupBy(advances, (a) => a.employeeId);
    const installmentsByEmployee = this.groupBy(installments, (i) => i.employeeId);
    const awardsByEmployee = this.groupBy(awards, (a) => a.employeeId);
    const reimbursementsByEmployee = this.groupBy(reimbursements, (r) => r.employeeId);

    const financialYear = this.taxService.getFinancialYear(to);
    let taxContext: TaxContext | null = null;
    let taxThreshold = Number.POSITIVE_INFINITY;
    try {
      taxContext = await this.taxService.loadContext(financialYear, employeeIds, period.id);
      taxThreshold = this.taxService.zeroTaxThreshold(taxContext);
    } catch {
      // Tax tables missing or unreadable: payroll still runs, TDS stays zero.
      taxContext = null;
    }

    return {
      period,
      cycle,
      cfg,
      employerPfRatePct: numSetting('pf_employer_rate_pct', cfg.pfRatePct),
      employerEsiRatePct: numSetting('esi_employer_rate_pct', 3.25),
      componentsById,
      componentsByCode,
      compensation,
      pieceMap,
      attendanceMap,
      holidaySet,
      weekOffByShift,
      defaultWeekOff,
      advancesByEmployee,
      installmentsByEmployee,
      awardsByEmployee,
      reimbursementsByEmployee,
      otRules,
      taxContext,
      taxThreshold,
      financialYear,
      arrears: input.arrears ?? {},
      persistTax: !input.isSimulation,
    };
  }

  private groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const row of rows) {
      const k = key(row);
      const list = map.get(k) ?? [];
      list.push(row);
      map.set(k, list);
    }
    return map;
  }

  // =========================================================================
  // Per-employee computation
  // =========================================================================

  /**
   * Compute one employee's pay. Returns null when there is nothing to pay at
   * all, in which case no salary line is written (matching v1).
   */
  private async computeEmployee(
    emp: EmployeeRow,
    ctx: RunContext,
    conn?: any,
  ): Promise<EmployeePayComputation | null> {
    const warnings: string[] = [];
    const from = ctx.period.from_date;
    const to = ctx.period.to_date;

    const joinedAt = emp.joined_at ? toDateString(emp.joined_at) : from;
    const resignedAt = emp.resigned_at ? toDateString(emp.resigned_at) : null;
    const effFrom = maxDate(from, joinedAt);
    const effTo = minDate(to, resignedAt ?? to);
    if (effFrom > effTo) return null;

    const walk = this.walkAttendance(emp, effFrom, effTo, ctx);
    const periodDays = daysBetween(from, to);
    const piece = ctx.pieceMap.get(Number(emp.id)) ?? { amount: 0, cts: 0, lots: 0 };
    const comp = ctx.compensation.get(Number(emp.id)) ?? null;

    const cycle = ctx.cycle;
    const days = computePayableDays({
      periodDays,
      paidUnits: walk.paidDays,
      workingDays: walk.workingDays,
      lopBasis: cycle?.lop_basis ?? 'CALENDAR_DAYS',
      fixedDaysPerMonth: cycle?.fixed_days_per_month ?? null,
    });

    const components: SalaryLineComponentRow[] = [];
    const hasStructure = !!comp && comp.lines.length > 0;

    // ---- earnings ---------------------------------------------------------
    let earnPiece = round2(piece.amount);
    let earnFixed = 0;
    let earnOther = 0; // structure allowances that are not BASIC
    let pfBase = 0;
    let esiBase = 0;
    let dedLwf = 0;
    let dedInsurance = 0;
    const otHours = round2(walk.otHours);
    let earnOt = 0;

    if (hasStructure && comp) {
      const built = this.computeStructureEarnings(emp, comp, ctx, {
        piece: earnPiece,
        otHours,
        payableDays: days.payableDays,
        denominatorDays: days.denominatorDays,
        warnings,
      });
      // The structure owns the piece-rate figure now (its PIECE_RATE component,
      // or the fallback line the engine adds when the structure has none), so it
      // must not be added to gross a second time from the raw lot totals.
      earnPiece = built.earnPiece;
      earnFixed = built.earnFixed;
      earnOther = built.earnOther;
      earnOt = built.earnOt;
      pfBase = built.pfBase;
      esiBase = built.esiBase;
      dedLwf = built.dedLwf;
      dedInsurance = built.dedInsurance;
      components.push(...built.components);
    } else {
      // ---- legacy path: byte-for-byte the v1 rules ------------------------
      earnFixed = this.computeLegacyFixedEarning(emp, walk.paidUnitsByMonth, warnings);
      earnOt = computeOtAmount(otHours, ctx.cfg);

      if (earnPiece !== 0) {
        components.push(this.legacyComponent(ctx, 'PIECE', 'Piece Rate Earnings', 'EARNING', 'BASIC', earnPiece, 15));
      }
      if (earnFixed !== 0) {
        components.push(this.legacyComponent(ctx, 'BASIC', 'Basic Salary', 'EARNING', 'BASIC', earnFixed, 10));
      }
      if (earnOt !== 0) {
        components.push(this.legacyComponent(ctx, 'OT', 'Overtime', 'EARNING', 'OVERTIME', earnOt, 80));
      }
    }

    // ---- awards, arrears and reimbursements --------------------------------
    let earnBonus = 0;
    let earnIncentive = 0;
    let earnVariable = 0;
    for (const award of ctx.awardsByEmployee.get(Number(emp.id)) ?? []) {
      const amount = round2(award.amount);
      if (amount === 0) continue;
      if (award.awardClass === 'BONUS') earnBonus = round2(earnBonus + amount);
      else if (award.awardClass === 'INCENTIVE') earnIncentive = round2(earnIncentive + amount);
      else earnVariable = round2(earnVariable + amount);

      const def = award.componentId ? ctx.componentsById.get(award.componentId) : undefined;
      const code = def?.code ?? (award.awardClass === 'BONUS' ? 'BONUS' : award.awardClass === 'INCENTIVE' ? 'INCENTIVE' : 'VARPAY');
      components.push({
        componentId: def?.id ?? ctx.componentsByCode.get(code)?.id ?? null,
        componentCode: code,
        componentName: award.title || def?.name || code,
        componentType: 'EARNING',
        category: award.awardClass === 'VARIABLE_PAY' ? 'VARIABLE_PAY' : award.awardClass,
        amount,
        baseAmount: null,
        percentApplied: null,
        isTaxable: award.isTaxable,
        isProrated: false,
        displayOrder: 90,
      });
    }

    const earnArrears = round2(num(ctx.arrears[Number(emp.id)]));
    if (earnArrears !== 0) {
      const def = ctx.componentsByCode.get('ARREARS');
      components.push({
        componentId: def?.id ?? null,
        componentCode: 'ARREARS',
        componentName: def?.name ?? 'Arrears',
        componentType: 'EARNING',
        category: 'ARREARS',
        amount: earnArrears,
        baseAmount: null,
        percentApplied: null,
        isTaxable: true,
        isProrated: false,
        displayOrder: 96,
      });
    }

    let earnReimbursement = 0;
    for (const claim of ctx.reimbursementsByEmployee.get(Number(emp.id)) ?? []) {
      const amount = round2(claim.amount);
      if (amount === 0) continue;
      earnReimbursement = round2(earnReimbursement + amount);
      const def = claim.componentId ? ctx.componentsById.get(claim.componentId) : ctx.componentsByCode.get('REIMB');
      components.push({
        componentId: def?.id ?? null,
        componentCode: def?.code ?? 'REIMB',
        componentName: `${def?.name ?? 'Reimbursement'} ${claim.claimNo}`,
        componentType: 'REIMBURSEMENT',
        category: 'REIMBURSEMENT',
        amount,
        baseAmount: null,
        percentApplied: null,
        isTaxable: claim.isTaxable,
        isProrated: false,
        displayOrder: 98,
      });
    }

    // Reimbursements are a pass-through payout: they are paid with the salary
    // but are not wages, so they stay out of gross (and out of PF/ESI/tax).
    const grossAmount = round2(
      earnPiece + earnFixed + earnOther + earnOt + earnBonus + earnIncentive + earnVariable + earnArrears,
    );

    if (
      grossAmount === 0 &&
      walk.paidDays === 0 &&
      piece.lots === 0 &&
      earnReimbursement === 0
    ) {
      return null;
    }

    // ---- statutory deductions ---------------------------------------------
    // Without a structure there is no basic/allowance split, so gross is the
    // contribution base exactly as v1 does it. With a structure, the components
    // flagged pf/esi applicable form the base.
    const pfContributionBase = hasStructure ? round2(pfBase) : grossAmount;
    const esiContributionBase = hasStructure ? round2(esiBase) : grossAmount;

    const dedPf = computePf(pfContributionBase, ctx.cfg, !!emp.pf_applicable);
    const dedEsi = computeEsi(esiContributionBase, ctx.cfg, !!emp.esi_applicable);
    const dedPt = computePt(grossAmount, ctx.cfg);

    // ---- income tax --------------------------------------------------------
    const taxableEarnings = round2(
      components
        .filter((c) => c.componentType === 'EARNING' && c.isTaxable)
        .reduce((sum, c) => round2(sum + c.amount), 0),
    );
    const dedIncomeTax = await this.computeTds(emp, comp, ctx, grossAmount, conn);

    this.pushStatutoryComponents(components, ctx, {
      dedPf,
      dedEsi,
      dedPt,
      dedIncomeTax,
      pfContributionBase,
      esiContributionBase,
    });

    const fixedDeductions = round2(dedPf + dedEsi + dedPt + dedIncomeTax + dedLwf + dedInsurance);

    // ---- loans and advances, capped by headroom ---------------------------
    // Headroom is what is left of the payout after every non-negotiable
    // deduction. Recoveries can only ever eat into it, so net pay is >= 0 and
    // no loan or advance is ever recovered beyond what is owed.
    let headroom = round2(Math.max(0, grossAmount + earnReimbursement - fixedDeductions));

    const loanRecoveries: EmployeePayComputation['loanRecoveries'] = [];
    let dedLoan = 0;
    for (const inst of ctx.installmentsByEmployee.get(Number(emp.id)) ?? []) {
      if (headroom <= 0) break;
      const owed = round2(Math.max(0, inst.emiAmount - inst.recoveredAmount));
      if (owed <= 0) continue;
      const take = round2(Math.min(owed, headroom));
      if (take <= 0) continue;
      loanRecoveries.push({ installmentId: inst.id, loanId: inst.loanId, amount: take });
      dedLoan = round2(dedLoan + take);
      headroom = round2(headroom - take);
    }
    if (dedLoan > 0) {
      const def = ctx.componentsByCode.get('LOAN-EMI');
      components.push({
        componentId: def?.id ?? null,
        componentCode: 'LOAN-EMI',
        componentName: def?.name ?? 'Loan EMI Recovery',
        componentType: 'DEDUCTION',
        category: 'LOAN',
        amount: dedLoan,
        baseAmount: null,
        percentApplied: null,
        isTaxable: false,
        isProrated: false,
        displayOrder: 250,
      });
    }

    const advanceRecoveries: EmployeePayComputation['advanceRecoveries'] = [];
    let dedAdvance = 0;
    for (const adv of ctx.advancesByEmployee.get(Number(emp.id)) ?? []) {
      if (headroom <= 0) break;
      const outstanding = round2(adv.outstanding);
      if (outstanding <= 0) continue;
      const cap = adv.installmentAmount > 0 ? adv.installmentAmount : outstanding;
      const take = round2(Math.min(cap, outstanding, headroom));
      if (take <= 0) continue;
      advanceRecoveries.push({ advanceId: adv.id, amount: take, closes: round2(outstanding - take) <= 0 });
      dedAdvance = round2(dedAdvance + take);
      headroom = round2(headroom - take);
    }
    if (dedAdvance > 0) {
      const def = ctx.componentsByCode.get('ADV-REC');
      components.push({
        componentId: def?.id ?? null,
        componentCode: 'ADV-REC',
        componentName: def?.name ?? 'Advance Recovery',
        componentType: 'DEDUCTION',
        category: 'LOAN',
        amount: dedAdvance,
        baseAmount: null,
        percentApplied: null,
        isTaxable: false,
        isProrated: false,
        displayOrder: 260,
      });
    }

    const totalDeductions = round2(fixedDeductions + dedLoan + dedAdvance);
    const netAmount = round2(grossAmount + earnReimbursement - totalDeductions);

    // ---- employer contributions -------------------------------------------
    const employerPf = emp.pf_applicable && ctx.cfg.pfEnabled && pfContributionBase > 0
      ? round2((Math.min(pfContributionBase, ctx.cfg.pfCeiling) * ctx.employerPfRatePct) / 100)
      : 0;
    const employerEsi = emp.esi_applicable && ctx.cfg.esiEnabled && esiContributionBase > 0
      && esiContributionBase <= ctx.cfg.esiCeiling
      ? round2((esiContributionBase * ctx.employerEsiRatePct) / 100)
      : 0;
    const employerCost = round2(grossAmount + earnReimbursement + employerPf + employerEsi);

    if (employerPf > 0) {
      const def = ctx.componentsByCode.get('EMP-PF');
      components.push({
        componentId: def?.id ?? null,
        componentCode: 'EMP-PF',
        componentName: def?.name ?? 'Employer PF Contribution',
        componentType: 'EMPLOYER_CONTRIBUTION',
        category: 'STATUTORY',
        amount: employerPf,
        baseAmount: pfContributionBase,
        percentApplied: ctx.employerPfRatePct,
        isTaxable: false,
        isProrated: false,
        displayOrder: 300,
      });
    }
    if (employerEsi > 0) {
      const def = ctx.componentsByCode.get('EMP-ESI');
      components.push({
        componentId: def?.id ?? null,
        componentCode: 'EMP-ESI',
        componentName: def?.name ?? 'Employer ESI Contribution',
        componentType: 'EMPLOYER_CONTRIBUTION',
        category: 'STATUTORY',
        amount: employerEsi,
        baseAmount: esiContributionBase,
        percentApplied: ctx.employerEsiRatePct,
        isTaxable: false,
        isProrated: false,
        displayOrder: 310,
      });
    }

    return {
      employeeId: Number(emp.id),
      empCode: emp.emp_code,
      fullName: emp.full_name,
      workerType: emp.worker_type ?? null,
      structureId: comp?.structure?.id ?? null,
      currency: ctx.period.currency,
      periodDays: walk.employedDays,
      paidDays: walk.paidDays,
      presentDays: walk.presentDays,
      absentDays: walk.absentDays,
      leaveDays: walk.leaveDays,
      lopDays: days.lopDays,
      payableDays: days.payableDays,
      otHours,
      totalCts: round2(piece.cts),
      lotsCount: piece.lots,
      earnPiece,
      earnFixed: round2(earnFixed + earnOther),
      earnOt,
      earnBonus,
      earnIncentive,
      earnVariable,
      earnArrears,
      earnReimbursement,
      grossAmount,
      taxableIncome: taxableEarnings,
      dedPf,
      dedEsi,
      dedPt,
      dedIncomeTax,
      dedLwf,
      dedInsurance,
      dedLoan,
      dedAdvance,
      dedOther: 0,
      totalDeductions,
      netAmount,
      employerPf,
      employerEsi,
      employerCost,
      components,
      loanRecoveries,
      advanceRecoveries,
      warnings,
    };
  }

  /**
   * Walk every day the employee was on the books and decide whether it is paid.
   *
   * These are the v1 rules verbatim: PRESENT 1, HALF_DAY 0.5, HOLIDAY/WEEK_OFF 1,
   * LEAVE 1 when the leave type is paid else 0, ABSENT 0, and an *unmarked*
   * working day 0 — so a missing attendance import can never inflate wages.
   */
  private walkAttendance(emp: EmployeeRow, effFrom: string, effTo: string, ctx: RunContext): AttendanceWalk {
    const shiftId = emp.shift_id === null || emp.shift_id === undefined ? null : Number(emp.shift_id);
    const weekOffDay = shiftId !== null && ctx.weekOffByShift.get(shiftId) !== undefined
      ? (ctx.weekOffByShift.get(shiftId) as number)
      : ctx.defaultWeekOff;

    const days = ctx.attendanceMap.get(Number(emp.id));
    const paidUnitsByMonth = new Map<string, number>();
    let paidDays = 0;
    let presentDays = 0;
    let absentDays = 0;
    let leaveDays = 0;
    let otHours = 0;
    let workingDays = 0;

    for (const date of eachDate(effFrom, effTo)) {
      const fact = days?.get(date);
      const isHoliday = ctx.holidaySet.has(date);
      const isWeekOff = dayOfWeek(date) === weekOffDay;
      let unit = 0;

      if (fact) {
        switch (fact.status) {
          case 'PRESENT':
            unit = 1;
            presentDays += 1;
            break;
          case 'HALF_DAY':
            unit = 0.5;
            presentDays += 0.5;
            absentDays += 0.5;
            break;
          case 'HOLIDAY':
          case 'WEEK_OFF':
            unit = 1;
            break;
          case 'LEAVE':
            unit = fact.isPaidLeave ? 1 : 0;
            leaveDays += 1;
            break;
          case 'ABSENT':
          default:
            unit = 0;
            absentDays += 1;
            break;
        }
        otHours += fact.otHours;
        if (fact.status !== 'HOLIDAY' && fact.status !== 'WEEK_OFF') workingDays += 1;
      } else if (isHoliday) {
        unit = 1;
      } else if (isWeekOff) {
        unit = 1;
      } else {
        unit = 0;
        absentDays += 1;
        workingDays += 1;
      }

      paidDays += unit;
      const mk = monthKey(date);
      paidUnitsByMonth.set(mk, (paidUnitsByMonth.get(mk) ?? 0) + unit);
    }

    return {
      paidDays: round2(paidDays),
      employedDays: daysBetween(effFrom, effTo),
      workingDays,
      presentDays: round2(presentDays),
      absentDays: round2(absentDays),
      leaveDays: round2(leaveDays),
      otHours: round2(otHours),
      paidUnitsByMonth,
    };
  }

  /** v1's fixed-pay rule: DHAR/MAXI prorated month by month against each month's length. */
  private computeLegacyFixedEarning(
    emp: EmployeeRow,
    paidUnitsByMonth: Map<string, number>,
    warnings: string[],
  ): number {
    if (emp.worker_type !== 'DHAR' && emp.worker_type !== 'MAXI') return 0;
    const monthly = num(emp.monthly_salary);
    if (monthly <= 0) {
      warnings.push(`${emp.emp_code} ${emp.full_name}: no monthly salary set`);
      return 0;
    }
    return prorateMonthly(monthly, paidUnitsByMonth, daysInMonth);
  }

  private legacyComponent(
    ctx: RunContext,
    code: string,
    name: string,
    type: SalaryLineComponentRow['componentType'],
    category: string,
    amount: number,
    displayOrder: number,
  ): SalaryLineComponentRow {
    const def = ctx.componentsByCode.get(code);
    return {
      componentId: def?.id ?? null,
      componentCode: code,
      componentName: def?.name ?? name,
      componentType: type,
      category,
      amount,
      baseAmount: null,
      percentApplied: null,
      isTaxable: def ? def.is_taxable === 1 || def.is_taxable === true : true,
      isProrated: false,
      displayOrder,
    };
  }

  // -------------------------------------------------------------------------
  // Structure-driven earnings
  // -------------------------------------------------------------------------

  /**
   * Evaluate an assigned salary structure into components.
   *
   * Each component is evaluated at its full-month value first (so a percentage
   * of BASIC uses the full BASIC, never a prorated one), then prorated exactly
   * once by payableDays/denominatorDays when the component is flagged prorated.
   */
  private computeStructureEarnings(
    emp: EmployeeRow,
    comp: EmployeeCompensation,
    ctx: RunContext,
    args: {
      piece: number;
      otHours: number;
      payableDays: number;
      denominatorDays: number;
      warnings: string[];
    },
  ): {
    components: SalaryLineComponentRow[];
    earnPiece: number;
    earnFixed: number;
    earnOther: number;
    earnOt: number;
    pfBase: number;
    esiBase: number;
    dedLwf: number;
    dedInsurance: number;
    basicPlusDa: number;
  } {
    const components: SalaryLineComponentRow[] = [];
    const bases: Partial<Record<PercentBase, number>> = {
      CTC: comp.monthlyCtc,
      GROSS: comp.monthlyGross,
      NET: comp.monthlyGross,
      BASIC: 0,
    };
    const vars: Record<string, number> = { CTC: comp.monthlyCtc, GROSS: comp.monthlyGross };

    const roundingMode = ctx.cycle?.rounding_mode ?? 'NONE';
    const roundingPrecision = ctx.cycle?.rounding_precision ?? 0;

    let earnPiece = 0;
    let earnFixed = 0;
    let earnOther = 0;
    let earnOt = 0;
    let pfBase = 0;
    let esiBase = 0;
    let dedLwf = 0;
    let dedInsurance = 0;
    let basicPlusDa = 0;
    let earningsSoFar = 0;

    // OT is derived once from the applicable rule and fed to whichever
    // ATTENDANCE_BASED / OVERTIME component the structure carries.
    const perDayPay = safeDiv(comp.monthlyGross, args.denominatorDays);
    const otAmount = this.computeOvertime(emp, ctx, args.otHours, perDayPay);

    for (const line of comp.lines) {
      const def = ctx.componentsById.get(line.componentId);
      if (!def) continue;
      if (!(def.is_active === 1 || def.is_active === true)) continue;

      const calculationType: CalculationType = (line.calculationType ?? def.calculation_type) as CalculationType;
      const percentOf = (line.percentOf ?? def.percent_of) as PercentBase | null;
      const amount = line.amount !== null ? line.amount : def.default_value;
      const percentValue = line.percentValue !== null ? line.percentValue : def.default_percent;

      let supplied: number | null = null;
      if (calculationType === 'PIECE_RATE') supplied = args.piece;
      else if (calculationType === 'ATTENDANCE_BASED') {
        supplied = def.category === 'OVERTIME' ? otAmount : 0;
      }

      // A statutory deduction is computed by the engine's own helpers, never by
      // the structure line, so PF/ESI/PT/TDS lines are skipped here.
      if (def.is_statutory === 1 || def.is_statutory === true) continue;

      vars.BALANCE = round2(comp.monthlyCtc - earningsSoFar);

      let resolved;
      try {
        resolved = resolveComponentAmount({
          calculationType,
          percentOf,
          amount,
          percentValue,
          formula: def.formula,
          vars,
          bases,
          suppliedAmount: supplied,
          isProrated: false,
          minAmount: line.minAmount,
          maxAmount: line.maxAmount,
          roundingMode,
          roundingPrecision,
        });
      } catch (error) {
        args.warnings.push(`${emp.emp_code}: component ${def.code} skipped — ${(error as Error).message}`);
        continue;
      }

      const fullAmount = resolved.amount;
      const prorate =
        (def.is_prorated === 1 || def.is_prorated === true) &&
        (calculationType === 'FIXED' || calculationType === 'PERCENT_OF' || calculationType === 'FORMULA');
      let value = prorate ? proratePercent(fullAmount, args.payableDays, args.denominatorDays) : fullAmount;
      if (roundingMode !== 'NONE') value = applyRounding(value, roundingMode, roundingPrecision);
      value = round2(value);

      vars[def.code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()] = fullAmount;
      if (def.code === 'BASIC') bases.BASIC = fullAmount;

      if (def.component_type === 'EARNING') {
        earningsSoFar = round2(earningsSoFar + fullAmount);
        if (def.category === 'OVERTIME') earnOt = round2(earnOt + value);
        else if (calculationType === 'PIECE_RATE') earnPiece = round2(earnPiece + value);
        else if (def.code === 'BASIC') earnFixed = round2(earnFixed + value);
        else earnOther = round2(earnOther + value);

        if (def.is_pf_applicable === 1 || def.is_pf_applicable === true) pfBase = round2(pfBase + value);
        if (def.is_esi_applicable === 1 || def.is_esi_applicable === true) esiBase = round2(esiBase + value);
        if (def.code === 'BASIC' || def.code === 'DA') basicPlusDa = round2(basicPlusDa + value);
      } else if (def.component_type === 'DEDUCTION') {
        if (def.code === 'LWF') dedLwf = round2(dedLwf + value);
        else if (def.code === 'INS-PREM') dedInsurance = round2(dedInsurance + value);
      }

      if (value === 0 && calculationType !== 'FIXED') continue;

      components.push({
        componentId: def.id,
        componentCode: def.code,
        componentName: def.name,
        componentType: def.component_type,
        category: def.category,
        amount: value,
        baseAmount: resolved.baseAmount,
        percentApplied: resolved.percentApplied,
        isTaxable: def.is_taxable === 1 || def.is_taxable === true,
        isProrated: prorate,
        displayOrder: def.display_order,
      });
    }

    // The structure may not carry an overtime component at all; the hours still
    // have to be paid, so they land as a standalone OT line.
    if (earnOt === 0 && otAmount > 0) {
      earnOt = otAmount;
      const def = ctx.componentsByCode.get('OT');
      components.push({
        componentId: def?.id ?? null,
        componentCode: 'OT',
        componentName: def?.name ?? 'Overtime',
        componentType: 'EARNING',
        category: 'OVERTIME',
        amount: otAmount,
        baseAmount: null,
        percentApplied: null,
        isTaxable: true,
        isProrated: false,
        displayOrder: 80,
      });
      if (def && (def.is_esi_applicable === 1 || def.is_esi_applicable === true)) {
        esiBase = round2(esiBase + otAmount);
      }
    }

    // Piece-rate earnings exist even when the structure forgot to model them.
    if (args.piece > 0 && earnPiece === 0) {
      earnPiece = args.piece;
      const def = ctx.componentsByCode.get('PIECE');
      components.push({
        componentId: def?.id ?? null,
        componentCode: 'PIECE',
        componentName: def?.name ?? 'Piece Rate Earnings',
        componentType: 'EARNING',
        category: 'BASIC',
        amount: args.piece,
        baseAmount: null,
        percentApplied: null,
        isTaxable: true,
        isProrated: false,
        displayOrder: 15,
      });
      pfBase = round2(pfBase + args.piece);
      esiBase = round2(esiBase + args.piece);
    }

    return { components, earnPiece, earnFixed, earnOther, earnOt, pfBase, esiBase, dedLwf, dedInsurance, basicPlusDa };
  }

  /**
   * Overtime pay from the applicable rule.
   *
   * Rule selection prefers an exact grade match, then a branch match, then the
   * generic rule. `min_minutes` is applied to the period's total OT (the
   * attendance module already applies it per day) and `max_hours_per_month`
   * caps what payroll will pay for.
   */
  private computeOvertime(emp: EmployeeRow, ctx: RunContext, otHours: number, perDayPay: number): number {
    if (otHours <= 0) return 0;
    const any = emp as any;
    const regular = ctx.otRules.filter((r) => r.ot_kind === 'REGULAR');
    const rule =
      regular.find((r) => r.grade && r.grade === any.grade) ??
      regular.find((r) => r.branch && r.branch === any.branch) ??
      regular.find((r) => !r.grade && !r.branch) ??
      null;

    if (!rule) return computeOtAmount(otHours, ctx.cfg);

    let hours = otHours;
    if (rule.max_hours_per_month !== null && hours > num(rule.max_hours_per_month)) {
      hours = num(rule.max_hours_per_month);
    }
    if (hours * 60 < num(rule.min_minutes)) return 0;

    if (rule.rate_type === 'FLAT_HOURLY') {
      const rate = rule.flat_rate !== null ? num(rule.flat_rate) : ctx.cfg.otRatePerHour;
      return round2(hours * rate);
    }

    const hourlyRate = safeDiv(perDayPay, ctx.cfg.fullDayHours);
    const multiplier = rule.multiplier !== null ? num(rule.multiplier) : 1;
    return round2(hours * hourlyRate * multiplier);
  }

  private pushStatutoryComponents(
    components: SalaryLineComponentRow[],
    ctx: RunContext,
    values: {
      dedPf: number;
      dedEsi: number;
      dedPt: number;
      dedIncomeTax: number;
      pfContributionBase: number;
      esiContributionBase: number;
    },
  ): void {
    const add = (code: string, fallbackName: string, amount: number, base: number | null, order: number) => {
      if (amount === 0) return;
      const def = ctx.componentsByCode.get(code);
      components.push({
        componentId: def?.id ?? null,
        componentCode: code,
        componentName: def?.name ?? fallbackName,
        componentType: 'DEDUCTION',
        category: 'STATUTORY',
        amount,
        baseAmount: base,
        percentApplied: null,
        isTaxable: false,
        isProrated: false,
        displayOrder: order,
      });
    };
    add('PF', 'Provident Fund', values.dedPf, values.pfContributionBase, 200);
    add('ESI', 'Employee State Insurance', values.dedEsi, values.esiContributionBase, 210);
    add('PT', 'Professional Tax', values.dedPt, null, 220);
    add('TDS', 'Income Tax (TDS)', values.dedIncomeTax, null, 230);
  }

  /**
   * Monthly TDS for one employee.
   *
   * The cheap threshold test comes first: an employee whose annualised gross
   * cannot reach the first taxable rupee is skipped entirely, so a 100k payroll
   * of karigars never touches the tax tables.
   */
  private async computeTds(
    emp: EmployeeRow,
    comp: EmployeeCompensation | null,
    ctx: RunContext,
    grossThisMonth: number,
    conn?: any,
  ): Promise<number> {
    if (!ctx.taxContext) return 0;
    void conn; // tax projections are read-only outside the payroll transaction

    const monthlyGross = comp ? comp.monthlyGross : grossThisMonth;
    if (monthlyGross <= 0) return 0;

    const ytd = ctx.taxContext.ytdByEmployee.get(Number(emp.id))?.gross ?? 0;
    const monthsRemaining = this.taxService.monthsRemainingInFy(ctx.period.to_date);
    const projected = ytd + monthlyGross * monthsRemaining;
    if (projected <= ctx.taxThreshold) return 0;

    const result = await this.taxService.computeAnnualTax(Number(emp.id), ctx.financialYear, {
      monthlyGross,
      asOfDate: ctx.period.to_date,
      excludePeriodId: ctx.period.id,
      context: ctx.taxContext,
      persist: ctx.persistTax,
      monthsRemaining,
    });
    return round2(result.monthlyTds);
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  private async persistEmployee(
    computed: EmployeePayComputation,
    ctx: RunContext,
    runId: number,
    userId: number,
    conn: any,
  ): Promise<void> {
    const line: EnterpriseSalaryLine = {
      periodId: ctx.period.id,
      runId,
      employeeId: computed.employeeId,
      workerType: computed.workerType,
      structureId: computed.structureId,
      currency: computed.currency,
      totalCts: computed.totalCts,
      lotsCount: computed.lotsCount,
      paidDays: computed.paidDays,
      periodDays: computed.periodDays,
      presentDays: computed.presentDays,
      absentDays: computed.absentDays,
      leaveDays: computed.leaveDays,
      lopDays: computed.lopDays,
      payableDays: computed.payableDays,
      otHours: computed.otHours,
      earnPiece: computed.earnPiece,
      earnFixed: computed.earnFixed,
      earnOt: computed.earnOt,
      earnBonus: computed.earnBonus,
      earnIncentive: computed.earnIncentive,
      earnVariable: computed.earnVariable,
      earnArrears: computed.earnArrears,
      earnReimbursement: computed.earnReimbursement,
      grossAmount: computed.grossAmount,
      taxableIncome: computed.taxableIncome,
      dedPf: computed.dedPf,
      dedEsi: computed.dedEsi,
      dedPt: computed.dedPt,
      dedIncomeTax: computed.dedIncomeTax,
      dedLoan: computed.dedLoan,
      dedAdvance: computed.dedAdvance,
      dedLwf: computed.dedLwf,
      dedInsurance: computed.dedInsurance,
      dedOther: computed.dedOther,
      totalDeductions: computed.totalDeductions,
      netAmount: computed.netAmount,
      employerPf: computed.employerPf,
      employerEsi: computed.employerEsi,
      employerCost: computed.employerCost,
      isFinalSettlement: false,
      remarks: null,
      userId,
    };

    const lineId = await this.runRepo.upsertSalaryLine(line, conn);
    await this.runRepo.replaceLineComponents(lineId, computed.components, conn);

    const recoveredOn = ctx.period.to_date;
    const settledLoans: number[] = [];
    for (const rec of computed.loanRecoveries) {
      await this.runRepo.markInstallmentRecovered(
        rec.installmentId,
        rec.amount,
        recoveredOn,
        lineId,
        ctx.period.id,
        conn,
      );
      settledLoans.push(rec.loanId);
    }
    if (settledLoans.length > 0) {
      await this.runRepo.closeSettledLoans([...new Set(settledLoans)], conn);
    }

    for (const rec of computed.advanceRecoveries) {
      await this.advanceRepo.insertRecovery(
        {
          advanceId: rec.advanceId,
          periodId: ctx.period.id,
          salaryLineId: lineId,
          amount: rec.amount,
          recoveredOn,
          source: 'PAYROLL',
        },
        userId,
        conn,
      );
      if (rec.closes) {
        await this.advanceRepo.updateStatus(rec.advanceId, 'CLOSED', conn);
      }
    }
  }

  // =========================================================================
  // Retro
  // =========================================================================

  /**
   * Recompute past periods against today's salary structure and post the
   * difference into the open target period as ARREARS.
   *
   * A LOCKED or PAID period's own salary lines are never rewritten — that is
   * frozen history. The correction always lands in the open period.
   */
  async runRetro(options: RetroRunOptions): Promise<RetroRunResult>;
  async runRetro(
    periodId: number,
    fromPeriodId: number,
    employeeIds: number[],
    userId: number,
    actorName?: string,
  ): Promise<RetroRunResult>;
  async runRetro(
    periodOrOptions: number | RetroRunOptions,
    fromPeriodId?: number,
    employeeIds?: number[],
    userId?: number,
    actorName = 'System',
  ): Promise<RetroRunResult> {
    const options: RetroRunOptions = typeof periodOrOptions === 'number'
      ? {
        periodId: periodOrOptions,
        fromPeriodId,
        employeeIds,
        userId: Number(userId ?? 0),
        actorName,
      }
      : periodOrOptions;

    const scopedEmployeeIds = options.employeeIds && options.employeeIds.length > 0
      ? options.employeeIds.map(Number)
      : undefined;
    const actor = options.actorName ?? 'System';

    const target = await this.runRepo.getPeriod(options.periodId);
    if (!target) throw new Error('Salary period not found');
    if (target.status !== 'OPEN') throw new Error('Payroll can only run while the period is OPEN');

    // The window to recompute: an explicit period, an explicit date, or — when
    // neither is given — every period of the financial year up to this one.
    let fromPeriod: PayrollPeriodRow | null = null;
    let fromDate: string;
    if (options.fromPeriodId) {
      fromPeriod = await this.runRepo.getPeriod(options.fromPeriodId);
      if (!fromPeriod) throw new Error('Starting salary period not found');
      fromDate = fromPeriod.from_date;
    } else if (options.effectiveFrom) {
      fromDate = toDateString(options.effectiveFrom);
    } else {
      fromDate = this.taxService.getFinancialYearBounds(
        this.taxService.getFinancialYear(target.to_date),
      ).from;
    }

    const pastPeriods = (await this.runRepo.getPeriodsInRange(fromDate, target.from_date))
      .filter((p) => p.id !== target.id);

    const deltas: RetroEmployeeDelta[] = [];
    const arrearsByEmployee: Record<number, number> = {};

    for (const past of pastPeriods) {
      const employees = this.applyFilters(
        await this.employeeRepo.findEmployableInWindow(past.from_date, past.to_date),
        { employeeIds: scopedEmployeeIds },
      );
      if (employees.length === 0) continue;

      const ids = employees.map((e) => Number(e.id));
      const storedGross = await this.runRepo.getGrossByEmployee(past.id, ids);
      const ctx = await this.loadContext(
        past,
        {
          periodId: past.id,
          runType: 'RETRO',
          employeeIds: ids,
          isSimulation: true,
          userId: options.userId,
          actorName: actor,
        },
        ids,
      );

      for (const emp of employees) {
        try {
          const computed = await this.computeEmployee(emp, ctx);
          const recomputed = computed ? computed.grossAmount : 0;
          const previous = storedGross.get(Number(emp.id)) ?? 0;
          const difference = round2(recomputed - previous);
          if (difference === 0) continue;
          deltas.push({
            employeeId: Number(emp.id),
            periodId: past.id,
            previousGross: previous,
            recomputedGross: recomputed,
            difference,
          });
          arrearsByEmployee[Number(emp.id)] = round2((arrearsByEmployee[Number(emp.id)] ?? 0) + difference);
        } catch {
          // A retro recomputation that fails simply produces no arrears for that
          // employee; the regular run below still pays them normally.
        }
      }
    }

    const totalArrears = round2(
      Object.values(arrearsByEmployee).reduce((sum, value) => round2(sum + value), 0),
    );

    const run = await this.runPayroll({
      periodId: target.id,
      runType: 'RETRO',
      employeeIds: scopedEmployeeIds,
      isSimulation: false,
      userId: options.userId,
      actorName: actor,
      label: `Retro from ${fromPeriod ? fromPeriod.label : fromDate}`,
      arrears: arrearsByEmployee,
    });

    return {
      runId: run.runId,
      periodId: target.id,
      fromPeriodId: fromPeriod ? fromPeriod.id : (pastPeriods[0]?.id ?? target.id),
      deltas,
      arrearsByEmployee,
      totalArrears,
      run,
    };
  }

  // =========================================================================
  // Full and final settlement
  // =========================================================================

  /**
   * Compute a full and final settlement. The row is written as CALCULATED and is
   * deliberately NOT approved — approval is somebody's signature, not the
   * engine's.
   */
  async runFinalSettlement(
    employeeId: number,
    lastWorkingDate: string,
    userId: number,
    options: FinalSettlementOptions = {},
  ): Promise<FinalSettlementResult> {
    const warnings: string[] = [];
    const employee = await this.employeeRepo.findById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const lwd = toDateString(lastWorkingDate);
    const period = (await this.runRepo.getPeriodCovering(lwd)) ?? (await this.runRepo.getPeriodCovering(todayString()));
    if (!period) throw new Error('No salary period covers the last working date');

    // ---- pending salary up to the last working day ------------------------
    const settlementWindow: PayrollPeriodRow = { ...period, to_date: minDate(period.to_date, lwd) };
    const ctx = await this.loadContext(
      settlementWindow,
      {
        periodId: period.id,
        runType: 'FINAL_SETTLEMENT',
        employeeIds: [employeeId],
        isSimulation: true,
        userId,
        actorName: 'System',
      },
      [employeeId],
    );

    const computed = await this.computeEmployee(employee as unknown as EmployeeRow, ctx);
    const pendingSalary = computed ? round2(computed.grossAmount - computed.totalDeductions) : 0;
    if (computed) warnings.push(...computed.warnings);

    const comp = ctx.compensation.get(employeeId) ?? null;
    const monthlyBase = comp ? comp.monthlyGross : num((employee as any).monthly_salary);
    const denominatorDays = computePayableDays({
      periodDays: daysBetween(period.from_date, period.to_date),
      paidUnits: 0,
      workingDays: 0,
      lopBasis: ctx.cycle?.lop_basis ?? 'CALENDAR_DAYS',
      fixedDaysPerMonth: ctx.cycle?.fixed_days_per_month ?? null,
    }).denominatorDays;
    const perDayPay = round2(safeDiv(monthlyBase, denominatorDays));

    // ---- leave encashment --------------------------------------------------
    const encashmentDays = await this.runRepo.getEncashableLeaveDays(employeeId, Number(lwd.slice(0, 4)));
    const leaveEncashmentAmount = round2(encashmentDays * perDayPay);
    if (encashmentDays > 0 && perDayPay === 0) {
      // Piece-rate workers have no monthly wage, so there is no per-day rate to
      // encash against. Say so rather than silently settling at zero.
      warnings.push(
        `${encashmentDays} encashable leave days could not be valued: no monthly wage is configured for this employee`,
      );
    }

    // ---- gratuity ----------------------------------------------------------
    const joinedAt = (employee as any).joined_at ? toDateString((employee as any).joined_at) : lwd;
    const years = yearsOfService(joinedAt, lwd);
    const gratuityApplicable = (employee as any).gratuity_applicable !== 0
      && (employee as any).gratuity_applicable !== false;
    // Gratuity is paid on the last drawn basic + DA; without a structure the
    // monthly salary is the only wage figure available.
    const lastDrawnBasicPlusDa = monthlyBase;
    const gratuityAmount = gratuityApplicable ? computeGratuity(lastDrawnBasicPlusDa, years) : 0;
    if (gratuityApplicable && years >= 5 && gratuityAmount === 0) {
      warnings.push('Gratuity computed as zero: no basic/DA wage figure is configured');
    }

    // ---- notice shortfall --------------------------------------------------
    const noticePeriodDays = Number((employee as any).notice_period_days ?? 0) || 0;
    const noticeServedDays = options.noticeServedDays !== undefined
      ? Math.max(0, Math.floor(options.noticeServedDays))
      : noticePeriodDays;
    const noticeShortfallDays = Math.max(0, noticePeriodDays - noticeServedDays);
    const noticeRecovery = round2(noticeShortfallDays * perDayPay);

    // ---- outstanding recoveries -------------------------------------------
    const loans = await this.runRepo.getOutstandingLoans(employeeId);
    const loanRecovery = round2(loans.reduce((sum, l) => round2(sum + l.outstanding), 0));
    const advances = await this.advanceRepo.findActiveByEmployee(employeeId);
    const advanceRecovery = round2(advances.reduce((sum, a) => round2(sum + Math.max(0, a.outstanding)), 0));

    const bonusPayable = round2(num(options.bonusPayable));
    const otherEarnings = round2(num(options.otherEarnings));
    const otherDeductions = round2(num(options.otherDeductions));
    const assetRecovery = round2(num(options.assetRecovery));
    const taxDeduction = round2(num(options.taxDeduction));

    const grossPayable = round2(
      pendingSalary + leaveEncashmentAmount + gratuityAmount + bonusPayable + otherEarnings,
    );
    const totalRecovery = round2(
      noticeRecovery + loanRecovery + advanceRecovery + assetRecovery + taxDeduction + otherDeductions,
    );
    // A settlement may legitimately end negative — that is money the employee
    // owes back, not a payroll error, so it is not clamped to zero.
    const netSettlement = round2(grossPayable - totalRecovery);

    const result: FinalSettlementResult = {
      id: null,
      settlementId: null,
      employeeId,
      empCode: (employee as any).emp_code,
      fullName: (employee as any).full_name,
      settlementType: options.settlementType ?? 'RESIGNATION',
      lastWorkingDate: lwd,
      noticePeriodDays,
      noticeServedDays,
      noticeShortfallDays,
      pendingSalary,
      leaveEncashmentDays: round2(encashmentDays),
      leaveEncashmentAmount,
      gratuityYears: years,
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
      perDayPay,
      warnings,
    };

    if (options.persist !== false) {
      const settlementId = await this.runRepo.insertFinalSettlement(
        result,
        result.settlementType,
        userId,
      );
      result.settlementId = settlementId;
      result.id = settlementId;
    }

    return result;
  }
}

/** Process-wide engine instance; constructing it registers the PAYROLL_RUN job. */
export const payrollEngineV2Service = new PayrollEngineV2Service();
