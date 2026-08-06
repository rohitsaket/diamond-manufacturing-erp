import { RecruitmentAnalyticsRepository } from '../repositories/RecruitmentAnalyticsRepository';

const REPORT_TYPES = [
  'vacancy', 'applications', 'interviews', 'offers', 'referrals',
  'transfers', 'promotions', 'hiring-kpis', 'talent-pool',
] as const;
export type RecruitmentReportType = (typeof REPORT_TYPES)[number];

export interface RecruitmentReport {
  reportType: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  note?: string;
}

/** The application funnel in pipeline order for conversion computation. */
const FUNNEL_ORDER = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT', 'INTERVIEW', 'SELECTED', 'OFFERED', 'HIRED'];

export class RecruitmentAnalyticsService {
  private repo = new RecruitmentAnalyticsRepository();

  async dashboard(): Promise<any> {
    const [counts, timeToFill, timeToHire] = await Promise.all([
      this.repo.dashboardCounts(),
      this.repo.avgTimeToFillDays(),
      this.repo.avgTimeToHireDays(),
    ]);
    return {
      openJobs: Number(counts.jobs?.open_jobs ?? 0),
      draftJobs: Number(counts.jobs?.draft_jobs ?? 0),
      activeApplications: Number(counts.applications?.active_applications ?? 0),
      interviewsThisWeek: counts.interviewsThisWeek,
      offersReleased: Number(counts.offers?.released ?? 0),
      offersAccepted: Number(counts.offers?.accepted ?? 0),
      transfersEffected: Number(counts.offers?.transfers ?? 0),
      promotionsEffected: Number(counts.offers?.promotions ?? 0),
      referrals: {
        total: Number(counts.referrals?.total ?? 0),
        hired: Number(counts.referrals?.hired ?? 0),
      },
      talentPoolSize: counts.talentPoolSize,
      avgTimeToFillDays: timeToFill,
      avgTimeToFillNote: timeToFill === null ? 'No internal job has been filled yet.' : undefined,
      avgTimeToHireDays: timeToHire,
      avgTimeToHireNote: timeToHire === null ? 'No application has reached HIRED yet.' : undefined,
    };
  }

  async funnel(jobId?: number): Promise<any> {
    const { current, reached } = await this.repo.funnel(jobId);
    const currentMap: Record<string, number> = {};
    for (const row of current) currentMap[row.status] = Number(row.n);
    const reachedMap: Record<string, number> = {};
    for (const row of reached) reachedMap[row.status] = Number(row.n);

    const stages = FUNNEL_ORDER.map((stage, i) => {
      const reachedCount = reachedMap[stage] ?? 0;
      const prevReached = i === 0 ? null : (reachedMap[FUNNEL_ORDER[i - 1]] ?? 0);
      return {
        stage,
        reached: reachedCount,
        current: currentMap[stage] ?? 0,
        conversionPctFromPrevious:
          prevReached === null || prevReached === 0
            ? null
            : Math.round((reachedCount / prevReached) * 1000) / 10,
      };
    });
    return {
      jobId: jobId ?? null,
      stages,
      terminal: {
        rejected: currentMap['REJECTED'] ?? 0,
        withdrawn: currentMap['WITHDRAWN'] ?? 0,
        draft: currentMap['DRAFT'] ?? 0,
      },
      note: 'Stage-reached counts come from the application timeline, so later stages still count applications that have moved on.',
    };
  }

  async byDepartment(): Promise<any[]> {
    const rows = await this.repo.byDepartment();
    return rows.map((r) => ({
      department: r.department ?? '(no department)',
      jobs: Number(r.jobs),
      applications: Number(r.applications),
      hires: Number(r.hires),
    }));
  }

  async referralAnalytics(): Promise<any> {
    const rows = await this.repo.referralsByMonth();
    return {
      months: rows.map((r) => ({
        month: r.month,
        total: Number(r.total),
        hired: Number(r.hired),
        hireRatePct: Number(r.total) > 0 ? Math.round((Number(r.hired) / Number(r.total)) * 1000) / 10 : 0,
      })),
    };
  }

  costSavings(): any {
    return {
      available: false,
      reason: 'External hiring cost baseline is not recorded in this system, so cost savings cannot be computed honestly.',
    };
  }

  aiInsights(): any {
    return {
      available: false,
      reason: 'AI ranking is not configured in this deployment.',
      note: 'Rule-based job matching is available at /internal-jobs/portal/recommended.',
    };
  }

  async report(type: string): Promise<RecruitmentReport> {
    switch (type as RecruitmentReportType) {
      case 'vacancy': {
        const rows = await this.repo.vacancyRows();
        return this.shape('vacancy', rows, [
          ['job_code', 'Job Code'], ['title', 'Title'], ['department', 'Department'],
          ['employment_type', 'Type'], ['work_mode', 'Work Mode'], ['openings', 'Openings'],
          ['status', 'Status'], ['published_at', 'Published'], ['expires_at', 'Expires'],
          ['applications', 'Applications'],
        ]);
      }
      case 'applications': {
        const rows = await this.repo.applicationRows();
        return this.shape('applications', rows, [
          ['id', 'ID'], ['job_code', 'Job'], ['job_title', 'Title'], ['emp_code', 'Emp Code'],
          ['applicant', 'Applicant'], ['status', 'Status'], ['eligibility_passed', 'Eligible'],
          ['submitted_at', 'Submitted'], ['decided_at', 'Decided'],
        ]);
      }
      case 'interviews': {
        const rows = await this.repo.interviewRows();
        return this.shape('interviews', rows, [
          ['id', 'ID'], ['job_title', 'Job'], ['applicant', 'Applicant'], ['round_no', 'Round'],
          ['round_type', 'Type'], ['scheduled_at', 'Scheduled'], ['mode', 'Mode'],
          ['status', 'Status'], ['outcome', 'Outcome'],
        ]);
      }
      case 'offers': {
        const rows = await this.repo.offerRows();
        return this.shape('offers', rows, this.offerColumns());
      }
      case 'transfers': {
        const rows = await this.repo.offerRows({ offerType: 'INTERNAL_TRANSFER' });
        return this.shape('transfers', rows, this.offerColumns());
      }
      case 'promotions': {
        const rows = await this.repo.offerRows({ offerType: 'PROMOTION' });
        return this.shape('promotions', rows, this.offerColumns());
      }
      case 'referrals': {
        const rows = await this.repo.referralRows();
        return this.shape('referrals', rows, [
          ['id', 'ID'], ['referrer', 'Referrer'], ['referred', 'Referred'], ['referral_kind', 'Kind'],
          ['job_title', 'Job'], ['status', 'Status'], ['reward_points', 'Points'], ['created_at', 'Created'],
        ]);
      }
      case 'hiring-kpis': {
        const dash = await this.dashboard();
        const rows = Object.entries(dash)
          .filter(([, v]) => typeof v !== 'object' || v === null)
          .map(([metric, value]) => ({ metric, value: value === null ? '—' : value }));
        rows.push({ metric: 'referralsTotal', value: dash.referrals.total });
        rows.push({ metric: 'referralsHired', value: dash.referrals.hired });
        return this.shape('hiring-kpis', rows, [['metric', 'Metric'], ['value', 'Value']]);
      }
      case 'talent-pool': {
        const rows = await this.repo.talentPoolRows();
        return this.shape('talent-pool', rows, [
          ['pool', 'Pool'], ['pool_type', 'Type'], ['emp_code', 'Emp Code'],
          ['employee', 'Employee'], ['note', 'Note'], ['added_at', 'Added'],
        ]);
      }
      default:
        throw new Error(`Unknown report type. Valid: ${REPORT_TYPES.join(', ')}`);
    }
  }

  reportCsv(report: RecruitmentReport): string {
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = report.columns.map((c) => escape(c.label)).join(',');
    const lines = report.rows.map((row) => report.columns.map((c) => escape(row[c.key])).join(','));
    return [header, ...lines].join('\n') + '\n';
  }

  private offerColumns(): [string, string][] {
    return [
      ['offer_code', 'Offer Code'], ['employee', 'Employee'], ['job_title', 'Job'],
      ['offer_type', 'Type'], ['title', 'Title'], ['to_grade', 'To Grade'],
      ['to_department', 'To Department'], ['status', 'Status'],
      ['released_at', 'Released'], ['responded_at', 'Responded'], ['effected_at', 'Effected'],
    ];
  }

  private shape(reportType: string, rows: any[], columns: [string, string][]): RecruitmentReport {
    return {
      reportType,
      columns: columns.map(([key, label]) => ({ key, label })),
      rows,
    };
  }
}
