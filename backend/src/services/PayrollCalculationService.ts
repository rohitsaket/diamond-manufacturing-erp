import { BaseRepository } from '../repositories/BaseRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { AttendanceRepository } from '../repositories/AttendanceRepository';
import { HolidayRepository } from '../repositories/HolidayRepository';
import { AdvanceRepository } from '../repositories/AdvanceRepository';
import { SettingRepository } from '../repositories/SettingRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { LotRepository } from '../repositories/LotRepository';
import { SalaryLineRepository, ComputedSalaryLine } from '../repositories/SalaryLineRepository';
import { EmployeeRow, RecalculateResult } from '../types';
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
} from '../utils/dateUtils';

/** Per-employee, per-day attendance snapshot used by the day walk. */
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

interface PeriodRow {
  id: number;
  label: string;
  from_date: any;
  to_date: any;
  status: 'OPEN' | 'LOCKED' | 'PAID';
}

/**
 * Thin BaseRepository wrapper so the engine can own the payroll transaction and
 * run the couple of ad-hoc reads (period row, shifts) it needs without touching
 * repositories owned elsewhere.
 */
class PayrollEngineRepository extends BaseRepository {
  runInTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  async lockPeriodRow(periodId: number, conn: any): Promise<PeriodRow | null> {
    const [rows] = await conn.query(
      'SELECT * FROM salary_periods WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [periodId],
    );
    return (rows as PeriodRow[])[0] ?? null;
  }

  async getShifts(conn: any): Promise<{ id: number; week_off_day: number; is_default: number | boolean }[]> {
    const [rows] = await conn.query('SELECT id, week_off_day, is_default FROM shifts WHERE deleted_at IS NULL');
    return rows as { id: number; week_off_day: number; is_default: number | boolean }[];
  }

  async findOverlappingPeriod(
    fromDate: string,
    toDate: string,
    excludeId?: number,
  ): Promise<{ id: number; label: string; from_date: any; to_date: any } | null> {
    let sql = `SELECT id, label, from_date, to_date FROM salary_periods
               WHERE deleted_at IS NULL AND from_date <= ? AND to_date >= ?`;
    const params: any[] = [toDate, fromDate];
    if (excludeId) {
      sql += ' AND id <> ?';
      params.push(excludeId);
    }
    sql += ' ORDER BY from_date LIMIT 1';
    const rows = await this.query<any[]>(sql, params);
    return rows[0] ?? null;
  }
}

/**
 * The payroll engine.
 *
 * Recalculation is fully derived and idempotent: running it twice on unchanged
 * inputs produces exactly the same lines and the same advance recoveries. It is
 * therefore safe to re-run as often as the data changes, but only while the
 * period is OPEN — a locked or paid period is frozen history.
 */
export class PayrollCalculationService {
  private engineRepo = new PayrollEngineRepository();
  private employeeRepo = new EmployeeRepository();
  private attendanceRepo = new AttendanceRepository();
  private holidayRepo = new HolidayRepository();
  private advanceRepo = new AdvanceRepository();
  private settingRepo = new SettingRepository();
  private activityRepo = new ActivityRepository();
  private lotRepo = new LotRepository();
  private lineRepo = new SalaryLineRepository();

  /**
   * Rebuild every salary line of a period from source data.
   *
   * Everything runs inside a single transaction: either the whole period is
   * recomputed or nothing changes. The period row is locked FOR UPDATE so two
   * concurrent recalculations cannot interleave and double-recover advances.
   */
  async recalculatePeriod(periodId: number, userId: number, actorName: string): Promise<RecalculateResult> {
    return this.engineRepo.runInTransaction(async (conn) => {
      const period = await this.engineRepo.lockPeriodRow(periodId, conn);
      if (!period) throw new Error('Salary period not found');
      if (period.status !== 'OPEN') {
        throw new Error('Recalculation is only allowed while the period is OPEN');
      }

      const from = toDateString(period.from_date);
      const to = toDateString(period.to_date);

      const settings = await this.settingRepo.getAll();
      const cfg = parseStatutoryConfig(settings);

      // Wipe payroll-generated recoveries first so a re-run never double-counts.
      // MANUAL recoveries are somebody's cash receipt and always survive.
      await this.advanceRepo.deletePayrollRecoveriesForPeriod(periodId, conn);

      // ---- batch loads (one query each, never per employee) -----------------
      const employees = await this.employeeRepo.findEmployableInWindow(from, to, conn);
      const pieceMap = await this.loadPieceMap(from, to, conn);
      const attendanceMap = await this.loadAttendanceMap(from, to, conn);
      const holidaySet = await this.holidayRepo.findDateSet(from, to);
      const { weekOffByShift, defaultWeekOff } = await this.loadShifts(conn);

      const warnings: string[] = [];
      const writtenEmployeeIds: number[] = [];
      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;

      for (const emp of employees) {
        const joinedAt = emp.joined_at ? toDateString(emp.joined_at) : from;
        const resignedAt = emp.resigned_at ? toDateString(emp.resigned_at) : null;
        const effFrom = maxDate(from, joinedAt);
        const effTo = minDate(to, resignedAt ?? to);
        // Employed for zero days inside this window (e.g. joined after it ended).
        if (effFrom > effTo) continue;

        const piece = pieceMap.get(emp.id) ?? { amount: 0, cts: 0, lots: 0 };
        const attendance = this.walkAttendance(
          emp,
          effFrom,
          effTo,
          attendanceMap.get(emp.id),
          holidaySet,
          weekOffByShift,
          defaultWeekOff,
        );

        const earnPiece = round2(piece.amount);
        const earnFixed = this.computeFixedEarning(emp, attendance.paidUnitsByMonth, warnings);
        const earnOt = computeOtAmount(attendance.otHours, cfg);
        const gross = round2(earnPiece + earnFixed + earnOt);

        // Nothing earned, nothing worked, nothing delivered — no line at all.
        if (gross === 0 && attendance.paidDays === 0 && piece.lots === 0) continue;

        const dedPf = computePf(gross, cfg, !!emp.pf_applicable);
        const dedEsi = computeEsi(gross, cfg, !!emp.esi_applicable);
        const dedPt = computePt(gross, cfg);
        const statutory = round2(dedPf + dedEsi + dedPt);

        const line: ComputedSalaryLine = {
          periodId,
          employeeId: emp.id,
          workerType: emp.worker_type ?? null,
          totalCts: round2(piece.cts),
          lotsCount: piece.lots,
          paidDays: attendance.paidDays,
          periodDays: attendance.periodDays,
          presentDays: attendance.presentDays,
          absentDays: attendance.absentDays,
          leaveDays: attendance.leaveDays,
          otHours: round2(attendance.otHours),
          earnPiece,
          earnFixed,
          earnOt,
          grossAmount: gross,
          dedPf,
          dedEsi,
          dedPt,
          dedAdvance: 0,
          dedOther: 0,
          totalDeductions: statutory,
          netAmount: round2(gross - statutory),
          userId,
        };

        // Write first: advance_recoveries.salary_line_id needs the line id.
        const lineId = await this.lineRepo.upsertComputedLine(line, conn);

        const dedAdvance = await this.recoverAdvances(
          emp.id,
          periodId,
          lineId,
          round2(gross - statutory),
          to,
          userId,
          conn,
        );

        if (dedAdvance > 0) {
          const finalDeductions = round2(statutory + dedAdvance);
          const finalNet = round2(gross - finalDeductions);
          await this.lineRepo.updateAdvanceDeduction(lineId, dedAdvance, finalDeductions, finalNet, conn);
          totalDeductions += finalDeductions;
          totalNet += finalNet;
        } else {
          totalDeductions += statutory;
          totalNet += line.netAmount;
        }

        totalGross += gross;
        writtenEmployeeIds.push(emp.id);
      }

      const linesRemoved = await this.lineRepo.deleteLinesNotIn(periodId, writtenEmployeeIds, conn);

      const result: RecalculateResult = {
        periodId,
        linesWritten: writtenEmployeeIds.length,
        linesRemoved,
        totalGross: round2(totalGross),
        totalDeductions: round2(totalDeductions),
        totalNet: round2(totalNet),
        warnings,
      };

      await this.activityRepo.log(
        {
          actorUserId: userId,
          actorName,
          entityType: 'salary_period',
          entityId: periodId,
          action: 'RECALCULATE',
          summary: `Recalculated payroll for "${period.label}": ${result.linesWritten} lines, net ₹${result.totalNet}`,
          meta: { ...result },
        },
        conn,
      );

      return result;
    });
  }

  /**
   * Reject a period whose dates overlap an existing one. Overlapping periods
   * would let the same lot or attendance day be paid twice.
   */
  async validateNoOverlap(fromDate: string, toDate: string, excludeId?: number): Promise<void> {
    const clash = await this.engineRepo.findOverlappingPeriod(fromDate, toDate, excludeId);
    if (clash) {
      throw new Error(
        `This period overlaps the existing period "${clash.label}" (${toDateString(clash.from_date)} – ${toDateString(clash.to_date)})`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // batch loaders
  // -------------------------------------------------------------------------

  private async loadPieceMap(from: string, to: string, conn: any): Promise<Map<number, PieceTotals>> {
    const rows = await this.lotRepo.getLabourByEmployeeForWindow(from, to, conn);
    const map = new Map<number, PieceTotals>();
    for (const r of rows) {
      map.set(Number(r.employee_id), {
        amount: Number(r.total_amount) || 0,
        cts: Number(r.total_cts) || 0,
        lots: Number(r.lots_count) || 0,
      });
    }
    return map;
  }

  private async loadAttendanceMap(from: string, to: string, conn: any): Promise<Map<number, Map<string, DayFact>>> {
    const rows = await this.attendanceRepo.getWindowRows(from, to, conn);
    const map = new Map<number, Map<string, DayFact>>();
    for (const r of rows) {
      const empId = Number(r.employee_id);
      let byDate = map.get(empId);
      if (!byDate) {
        byDate = new Map<string, DayFact>();
        map.set(empId, byDate);
      }
      byDate.set(toDateString(r.att_date), {
        status: r.status,
        otHours: Number(r.ot_hours) || 0,
        // is_paid comes from the joined leave type; null means "not a leave row".
        isPaidLeave: Number(r.is_paid) === 1,
      });
    }
    return map;
  }

  private async loadShifts(conn: any): Promise<{ weekOffByShift: Map<number, number>; defaultWeekOff: number }> {
    const shifts = await this.engineRepo.getShifts(conn);
    const weekOffByShift = new Map<number, number>();
    let defaultWeekOff = 0; // Sunday, unless a shift is flagged as the default.
    for (const s of shifts) {
      const day = Number(s.week_off_day) || 0;
      weekOffByShift.set(Number(s.id), day);
      if (s.is_default === 1 || s.is_default === true) defaultWeekOff = day;
    }
    return { weekOffByShift, defaultWeekOff };
  }

  // -------------------------------------------------------------------------
  // per-employee computation
  // -------------------------------------------------------------------------

  /**
   * Walk every day the employee was on the books inside the period and decide
   * whether it is paid.
   *
   * A marked day always wins. An unmarked day is paid only when it is a company
   * holiday or the employee's weekly off — an unmarked *working* day is unpaid,
   * so a missing attendance import can never silently inflate wages.
   */
  private walkAttendance(
    emp: EmployeeRow,
    effFrom: string,
    effTo: string,
    days: Map<string, DayFact> | undefined,
    holidaySet: Set<string>,
    weekOffByShift: Map<number, number>,
    defaultWeekOff: number,
  ): {
    paidDays: number;
    periodDays: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    otHours: number;
    paidUnitsByMonth: Map<string, number>;
  } {
    const weekOffDay = (emp.shift_id !== null && weekOffByShift.get(Number(emp.shift_id)) !== undefined)
      ? (weekOffByShift.get(Number(emp.shift_id)) as number)
      : defaultWeekOff;

    const paidUnitsByMonth = new Map<string, number>();
    let paidDays = 0;
    let presentDays = 0;
    let absentDays = 0;
    let leaveDays = 0;
    let otHours = 0;

    for (const date of eachDate(effFrom, effTo)) {
      const fact = days?.get(date);
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
      } else if (holidaySet.has(date)) {
        unit = 1;
      } else if (dayOfWeek(date) === weekOffDay) {
        unit = 1;
      } else {
        // Unmarked working day: unpaid, and reported as absent so the payslip
        // day buckets still add up to the employed days.
        unit = 0;
        absentDays += 1;
      }

      paidDays += unit;
      const mk = monthKey(date);
      paidUnitsByMonth.set(mk, (paidUnitsByMonth.get(mk) ?? 0) + unit);
    }

    return {
      paidDays: round2(paidDays),
      // Days the employee was actually on the books inside the period, so
      // paid/period reads correctly for mid-period joiners and leavers.
      periodDays: daysBetween(effFrom, effTo),
      presentDays: round2(presentDays),
      absentDays: round2(absentDays),
      leaveDays: round2(leaveDays),
      otHours: round2(otHours),
      paidUnitsByMonth,
    };
  }

  /**
   * Monthly-salary earners (DHAR/MAXI) are prorated month by month, each month
   * against its own length. Piece-rate workers have no fixed component.
   */
  private computeFixedEarning(
    emp: EmployeeRow,
    paidUnitsByMonth: Map<string, number>,
    warnings: string[],
  ): number {
    if (emp.worker_type !== 'DHAR' && emp.worker_type !== 'MAXI') return 0;

    const monthly = Number(emp.monthly_salary) || 0;
    if (monthly <= 0) {
      // Never throw: one unconfigured employee must not block the whole payroll.
      warnings.push(`${emp.emp_code} ${emp.full_name}: no monthly salary set`);
      return 0;
    }
    return prorateMonthly(monthly, paidUnitsByMonth, daysInMonth);
  }

  /**
   * Recover instalments against active advances, oldest first.
   *
   * Two invariants hold no matter what the data says: an advance can never be
   * over-recovered (capped by its outstanding balance) and net pay can never go
   * negative (capped by the headroom left after statutory deductions).
   */
  private async recoverAdvances(
    employeeId: number,
    periodId: number,
    salaryLineId: number,
    availableHeadroom: number,
    recoveredOn: string,
    userId: number,
    conn: any,
  ): Promise<number> {
    let headroom = round2(Math.max(0, availableHeadroom));
    if (headroom <= 0) return 0;

    // Already filtered to ACTIVE and ordered oldest advance first by the repo.
    const advances = await this.advanceRepo.findActiveByEmployee(employeeId, conn);

    let recovered = 0;
    for (const adv of advances) {
      if (headroom <= 0) break;

      const outstanding = round2(Number(adv.outstanding) || 0);
      if (outstanding <= 0) {
        await this.advanceRepo.updateStatus(adv.id, 'CLOSED', conn);
        continue;
      }

      const instalment = Number(adv.installmentAmount) || 0;
      const cap = instalment > 0 ? instalment : outstanding;
      const take = round2(Math.min(cap, outstanding, headroom));
      if (take <= 0) continue;

      await this.advanceRepo.insertRecovery(
        {
          advanceId: adv.id,
          periodId,
          salaryLineId,
          amount: take,
          recoveredOn,
          source: 'PAYROLL',
        },
        userId,
        conn,
      );

      headroom = round2(headroom - take);
      recovered = round2(recovered + take);

      if (round2(outstanding - take) <= 0) {
        await this.advanceRepo.updateStatus(adv.id, 'CLOSED', conn);
      }
    }

    return recovered;
  }
}
