import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';

/**
 * Read-side of payroll: dashboard aggregates, cost analytics, statutory
 * reports, the run register and the payroll audit trail.
 *
 * Every metric is a single set-based aggregate. Nothing here loops over
 * employees in Node, because at six figures of headcount that is the difference
 * between a dashboard and an outage.
 */

export interface DateRange {
  from: string;
  to: string;
}

export interface PeriodTotals {
  periodId: number | null;
  periodLabel: string | null;
  employeesProcessed: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  totalBonus: number;
  totalIncentive: number;
  totalOvertime: number;
  overtimeHours: number;
  totalTax: number;
  totalPf: number;
  totalEsi: number;
  totalPt: number;
  employerPf: number;
  employerEsi: number;
}

export interface BucketAmount {
  bucket: string;
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
}

export interface TrendPoint extends BucketAmount {
  periodId: number;
  periodLabel: string;
  fromDate: string;
}

export interface RunSummary {
  id: number;
  periodId: number;
  periodLabel: string | null;
  runType: string;
  status: string;
  label: string | null;
  currency: string;
  isSimulation: boolean;
  totalEmployees: number;
  processedEmployees: number;
  failedEmployees: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdBy: number | null;
  createdAt: string | null;
  errors?: RunErrorRow[];
}

export interface RunErrorRow {
  id: number;
  runId: number;
  employeeId: number | null;
  employeeName: string | null;
  severity: string;
  code: string | null;
  message: string;
  createdAt: string | null;
}

export interface AuditEntryInput {
  entityType: string;
  entityId?: number | null;
  employeeId?: number | null;
  periodId?: number | null;
  runId?: number | null;
  action: string;
  summary: string;
  fieldName?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  actorUserId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditFilters {
  entityType?: string;
  entityId?: number;
  employeeId?: number;
  periodId?: number;
  action?: string;
  actorUserId?: number;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId: number | null;
  employeeId: number | null;
  employeeName: string | null;
  periodId: number | null;
  runId: number | null;
  action: string;
  summary: string;
  fieldName: string | null;
  previousValue: string | null;
  newValue: string | null;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string | null;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Grouping dimensions cost analytics supports, mapped to safe SQL. */
const COST_DIMENSIONS: Record<string, string> = {
  department: "COALESCE(NULLIF(e.department, ''), 'Unassigned')",
  branch: "COALESCE(NULLIF(e.branch, ''), 'Unassigned')",
  grade: "COALESCE(NULLIF(e.pay_grade, ''), NULLIF(e.grade, ''), 'Unassigned')",
  workerType: "COALESCE(e.worker_type, 'UNKNOWN')",
};

/** mysql2 cannot bind LIMIT/OFFSET, so they are sanitised and inlined. */
function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 500);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

/**
 * Crude device/browser extraction from a user agent string.
 *
 * Deliberately not a UA-parsing library: this only has to answer "was that
 * change made from the office desktop or someone's phone" in an audit review.
 */
export function describeUserAgent(ua: string | null | undefined): { device: string | null; browser: string | null } {
  if (!ua) return { device: null, browser: null };

  let browser: string | null = null;
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/curl|wget|postman|node|axios|python/i.test(ua)) browser = 'API client';

  let device: string | null = null;
  if (/ipad|tablet/i.test(ua)) device = 'Tablet';
  else if (/iphone|android.*mobile|windows phone|mobile/i.test(ua)) device = 'Mobile';
  else if (/windows nt/i.test(ua)) device = 'Windows desktop';
  else if (/mac os x/i.test(ua)) device = 'Mac desktop';
  else if (/android/i.test(ua)) device = 'Android device';
  else if (/linux/i.test(ua)) device = 'Linux desktop';

  return { device, browser };
}

const LINE_TOTALS_SELECT = `
  COUNT(sl.id)                                   AS employees,
  COALESCE(SUM(sl.gross_amount), 0)              AS gross,
  COALESCE(SUM(sl.total_deductions), 0)          AS deductions,
  COALESCE(SUM(sl.net_amount), 0)                AS net,
  COALESCE(SUM(sl.employer_cost), 0)             AS employer_cost,
  COALESCE(SUM(sl.earn_bonus), 0)                AS bonus,
  COALESCE(SUM(sl.earn_incentive), 0)            AS incentive,
  COALESCE(SUM(sl.earn_ot), 0)                   AS overtime,
  COALESCE(SUM(sl.ot_hours), 0)                  AS ot_hours,
  COALESCE(SUM(sl.ded_income_tax), 0)            AS tax,
  COALESCE(SUM(sl.ded_pf), 0)                    AS pf,
  COALESCE(SUM(sl.ded_esi), 0)                   AS esi,
  COALESCE(SUM(sl.ded_pt), 0)                    AS pt,
  COALESCE(SUM(sl.employer_pf), 0)               AS employer_pf,
  COALESCE(SUM(sl.employer_esi), 0)              AS employer_esi
`;

export class PayrollAnalyticsRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Periods and runs
  // -------------------------------------------------------------------------

  async findLatestPeriod(): Promise<{ id: number; label: string; fromDate: string; toDate: string } | null> {
    const rows = await this.query<any[]>(
      `SELECT id, label, from_date, to_date FROM salary_periods
       WHERE deleted_at IS NULL ORDER BY from_date DESC, id DESC LIMIT 1`,
    );
    const r = rows[0];
    return r
      ? { id: Number(r.id), label: String(r.label), fromDate: toDateString(r.from_date), toDate: toDateString(r.to_date) }
      : null;
  }

  async findPeriod(periodId: number): Promise<{ id: number; label: string; fromDate: string; toDate: string } | null> {
    const rows = await this.query<any[]>(
      'SELECT id, label, from_date, to_date FROM salary_periods WHERE id = ? AND deleted_at IS NULL',
      [periodId],
    );
    const r = rows[0];
    return r
      ? { id: Number(r.id), label: String(r.label), fromDate: toDateString(r.from_date), toDate: toDateString(r.to_date) }
      : null;
  }

  async listRuns(filters: { periodId?: number; status?: string; runType?: string; limit?: number } = {}): Promise<RunSummary[]> {
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.periodId) { where.push('r.period_id = ?'); params.push(filters.periodId); }
    if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
    if (filters.runType) { where.push('r.run_type = ?'); params.push(filters.runType); }
    const capped = safeInt(filters.limit, 100, 1, 500);

    const rows = await this.query<any[]>(
      `SELECT r.*, p.label AS period_label
       FROM payroll_runs r
       LEFT JOIN salary_periods p ON p.id = r.period_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.id DESC LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => this.toRun(r));
  }

  async findRunById(id: number): Promise<RunSummary | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, p.label AS period_label
       FROM payroll_runs r
       LEFT JOIN salary_periods p ON p.id = r.period_id
       WHERE r.id = ? AND r.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.toRun(rows[0]) : null;
  }

  async listRunErrors(runId: number, limit = 500): Promise<RunErrorRow[]> {
    const capped = safeInt(limit, 500, 1, 5000);
    const rows = await this.query<any[]>(
      `SELECT er.*, e.full_name AS employee_name
       FROM payroll_run_errors er
       LEFT JOIN employees e ON e.id = er.employee_id
       WHERE er.run_id = ?
       ORDER BY er.severity ASC, er.id ASC LIMIT ${capped}`,
      [runId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      runId: Number(r.run_id),
      employeeId: r.employee_id === null || r.employee_id === undefined ? null : Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      severity: String(r.severity),
      code: r.code ?? null,
      message: String(r.message),
      createdAt: toIsoOrNull(r.created_at),
    }));
  }

  async setRunStatus(runId: number, status: string, userId: number): Promise<void> {
    await this.query(
      'UPDATE payroll_runs SET status = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [status, userId, runId],
    );
  }

  async countRunErrors(periodId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n
       FROM payroll_run_errors er
       JOIN payroll_runs r ON r.id = er.run_id AND r.deleted_at IS NULL
       WHERE r.period_id = ? AND er.severity = 'ERROR'`,
      [periodId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  // -------------------------------------------------------------------------
  // Dashboard aggregates
  // -------------------------------------------------------------------------

  async getPeriodTotals(periodId: number): Promise<PeriodTotals> {
    const rows = await this.query<any[]>(
      `SELECT p.id AS period_id, p.label AS period_label, ${LINE_TOTALS_SELECT}
       FROM salary_periods p
       LEFT JOIN salary_lines sl ON sl.period_id = p.id
       WHERE p.id = ? AND p.deleted_at IS NULL
       GROUP BY p.id, p.label`,
      [periodId],
    );
    const r = rows[0] ?? {};
    return {
      periodId: r.period_id === undefined ? null : Number(r.period_id),
      periodLabel: r.period_label ?? null,
      employeesProcessed: Number(r.employees ?? 0),
      totalGross: Number(r.gross ?? 0),
      totalDeductions: Number(r.deductions ?? 0),
      totalNet: Number(r.net ?? 0),
      totalEmployerCost: Number(r.employer_cost ?? 0),
      totalBonus: Number(r.bonus ?? 0),
      totalIncentive: Number(r.incentive ?? 0),
      totalOvertime: Number(r.overtime ?? 0),
      overtimeHours: Number(r.ot_hours ?? 0),
      totalTax: Number(r.tax ?? 0),
      totalPf: Number(r.pf ?? 0),
      totalEsi: Number(r.esi ?? 0),
      totalPt: Number(r.pt ?? 0),
      employerPf: Number(r.employer_pf ?? 0),
      employerEsi: Number(r.employer_esi ?? 0),
    };
  }

  /** Bank transfer progress for a period, straight off the salary ledger. */
  async getPaymentStatusCounts(periodId: number): Promise<Record<string, number>> {
    const rows = await this.query<any[]>(
      `SELECT payment_status, COUNT(*) AS n, COALESCE(SUM(net_amount), 0) AS amount
       FROM salary_lines WHERE period_id = ? GROUP BY payment_status`,
      [periodId],
    );
    const out: Record<string, number> = { UNPAID: 0, QUEUED: 0, PAID: 0, FAILED: 0, ON_HOLD: 0 };
    for (const r of rows) out[String(r.payment_status)] = Number(r.n ?? 0);
    return out;
  }

  // -------------------------------------------------------------------------
  // Cost analytics
  // -------------------------------------------------------------------------

  /** Cost split by one of the whitelisted dimensions over a date range. */
  async costByDimension(dimension: keyof typeof COST_DIMENSIONS, range: DateRange): Promise<BucketAmount[]> {
    const expr = COST_DIMENSIONS[dimension];
    if (!expr) throw new Error(`Unsupported cost dimension '${String(dimension)}'`);

    const rows = await this.query<any[]>(
      `SELECT ${expr} AS bucket,
              COUNT(DISTINCT sl.employee_id)        AS employees,
              COALESCE(SUM(sl.gross_amount), 0)     AS gross,
              COALESCE(SUM(sl.total_deductions), 0) AS deductions,
              COALESCE(SUM(sl.net_amount), 0)       AS net,
              COALESCE(SUM(sl.employer_cost), 0)    AS employer_cost
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       JOIN employees e ON e.id = sl.employee_id
       WHERE p.from_date <= ? AND p.to_date >= ?
       GROUP BY bucket
       ORDER BY gross DESC`,
      [range.to, range.from],
    );
    return rows.map((r) => this.toBucket(r));
  }

  /** Gross/net/deduction/employer-cost trend over the most recent N periods. */
  async periodTrend(limit = 12, employeeId?: number): Promise<TrendPoint[]> {
    const capped = safeInt(limit, 12, 1, 60);
    // The employee filter belongs on the JOIN, not the WHERE: on the WHERE it
    // would turn the outer join into an inner one and drop empty periods.
    const joinFilter = employeeId ? 'AND sl.employee_id = ?' : '';
    const params: any[] = employeeId ? [employeeId] : [];

    const rows = await this.query<any[]>(
      `SELECT p.id AS period_id, p.label AS period_label, p.from_date,
              COUNT(sl.id)                          AS employees,
              COALESCE(SUM(sl.gross_amount), 0)     AS gross,
              COALESCE(SUM(sl.total_deductions), 0) AS deductions,
              COALESCE(SUM(sl.net_amount), 0)       AS net,
              COALESCE(SUM(sl.employer_cost), 0)    AS employer_cost
       FROM salary_periods p
       LEFT JOIN salary_lines sl ON sl.period_id = p.id ${joinFilter}
       WHERE p.deleted_at IS NULL
       GROUP BY p.id, p.label, p.from_date
       ORDER BY p.from_date DESC, p.id DESC
       LIMIT ${capped}`,
      params,
    );

    return rows
      .map((r) => ({
        ...this.toBucket(r),
        bucket: String(r.period_label ?? ''),
        periodId: Number(r.period_id),
        periodLabel: String(r.period_label ?? ''),
        fromDate: toDateString(r.from_date),
      }))
      .reverse();
  }

  /**
   * Average increase percentage by grade and by revision type, taken from the
   * compensation revision history rather than recomputed from salaries.
   */
  async incrementAnalysis(): Promise<{
    byGrade: { bucket: string; revisions: number; avgPct: number; avgAmount: number }[];
    byType: { bucket: string; revisions: number; avgPct: number; avgAmount: number }[];
    overall: { revisions: number; avgPct: number };
  }> {
    const [byGrade, byType, overall] = await Promise.all([
      this.query<any[]>(
        `SELECT ${COST_DIMENSIONS.grade} AS bucket,
                COUNT(*) AS revisions,
                COALESCE(AVG(es.change_pct), 0) AS avg_pct,
                COALESCE(AVG(es.annual_ctc - COALESCE(es.previous_ctc, 0)), 0) AS avg_amount
         FROM employee_salary es
         JOIN employees e ON e.id = es.employee_id
         WHERE es.deleted_at IS NULL AND es.revision_type <> 'INITIAL' AND es.change_pct IS NOT NULL
         GROUP BY bucket ORDER BY avg_pct DESC`,
      ),
      this.query<any[]>(
        `SELECT es.revision_type AS bucket,
                COUNT(*) AS revisions,
                COALESCE(AVG(es.change_pct), 0) AS avg_pct,
                COALESCE(AVG(es.annual_ctc - COALESCE(es.previous_ctc, 0)), 0) AS avg_amount
         FROM employee_salary es
         WHERE es.deleted_at IS NULL AND es.revision_type <> 'INITIAL' AND es.change_pct IS NOT NULL
         GROUP BY es.revision_type ORDER BY avg_pct DESC`,
      ),
      this.query<any[]>(
        `SELECT COUNT(*) AS revisions, COALESCE(AVG(change_pct), 0) AS avg_pct
         FROM employee_salary
         WHERE deleted_at IS NULL AND revision_type <> 'INITIAL' AND change_pct IS NOT NULL`,
      ),
    ]);

    const map = (rows: any[]) => rows.map((r) => ({
      bucket: String(r.bucket ?? 'Unassigned'),
      revisions: Number(r.revisions ?? 0),
      avgPct: Number(r.avg_pct ?? 0),
      avgAmount: Number(r.avg_amount ?? 0),
    }));

    return {
      byGrade: map(byGrade),
      byType: map(byType),
      overall: {
        revisions: Number(overall[0]?.revisions ?? 0),
        avgPct: Number(overall[0]?.avg_pct ?? 0),
      },
    };
  }

  async listSalaryRevisions(employeeId: number, limit = 100): Promise<any[]> {
    const capped = safeInt(limit, 100, 1, 500);
    const rows = await this.query<any[]>(
      `SELECT es.id, es.effective_from, es.effective_to, es.annual_ctc, es.monthly_gross,
              es.previous_ctc, es.change_pct, es.revision_type, es.revision_reason,
              es.status, es.currency, s.name AS structure_name
       FROM employee_salary es
       LEFT JOIN salary_structures s ON s.id = es.structure_id
       WHERE es.employee_id = ? AND es.deleted_at IS NULL
       ORDER BY es.effective_from DESC, es.id DESC LIMIT ${capped}`,
      [employeeId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      annualCtc: r.annual_ctc === null ? null : Number(r.annual_ctc),
      monthlyGross: r.monthly_gross === null ? null : Number(r.monthly_gross),
      previousCtc: r.previous_ctc === null ? null : Number(r.previous_ctc),
      changePct: r.change_pct === null ? null : Number(r.change_pct),
      revisionType: String(r.revision_type),
      revisionReason: r.revision_reason ?? null,
      status: String(r.status),
      currency: String(r.currency ?? 'INR'),
      structureName: r.structure_name ?? null,
    }));
  }

  async overtimeAnalysis(range: DateRange): Promise<{
    totals: { hours: number; amount: number; employees: number };
    byDepartment: { bucket: string; hours: number; amount: number; employees: number }[];
    byPeriod: { periodId: number; periodLabel: string; hours: number; amount: number }[];
  }> {
    const [totals, byDepartment, byPeriod] = await Promise.all([
      this.query<any[]>(
        `SELECT COALESCE(SUM(sl.ot_hours), 0) AS hours,
                COALESCE(SUM(sl.earn_ot), 0)  AS amount,
                COUNT(DISTINCT CASE WHEN sl.ot_hours > 0 THEN sl.employee_id END) AS employees
         FROM salary_lines sl
         JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
         WHERE p.from_date <= ? AND p.to_date >= ?`,
        [range.to, range.from],
      ),
      this.query<any[]>(
        `SELECT ${COST_DIMENSIONS.department} AS bucket,
                COALESCE(SUM(sl.ot_hours), 0) AS hours,
                COALESCE(SUM(sl.earn_ot), 0)  AS amount,
                COUNT(DISTINCT CASE WHEN sl.ot_hours > 0 THEN sl.employee_id END) AS employees
         FROM salary_lines sl
         JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
         JOIN employees e ON e.id = sl.employee_id
         WHERE p.from_date <= ? AND p.to_date >= ?
         GROUP BY bucket ORDER BY amount DESC`,
        [range.to, range.from],
      ),
      this.query<any[]>(
        `SELECT p.id AS period_id, p.label AS period_label,
                COALESCE(SUM(sl.ot_hours), 0) AS hours,
                COALESCE(SUM(sl.earn_ot), 0)  AS amount
         FROM salary_periods p
         LEFT JOIN salary_lines sl ON sl.period_id = p.id
         WHERE p.deleted_at IS NULL AND p.from_date <= ? AND p.to_date >= ?
         GROUP BY p.id, p.label ORDER BY p.from_date ASC`,
        [range.to, range.from],
      ),
    ]);

    return {
      totals: {
        hours: Number(totals[0]?.hours ?? 0),
        amount: Number(totals[0]?.amount ?? 0),
        employees: Number(totals[0]?.employees ?? 0),
      },
      byDepartment: byDepartment.map((r) => ({
        bucket: String(r.bucket ?? 'Unassigned'),
        hours: Number(r.hours ?? 0),
        amount: Number(r.amount ?? 0),
        employees: Number(r.employees ?? 0),
      })),
      byPeriod: byPeriod.map((r) => ({
        periodId: Number(r.period_id),
        periodLabel: String(r.period_label ?? ''),
        hours: Number(r.hours ?? 0),
        amount: Number(r.amount ?? 0),
      })),
    };
  }

  async bonusAnalysis(range: DateRange): Promise<{
    paidThroughPayroll: { bonus: number; incentive: number; variable: number; employees: number };
    byAwardClass: { bucket: string; awards: number; amount: number; status: string }[];
    byDepartment: { bucket: string; amount: number; employees: number }[];
  }> {
    const [paid, byAwardClass, byDepartment] = await Promise.all([
      this.query<any[]>(
        `SELECT COALESCE(SUM(sl.earn_bonus), 0)     AS bonus,
                COALESCE(SUM(sl.earn_incentive), 0) AS incentive,
                COALESCE(SUM(sl.earn_variable), 0)  AS variable_pay,
                COUNT(DISTINCT CASE WHEN sl.earn_bonus + sl.earn_incentive + sl.earn_variable > 0
                                    THEN sl.employee_id END) AS employees
         FROM salary_lines sl
         JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
         WHERE p.from_date <= ? AND p.to_date >= ?`,
        [range.to, range.from],
      ),
      this.query<any[]>(
        `SELECT a.award_class AS bucket, a.status, COUNT(*) AS awards, COALESCE(SUM(a.amount), 0) AS amount
         FROM pay_awards a
         WHERE a.deleted_at IS NULL AND a.effective_date BETWEEN ? AND ?
         GROUP BY a.award_class, a.status ORDER BY amount DESC`,
        [range.from, range.to],
      ),
      this.query<any[]>(
        `SELECT ${COST_DIMENSIONS.department} AS bucket,
                COALESCE(SUM(sl.earn_bonus + sl.earn_incentive + sl.earn_variable), 0) AS amount,
                COUNT(DISTINCT CASE WHEN sl.earn_bonus + sl.earn_incentive + sl.earn_variable > 0
                                    THEN sl.employee_id END) AS employees
         FROM salary_lines sl
         JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
         JOIN employees e ON e.id = sl.employee_id
         WHERE p.from_date <= ? AND p.to_date >= ?
         GROUP BY bucket ORDER BY amount DESC`,
        [range.to, range.from],
      ),
    ]);

    return {
      paidThroughPayroll: {
        bonus: Number(paid[0]?.bonus ?? 0),
        incentive: Number(paid[0]?.incentive ?? 0),
        variable: Number(paid[0]?.variable_pay ?? 0),
        employees: Number(paid[0]?.employees ?? 0),
      },
      byAwardClass: byAwardClass.map((r) => ({
        bucket: String(r.bucket ?? ''),
        status: String(r.status ?? ''),
        awards: Number(r.awards ?? 0),
        amount: Number(r.amount ?? 0),
      })),
      byDepartment: byDepartment.map((r) => ({
        bucket: String(r.bucket ?? 'Unassigned'),
        amount: Number(r.amount ?? 0),
        employees: Number(r.employees ?? 0),
      })),
    };
  }

  /** Headcount per period, used to derive the growth rate in the forecast. */
  async headcountTrend(limit = 12): Promise<{ periodId: number; periodLabel: string; headcount: number }[]> {
    const capped = safeInt(limit, 12, 1, 60);
    const rows = await this.query<any[]>(
      `SELECT p.id AS period_id, p.label AS period_label, COUNT(sl.id) AS headcount
       FROM salary_periods p
       LEFT JOIN salary_lines sl ON sl.period_id = p.id
       WHERE p.deleted_at IS NULL
       GROUP BY p.id, p.label
       ORDER BY p.from_date DESC, p.id DESC LIMIT ${capped}`,
    );
    return rows
      .map((r) => ({
        periodId: Number(r.period_id),
        periodLabel: String(r.period_label ?? ''),
        headcount: Number(r.headcount ?? 0),
      }))
      .reverse();
  }

  /**
   * The data gaps that actually block a statutory filing: no UAN blocks the PF
   * ECR, no ESIC blocks the ESI return, no PAN corrupts the TDS return, and no
   * bank details means the money cannot move at all.
   */
  async missingStatutoryData(periodId: number): Promise<{
    missingUan: number;
    missingEsic: number;
    missingPan: number;
    missingBank: number;
    totalEmployees: number;
  }> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(sl.ded_pf > 0 AND (e.uan_number IS NULL OR e.uan_number = '')), 0)   AS missing_uan,
              COALESCE(SUM(sl.ded_esi > 0 AND (e.esic_number IS NULL OR e.esic_number = '')), 0) AS missing_esic,
              COALESCE(SUM(sl.ded_income_tax > 0 AND (e.pan IS NULL OR e.pan = '')), 0)          AS missing_pan,
              COALESCE(SUM(sl.net_amount > 0 AND (e.bank_account IS NULL OR e.bank_account = ''
                        OR e.bank_ifsc IS NULL OR e.bank_ifsc = '')), 0)                        AS missing_bank
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.period_id = ? AND e.deleted_at IS NULL`,
      [periodId],
    );
    const r = rows[0] ?? {};
    return {
      totalEmployees: Number(r.total ?? 0),
      missingUan: Number(r.missing_uan ?? 0),
      missingEsic: Number(r.missing_esic ?? 0),
      missingPan: Number(r.missing_pan ?? 0),
      missingBank: Number(r.missing_bank ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // Report row sources
  // -------------------------------------------------------------------------

  async reportPayrollRegister(periodId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, e.department, e.branch, e.pay_grade, e.worker_type,
              sl.paid_days, sl.lop_days, sl.present_days, sl.gross_amount, sl.total_deductions,
              sl.net_amount, sl.employer_cost, sl.payment_status, sl.payment_reference
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.period_id = ?
       ORDER BY e.emp_code ASC`,
      [periodId],
    );
  }

  async reportSalaryRegister(periodId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, sl.earn_fixed, sl.earn_piece, sl.earn_ot, sl.earn_bonus,
              sl.earn_incentive, sl.earn_variable, sl.earn_arrears, sl.earn_reimbursement,
              sl.gross_amount, sl.ded_pf, sl.ded_esi, sl.ded_pt, sl.ded_income_tax,
              sl.ded_loan, sl.ded_advance, sl.ded_lwf, sl.ded_insurance, sl.ded_other,
              sl.total_deductions, sl.net_amount
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.period_id = ?
       ORDER BY e.emp_code ASC`,
      [periodId],
    );
  }

  async reportPf(periodId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, e.uan_number, sl.gross_amount,
              sl.ded_pf, sl.employer_pf, (sl.ded_pf + sl.employer_pf) AS total_pf
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.period_id = ? AND (sl.ded_pf > 0 OR sl.employer_pf > 0)
       ORDER BY e.emp_code ASC`,
      [periodId],
    );
  }

  async reportEsi(periodId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, e.esic_number, sl.gross_amount,
              sl.ded_esi, sl.employer_esi, (sl.ded_esi + sl.employer_esi) AS total_esi
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.period_id = ? AND (sl.ded_esi > 0 OR sl.employer_esi > 0)
       ORDER BY e.emp_code ASC`,
      [periodId],
    );
  }

  async reportPt(periodId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, e.state, e.branch, sl.gross_amount, sl.ded_pt
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.period_id = ? AND sl.ded_pt > 0
       ORDER BY e.emp_code ASC`,
      [periodId],
    );
  }

  async reportTax(periodId: number, financialYear: string): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, e.pan, sl.gross_amount, sl.taxable_income, sl.ded_income_tax,
              tc.gross_annual, tc.taxable_income AS annual_taxable, tc.total_tax AS annual_tax,
              tc.tax_paid_to_date, tc.monthly_tds, r.code AS regime
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       LEFT JOIN tax_computations tc ON tc.employee_id = e.id AND tc.financial_year = ?
       LEFT JOIN tax_regimes r ON r.id = tc.regime_id
       WHERE sl.period_id = ?
       ORDER BY e.emp_code ASC`,
      [financialYear, periodId],
    );
  }

  async reportPayslipSummary(periodId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT sl.id AS line_id, e.emp_code, e.full_name, p.label AS period_label,
              sl.gross_amount, sl.total_deductions, sl.net_amount, sl.payment_status,
              (SELECT COUNT(*) FROM salary_line_components c WHERE c.salary_line_id = sl.id) AS component_count
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       JOIN salary_periods p ON p.id = sl.period_id
       WHERE sl.period_id = ?
       ORDER BY e.emp_code ASC`,
      [periodId],
    );
  }

  async reportAwards(range: DateRange, awardClass: string): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, a.award_type, a.title, a.amount, a.currency,
              a.target_value, a.achieved_value, a.achievement_pct, a.effective_date, a.status
       FROM pay_awards a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.deleted_at IS NULL AND a.award_class = ? AND a.effective_date BETWEEN ? AND ?
       ORDER BY a.effective_date DESC, e.emp_code ASC`,
      [awardClass, range.from, range.to],
    );
  }

  async reportOvertime(periodId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, e.department, sl.ot_hours, sl.earn_ot, sl.present_days
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.period_id = ? AND sl.ot_hours > 0
       ORDER BY sl.ot_hours DESC`,
      [periodId],
    );
  }

  async reportFinalSettlement(range: DateRange): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, f.settlement_type, f.last_working_date,
              f.pending_salary, f.leave_encashment_amount, f.gratuity_amount, f.bonus_payable,
              f.other_earnings, f.notice_recovery, f.loan_recovery, f.advance_recovery,
              f.tax_deduction, f.gross_payable, f.total_recovery, f.net_settlement, f.status
       FROM final_settlements f
       JOIN employees e ON e.id = f.employee_id
       WHERE f.deleted_at IS NULL AND f.last_working_date BETWEEN ? AND ?
       ORDER BY f.last_working_date DESC`,
      [range.from, range.to],
    );
  }

  // -------------------------------------------------------------------------
  // Employee self-service reads
  // -------------------------------------------------------------------------

  async listLinesForEmployee(employeeId: number, limit = 24): Promise<any[]> {
    const capped = safeInt(limit, 24, 1, 200);
    const rows = await this.query<any[]>(
      `SELECT sl.id, sl.period_id, p.label AS period_label, p.from_date, p.to_date, p.pay_date,
              sl.gross_amount, sl.total_deductions, sl.net_amount, sl.payment_status,
              sl.payment_reference, sl.paid_days, sl.lop_days
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       WHERE sl.employee_id = ?
       ORDER BY p.from_date DESC, sl.id DESC LIMIT ${capped}`,
      [employeeId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      periodId: Number(r.period_id),
      periodLabel: String(r.period_label ?? ''),
      fromDate: toDateString(r.from_date),
      toDate: toDateString(r.to_date),
      payDate: r.pay_date ? toDateString(r.pay_date) : null,
      grossAmount: Number(r.gross_amount ?? 0),
      totalDeductions: Number(r.total_deductions ?? 0),
      netAmount: Number(r.net_amount ?? 0),
      paymentStatus: String(r.payment_status ?? 'UNPAID'),
      paymentReference: r.payment_reference ?? null,
      paidDays: Number(r.paid_days ?? 0),
      lopDays: Number(r.lop_days ?? 0),
    }));
  }

  /** Ownership check for every self-service payslip route. */
  async findLineOwner(lineId: number): Promise<number | null> {
    const rows = await this.query<any[]>('SELECT employee_id FROM salary_lines WHERE id = ?', [lineId]);
    return rows[0] ? Number(rows[0].employee_id) : null;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  /**
   * Append-only. Never throws: losing an audit row must not roll back the
   * payroll action that produced it, but the gap is logged so it is visible.
   */
  async logAudit(entry: AuditEntryInput): Promise<void> {
    const { device, browser } = describeUserAgent(entry.userAgent);
    try {
      await this.query(
        `INSERT INTO payroll_audit_logs
           (entity_type, entity_id, employee_id, period_id, run_id, action, summary,
            field_name, previous_value, new_value, actor_user_id, actor_name, actor_role,
            ip_address, user_agent, device, browser)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.entityType,
          entry.entityId ?? null,
          entry.employeeId ?? null,
          entry.periodId ?? null,
          entry.runId ?? null,
          entry.action,
          String(entry.summary).slice(0, 500),
          entry.fieldName ?? null,
          stringify(entry.previousValue),
          stringify(entry.newValue),
          entry.actorUserId ?? null,
          entry.actorName ?? null,
          entry.actorRole ?? null,
          entry.ipAddress ?? null,
          entry.userAgent ? String(entry.userAgent).slice(0, 400) : null,
          device,
          browser,
        ],
      );
    } catch (err: any) {
      console.error('[payroll-audit] failed to write audit row:', err?.message ?? err);
    }
  }

  async listAudit(filters: AuditFilters): Promise<Paged<AuditEntry>> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.entityType) { where.push('l.entity_type = ?'); params.push(filters.entityType); }
    if (filters.entityId) { where.push('l.entity_id = ?'); params.push(filters.entityId); }
    if (filters.employeeId) { where.push('l.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.periodId) { where.push('l.period_id = ?'); params.push(filters.periodId); }
    if (filters.action) { where.push('l.action = ?'); params.push(filters.action); }
    if (filters.actorUserId) { where.push('l.actor_user_id = ?'); params.push(filters.actorUserId); }
    if (filters.from) { where.push('DATE(l.created_at) >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('DATE(l.created_at) <= ?'); params.push(filters.to); }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 500);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(`SELECT COUNT(*) AS n FROM payroll_audit_logs l WHERE ${clause}`, params),
      this.query<any[]>(
        `SELECT l.*, e.full_name AS employee_name
         FROM payroll_audit_logs l
         LEFT JOIN employees e ON e.id = l.employee_id
         WHERE ${clause}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        entityType: String(r.entity_type),
        entityId: r.entity_id === null || r.entity_id === undefined ? null : Number(r.entity_id),
        employeeId: r.employee_id === null || r.employee_id === undefined ? null : Number(r.employee_id),
        employeeName: r.employee_name ?? null,
        periodId: r.period_id === null || r.period_id === undefined ? null : Number(r.period_id),
        runId: r.run_id === null || r.run_id === undefined ? null : Number(r.run_id),
        action: String(r.action),
        summary: String(r.summary),
        fieldName: r.field_name ?? null,
        previousValue: r.previous_value ?? null,
        newValue: r.new_value ?? null,
        actorUserId: r.actor_user_id === null || r.actor_user_id === undefined ? null : Number(r.actor_user_id),
        actorName: r.actor_name ?? null,
        actorRole: r.actor_role ?? null,
        ipAddress: r.ip_address ?? null,
        device: r.device ?? null,
        browser: r.browser ?? null,
        createdAt: toIsoOrNull(r.created_at),
      })),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private toBucket(r: any): BucketAmount {
    return {
      bucket: String(r.bucket ?? 'Unassigned'),
      employees: Number(r.employees ?? 0),
      gross: Number(r.gross ?? 0),
      deductions: Number(r.deductions ?? 0),
      net: Number(r.net ?? 0),
      employerCost: Number(r.employer_cost ?? 0),
    };
  }

  private toRun(r: any): RunSummary {
    return {
      id: Number(r.id),
      periodId: Number(r.period_id),
      periodLabel: r.period_label ?? null,
      runType: String(r.run_type),
      status: String(r.status),
      label: r.label ?? null,
      currency: String(r.currency ?? 'INR'),
      isSimulation: !!r.is_simulation,
      totalEmployees: Number(r.total_employees ?? 0),
      processedEmployees: Number(r.processed_employees ?? 0),
      failedEmployees: Number(r.failed_employees ?? 0),
      totalGross: Number(r.total_gross ?? 0),
      totalDeductions: Number(r.total_deductions ?? 0),
      totalNet: Number(r.total_net ?? 0),
      totalEmployerCost: Number(r.total_employer_cost ?? 0),
      startedAt: toIsoOrNull(r.started_at),
      finishedAt: toIsoOrNull(r.finished_at),
      durationMs: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
      errorMessage: r.error_message ?? null,
      createdBy: r.created_by === null || r.created_by === undefined ? null : Number(r.created_by),
      createdAt: toIsoOrNull(r.created_at),
    };
  }
}
