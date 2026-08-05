import { PerformanceAnalyticsRepository } from '../repositories/PerformanceAnalyticsRepository';
import { PerformanceCycleRepository } from '../repositories/PerformanceCycleRepository';
import { generateCsv } from '../utils/csv';
import { round2, toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportPayload {
  reportType: string;
  generatedAtNote?: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

const REPORT_TYPES = new Set(['goal-achievement', 'kpi-report', 'kra-report', 'okr-report']);

function avgOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return round2(num(value));
}

function toInt(value: unknown): number {
  return Math.trunc(num(value));
}

/**
 * Read-only analytics over the whole performance module. Where the data is
 * too thin to support a statistical claim (a bell curve over ten people, an
 * attrition correlation over one cycle) the payload says so instead of
 * dressing the numbers up.
 */
export class PerformanceAnalyticsService {
  private repo = new PerformanceAnalyticsRepository();
  private cycles = new PerformanceCycleRepository();

  async dashboard(cycleId: number): Promise<any> {
    await this.mustFindCycle(cycleId);
    const [goals, kpis, kras, okr, reviewCounts, appraisalCounts] = await Promise.all([
      this.repo.goalStats(cycleId),
      this.repo.kpiStats(cycleId),
      this.repo.kraStats(cycleId),
      this.repo.okrStats(cycleId),
      this.repo.reviewCountsByStatus(cycleId),
      this.repo.appraisalCountsByStatus(cycleId),
    ]);

    const reviewProgress: Record<string, number> = {
      requested: 0, inProgress: 0, submitted: 0, acknowledged: 0, declined: 0,
    };
    const reviewKeyMap: Record<string, string> = {
      REQUESTED: 'requested', IN_PROGRESS: 'inProgress', SUBMITTED: 'submitted',
      ACKNOWLEDGED: 'acknowledged', DECLINED: 'declined',
    };
    for (const r of reviewCounts) {
      const key = reviewKeyMap[String(r.status)];
      if (key) reviewProgress[key] = toInt(r.count);
    }

    const appraisals: Record<string, number> = {
      pending: 0, inReview: 0, calibrated: 0, finalized: 0, letterIssued: 0, acknowledged: 0,
    };
    const appraisalKeyMap: Record<string, string> = {
      PENDING: 'pending', IN_REVIEW: 'inReview', CALIBRATED: 'calibrated',
      FINALIZED: 'finalized', LETTER_ISSUED: 'letterIssued', ACKNOWLEDGED: 'acknowledged',
    };
    for (const r of appraisalCounts) {
      const key = appraisalKeyMap[String(r.status)];
      if (key) appraisals[key] = toInt(r.count);
    }

    // Top/bottom performers: appraisal ratings when any exist, otherwise
    // average goal progress — the payload labels which basis was used.
    const ratedTop = await this.repo.performersByAppraisalRating(cycleId, 'DESC', 5);
    let basis: 'appraisal_rating' | 'goal_progress';
    let highPerformers: any[];
    let lowPerformers: any[];
    if (ratedTop.length > 0) {
      basis = 'appraisal_rating';
      const ratedBottom = await this.repo.performersByAppraisalRating(cycleId, 'ASC', 5);
      const map = (r: any) => ({
        employeeId: r.employee_id,
        employeeName: r.full_name,
        empCode: r.emp_code,
        value: avgOrNull(r.rating),
      });
      highPerformers = ratedTop.map(map);
      lowPerformers = ratedBottom.map(map);
    } else {
      basis = 'goal_progress';
      const top = await this.repo.performersByGoalProgress(cycleId, 'DESC', 5);
      const bottom = await this.repo.performersByGoalProgress(cycleId, 'ASC', 5);
      const map = (r: any) => ({
        employeeId: r.employee_id,
        employeeName: r.full_name,
        empCode: r.emp_code,
        value: avgOrNull(r.avg_progress),
      });
      highPerformers = top.map(map);
      lowPerformers = bottom.map(map);
    }

    return {
      cycleId,
      goalCompletion: {
        total: toInt(goals.total),
        completed: toInt(goals.completed),
        active: toInt(goals.active),
        pendingApproval: toInt(goals.pending_approval),
        avgProgressPct: avgOrNull(goals.avg_progress),
      },
      kpiAchievement: {
        assignments: toInt(kpis.assignments),
        computed: toInt(kpis.computed),
        avgAchievementPct: avgOrNull(kpis.avg_achievement),
      },
      kraStatus: {
        assigned: toInt(kras.assigned),
        selfScored: toInt(kras.self_scored),
        reviewed: toInt(kras.reviewed),
        finalized: toInt(kras.finalized),
      },
      okr: {
        objectives: toInt(okr.objectives),
        keyResults: toInt(okr.key_results),
        avgProgressPct: avgOrNull(okr.avg_objective_progress),
      },
      reviewProgress,
      appraisals,
      basis,
      highPerformers,
      lowPerformers,
    };
  }

  /** Rating distribution in half-point buckets from 1 to 5. */
  async distribution(cycleId: number): Promise<any> {
    await this.mustFindCycle(cycleId);
    const ratings = await this.repo.appraisalRatings(cycleId);
    const buckets: { range: string; from: number; to: number; count: number }[] = [];
    for (let lo = 1; lo < 5; lo += 0.5) {
      const hi = lo + 0.5;
      buckets.push({ range: `${lo}-${hi}`, from: lo, to: hi, count: 0 });
    }
    for (const rating of ratings) {
      // Last bucket is inclusive of 5.0.
      const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor((rating - 1) / 0.5)));
      const bucket = buckets[idx];
      if (bucket) bucket.count += 1;
    }
    const sampleSize = ratings.length;
    const smallSampleWarning = sampleSize < 30;
    return {
      cycleId,
      sampleSize,
      smallSampleWarning,
      note: smallSampleWarning
        ? `Only ${sampleSize} rated appraisal(s) exist for this cycle; a bell curve drawn over so few people is illustrative only and should not drive forced-ranking decisions.`
        : undefined,
      buckets,
    };
  }

  async departments(cycleId: number): Promise<any[]> {
    await this.mustFindCycle(cycleId);
    const [goalStats, kpiStats] = await Promise.all([
      this.repo.departmentGoalStats(cycleId),
      this.repo.departmentKpiStats(cycleId),
    ]);
    const kpiByDept = new Map(kpiStats.map((k) => [Number(k.department_id), k]));
    return goalStats.map((g) => {
      const kpi = kpiByDept.get(Number(g.department_id));
      const goalCount = toInt(g.goal_count);
      const kpiCount = kpi ? toInt(kpi.assignment_count) : 0;
      return {
        departmentId: g.department_id,
        departmentName: g.department_name,
        headcountWithGoals: toInt(g.headcount_with_goals),
        goalCount,
        avgGoalProgress: goalCount > 0 ? avgOrNull(g.avg_goal_progress) : null,
        avgGoalProgressNote: goalCount > 0 ? undefined : 'no goals recorded for this department in the cycle',
        kpiAssignments: kpiCount,
        avgKpiAchievement: kpiCount > 0 ? avgOrNull(kpi?.avg_kpi_achievement) : null,
        avgKpiAchievementNote:
          kpiCount > 0
            ? kpi && kpi.avg_kpi_achievement === null
              ? 'assignments exist but none has been computed yet'
              : undefined
            : 'no KPI assignments for this department in the cycle',
      };
    });
  }

  async trends(months: number): Promise<any> {
    const span = Math.min(Math.max(Math.trunc(months) || 6, 1), 24);
    const today = new Date();
    const monthKeys: string[] = [];
    for (let i = span - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      monthKeys.push(toDateString(d).slice(0, 7));
    }
    const firstKey = monthKeys[0] as string;
    const [goalTrend, kpiTrend] = await Promise.all([
      this.repo.monthlyGoalUpdateTrend(`${firstKey}-01`),
      this.repo.monthlyKpiValueTrend(firstKey),
    ]);
    const goalByMonth = new Map(goalTrend.map((r) => [String(r.month), r]));
    const kpiByMonth = new Map(kpiTrend.map((r) => [String(r.month), r]));
    return {
      months: span,
      series: monthKeys.map((month) => {
        const g = goalByMonth.get(month);
        const k = kpiByMonth.get(month);
        return {
          month,
          goalProgressUpdates: g ? toInt(g.updates) : 0,
          avgReportedProgressPct: g ? avgOrNull(g.avg_progress) : null,
          kpiValuesRecorded: k ? toInt(k.values_recorded) : 0,
        };
      }),
    };
  }

  /**
   * Rating band vs resigned/working. With a headcount this small the payload
   * says the result is directional, not statistical — HONESTY over polish.
   */
  async attrition(cycleId: number): Promise<any> {
    await this.mustFindCycle(cycleId);
    const rows = await this.repo.ratingWorkStatusRows(cycleId);
    if (rows.length === 0) {
      return {
        available: false,
        reason: 'No appraisal ratings exist for this cycle yet, so a rating-vs-attrition correlation cannot be computed.',
      };
    }
    const bands = [
      { ratingBand: '1.0-1.9', lo: 1, hi: 2, resigned: 0, working: 0 },
      { ratingBand: '2.0-2.9', lo: 2, hi: 3, resigned: 0, working: 0 },
      { ratingBand: '3.0-3.9', lo: 3, hi: 4, resigned: 0, working: 0 },
      { ratingBand: '4.0-5.0', lo: 4, hi: 5.01, resigned: 0, working: 0 },
    ];
    for (const row of rows) {
      const rating = num(row.rating);
      const band = bands.find((b) => rating >= b.lo && rating < b.hi);
      if (!band) continue;
      if (String(row.work_status) === 'RESIGN') band.resigned += 1;
      else band.working += 1;
    }
    return {
      available: true,
      note: `directional at this sample size (${rows.length} rated employees)`,
      sampleSize: rows.length,
      groups: bands.map(({ ratingBand, resigned, working }) => ({ ratingBand, resigned, working })),
    };
  }

  // ==========================================================================
  // Reports
  // ==========================================================================

  async report(type: string, cycleId?: number): Promise<ReportPayload> {
    if (!REPORT_TYPES.has(type)) {
      throw new Error(`Unknown report type "${type}"; expected one of ${[...REPORT_TYPES].join(', ')}`);
    }
    if (cycleId) await this.mustFindCycle(cycleId);

    switch (type) {
      case 'goal-achievement': {
        const rows = await this.repo.goalReportRows(cycleId);
        return {
          reportType: type,
          columns: [
            { key: 'cycleCode', label: 'Cycle' },
            { key: 'kind', label: 'Kind' },
            { key: 'scope', label: 'Scope' },
            { key: 'owner', label: 'Owner' },
            { key: 'title', label: 'Goal' },
            { key: 'priority', label: 'Priority' },
            { key: 'weightagePct', label: 'Weightage %' },
            { key: 'progressPct', label: 'Progress %' },
            { key: 'status', label: 'Status' },
            { key: 'dueDate', label: 'Due Date' },
          ],
          rows: rows.map((r) => ({
            cycleCode: r.cycle_code,
            kind: r.kind,
            scope: r.scope,
            owner: r.employee_name ?? r.team_name ?? r.department_name ?? 'Organization',
            title: r.title,
            priority: r.priority,
            weightagePct: num(r.weightage_pct),
            progressPct: num(r.progress_pct),
            status: r.status,
            dueDate: r.due_date ? toDateString(r.due_date) : null,
          })),
        };
      }
      case 'kpi-report': {
        const rows = await this.repo.kpiReportRows(cycleId);
        return {
          reportType: type,
          columns: [
            { key: 'cycleCode', label: 'Cycle' },
            { key: 'kpiCode', label: 'KPI Code' },
            { key: 'kpiName', label: 'KPI' },
            { key: 'scope', label: 'Scope' },
            { key: 'owner', label: 'Assigned To' },
            { key: 'unit', label: 'Unit' },
            { key: 'targetValue', label: 'Target' },
            { key: 'actualValue', label: 'Actual' },
            { key: 'achievementPct', label: 'Achievement %' },
            { key: 'score', label: 'Score' },
            { key: 'status', label: 'Status' },
          ],
          rows: rows.map((r) => ({
            cycleCode: r.cycle_code,
            kpiCode: r.kpi_code,
            kpiName: r.kpi_name,
            scope: r.scope,
            owner: r.employee_name ?? r.department_name ?? 'Organization',
            unit: r.unit ?? null,
            targetValue: r.target_value === null ? null : num(r.target_value),
            actualValue: r.actual_value === null ? null : num(r.actual_value),
            achievementPct: r.achievement_pct === null ? null : num(r.achievement_pct),
            score: r.score === null ? null : num(r.score),
            status: r.status,
          })),
        };
      }
      case 'kra-report': {
        const rows = await this.repo.kraReportRows(cycleId);
        return {
          reportType: type,
          columns: [
            { key: 'cycleCode', label: 'Cycle' },
            { key: 'empCode', label: 'Emp Code' },
            { key: 'employeeName', label: 'Employee' },
            { key: 'kraCode', label: 'KRA Code' },
            { key: 'kraName', label: 'KRA' },
            { key: 'weightagePct', label: 'Weightage %' },
            { key: 'selfScore', label: 'Self Score' },
            { key: 'managerScore', label: 'Manager Score' },
            { key: 'finalScore', label: 'Final Score' },
            { key: 'status', label: 'Status' },
          ],
          rows: rows.map((r) => ({
            cycleCode: r.cycle_code,
            empCode: r.emp_code,
            employeeName: r.employee_name,
            kraCode: r.kra_code,
            kraName: r.kra_name,
            weightagePct: num(r.weightage_pct),
            selfScore: r.self_score === null ? null : num(r.self_score),
            managerScore: r.manager_score === null ? null : num(r.manager_score),
            finalScore: r.final_score === null ? null : num(r.final_score),
            status: r.status,
          })),
        };
      }
      default: {
        const rows = await this.repo.okrReportRows(cycleId);
        return {
          reportType: 'okr-report',
          columns: [
            { key: 'cycleCode', label: 'Cycle' },
            { key: 'kind', label: 'Kind' },
            { key: 'objectiveTitle', label: 'Objective' },
            { key: 'title', label: 'Title' },
            { key: 'scope', label: 'Scope' },
            { key: 'currentValue', label: 'Current' },
            { key: 'targetValue', label: 'Target' },
            { key: 'metricUnit', label: 'Unit' },
            { key: 'weightagePct', label: 'Weightage %' },
            { key: 'progressPct', label: 'Progress %' },
            { key: 'status', label: 'Status' },
          ],
          rows: rows.map((r) => ({
            cycleCode: r.cycle_code,
            kind: r.kind,
            objectiveTitle: r.kind === 'KEY_RESULT' ? r.objective_title ?? null : null,
            title: r.title,
            scope: r.scope,
            currentValue: r.current_value === null ? null : num(r.current_value),
            targetValue: r.target_value === null ? null : num(r.target_value),
            metricUnit: r.metric_unit ?? null,
            weightagePct: num(r.weightage_pct),
            progressPct: num(r.progress_pct),
            status: r.status,
          })),
        };
      }
    }
  }

  /** The same report rows, flattened to CSV for download. */
  async reportCsv(type: string, cycleId?: number): Promise<{ filename: string; csv: string }> {
    const payload = await this.report(type, cycleId);
    const csv = generateCsv(
      payload.columns.map((c) => c.label),
      payload.rows.map((row) => payload.columns.map((c) => row[c.key] ?? '')),
    );
    const suffix = cycleId ? `-cycle-${cycleId}` : '';
    return { filename: `${type}${suffix}.csv`, csv };
  }

  private async mustFindCycle(cycleId: number): Promise<void> {
    if (!cycleId) throw new Error('cycleId is required');
    const cycle = await this.cycles.findById(cycleId);
    if (!cycle) throw new Error(`Performance cycle ${cycleId} was not found`);
  }
}
