import { ExitAnalyticsRepository } from '../repositories/ExitAnalyticsRepository';
import { round2, toDateString } from '../utils/dateUtils';
import { num, yearsOfService } from '../utils/payrollMath';

/**
 * Offboarding analytics and flat reports.
 *
 * Every aggregate block carries its sample size, and the attrition rate says
 * out loud when the dataset is too small for the percentage to mean anything.
 * Cost-of-attrition and AI prediction honestly report unavailable — the
 * baselines/models they need do not exist in this deployment.
 */

const VOLUNTARY_TYPES = new Set(['RESIGNATION', 'RETIREMENT', 'MUTUAL']);
const INVOLUNTARY_TYPES = new Set(['TERMINATION', 'LAYOFF']);

const SMALL_SAMPLE_NOTE =
  'The sample is very small, so this figure is arithmetic on a handful of records, not a statistically meaningful rate.';

export interface ReportResult {
  reportType: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}

function tenureBand(years: number): string {
  if (years < 1) return '< 1 year';
  if (years < 3) return '1-3 years';
  if (years < 5) return '3-5 years';
  if (years < 10) return '5-10 years';
  return '10+ years';
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function monthsAgoDate(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export class ExitAnalyticsService {
  private repo = new ExitAnalyticsRepository();

  // ===========================================================================
  // Dashboard
  // ===========================================================================

  async dashboard(): Promise<any> {
    const byStatus = await this.repo.countSeparationsByStatus();
    const activeCases = await this.repo.countActiveCases();
    const pendingClearances = await this.repo.countPendingClearances();
    const pendingAssetReturns = await this.repo.countPendingAssetReturns();
    const pendingInterviews = await this.repo.countPendingInterviews();
    const settlementCounts = await this.repo.countSettlementsByStatus();
    const lettersIssued = await this.repo.countLettersByType();
    const rehireEligible = await this.repo.countRehireEligible();

    const since = monthsAgoDate(12);
    const exitsLast12Months = await this.repo.countCompletedSeparationsSince(since);
    const headcount = await this.repo.countEmployees();

    const attritionRate: any = { available: headcount > 0 };
    if (headcount > 0) {
      attritionRate.ratePct = round2((exitsLast12Months / headcount) * 100);
      attritionRate.basis =
        `${exitsLast12Months} separation(s) completed since ${since}, divided by the current employee count of ${headcount}. `
        + 'A true average headcount over the period is not stored, so the current count stands in for it.';
      if (exitsLast12Months < 10 || headcount < 30) attritionRate.note = SMALL_SAMPLE_NOTE;
    } else {
      attritionRate.basis = 'No employees exist, so an attrition rate cannot be computed.';
    }

    return {
      activeCases,
      pendingResignations: byStatus['PENDING_APPROVAL'] ?? 0,
      inNotice: byStatus['IN_NOTICE'] ?? 0,
      pendingClearances,
      pendingAssetReturns,
      pendingInterviews,
      settlements: {
        draft: settlementCounts['DRAFT'] ?? 0,
        calculated: settlementCounts['CALCULATED'] ?? 0,
        pendingApproval: settlementCounts['PENDING_APPROVAL'] ?? 0,
        approved: settlementCounts['APPROVED'] ?? 0,
        paid: settlementCounts['PAID'] ?? 0,
      },
      lettersIssued,
      attritionRate,
      rehireEligible,
    };
  }

  // ===========================================================================
  // Attrition
  // ===========================================================================

  async attrition(): Promise<any> {
    const since = monthsAgoDate(12);
    const byMonthRows = await this.repo.completedByMonth(since);
    const byTypeRows = await this.repo.completedByType();
    const byDeptRows = await this.repo.completedByDepartment();
    const completed = await this.repo.completedSeparationRows();
    const choices = await this.repo.choiceDistribution();
    const freeTextReasons = await this.repo.countFreeTextReasons();

    const totalCompleted = byTypeRows.reduce((s, r) => s + Number(r.n), 0);

    // Voluntary vs involuntary, labelling anything outside the two buckets.
    let voluntary = 0;
    let involuntary = 0;
    const other: Record<string, number> = {};
    for (const r of byTypeRows) {
      const type = String(r.separation_type);
      const n = Number(r.n);
      if (VOLUNTARY_TYPES.has(type)) voluntary += n;
      else if (INVOLUNTARY_TYPES.has(type)) involuntary += n;
      else other[type] = (other[type] ?? 0) + n;
    }

    // Tenure bands from real joined_at -> last_working_day spans.
    const bands: Record<string, number> = {};
    let tenureSample = 0;
    for (const row of completed) {
      if (!row.joined_at || !row.last_working_day) continue;
      const years = yearsOfService(toDateString(row.joined_at), toDateString(row.last_working_day));
      bands[tenureBand(years)] = (bands[tenureBand(years)] ?? 0) + 1;
      tenureSample += 1;
    }

    // Top exit reasons: CHOICE-question distribution from the survey.
    const reasonsByQuestion: Record<string, { choice: string; count: number }[]> = {};
    let surveySample = 0;
    for (const c of choices) {
      const q = String(c.question);
      if (!reasonsByQuestion[q]) reasonsByQuestion[q] = [];
      reasonsByQuestion[q]!.push({ choice: String(c.choice), count: Number(c.n) });
      surveySample += Number(c.n);
    }

    const smallNote = totalCompleted < 10 ? SMALL_SAMPLE_NOTE : undefined;

    return {
      byMonth: {
        sampleSize: byMonthRows.reduce((s, r) => s + Number(r.n), 0),
        months: byMonthRows.map((r) => ({ month: String(r.month), exits: Number(r.n) })),
        basis: `Separations completed since ${since}, bucketed by completion month.`,
        ...(smallNote ? { note: smallNote } : {}),
      },
      byType: {
        sampleSize: totalCompleted,
        voluntary,
        involuntary,
        otherByType: other,
        detail: byTypeRows.map((r) => ({ type: String(r.separation_type), exits: Number(r.n) })),
        basis: 'Voluntary = RESIGNATION/RETIREMENT/MUTUAL; involuntary = TERMINATION/LAYOFF; everything else is labelled separately.',
        ...(smallNote ? { note: smallNote } : {}),
      },
      byDepartment: {
        sampleSize: byDeptRows.reduce((s, r) => s + Number(r.n), 0),
        departments: byDeptRows.map((r) => ({ department: String(r.department), exits: Number(r.n) })),
        ...(smallNote ? { note: smallNote } : {}),
      },
      tenureAtExit: {
        sampleSize: tenureSample,
        bands,
        basis: 'Tenure = joined_at to last_working_day of each completed separation.',
        ...(smallNote ? { note: smallNote } : {}),
      },
      topExitReasons: {
        sampleSize: surveySample,
        choiceDistribution: reasonsByQuestion,
        casesWithFreeTextReason: freeTextReasons,
        basis: 'Distribution of CHOICE answers in exit_survey_responses, plus the count of separations carrying a free-text reason. Free text is counted, not machine-interpreted.',
        ...(surveySample < 10 ? { note: SMALL_SAMPLE_NOTE } : {}),
      },
    };
  }

  cost(): { available: false; reason: string } {
    return {
      available: false,
      reason: 'Replacement and training cost baselines are not recorded, so cost of attrition cannot be computed honestly.',
    };
  }

  predictAttrition(): { available: false; reason: string; note: string } {
    return {
      available: false,
      reason: 'AI attrition prediction is not configured in this deployment.',
      note: 'The attrition analytics above are computed from real exit records.',
    };
  }

  // ===========================================================================
  // Reports
  // ===========================================================================

  async report(type: string): Promise<ReportResult> {
    const reportType = String(type ?? '').toLowerCase();
    switch (reportType) {
      case 'resignations': {
        const rows = await this.repo.reportResignations();
        return this.shape(reportType, [
          ['sepCode', 'Case'], ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['separationType', 'Type'],
          ['status', 'Status'], ['resignationDate', 'Resignation Date'], ['noticeDays', 'Notice Days'],
          ['noticeStart', 'Notice Start'], ['noticeEnd', 'Notice End'], ['lastWorkingDay', 'Last Working Day'], ['reason', 'Reason'],
        ], rows.map((r) => ({
          sepCode: r.sep_code, empCode: r.emp_code, employeeName: r.full_name, separationType: r.separation_type,
          status: r.status, resignationDate: this.d(r.resignation_date), noticeDays: r.notice_days,
          noticeStart: this.d(r.notice_start), noticeEnd: this.d(r.notice_end),
          lastWorkingDay: this.d(r.last_working_day), reason: r.reason,
        })));
      }
      case 'exit-interviews': {
        const rows = await this.repo.reportExitInterviews();
        return this.shape(reportType, [
          ['sepCode', 'Case'], ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['interviewType', 'Round'],
          ['status', 'Status'], ['scheduledAt', 'Scheduled'], ['completedAt', 'Completed'],
          ['interviewerName', 'Interviewer'], ['keyReasons', 'Key Reasons'], ['wouldRecommendCompany', 'Would Recommend'],
        ], rows.map((r) => ({
          sepCode: r.sep_code, empCode: r.emp_code, employeeName: r.full_name, interviewType: r.interview_type,
          status: r.status, scheduledAt: this.dt(r.scheduled_at), completedAt: this.dt(r.completed_at),
          interviewerName: r.interviewer_name,
          keyReasons: r.key_reasons,
          wouldRecommendCompany: r.would_recommend_company === null || r.would_recommend_company === undefined ? null : !!r.would_recommend_company,
        })));
      }
      case 'asset-returns': {
        const rows = await this.repo.reportAssetReturns();
        return this.shape(reportType, [
          ['sepCode', 'Case'], ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['assetCode', 'Asset Code'],
          ['assetName', 'Asset'], ['assetCategory', 'Category'], ['returnCondition', 'Condition'],
          ['damageNote', 'Damage Note'], ['damageCharge', 'Damage Charge'], ['returnedAt', 'Returned At'],
        ], rows.map((r) => ({
          sepCode: r.sep_code, empCode: r.emp_code, employeeName: r.full_name, assetCode: r.asset_code,
          assetName: r.asset_name, assetCategory: r.asset_category, returnCondition: r.return_condition,
          damageNote: r.damage_note, damageCharge: r.damage_charge === null ? null : round2(num(r.damage_charge)),
          returnedAt: this.dt(r.returned_at),
        })));
      }
      case 'clearances': {
        const rows = await this.repo.reportClearances();
        return this.shape(reportType, [
          ['sepCode', 'Case'], ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['department', 'Department'],
          ['status', 'Status'], ['note', 'Note'], ['clearedByName', 'Cleared By'], ['clearedAt', 'Cleared At'],
        ], rows.map((r) => ({
          sepCode: r.sep_code, empCode: r.emp_code, employeeName: r.full_name, department: r.department,
          status: r.status, note: r.note, clearedByName: r.cleared_by_name, clearedAt: this.dt(r.cleared_at),
        })));
      }
      case 'settlements': {
        const rows = await this.repo.reportSettlements();
        return this.shape(reportType, [
          ['id', 'Settlement'], ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['settlementType', 'Type'],
          ['status', 'Status'], ['lastWorkingDate', 'Last Working Date'], ['pendingSalary', 'Pending Salary'],
          ['leaveEncashment', 'Leave Encashment'], ['gratuity', 'Gratuity'], ['grossPayable', 'Gross Payable'],
          ['totalRecovery', 'Total Recovery'], ['netSettlement', 'Net Settlement'], ['paidAt', 'Paid At'],
        ], rows.map((r) => ({
          id: Number(r.id), empCode: r.emp_code, employeeName: r.full_name, settlementType: r.settlement_type,
          status: r.status, lastWorkingDate: this.d(r.last_working_date), pendingSalary: round2(num(r.pending_salary)),
          leaveEncashment: round2(num(r.leave_encashment_amount)), gratuity: round2(num(r.gratuity_amount)),
          grossPayable: round2(num(r.gross_payable)), totalRecovery: round2(num(r.total_recovery)),
          netSettlement: round2(num(r.net_settlement)), paidAt: this.dt(r.paid_at),
        })));
      }
      case 'letters': {
        const rows = await this.repo.reportLetters();
        return this.shape(reportType, [
          ['letterNumber', 'Letter No'], ['letterType', 'Type'], ['status', 'Status'], ['sepCode', 'Case'],
          ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['generatedAt', 'Generated'],
          ['emailedAt', 'Emailed'], ['emailError', 'Email Error'],
        ], rows.map((r) => ({
          letterNumber: r.letter_number, letterType: r.letter_type, status: r.status, sepCode: r.sep_code,
          empCode: r.emp_code, employeeName: r.full_name, generatedAt: this.dt(r.generated_at),
          emailedAt: this.dt(r.emailed_at), emailError: r.email_error,
        })));
      }
      case 'attrition': {
        const rows = await this.repo.completedSeparationRows();
        return this.shape(reportType, [
          ['sepCode', 'Case'], ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['separationType', 'Type'],
          ['department', 'Department'], ['workerType', 'Worker Type'], ['grade', 'Grade'],
          ['joinedAt', 'Joined'], ['lastWorkingDay', 'Last Working Day'], ['tenureYears', 'Tenure (Years)'],
          ['tenureBand', 'Tenure Band'], ['completedAt', 'Completed'],
        ], rows.map((r) => {
          const years = r.joined_at && r.last_working_day
            ? yearsOfService(toDateString(r.joined_at), toDateString(r.last_working_day))
            : null;
          return {
            sepCode: r.sep_code, empCode: r.emp_code, employeeName: r.full_name, separationType: r.separation_type,
            department: r.department, workerType: r.worker_type, grade: r.grade,
            joinedAt: this.d(r.joined_at), lastWorkingDay: this.d(r.last_working_day),
            tenureYears: years, tenureBand: years === null ? null : tenureBand(years),
            completedAt: this.dt(r.completed_at),
          };
        }));
      }
      case 'rehire': {
        const rows = await this.repo.reportRehire();
        return this.shape(reportType, [
          ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['exitDate', 'Exit Date'], ['lastGrade', 'Last Grade'],
          ['lastDepartment', 'Last Department'], ['rehireEligible', 'Rehire Eligible'], ['latestDecision', 'Latest Decision'],
          ['restrictionNote', 'Restriction Note'], ['isBoomerang', 'Boomerang'], ['inNetwork', 'In Network'],
        ], rows.map((r) => ({
          empCode: r.emp_code, employeeName: r.full_name, exitDate: this.d(r.exit_date), lastGrade: r.last_grade,
          lastDepartment: r.last_department,
          rehireEligible: r.rehire_eligible === null || r.rehire_eligible === undefined ? null : !!r.rehire_eligible,
          latestDecision: r.latest_decision, restrictionNote: r.rehire_restriction_note,
          isBoomerang: !!r.is_boomerang, inNetwork: !!r.in_alumni_network,
        })));
      }
      case 'kt': {
        const rows = await this.repo.reportKt();
        return this.shape(reportType, [
          ['sepCode', 'Case'], ['empCode', 'Emp Code'], ['employeeName', 'Employee'], ['planStatus', 'Plan Status'],
          ['successorName', 'Successor'], ['itemType', 'Item Type'], ['itemTitle', 'Item'],
          ['itemStatus', 'Item Status'], ['dueDate', 'Due'], ['completedAt', 'Completed'],
        ], rows.map((r) => ({
          sepCode: r.sep_code, empCode: r.emp_code, employeeName: r.full_name, planStatus: r.plan_status,
          successorName: r.successor_name, itemType: r.item_type, itemTitle: r.title, itemStatus: r.item_status,
          dueDate: this.d(r.due_date), completedAt: this.dt(r.completed_at),
        })));
      }
      default:
        throw new Error(
          `Unknown report type "${type}"; expected one of resignations, exit-interviews, asset-returns, clearances, settlements, letters, attrition, rehire, kt`,
        );
    }
  }

  async exportCsv(type: string): Promise<{ fileName: string; content: string }> {
    const result = await this.report(type);
    const header = result.columns.map((c) => csvEscape(c.label)).join(',');
    const lines = result.rows.map((row) => result.columns.map((c) => csvEscape(row[c.key])).join(','));
    return {
      fileName: `offboarding-${result.reportType}-${new Date().toISOString().slice(0, 10)}.csv`,
      content: [header, ...lines].join('\r\n'),
    };
  }

  // ---------------------------------------------------------------------------

  private shape(reportType: string, columns: [string, string][], rows: Record<string, unknown>[]): ReportResult {
    return {
      reportType,
      columns: columns.map(([key, label]) => ({ key, label })),
      rows,
    };
  }

  private d(value: unknown): string | null {
    return value ? toDateString(value) : null;
  }

  private dt(value: unknown): string | null {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : String(value);
  }
}
