import { AttendanceAnalyticsRepository, AnalyticsScope } from '../repositories/AttendanceAnalyticsRepository';
import { AttendanceDeviceRepository } from '../repositories/AttendanceDeviceRepository';
import { AttendancePunchRepository } from '../repositories/AttendancePunchRepository';
import { AttendanceRequestRepository } from '../repositories/AttendanceRequestRepository';
import { AttendanceComplianceRepository } from '../repositories/AttendanceComplianceRepository';
import { VisitorRepository } from '../repositories/VisitorRepository';
import { AttendanceAnalytics, LiveAttendanceBoard } from '../types/attendance';
import { daysBetween, isValidDateString, todayString } from '../utils/dateUtils';

const MAX_ANALYTICS_DAYS = 400;

export class AttendanceAnalyticsService {
  private repo = new AttendanceAnalyticsRepository();
  private punchRepo = new AttendancePunchRepository();
  private deviceRepo = new AttendanceDeviceRepository();
  private requestRepo = new AttendanceRequestRepository();
  private complianceRepo = new AttendanceComplianceRepository();
  private visitorRepo = new VisitorRepository();

  /**
   * The live board.
   *
   * `currentlyIn` and `onBreak` come from the punch stream rather than the day
   * summary, because a day is not final until someone punches out -- the
   * summary would show them absent while they are standing on the floor.
   */
  async liveBoard(date?: string): Promise<LiveAttendanceBoard> {
    const day = date && isValidDateString(date) ? date : todayString();

    const [totals, byDepartment, byBranch, shiftCoverage, recentPunches, exceptions, devices, presence] =
      await Promise.all([
        this.repo.dayTotals(day),
        this.repo.dayByDimension(day, 'department'),
        this.repo.dayByDimension(day, 'branch'),
        this.repo.shiftCoverage(day),
        this.punchRepo.findRecent(20),
        this.repo.dayExceptions(day, 20),
        this.deviceRepo.healthSummary(),
        this.punchRepo.getPresenceState(day),
      ]);

    let currentlyIn = 0;
    let onBreak = 0;
    let punchedOut = 0;
    for (const state of presence.values()) {
      if (state.lastType === 'IN' || state.lastType === 'BREAK_IN') currentlyIn += 1;
      else if (state.lastType === 'BREAK_OUT') onBreak += 1;
      else punchedOut += 1;
    }

    const expected = totals.present + totals.halfDay + totals.absent + totals.onLeave;
    const attendancePct = expected === 0
      ? 0
      : Math.round(((totals.present + totals.halfDay * 0.5) / expected) * 1000) / 10;

    return {
      date: day,
      generatedAt: new Date().toISOString(),
      totals: {
        headcount: totals.headcount,
        present: totals.present,
        absent: totals.absent,
        late: totals.late,
        onLeave: totals.onLeave,
        holiday: totals.holiday,
        weekOff: totals.weekOff,
        remote: totals.remote,
        businessTravel: totals.businessTravel,
        notMarked: Math.max(0, totals.headcount - totals.marked),
        currentlyIn,
        onBreak,
        punchedOut,
        overtimeHours: totals.overtimeHours,
        exceptions: totals.exceptions,
        missingPunches: totals.missingPunches,
        attendancePct,
      },
      shiftCoverage,
      byDepartment: byDepartment.map((d) => ({
        departmentId: d.id, name: d.name, headcount: d.headcount,
        present: d.present, absent: d.absent, pct: d.pct,
      })),
      byBranch: byBranch.map((b) => ({
        branchId: b.id, name: b.name, headcount: b.headcount, present: b.present, pct: b.pct,
      })),
      recentPunches,
      exceptions,
      devices,
    };
  }

  async analytics(scope: AnalyticsScope, granularity: 'day' | 'week' | 'month' = 'day'): Promise<AttendanceAnalytics> {
    if (!isValidDateString(scope.from) || !isValidDateString(scope.to)) throw new Error('Invalid date range');
    if (scope.to < scope.from) throw new Error('Invalid date range: to must not be before from');
    const span = daysBetween(scope.from, scope.to);
    if (span > MAX_ANALYTICS_DAYS) {
      throw new Error(`Analytics can cover at most ${MAX_ANALYTICS_DAYS} days. This range covers ${span}.`);
    }

    const [trend, byDepartment, byBranch, absenteeism, overtime, punctuality, heatmap, captureMix, workModeMix, summary] =
      await Promise.all([
        this.repo.trend(scope, granularity),
        this.repo.byDimension(scope, 'department'),
        this.repo.byDimension(scope, 'branch'),
        this.repo.absenteeism(scope),
        this.repo.overtimeLeaders(scope),
        this.repo.punctuality(scope),
        this.repo.heatmap(scope),
        this.punchRepo.countByMethod(scope.from, scope.to),
        this.repo.workModeMix(scope),
        this.repo.summary(scope),
      ]);

    const totalPunches = captureMix.reduce((sum, m) => sum + m.count, 0);

    return {
      from: scope.from,
      to: scope.to,
      trend,
      byDepartment,
      byBranch: byBranch.map((b) => ({ name: b.name, present: b.present, absent: b.absent, attendancePct: b.attendancePct })),
      absenteeism,
      overtime,
      punctuality,
      heatmap,
      captureMix: captureMix.map((m) => ({
        method: m.method,
        count: m.count,
        pct: totalPunches === 0 ? 0 : Math.round((m.count / totalPunches) * 1000) / 10,
      })),
      workModeMix,
      summary,
    };
  }

  /**
   * One roll-up for the attendance dashboard tab: today's board plus the
   * pending workload and open compliance issues, so the landing screen answers
   * "what needs me" and not only "what happened".
   */
  async dashboard(date?: string): Promise<{
    board: LiveAttendanceBoard;
    requests: Record<string, number>;
    compliance: { bySeverity: Record<string, number>; byStatus: Record<string, number>; total: number };
    visitors: Awaited<ReturnType<VisitorRepository['summaryForDate']>>;
    trend: AttendanceAnalytics['trend'];
  }> {
    const day = date && isValidDateString(date) ? date : todayString();
    const from = new Date(`${day}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 29);
    const fromDate = from.toISOString().slice(0, 10);

    const [board, requests, compliance, visitors, trend] = await Promise.all([
      this.liveBoard(day),
      this.requestRepo.countByStatus(),
      this.complianceRepo.summary(),
      this.visitorRepo.summaryForDate(day),
      this.repo.trend({ from: fromDate, to: day }, 'day'),
    ]);

    return { board, requests, compliance, visitors, trend };
  }
}
