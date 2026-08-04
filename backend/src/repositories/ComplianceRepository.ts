import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

// ---------------------------------------------------------------------------
// Types
//
// Deliberately local to this module. The statutory side of the compliance
// module is owned elsewhere; keeping these here means the calendar, checklist
// engine, audit and analytics compile independently of it.
// ---------------------------------------------------------------------------

export type ObligationCategory =
  | 'PF' | 'ESI' | 'PT' | 'LWF' | 'TDS' | 'LABOUR_LAW' | 'GRATUITY' | 'BONUS' | 'OTHER';

export type ComplianceCategory = ObligationCategory | 'MINIMUM_WAGE';

export type ObligationType = 'PAYMENT' | 'RETURN' | 'REGISTER' | 'RENEWAL' | 'DISCLOSURE';

export type ObligationFrequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL' | 'ONE_TIME';

export type CalendarStatus =
  | 'UPCOMING' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' | 'NOT_APPLICABLE' | 'WAIVED';

export type AuditType = 'INTERNAL' | 'EXTERNAL' | 'STATUTORY' | 'INSPECTION';
export type AuditStatus = 'PLANNED' | 'IN_PROGRESS' | 'FINDINGS_ISSUED' | 'CLOSED' | 'CANCELLED';
export type AuditRating = 'COMPLIANT' | 'MINOR_ISSUES' | 'MAJOR_ISSUES' | 'NON_COMPLIANT';

export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FindingStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ACCEPTED_RISK' | 'CLOSED';

export type ActionType = 'CORRECTIVE' | 'PREVENTIVE';
export type ActionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type CheckResultValue = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_APPLICABLE' | 'MANUAL_REVIEW';

export type MinimumWageSkill = 'UNSKILLED' | 'SEMI_SKILLED' | 'SKILLED' | 'HIGHLY_SKILLED';

export interface ObligationResponse {
  id: number;
  code: string;
  name: string;
  category: ObligationCategory;
  obligationType: ObligationType;
  frequency: ObligationFrequency;
  country: string;
  stateCode: string | null;
  authority: string | null;
  dueDay: number | null;
  dueMonthOffset: number;
  reminderDaysBefore: number;
  penaltyNote: string | null;
  referenceUrl: string | null;
  isActive: boolean;
}

export interface CalendarEntryResponse {
  id: number;
  obligationId: number;
  obligationCode: string;
  obligationName: string;
  category: ObligationCategory;
  obligationType: ObligationType;
  frequency: ObligationFrequency;
  authority: string | null;
  financialYear: string;
  periodLabel: string;
  monthKey: string | null;
  quarter: number | null;
  stateCode: string | null;
  dueDate: string;
  originalDueDate: string | null;
  extensionReason: string | null;
  status: CalendarStatus;
  filingId: number | null;
  challanId: number | null;
  completedOn: string | null;
  completedBy: number | null;
  ownerUserId: number | null;
  ownerName: string | null;
  reminderSentAt: string | null;
  reminderDaysBefore: number;
  remarks: string | null;
  daysToDue: number;
}

export interface AuditResponse {
  id: number;
  title: string;
  auditType: AuditType;
  scope: string | null;
  financialYear: string | null;
  auditorName: string | null;
  authority: string | null;
  plannedOn: string | null;
  startedOn: string | null;
  completedOn: string | null;
  status: AuditStatus;
  overallRating: AuditRating | null;
  summary: string | null;
  documentId: number | null;
  findingCount: number;
  openFindingCount: number;
  createdBy: number | null;
  createdAt: string | null;
}

export interface FindingResponse {
  id: number;
  auditId: number | null;
  auditTitle: string | null;
  findingNo: string | null;
  category: ComplianceCategory;
  severity: FindingSeverity;
  title: string;
  description: string | null;
  affectedCount: number;
  financialImpact: number | null;
  ruleCode: string | null;
  isAutomated: boolean;
  status: FindingStatus;
  identifiedOn: string;
  dueDate: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  actionCount: number;
  openActionCount: number;
  createdAt: string | null;
}

export interface ActionResponse {
  id: number;
  findingId: number;
  actionText: string;
  actionType: ActionType;
  ownerUserId: number | null;
  ownerName: string | null;
  dueDate: string | null;
  status: ActionStatus;
  completedOn: string | null;
  evidenceDocumentId: number | null;
  remarks: string | null;
  createdAt: string | null;
}

export interface ChecklistItemResponse {
  id: number;
  code: string;
  category: ComplianceCategory;
  title: string;
  description: string | null;
  severity: FindingSeverity;
  ruleCode: string | null;
  isAutomated: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface CheckResultResponse {
  id: number;
  checklistItemId: number;
  code: string;
  title: string;
  category: ComplianceCategory;
  severity: FindingSeverity;
  ruleCode: string | null;
  auditId: number | null;
  periodId: number | null;
  financialYear: string | null;
  result: CheckResultValue;
  affectedCount: number;
  detail: string | null;
  evidence: unknown[];
  findingId: number | null;
  checkedAt: string | null;
  checkedBy: number | null;
}

/** One offending row picked up by a rule, kept small enough to store as evidence. */
export interface RuleSample {
  employeeId?: number;
  empCode?: string;
  /** Set instead of `employeeId` when the offending row is not an employee. */
  recordId?: number;
  reference?: string;
  name?: string;
  detail?: string;
}

/** Whether a rule's offending rows are employees or some other record. */
type RuleEntity = 'EMPLOYEE' | 'RECORD';

export interface RuleEvaluation {
  affectedCount: number;
  sample: RuleSample[];
  /** Anything the rule had to assume, surfaced verbatim in the result detail. */
  notes: string[];
}

export interface RuleContext {
  financialYear: string;
  fyFrom: string;
  fyTo: string;
  periodId?: number | null;
  today: string;
}

/**
 * Grade to minimum-wage skill level.
 *
 * `employees.grade` is a piece-rate quality grade, not a statutory skill
 * classification, so this is a mapping decision rather than a fact. It is
 * deliberately conservative: an unrecognised grade falls back to UNSKILLED,
 * the lowest notified floor, so a grade nobody has mapped yet can never
 * manufacture a minimum-wage finding. The mapping is echoed into the check
 * result so a reviewer sees exactly what was assumed.
 */
export const GRADE_SKILL_MAP: Record<string, MinimumWageSkill> = {
  'A*': 'HIGHLY_SKILLED',
  'A+++': 'HIGHLY_SKILLED',
  'A++': 'SKILLED',
  'A+': 'SKILLED',
  A: 'SEMI_SKILLED',
  B: 'UNSKILLED',
  C: 'UNSKILLED',
};

export const DEFAULT_SKILL_LEVEL: MinimumWageSkill = 'UNSKILLED';

/** Weighting used by the compliance score. CRITICAL costs exactly 4x MEDIUM. */
export const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 4,
  CRITICAL: 8,
};

const MAX_EVIDENCE_ROWS = 50;

/**
 * Marks an `extension_reason` the generator wrote itself. A reason without this
 * prefix was typed by a person and is never overwritten by regeneration.
 */
export const AUTO_ADJUSTMENT_PREFIX = 'Auto: ';

function boolOf(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return toDateString(value);
}

function isoOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function limitOf(value: unknown, fallback = 200, max = 2000): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function idList(ids: number[]): string {
  const clean = ids
    .map((id) => Math.floor(Number(id)))
    .filter((id) => Number.isFinite(id) && id > 0);
  return clean.length ? clean.join(',') : '';
}

export interface CalendarUpsertInput {
  obligationId: number;
  financialYear: string;
  periodLabel: string;
  monthKey: string | null;
  quarter: number | null;
  stateCode: string | null;
  dueDate: string;
  originalDueDate: string | null;
  extensionReason: string | null;
}

export interface CalendarFilters {
  financialYear?: string;
  month?: string;
  status?: string;
  category?: string;
  obligationId?: number;
  ownerUserId?: number;
  limit?: number;
}

/**
 * Compliance obligations, the generated calendar, audits, findings, corrective
 * actions and the automated checklist engine's inputs and outputs.
 *
 * Every automated rule is a single set-based statement: the checker must stay
 * usable when the employee table has six figures in it, so nothing here issues
 * a query per employee. `evaluateRule` runs the offending-set query twice --
 * once wrapped in a COUNT, once with a LIMIT for evidence -- so the result table
 * never stores more than a sample no matter how large the breach is.
 */
export class ComplianceRepository extends BaseRepository {
  // =========================================================================
  // Obligations
  // =========================================================================

  async listObligations(filters: {
    category?: string;
    frequency?: string;
    isActive?: boolean;
    limit?: number;
  } = {}): Promise<ObligationResponse[]> {
    let sql = 'SELECT * FROM compliance_obligations WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.frequency) {
      sql += ' AND frequency = ?';
      params.push(filters.frequency);
    }
    if (filters.isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(filters.isActive);
    }
    sql += ` ORDER BY category ASC, code ASC LIMIT ${limitOf(filters.limit, 500)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toObligation(r));
  }

  async findObligationById(id: number): Promise<ObligationResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM compliance_obligations WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toObligation(rows[0]) : null;
  }

  async findObligationByCode(code: string): Promise<ObligationResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM compliance_obligations WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] ? this.toObligation(rows[0]) : null;
  }

  async createObligation(data: Record<string, any>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO compliance_obligations
        (code, name, category, obligation_type, frequency, country, state_code, authority,
         due_day, due_month_offset, reminder_days_before, penalty_note, reference_url, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code,
        data.name,
        data.category,
        data.obligationType ?? 'RETURN',
        data.frequency ?? 'MONTHLY',
        data.country ?? 'IN',
        data.stateCode ?? null,
        data.authority ?? null,
        data.dueDay ?? null,
        data.dueMonthOffset ?? 1,
        data.reminderDaysBefore ?? 7,
        data.penaltyNote ?? null,
        data.referenceUrl ?? null,
        data.isActive === undefined ? true : !!data.isActive,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateObligation(id: number, data: Record<string, any>): Promise<void> {
    const columns: Record<string, string> = {
      code: 'code',
      name: 'name',
      category: 'category',
      obligationType: 'obligation_type',
      frequency: 'frequency',
      country: 'country',
      stateCode: 'state_code',
      authority: 'authority',
      dueDay: 'due_day',
      dueMonthOffset: 'due_month_offset',
      reminderDaysBefore: 'reminder_days_before',
      penaltyNote: 'penalty_note',
      referenceUrl: 'reference_url',
      isActive: 'is_active',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (data[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(data[key]);
      }
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(
      `UPDATE compliance_obligations SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteObligation(id: number): Promise<void> {
    await this.query(
      'UPDATE compliance_obligations SET deleted_at = NOW(), is_active = false WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  async countCalendarEntriesForObligation(id: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS c FROM compliance_calendar WHERE obligation_id = ?',
      [id],
    );
    return Number(rows[0]?.c ?? 0);
  }

  // =========================================================================
  // Calendar
  // =========================================================================

  /** Existing entries for a year, keyed for idempotent regeneration. */
  async findCalendarEntriesForYear(financialYear: string): Promise<
    { id: number; obligationId: number; periodLabel: string; stateCode: string | null; status: CalendarStatus }[]
  > {
    const rows = await this.query<any[]>(
      `SELECT id, obligation_id, period_label, state_code, status
       FROM compliance_calendar WHERE financial_year = ?`,
      [financialYear],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      obligationId: Number(r.obligation_id),
      periodLabel: String(r.period_label),
      stateCode: r.state_code ?? null,
      status: String(r.status) as CalendarStatus,
    }));
  }

  async insertCalendarEntry(entry: CalendarUpsertInput): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO compliance_calendar
        (obligation_id, financial_year, period_label, month_key, quarter, state_code,
         due_date, original_due_date, extension_reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPCOMING')`,
      [
        entry.obligationId,
        entry.financialYear,
        entry.periodLabel,
        entry.monthKey,
        entry.quarter,
        entry.stateCode,
        entry.dueDate,
        entry.originalDueDate,
        entry.extensionReason,
      ],
    );
    return Number(result.insertId);
  }

  /**
   * Refresh a regenerated entry's dates.
   *
   * Deliberately scoped twice over: a completed or waived obligation keeps the
   * date it was actually judged against, and an entry carrying a human-entered
   * extension reason is left alone, because a government extension must not be
   * silently undone by rerunning the generator. Entries whose reason begins with
   * the automatic prefix are the generator's own weekend adjustments and are
   * fair game.
   *
   * `changedRows` rather than `affectedRows`: mysql2 connects with FOUND_ROWS,
   * so `affectedRows` counts rows matched and would report every entry as
   * updated on an idempotent rerun.
   */
  async refreshCalendarDates(id: number, entry: CalendarUpsertInput): Promise<number> {
    const result = await this.query<any>(
      `UPDATE compliance_calendar
       SET month_key = ?, quarter = ?, due_date = ?, original_due_date = ?, extension_reason = ?
       WHERE id = ? AND status IN ('UPCOMING', 'DUE_SOON', 'OVERDUE')
         AND (extension_reason IS NULL OR extension_reason LIKE '${AUTO_ADJUSTMENT_PREFIX}%')`,
      [entry.monthKey, entry.quarter, entry.dueDate, entry.originalDueDate, entry.extensionReason, id],
    );
    return Number(result.changedRows ?? result.affectedRows ?? 0);
  }

  async listCalendar(filters: CalendarFilters = {}): Promise<CalendarEntryResponse[]> {
    let sql = `${this.calendarSelect()} WHERE 1 = 1`;
    const params: any[] = [];
    if (filters.financialYear) {
      sql += ' AND cc.financial_year = ?';
      params.push(filters.financialYear);
    }
    if (filters.month) {
      sql += ' AND (cc.month_key = ? OR DATE_FORMAT(cc.due_date, \'%Y-%m\') = ?)';
      params.push(filters.month, filters.month);
    }
    if (filters.status) {
      sql += ' AND cc.status = ?';
      params.push(filters.status);
    }
    if (filters.category) {
      sql += ' AND o.category = ?';
      params.push(filters.category);
    }
    if (filters.obligationId) {
      sql += ' AND cc.obligation_id = ?';
      params.push(filters.obligationId);
    }
    if (filters.ownerUserId) {
      sql += ' AND cc.owner_user_id = ?';
      params.push(filters.ownerUserId);
    }
    sql += ` ORDER BY cc.due_date ASC, o.code ASC LIMIT ${limitOf(filters.limit, 500)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toCalendarEntry(r));
  }

  async findCalendarById(id: number): Promise<CalendarEntryResponse | null> {
    const rows = await this.query<any[]>(`${this.calendarSelect()} WHERE cc.id = ?`, [id]);
    return rows[0] ? this.toCalendarEntry(rows[0]) : null;
  }

  async getUpcoming(days: number, limit = 200): Promise<CalendarEntryResponse[]> {
    const window = Math.max(1, Math.min(365, Math.floor(days) || 30));
    const rows = await this.query<any[]>(
      `${this.calendarSelect()}
       WHERE cc.status IN ('UPCOMING', 'DUE_SOON')
         AND cc.due_date >= CURDATE()
         AND cc.due_date <= DATE_ADD(CURDATE(), INTERVAL ${window} DAY)
       ORDER BY cc.due_date ASC LIMIT ${limitOf(limit, 200)}`,
      [],
    );
    return rows.map((r) => this.toCalendarEntry(r));
  }

  async getOverdue(limit = 200): Promise<CalendarEntryResponse[]> {
    const rows = await this.query<any[]>(
      `${this.calendarSelect()}
       WHERE cc.status = 'OVERDUE' OR (cc.due_date < CURDATE() AND cc.status IN ('UPCOMING', 'DUE_SOON'))
       ORDER BY cc.due_date ASC LIMIT ${limitOf(limit, 200)}`,
      [],
    );
    return rows.map((r) => this.toCalendarEntry(r));
  }

  /** Set OVERDUE / DUE_SOON without ever downgrading a settled entry. */
  async refreshCalendarStatuses(): Promise<{ markedOverdue: number; markedDueSoon: number }> {
    const dueSoon = await this.query<any>(
      `UPDATE compliance_calendar cc
       JOIN compliance_obligations o ON o.id = cc.obligation_id
       SET cc.status = 'DUE_SOON'
       WHERE cc.status = 'UPCOMING'
         AND cc.due_date >= CURDATE()
         AND cc.due_date <= DATE_ADD(CURDATE(), INTERVAL o.reminder_days_before DAY)`,
      [],
    );
    const overdue = await this.query<any>(
      `UPDATE compliance_calendar
       SET status = 'OVERDUE'
       WHERE due_date < CURDATE() AND status IN ('UPCOMING', 'DUE_SOON')`,
      [],
    );
    return {
      markedOverdue: Number(overdue.affectedRows ?? 0),
      markedDueSoon: Number(dueSoon.affectedRows ?? 0),
    };
  }

  async updateCalendarEntry(id: number, data: Record<string, any>): Promise<void> {
    const columns: Record<string, string> = {
      status: 'status',
      dueDate: 'due_date',
      originalDueDate: 'original_due_date',
      extensionReason: 'extension_reason',
      filingId: 'filing_id',
      challanId: 'challan_id',
      completedOn: 'completed_on',
      completedBy: 'completed_by',
      ownerUserId: 'owner_user_id',
      remarks: 'remarks',
      reminderSentAt: 'reminder_sent_at',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (data[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(data[key]);
      }
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE compliance_calendar SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  /** Entries inside their reminder window that have never been reminded on. */
  async findReminderCandidates(limit = 200): Promise<CalendarEntryResponse[]> {
    const rows = await this.query<any[]>(
      `${this.calendarSelect()}
       WHERE cc.reminder_sent_at IS NULL
         AND cc.status IN ('UPCOMING', 'DUE_SOON', 'OVERDUE')
         AND cc.due_date <= DATE_ADD(CURDATE(), INTERVAL o.reminder_days_before DAY)
       ORDER BY cc.due_date ASC LIMIT ${limitOf(limit, 200)}`,
      [],
    );
    return rows.map((r) => this.toCalendarEntry(r));
  }

  async markRemindersSent(ids: number[]): Promise<number> {
    const list = idList(ids);
    if (!list) return 0;
    const result = await this.query<any>(
      `UPDATE compliance_calendar SET reminder_sent_at = NOW() WHERE id IN (${list}) AND reminder_sent_at IS NULL`,
      [],
    );
    return Number(result.affectedRows ?? 0);
  }

  // =========================================================================
  // Audits
  // =========================================================================

  async listAudits(filters: {
    status?: string;
    auditType?: string;
    financialYear?: string;
    limit?: number;
  } = {}): Promise<AuditResponse[]> {
    let sql = `SELECT a.*,
                 (SELECT COUNT(*) FROM compliance_findings f WHERE f.audit_id = a.id AND f.deleted_at IS NULL) AS finding_count,
                 (SELECT COUNT(*) FROM compliance_findings f WHERE f.audit_id = a.id AND f.deleted_at IS NULL
                    AND f.status IN ('OPEN', 'IN_PROGRESS')) AS open_finding_count
               FROM compliance_audits a
               WHERE a.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.status) {
      sql += ' AND a.status = ?';
      params.push(filters.status);
    }
    if (filters.auditType) {
      sql += ' AND a.audit_type = ?';
      params.push(filters.auditType);
    }
    if (filters.financialYear) {
      sql += ' AND a.financial_year = ?';
      params.push(filters.financialYear);
    }
    sql += ` ORDER BY COALESCE(a.planned_on, a.created_at) DESC, a.id DESC LIMIT ${limitOf(filters.limit, 200)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toAudit(r));
  }

  async findAuditById(id: number): Promise<AuditResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT a.*,
         (SELECT COUNT(*) FROM compliance_findings f WHERE f.audit_id = a.id AND f.deleted_at IS NULL) AS finding_count,
         (SELECT COUNT(*) FROM compliance_findings f WHERE f.audit_id = a.id AND f.deleted_at IS NULL
            AND f.status IN ('OPEN', 'IN_PROGRESS')) AS open_finding_count
       FROM compliance_audits a WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.toAudit(rows[0]) : null;
  }

  async createAudit(data: Record<string, any>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO compliance_audits
        (title, audit_type, scope, financial_year, auditor_name, authority, planned_on,
         started_on, completed_on, status, overall_rating, summary, document_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.auditType ?? 'INTERNAL',
        data.scope ?? null,
        data.financialYear ?? null,
        data.auditorName ?? null,
        data.authority ?? null,
        data.plannedOn ?? null,
        data.startedOn ?? null,
        data.completedOn ?? null,
        data.status ?? 'PLANNED',
        data.overallRating ?? null,
        data.summary ?? null,
        data.documentId ?? null,
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateAudit(id: number, data: Record<string, any>, userId: number): Promise<void> {
    const columns: Record<string, string> = {
      title: 'title',
      auditType: 'audit_type',
      scope: 'scope',
      financialYear: 'financial_year',
      auditorName: 'auditor_name',
      authority: 'authority',
      plannedOn: 'planned_on',
      startedOn: 'started_on',
      completedOn: 'completed_on',
      status: 'status',
      overallRating: 'overall_rating',
      summary: 'summary',
      documentId: 'document_id',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (data[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(data[key]);
      }
    }
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE compliance_audits SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteAudit(id: number): Promise<void> {
    await this.query('UPDATE compliance_audits SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // =========================================================================
  // Findings
  // =========================================================================

  async listFindings(filters: {
    auditId?: number;
    status?: string;
    severity?: string;
    category?: string;
    ruleCode?: string;
    isAutomated?: boolean;
    ownerUserId?: number;
    limit?: number;
  } = {}): Promise<FindingResponse[]> {
    let sql = `${this.findingSelect()} WHERE f.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.auditId) {
      sql += ' AND f.audit_id = ?';
      params.push(filters.auditId);
    }
    if (filters.status) {
      sql += ' AND f.status = ?';
      params.push(filters.status);
    }
    if (filters.severity) {
      sql += ' AND f.severity = ?';
      params.push(filters.severity);
    }
    if (filters.category) {
      sql += ' AND f.category = ?';
      params.push(filters.category);
    }
    if (filters.ruleCode) {
      sql += ' AND f.rule_code = ?';
      params.push(filters.ruleCode);
    }
    if (filters.isAutomated !== undefined) {
      sql += ' AND f.is_automated = ?';
      params.push(filters.isAutomated);
    }
    if (filters.ownerUserId) {
      sql += ' AND f.owner_user_id = ?';
      params.push(filters.ownerUserId);
    }
    sql += ` ORDER BY FIELD(f.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), f.identified_on DESC, f.id DESC
             LIMIT ${limitOf(filters.limit, 300)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toFinding(r));
  }

  async findFindingById(id: number): Promise<FindingResponse | null> {
    const rows = await this.query<any[]>(`${this.findingSelect()} WHERE f.id = ? AND f.deleted_at IS NULL`, [id]);
    return rows[0] ? this.toFinding(rows[0]) : null;
  }

  /** Rule codes that already carry an unresolved finding, for de-duplication. */
  async findOpenRuleCodes(ruleCodes: string[]): Promise<Map<string, number>> {
    const clean = ruleCodes.filter((c) => typeof c === 'string' && c.length > 0);
    if (clean.length === 0) return new Map();
    const placeholders = clean.map(() => '?').join(', ');
    const rows = await this.query<any[]>(
      `SELECT rule_code, MIN(id) AS id FROM compliance_findings
       WHERE deleted_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS') AND rule_code IN (${placeholders})
       GROUP BY rule_code`,
      clean,
    );
    const map = new Map<string, number>();
    for (const row of rows) map.set(String(row.rule_code), Number(row.id));
    return map;
  }

  async createFinding(data: Record<string, any>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO compliance_findings
        (audit_id, finding_no, category, severity, title, description, affected_count, financial_impact,
         rule_code, is_automated, status, identified_on, due_date, owner_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.auditId ?? null,
        data.findingNo ?? null,
        data.category,
        data.severity ?? 'MEDIUM',
        data.title,
        data.description ?? null,
        Math.max(0, Math.floor(Number(data.affectedCount ?? 0)) || 0),
        data.financialImpact ?? null,
        data.ruleCode ?? null,
        data.isAutomated === undefined ? false : !!data.isAutomated,
        data.status ?? 'OPEN',
        data.identifiedOn ?? toDateString(new Date()),
        data.dueDate ?? null,
        data.ownerUserId ?? null,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateFinding(id: number, data: Record<string, any>): Promise<void> {
    const columns: Record<string, string> = {
      auditId: 'audit_id',
      findingNo: 'finding_no',
      category: 'category',
      severity: 'severity',
      title: 'title',
      description: 'description',
      affectedCount: 'affected_count',
      financialImpact: 'financial_impact',
      status: 'status',
      identifiedOn: 'identified_on',
      dueDate: 'due_date',
      ownerUserId: 'owner_user_id',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (data[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(data[key]);
      }
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(
      `UPDATE compliance_findings SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async countOpenFindings(auditId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS c FROM compliance_findings
       WHERE audit_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS')`,
      [auditId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  async getFindingsSummary(): Promise<{
    bySeverity: { severity: FindingSeverity; count: number }[];
    byStatus: { status: FindingStatus; count: number }[];
    byCategory: { category: ComplianceCategory; count: number }[];
    overdueActions: number;
    total: number;
    open: number;
  }> {
    const [severity, status, category, actions] = await Promise.all([
      this.query<any[]>(
        `SELECT severity, COUNT(*) AS c FROM compliance_findings WHERE deleted_at IS NULL GROUP BY severity`,
        [],
      ),
      this.query<any[]>(
        `SELECT status, COUNT(*) AS c FROM compliance_findings WHERE deleted_at IS NULL GROUP BY status`,
        [],
      ),
      this.query<any[]>(
        `SELECT category, COUNT(*) AS c FROM compliance_findings WHERE deleted_at IS NULL GROUP BY category`,
        [],
      ),
      this.query<any[]>(
        `SELECT COUNT(*) AS c FROM compliance_actions
         WHERE status IN ('PENDING', 'IN_PROGRESS') AND due_date IS NOT NULL AND due_date < CURDATE()`,
        [],
      ),
    ]);

    const byStatus = status.map((r) => ({ status: String(r.status) as FindingStatus, count: Number(r.c) }));
    return {
      bySeverity: severity.map((r) => ({ severity: String(r.severity) as FindingSeverity, count: Number(r.c) })),
      byStatus,
      byCategory: category.map((r) => ({ category: String(r.category) as ComplianceCategory, count: Number(r.c) })),
      overdueActions: Number(actions[0]?.c ?? 0),
      total: byStatus.reduce((sum, r) => sum + r.count, 0),
      open: byStatus.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS')
        .reduce((sum, r) => sum + r.count, 0),
    };
  }

  async getOpenFindingsBySeverity(): Promise<{ severity: FindingSeverity; count: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT severity, COUNT(*) AS c FROM compliance_findings
       WHERE deleted_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS')
       GROUP BY severity ORDER BY FIELD(severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW')`,
      [],
    );
    return rows.map((r) => ({ severity: String(r.severity) as FindingSeverity, count: Number(r.c) }));
  }

  // =========================================================================
  // Corrective actions
  // =========================================================================

  async listActions(findingId?: number, filters: { status?: string; limit?: number } = {}): Promise<ActionResponse[]> {
    let sql = `SELECT a.*, u.name AS owner_name FROM compliance_actions a
               LEFT JOIN users u ON u.id = a.owner_user_id WHERE 1 = 1`;
    const params: any[] = [];
    if (findingId) {
      sql += ' AND a.finding_id = ?';
      params.push(findingId);
    }
    if (filters.status) {
      sql += ' AND a.status = ?';
      params.push(filters.status);
    }
    sql += ` ORDER BY a.due_date IS NULL, a.due_date ASC, a.id ASC LIMIT ${limitOf(filters.limit, 300)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toAction(r));
  }

  async findActionById(id: number): Promise<ActionResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT a.*, u.name AS owner_name FROM compliance_actions a
       LEFT JOIN users u ON u.id = a.owner_user_id WHERE a.id = ?`,
      [id],
    );
    return rows[0] ? this.toAction(rows[0]) : null;
  }

  async createAction(data: Record<string, any>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO compliance_actions
        (finding_id, action_text, action_type, owner_user_id, due_date, status, completed_on,
         evidence_document_id, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.findingId,
        data.actionText,
        data.actionType ?? 'CORRECTIVE',
        data.ownerUserId ?? null,
        data.dueDate ?? null,
        data.status ?? 'PENDING',
        data.completedOn ?? null,
        data.evidenceDocumentId ?? null,
        data.remarks ?? null,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateAction(id: number, data: Record<string, any>): Promise<void> {
    const columns: Record<string, string> = {
      actionText: 'action_text',
      actionType: 'action_type',
      ownerUserId: 'owner_user_id',
      dueDate: 'due_date',
      status: 'status',
      completedOn: 'completed_on',
      evidenceDocumentId: 'evidence_document_id',
      remarks: 'remarks',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (data[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(data[key]);
      }
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE compliance_actions SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async countOpenActions(findingId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS c FROM compliance_actions
       WHERE finding_id = ? AND status IN ('PENDING', 'IN_PROGRESS')`,
      [findingId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  /** Open actions whose due date is close or past, for the reminder sweep. */
  async findActionsDueWithin(days: number, limit = 200): Promise<
    (ActionResponse & { findingTitle: string; findingSeverity: FindingSeverity })[]
  > {
    const window = Math.max(0, Math.min(365, Math.floor(days) || 7));
    const rows = await this.query<any[]>(
      `SELECT a.*, u.name AS owner_name, f.title AS finding_title, f.severity AS finding_severity
       FROM compliance_actions a
       JOIN compliance_findings f ON f.id = a.finding_id AND f.deleted_at IS NULL
       LEFT JOIN users u ON u.id = a.owner_user_id
       WHERE a.status IN ('PENDING', 'IN_PROGRESS')
         AND a.due_date IS NOT NULL
         AND a.due_date <= DATE_ADD(CURDATE(), INTERVAL ${window} DAY)
       ORDER BY a.due_date ASC LIMIT ${limitOf(limit, 200)}`,
      [],
    );
    return rows.map((r) => ({
      ...this.toAction(r),
      findingTitle: String(r.finding_title),
      findingSeverity: String(r.finding_severity) as FindingSeverity,
    }));
  }

  // =========================================================================
  // Checklist items and results
  // =========================================================================

  async listChecklistItems(filters: {
    category?: string;
    isAutomated?: boolean;
    isActive?: boolean;
    limit?: number;
  } = {}): Promise<ChecklistItemResponse[]> {
    let sql = 'SELECT * FROM compliance_checklist_items WHERE 1 = 1';
    const params: any[] = [];
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.isAutomated !== undefined) {
      sql += ' AND is_automated = ?';
      params.push(filters.isAutomated);
    }
    if (filters.isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(filters.isActive);
    }
    sql += ` ORDER BY display_order ASC, code ASC LIMIT ${limitOf(filters.limit, 300)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toChecklistItem(r));
  }

  async findChecklistItemById(id: number): Promise<ChecklistItemResponse | null> {
    const rows = await this.query<any[]>('SELECT * FROM compliance_checklist_items WHERE id = ?', [id]);
    return rows[0] ? this.toChecklistItem(rows[0]) : null;
  }

  async createChecklistItem(data: Record<string, any>): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO compliance_checklist_items
        (code, category, title, description, severity, rule_code, is_automated, is_active, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code,
        data.category,
        data.title,
        data.description ?? null,
        data.severity ?? 'MEDIUM',
        data.ruleCode ?? null,
        data.isAutomated === undefined ? false : !!data.isAutomated,
        data.isActive === undefined ? true : !!data.isActive,
        data.displayOrder ?? 100,
      ],
    );
    return Number(result.insertId);
  }

  async updateChecklistItem(id: number, data: Record<string, any>): Promise<void> {
    const columns: Record<string, string> = {
      code: 'code',
      category: 'category',
      title: 'title',
      description: 'description',
      severity: 'severity',
      ruleCode: 'rule_code',
      isAutomated: 'is_automated',
      isActive: 'is_active',
      displayOrder: 'display_order',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (data[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(data[key]);
      }
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE compliance_checklist_items SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async insertCheckResult(data: {
    checklistItemId: number;
    auditId?: number | null;
    periodId?: number | null;
    financialYear?: string | null;
    result: CheckResultValue;
    affectedCount: number;
    detail: string;
    evidence: unknown[];
    checkedBy: number | null;
  }): Promise<number> {
    const evidence = Array.isArray(data.evidence) ? data.evidence.slice(0, MAX_EVIDENCE_ROWS) : [];
    const result = await this.query<any>(
      `INSERT INTO compliance_check_results
        (checklist_item_id, audit_id, period_id, financial_year, result, affected_count, detail,
         evidence_json, checked_at, checked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        data.checklistItemId,
        data.auditId ?? null,
        data.periodId ?? null,
        data.financialYear ?? null,
        data.result,
        Math.max(0, Math.floor(data.affectedCount) || 0),
        data.detail.slice(0, 1000),
        JSON.stringify(evidence),
        data.checkedBy,
      ],
    );
    return Number(result.insertId);
  }

  async linkResultToFinding(resultId: number, findingId: number): Promise<void> {
    await this.query('UPDATE compliance_check_results SET finding_id = ? WHERE id = ?', [findingId, resultId]);
  }

  async findResultsByIds(ids: number[]): Promise<CheckResultResponse[]> {
    const list = idList(ids);
    if (!list) return [];
    const rows = await this.query<any[]>(`${this.resultSelect()} WHERE r.id IN (${list})`, []);
    return rows.map((r) => this.toCheckResult(r));
  }

  async listCheckResults(filters: {
    financialYear?: string;
    periodId?: number;
    auditId?: number;
    result?: string;
    ruleCode?: string;
    limit?: number;
  } = {}): Promise<CheckResultResponse[]> {
    let sql = `${this.resultSelect()} WHERE 1 = 1`;
    const params: any[] = [];
    if (filters.financialYear) {
      sql += ' AND r.financial_year = ?';
      params.push(filters.financialYear);
    }
    if (filters.periodId) {
      sql += ' AND r.period_id = ?';
      params.push(filters.periodId);
    }
    if (filters.auditId) {
      sql += ' AND r.audit_id = ?';
      params.push(filters.auditId);
    }
    if (filters.result) {
      sql += ' AND r.result = ?';
      params.push(filters.result);
    }
    if (filters.ruleCode) {
      sql += ' AND i.rule_code = ?';
      params.push(filters.ruleCode);
    }
    sql += ` ORDER BY r.checked_at DESC, r.id DESC LIMIT ${limitOf(filters.limit, 300)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toCheckResult(r));
  }

  /**
   * The most recent result per checklist item. A single set-based query: the
   * inner aggregate picks the latest id per item, the outer join reads it.
   */
  async listLatestCheckResults(filters: { financialYear?: string; periodId?: number } = {}): Promise<CheckResultResponse[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters.financialYear) {
      conditions.push('financial_year = ?');
      params.push(filters.financialYear);
    }
    if (filters.periodId) {
      conditions.push('period_id = ?');
      params.push(filters.periodId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.query<any[]>(
      `${this.resultSelect()}
       JOIN (
         SELECT checklist_item_id, MAX(id) AS latest_id
         FROM compliance_check_results ${where}
         GROUP BY checklist_item_id
       ) latest ON latest.latest_id = r.id
       ORDER BY i.display_order ASC`,
      params,
    );
    return rows.map((r) => this.toCheckResult(r));
  }

  // =========================================================================
  // The rule engine
  //
  // One authored statement per rule. It is run twice: wrapped in a COUNT for
  // the true breach size, and with a LIMIT for the evidence sample.
  // =========================================================================

  async evaluateRule(ruleCode: string, ctx: RuleContext): Promise<RuleEvaluation> {
    const built = await this.buildRuleQuery(ruleCode, ctx);
    if (!built) {
      return { affectedCount: 0, sample: [], notes: [`No SQL rule is implemented for ${ruleCode}.`] };
    }
    if (built.skip) {
      return { affectedCount: 0, sample: [], notes: built.notes };
    }

    const countRows = await this.query<any[]>(
      `SELECT COUNT(*) AS c FROM (${built.sql}) rule_set`,
      built.params,
    );
    const affectedCount = Number(countRows[0]?.c ?? 0);
    if (affectedCount === 0) {
      return { affectedCount: 0, sample: [], notes: built.notes };
    }

    const sampleRows = await this.query<any[]>(
      `SELECT * FROM (${built.sql}) rule_set ORDER BY 1 ASC LIMIT ${MAX_EVIDENCE_ROWS}`,
      built.params,
    );
    return {
      affectedCount,
      sample: sampleRows.map((r) => this.toRuleSample(r, built.entity ?? 'EMPLOYEE')),
      notes: built.notes,
    };
  }

  private async buildRuleQuery(
    ruleCode: string,
    ctx: RuleContext,
  ): Promise<{ sql: string; params: any[]; notes: string[]; skip?: boolean; entity?: RuleEntity } | null> {
    const notes: string[] = [];

    switch (ruleCode) {
      case 'UAN_MISSING':
        return {
          notes,
          params: [],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name
                FROM employees e
                JOIN employee_statutory es ON es.employee_id = e.id
                WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
                  AND es.pf_status = 'ACTIVE'
                  AND (es.uan IS NULL OR TRIM(es.uan) = '')`,
        };

      case 'ESI_IP_MISSING':
        notes.push('Restricted to currently working employees; an exited member needs no new IP number.');
        return {
          notes,
          params: [],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name
                FROM employees e
                JOIN employee_statutory es ON es.employee_id = e.id
                WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
                  AND es.esi_status = 'ACTIVE'
                  AND (es.esi_ip_number IS NULL OR TRIM(es.esi_ip_number) = '')`,
        };

      case 'PAN_MISSING': {
        const exemption = await this.getBasicExemptionLimit(ctx.financialYear);
        if (exemption === null) {
          notes.push(
            `No default tax regime with a zero-rate slab is configured for ${ctx.financialYear}, `
            + 'so only employees who have actually had TDS deducted were tested. '
            + 'The exemption-threshold half of this rule was skipped rather than guessed.',
          );
          return {
            notes,
            params: [ctx.fyFrom, ctx.fyTo],
            sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name,
                         CONCAT('TDS deducted ', ROUND(agg.tds, 2)) AS detail
                  FROM employees e
                  JOIN employee_statutory es ON es.employee_id = e.id
                  JOIN (
                    SELECT sl.employee_id, SUM(sl.ded_income_tax) AS tds
                    FROM salary_lines sl
                    JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
                    WHERE p.from_date >= ? AND p.to_date <= ?
                    GROUP BY sl.employee_id
                  ) agg ON agg.employee_id = e.id
                  WHERE e.deleted_at IS NULL
                    AND es.pan_status IN ('NOT_PROVIDED', 'INVALID')
                    AND agg.tds > 0`,
          };
        }
        notes.push(`Basic exemption taken as ${exemption} from the default regime's zero-rate slab for ${ctx.financialYear}.`);
        return {
          notes,
          params: [ctx.fyFrom, ctx.fyTo, exemption],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name,
                       CONCAT('gross ', ROUND(agg.gross, 2), ', TDS ', ROUND(agg.tds, 2)) AS detail
                FROM employees e
                JOIN employee_statutory es ON es.employee_id = e.id
                JOIN (
                  SELECT sl.employee_id,
                         SUM(sl.ded_income_tax) AS tds,
                         SUM(sl.gross_amount) AS gross
                  FROM salary_lines sl
                  JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
                  WHERE p.from_date >= ? AND p.to_date <= ?
                  GROUP BY sl.employee_id
                ) agg ON agg.employee_id = e.id
                WHERE e.deleted_at IS NULL
                  AND es.pan_status IN ('NOT_PROVIDED', 'INVALID')
                  AND (agg.tds > 0 OR agg.gross > ?)`,
        };
      }

      case 'BANK_MISSING':
        return {
          notes,
          params: [],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name,
                       CASE
                         WHEN (e.bank_account IS NULL OR TRIM(e.bank_account) = '')
                          AND (e.bank_ifsc IS NULL OR TRIM(e.bank_ifsc) = '') THEN 'account and IFSC missing'
                         WHEN (e.bank_account IS NULL OR TRIM(e.bank_account) = '') THEN 'account number missing'
                         ELSE 'IFSC missing'
                       END AS detail
                FROM employees e
                WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
                  AND ((e.bank_account IS NULL OR TRIM(e.bank_account) = '')
                    OR (e.bank_ifsc IS NULL OR TRIM(e.bank_ifsc) = ''))`,
        };

      case 'BELOW_MINIMUM_WAGE': {
        const period = await this.resolvePeriod(ctx);
        if (!period) {
          notes.push('No salary period inside the financial year has been processed yet, so there is nothing to compare.');
          return { notes, params: [], sql: '', skip: true };
        }
        notes.push(
          'Piece-rate workers are excluded: their monthly earnings legitimately vary with output, '
          + 'and a single low month is not by itself a minimum-wage breach.',
        );
        notes.push('Zero-gross lines are excluded: they mean payroll has not been computed, not that wages were underpaid.');
        notes.push('Compared against the lowest notified floor in force for the mapped skill level, so a borderline case is not flagged.');
        const caseSql = this.gradeSkillCaseSql();
        return {
          notes,
          params: [...caseSql.params, period.id],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name,
                       CONCAT('monthly equivalent ',
                              ROUND(sl.gross_amount * 30.0 / GREATEST(DATEDIFF(p.to_date, p.from_date) + 1, 1), 2),
                              ' against floor ', MIN(mw.monthly_minimum),
                              ' for ', MIN(mw.skill_level), ' in ', MIN(mw.state_code)) AS detail
                FROM salary_lines sl
                JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
                JOIN employees e ON e.id = sl.employee_id AND e.deleted_at IS NULL
                JOIN employee_statutory es ON es.employee_id = e.id
                JOIN minimum_wage_rules mw
                  ON mw.state_code = COALESCE(es.pt_state_code, es.lwf_state_code)
                 AND mw.is_active = true AND mw.deleted_at IS NULL
                 AND mw.effective_from <= p.to_date
                 AND (mw.effective_to IS NULL OR mw.effective_to >= p.to_date)
                 AND mw.skill_level = ${caseSql.sql}
                WHERE p.id = ?
                  AND e.work_status = 'WORKING'
                  AND e.worker_type <> 'PIECE_RATE'
                  AND sl.gross_amount > 0
                GROUP BY e.id, e.emp_code, e.full_name, sl.gross_amount, p.from_date, p.to_date
                HAVING ROUND(sl.gross_amount * 30.0 / GREATEST(DATEDIFF(p.to_date, p.from_date) + 1, 1), 2)
                       < MIN(mw.monthly_minimum)`,
        };
      }

      case 'PF_CEILING_BREACH':
        notes.push('Compared against the highest PF wage ceiling in force for the year, so an overlapping configuration cannot create a false breach.');
        return {
          notes,
          params: [ctx.fyTo, ctx.fyFrom, ctx.financialYear],
          sql: `SELECT sc.employee_id AS employee_id, e.emp_code, e.full_name AS name,
                       CONCAT('wage base ', ROUND(sc.wage_base, 2), ' in ', sc.month_key,
                              ' exceeds ceiling ', MAX(cfg.wage_ceiling)) AS detail
                FROM statutory_contributions sc
                JOIN employees e ON e.id = sc.employee_id
                JOIN statutory_config cfg
                  ON cfg.scheme = 'PF' AND cfg.is_active = true AND cfg.deleted_at IS NULL
                 AND cfg.wage_ceiling IS NOT NULL
                 AND cfg.effective_from <= ?
                 AND (cfg.effective_to IS NULL OR cfg.effective_to >= ?)
                WHERE sc.scheme = 'PF' AND sc.financial_year = ?
                GROUP BY sc.id, sc.employee_id, e.emp_code, e.full_name, sc.wage_base, sc.month_key
                HAVING sc.wage_base > MAX(cfg.wage_ceiling)`,
        };

      case 'ESI_ELIGIBILITY': {
        const period = await this.resolvePeriod(ctx);
        if (!period) {
          notes.push('No salary period inside the financial year has been processed yet, so coverage cannot be tested.');
          return { notes, params: [], sql: '', skip: true };
        }
        notes.push(
          'Reported as a warning, not a failure: an employee who crosses the wage ceiling mid contribution '
          + 'period stays covered until that period ends, so the excess is expected rather than wrong.',
        );
        return {
          notes,
          params: [period.id],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name,
                       CONCAT('gross ', ROUND(sl.gross_amount, 2), ' exceeds ESI ceiling ', MAX(cfg.wage_ceiling)) AS detail
                FROM salary_lines sl
                JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
                JOIN employees e ON e.id = sl.employee_id AND e.deleted_at IS NULL
                JOIN employee_statutory es ON es.employee_id = e.id AND es.esi_status = 'ACTIVE'
                JOIN statutory_config cfg
                  ON cfg.scheme = 'ESI' AND cfg.is_active = true AND cfg.deleted_at IS NULL
                 AND cfg.wage_ceiling IS NOT NULL
                 AND cfg.effective_from <= p.to_date
                 AND (cfg.effective_to IS NULL OR cfg.effective_to >= p.to_date)
                WHERE p.id = ? AND sl.gross_amount > 0
                GROUP BY e.id, e.emp_code, e.full_name, sl.gross_amount
                HAVING sl.gross_amount > MAX(cfg.wage_ceiling)`,
        };
      }

      case 'CHALLAN_OVERDUE':
        return {
          notes,
          entity: 'RECORD',
          params: [ctx.today, ctx.financialYear],
          sql: `SELECT c.id AS employee_id, c.challan_no AS emp_code, c.scheme AS name,
                       CONCAT('due ', DATE_FORMAT(c.due_date, '%Y-%m-%d'), ', status ', c.status,
                              ', amount ', ROUND(c.total_amount, 2)) AS detail
                FROM statutory_challans c
                WHERE c.deleted_at IS NULL
                  AND c.due_date IS NOT NULL AND c.due_date < ?
                  AND c.status NOT IN ('PAID', 'ACKNOWLEDGED', 'CANCELLED')
                  AND c.financial_year = ?`,
        };

      case 'FILING_OVERDUE':
        notes.push('Covers both regulatory filings past their due date and calendar entries already marked overdue.');
        return {
          notes,
          entity: 'RECORD',
          params: [ctx.today, ctx.financialYear, ctx.financialYear],
          sql: `SELECT f.id AS employee_id, f.filing_code AS emp_code, f.filing_type AS name,
                       CONCAT('filing due ', DATE_FORMAT(f.due_date, '%Y-%m-%d'), ', status ', f.status) AS detail
                FROM regulatory_filings f
                WHERE f.deleted_at IS NULL
                  AND f.due_date IS NOT NULL AND f.due_date < ?
                  AND f.status NOT IN ('FILED', 'ACKNOWLEDGED')
                  AND f.financial_year = ?
                UNION ALL
                SELECT cc.id, o.code, o.name,
                       CONCAT('calendar entry ', cc.period_label, ' due ',
                              DATE_FORMAT(cc.due_date, '%Y-%m-%d'), ' is overdue')
                FROM compliance_calendar cc
                JOIN compliance_obligations o ON o.id = cc.obligation_id
                WHERE cc.status = 'OVERDUE' AND cc.financial_year = ?`,
        };

      case 'PROOF_PENDING': {
        const startYear = Number(ctx.financialYear.slice(0, 4));
        const q3End = `${startYear}-12-31`;
        if (ctx.today <= q3End) {
          notes.push(
            `The third quarter of ${ctx.financialYear} closes on ${q3End}; proofs are not yet late, `
            + 'so this check reports no breach rather than a premature failure.',
          );
          return { notes, params: [], sql: '', skip: true };
        }
        return {
          notes,
          params: [ctx.financialYear, ctx.financialYear],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name,
                       CONCAT('declaration still ', d.status) AS detail
                FROM tax_declarations d
                JOIN employees e ON e.id = d.employee_id AND e.deleted_at IS NULL
                WHERE d.financial_year = ? AND d.status IN ('DRAFT', 'SUBMITTED')
                UNION ALL
                SELECT e.id, e.emp_code, e.full_name,
                       CONCAT('proof "', tp.title, '" still ', tp.status)
                FROM tax_proofs tp
                JOIN employees e ON e.id = tp.employee_id AND e.deleted_at IS NULL
                WHERE tp.deleted_at IS NULL AND tp.financial_year = ?
                  AND tp.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
        };
      }

      case 'NOMINEE_MISSING':
        return {
          notes,
          params: [],
          sql: `SELECT e.id AS employee_id, e.emp_code, e.full_name AS name
                FROM employees e
                JOIN employee_statutory es ON es.employee_id = e.id
                WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
                  AND es.pf_status = 'ACTIVE'
                  AND NOT EXISTS (
                    SELECT 1 FROM statutory_nominees n
                    WHERE n.employee_id = e.id AND n.scheme = 'PF' AND n.deleted_at IS NULL
                  )`,
        };

      default:
        return null;
    }
  }

  /**
   * `employees.grade` rendered as a minimum-wage skill level. Built from the
   * exported map so the SQL and the explanation in the result can never drift.
   */
  private gradeSkillCaseSql(): { sql: string; params: any[] } {
    const entries = Object.entries(GRADE_SKILL_MAP);
    const whens = entries.map(() => 'WHEN ? THEN ?').join(' ');
    const params: any[] = [];
    for (const [grade, skill] of entries) params.push(grade, skill);
    params.push(DEFAULT_SKILL_LEVEL);
    return { sql: `CASE e.grade ${whens} ELSE ? END`, params };
  }

  /** The period a period-shaped rule runs against: the caller's, or the latest in the year. */
  private async resolvePeriod(ctx: RuleContext): Promise<{ id: number; label: string } | null> {
    if (ctx.periodId) {
      const rows = await this.query<any[]>(
        'SELECT id, label FROM salary_periods WHERE id = ? AND deleted_at IS NULL',
        [ctx.periodId],
      );
      return rows[0] ? { id: Number(rows[0].id), label: String(rows[0].label) } : null;
    }
    const rows = await this.query<any[]>(
      `SELECT id, label FROM salary_periods
       WHERE deleted_at IS NULL AND from_date >= ? AND to_date <= ?
       ORDER BY to_date DESC LIMIT 1`,
      [ctx.fyFrom, ctx.fyTo],
    );
    return rows[0] ? { id: Number(rows[0].id), label: String(rows[0].label) } : null;
  }

  /** Top of the default regime's zero-rate slab, or null when nothing is configured. */
  async getBasicExemptionLimit(financialYear: string): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT MAX(s.to_amount) AS limit_amount
       FROM tax_slabs s
       JOIN tax_regimes r ON r.id = s.regime_id
       WHERE r.financial_year = ? AND r.is_active = true AND r.is_default = true
         AND s.rate_pct = 0 AND s.to_amount IS NOT NULL`,
      [financialYear],
    );
    const value = rows[0]?.limit_amount;
    if (value === null || value === undefined) return null;
    const parsed = num(value);
    return parsed > 0 ? parsed : null;
  }

  // =========================================================================
  // Analytics aggregates
  //
  // All set-based. Nothing below iterates employees in application code.
  // =========================================================================

  async getContributionTotals(financialYear: string): Promise<{ scheme: string; employee: number; employer: number; total: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT scheme,
              COALESCE(SUM(employee_amount), 0) AS employee_amount,
              COALESCE(SUM(employer_amount), 0) AS employer_amount,
              COALESCE(SUM(total_amount), 0) AS total_amount
       FROM statutory_contributions WHERE financial_year = ? GROUP BY scheme`,
      [financialYear],
    );
    return rows.map((r) => ({
      scheme: String(r.scheme),
      employee: num(r.employee_amount),
      employer: num(r.employer_amount),
      total: num(r.total_amount),
    }));
  }

  async getContributionsByMonth(from: string, to: string): Promise<{ monthKey: string; scheme: string; total: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT month_key, scheme, COALESCE(SUM(total_amount), 0) AS total_amount
       FROM statutory_contributions
       WHERE month_key >= ? AND month_key <= ?
       GROUP BY month_key, scheme
       ORDER BY month_key ASC, scheme ASC`,
      [from, to],
    );
    return rows.map((r) => ({ monthKey: String(r.month_key), scheme: String(r.scheme), total: num(r.total_amount) }));
  }

  /** Payroll-derived statutory totals per month, used when the ledger is empty. */
  async getSalaryLineTotalsByMonth(from: string, to: string): Promise<
    { monthKey: string; pf: number; esi: number; pt: number; lwf: number; tds: number; gross: number }[]
  > {
    const rows = await this.query<any[]>(
      `SELECT DATE_FORMAT(p.to_date, '%Y-%m') AS month_key,
              COALESCE(SUM(sl.ded_pf), 0) AS pf,
              COALESCE(SUM(sl.ded_esi), 0) AS esi,
              COALESCE(SUM(sl.ded_pt), 0) AS pt,
              COALESCE(SUM(sl.ded_lwf), 0) AS lwf,
              COALESCE(SUM(sl.ded_income_tax), 0) AS tds,
              COALESCE(SUM(sl.gross_amount), 0) AS gross
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       WHERE p.from_date >= ? AND p.to_date <= ?
       GROUP BY DATE_FORMAT(p.to_date, '%Y-%m')
       ORDER BY month_key ASC`,
      [from, to],
    );
    return rows.map((r) => ({
      monthKey: String(r.month_key),
      pf: num(r.pf),
      esi: num(r.esi),
      pt: num(r.pt),
      lwf: num(r.lwf),
      tds: num(r.tds),
      gross: num(r.gross),
    }));
  }

  async getTaxLiabilityTotals(financialYear: string): Promise<{ totalTax: number; tdsDeducted: number; employees: number }> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(total_tax), 0) AS total_tax,
              COALESCE(SUM(tax_paid_to_date), 0) AS tds_deducted,
              COUNT(*) AS employees
       FROM tax_computations WHERE financial_year = ?`,
      [financialYear],
    );
    return {
      totalTax: num(rows[0]?.total_tax),
      tdsDeducted: num(rows[0]?.tds_deducted),
      employees: Number(rows[0]?.employees ?? 0),
    };
  }

  async getRegimeCounts(financialYear: string): Promise<{ regimeCode: string; count: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(r.code, 'UNSPECIFIED') AS regime_code, COUNT(*) AS c
       FROM tax_declarations d
       LEFT JOIN tax_regimes r ON r.id = d.regime_id
       WHERE d.financial_year = ?
       GROUP BY COALESCE(r.code, 'UNSPECIFIED')`,
      [financialYear],
    );
    return rows.map((r) => ({ regimeCode: String(r.regime_code), count: Number(r.c) }));
  }

  async getDeductionMix(financialYear: string): Promise<{ code: string; name: string; declared: number; approved: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT s.code, s.name,
              COALESCE(SUM(i.declared_amount), 0) AS declared,
              COALESCE(SUM(i.approved_amount), 0) AS approved
       FROM tax_declaration_items i
       JOIN tax_declarations d ON d.id = i.declaration_id
       JOIN tax_declaration_sections s ON s.id = i.section_id
       WHERE d.financial_year = ?
       GROUP BY s.code, s.name
       HAVING declared > 0 OR approved > 0
       ORDER BY declared DESC`,
      [financialYear],
    );
    return rows.map((r) => ({
      code: String(r.code),
      name: String(r.name),
      declared: num(r.declared),
      approved: num(r.approved),
    }));
  }

  async getTdsByMonth(from: string, to: string): Promise<{ monthKey: string; tds: number; gross: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT DATE_FORMAT(p.to_date, '%Y-%m') AS month_key,
              COALESCE(SUM(sl.ded_income_tax), 0) AS tds,
              COALESCE(SUM(sl.gross_amount), 0) AS gross
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       WHERE p.from_date >= ? AND p.to_date <= ?
       GROUP BY DATE_FORMAT(p.to_date, '%Y-%m') ORDER BY month_key ASC`,
      [from, to],
    );
    return rows.map((r) => ({ monthKey: String(r.month_key), tds: num(r.tds), gross: num(r.gross) }));
  }

  async getCalendarStatusCounts(financialYear?: string): Promise<{ status: CalendarStatus; count: number }[]> {
    const params: any[] = [];
    let sql = 'SELECT status, COUNT(*) AS c FROM compliance_calendar WHERE 1 = 1';
    if (financialYear) {
      sql += ' AND financial_year = ?';
      params.push(financialYear);
    }
    sql += ' GROUP BY status';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({ status: String(r.status) as CalendarStatus, count: Number(r.c) }));
  }

  async getFilingStatusCounts(financialYear?: string): Promise<{ status: string; count: number }[]> {
    const params: any[] = [];
    let sql = 'SELECT status, COUNT(*) AS c FROM regulatory_filings WHERE deleted_at IS NULL';
    if (financialYear) {
      sql += ' AND financial_year = ?';
      params.push(financialYear);
    }
    sql += ' GROUP BY status';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({ status: String(r.status), count: Number(r.c) }));
  }

  async getForm16Count(financialYear: string): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS c FROM form16_records
       WHERE financial_year = ? AND deleted_at IS NULL AND status IN ('GENERATED', 'ISSUED', 'REVISED')`,
      [financialYear],
    );
    return Number(rows[0]?.c ?? 0);
  }

  async getPendingProofCount(financialYear: string): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS c FROM tax_proofs
       WHERE deleted_at IS NULL AND financial_year = ? AND status IN ('SUBMITTED', 'UNDER_REVIEW')`,
      [financialYear],
    );
    return Number(rows[0]?.c ?? 0);
  }

  /** Per obligation: how many calendar entries are due, done and late. */
  async getFilingStatusByObligation(financialYear: string): Promise<
    { obligationId: number; code: string; name: string; category: ObligationCategory; frequency: ObligationFrequency;
      due: number; completed: number; overdue: number; notApplicable: number }[]
  > {
    const rows = await this.query<any[]>(
      `SELECT o.id, o.code, o.name, o.category, o.frequency,
              COUNT(cc.id) AS due,
              SUM(CASE WHEN cc.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN cc.status = 'OVERDUE' THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN cc.status IN ('NOT_APPLICABLE', 'WAIVED') THEN 1 ELSE 0 END) AS not_applicable
       FROM compliance_calendar cc
       JOIN compliance_obligations o ON o.id = cc.obligation_id
       WHERE cc.financial_year = ?
       GROUP BY o.id, o.code, o.name, o.category, o.frequency
       ORDER BY o.category ASC, o.code ASC`,
      [financialYear],
    );
    return rows.map((r) => ({
      obligationId: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      category: String(r.category) as ObligationCategory,
      frequency: String(r.frequency) as ObligationFrequency,
      due: Number(r.due ?? 0),
      completed: Number(r.completed ?? 0),
      overdue: Number(r.overdue ?? 0),
      notApplicable: Number(r.not_applicable ?? 0),
    }));
  }

  /** Free-form report source. Every report is a single aggregate query. */
  async runReportQuery(sql: string, params: any[]): Promise<any[]> {
    return this.query<any[]>(sql, params);
  }

  // =========================================================================
  // Audit trail
  // =========================================================================

  async logAudit(entry: {
    entityType: string;
    entityId?: number | null;
    action: string;
    summary: string;
    fieldName?: string | null;
    previousValue?: string | null;
    newValue?: string | null;
    actorUserId: number | null;
  }): Promise<void> {
    await this.query(
      `INSERT INTO payroll_audit_logs
        (entity_type, entity_id, action, summary, field_name, previous_value, new_value, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.entityType,
        entry.entityId ?? null,
        entry.action,
        entry.summary.slice(0, 500),
        entry.fieldName ?? null,
        entry.previousValue === null || entry.previousValue === undefined ? null : String(entry.previousValue).slice(0, 500),
        entry.newValue === null || entry.newValue === undefined ? null : String(entry.newValue).slice(0, 500),
        entry.actorUserId,
      ],
    );
  }

  // =========================================================================
  // Mappers
  // =========================================================================

  private calendarSelect(): string {
    return `SELECT cc.*, o.code AS obligation_code, o.name AS obligation_name, o.category, o.obligation_type,
                   o.frequency, o.authority, o.reminder_days_before,
                   DATEDIFF(cc.due_date, CURDATE()) AS days_to_due,
                   u.name AS owner_name
            FROM compliance_calendar cc
            JOIN compliance_obligations o ON o.id = cc.obligation_id
            LEFT JOIN users u ON u.id = cc.owner_user_id`;
  }

  private findingSelect(): string {
    return `SELECT f.*, a.title AS audit_title, u.name AS owner_name,
                   (SELECT COUNT(*) FROM compliance_actions ca WHERE ca.finding_id = f.id) AS action_count,
                   (SELECT COUNT(*) FROM compliance_actions ca WHERE ca.finding_id = f.id
                      AND ca.status IN ('PENDING', 'IN_PROGRESS')) AS open_action_count
            FROM compliance_findings f
            LEFT JOIN compliance_audits a ON a.id = f.audit_id
            LEFT JOIN users u ON u.id = f.owner_user_id`;
  }

  private resultSelect(): string {
    return `SELECT r.*, i.code, i.title, i.category, i.severity, i.rule_code
            FROM compliance_check_results r
            JOIN compliance_checklist_items i ON i.id = r.checklist_item_id`;
  }

  private toObligation(row: any): ObligationResponse {
    return {
      id: Number(row.id),
      code: String(row.code),
      name: String(row.name),
      category: String(row.category) as ObligationCategory,
      obligationType: String(row.obligation_type) as ObligationType,
      frequency: String(row.frequency) as ObligationFrequency,
      country: String(row.country ?? 'IN'),
      stateCode: row.state_code ?? null,
      authority: row.authority ?? null,
      dueDay: row.due_day === null || row.due_day === undefined ? null : Number(row.due_day),
      dueMonthOffset: Number(row.due_month_offset ?? 1),
      reminderDaysBefore: Number(row.reminder_days_before ?? 7),
      penaltyNote: row.penalty_note ?? null,
      referenceUrl: row.reference_url ?? null,
      isActive: boolOf(row.is_active),
    };
  }

  private toCalendarEntry(row: any): CalendarEntryResponse {
    return {
      id: Number(row.id),
      obligationId: Number(row.obligation_id),
      obligationCode: String(row.obligation_code),
      obligationName: String(row.obligation_name),
      category: String(row.category) as ObligationCategory,
      obligationType: String(row.obligation_type) as ObligationType,
      frequency: String(row.frequency) as ObligationFrequency,
      authority: row.authority ?? null,
      financialYear: String(row.financial_year),
      periodLabel: String(row.period_label),
      monthKey: row.month_key ?? null,
      quarter: row.quarter === null || row.quarter === undefined ? null : Number(row.quarter),
      stateCode: row.state_code ?? null,
      dueDate: toDateString(row.due_date),
      originalDueDate: nullableDate(row.original_due_date),
      extensionReason: row.extension_reason ?? null,
      status: String(row.status) as CalendarStatus,
      filingId: row.filing_id === null || row.filing_id === undefined ? null : Number(row.filing_id),
      challanId: row.challan_id === null || row.challan_id === undefined ? null : Number(row.challan_id),
      completedOn: nullableDate(row.completed_on),
      completedBy: row.completed_by === null || row.completed_by === undefined ? null : Number(row.completed_by),
      ownerUserId: row.owner_user_id === null || row.owner_user_id === undefined ? null : Number(row.owner_user_id),
      ownerName: row.owner_name ?? null,
      reminderSentAt: isoOf(row.reminder_sent_at),
      reminderDaysBefore: Number(row.reminder_days_before ?? 7),
      remarks: row.remarks ?? null,
      daysToDue: Number(row.days_to_due ?? 0),
    };
  }

  private toAudit(row: any): AuditResponse {
    return {
      id: Number(row.id),
      title: String(row.title),
      auditType: String(row.audit_type) as AuditType,
      scope: row.scope ?? null,
      financialYear: row.financial_year ?? null,
      auditorName: row.auditor_name ?? null,
      authority: row.authority ?? null,
      plannedOn: nullableDate(row.planned_on),
      startedOn: nullableDate(row.started_on),
      completedOn: nullableDate(row.completed_on),
      status: String(row.status) as AuditStatus,
      overallRating: row.overall_rating ? (String(row.overall_rating) as AuditRating) : null,
      summary: row.summary ?? null,
      documentId: row.document_id === null || row.document_id === undefined ? null : Number(row.document_id),
      findingCount: Number(row.finding_count ?? 0),
      openFindingCount: Number(row.open_finding_count ?? 0),
      createdBy: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
      createdAt: isoOf(row.created_at),
    };
  }

  private toFinding(row: any): FindingResponse {
    return {
      id: Number(row.id),
      auditId: row.audit_id === null || row.audit_id === undefined ? null : Number(row.audit_id),
      auditTitle: row.audit_title ?? null,
      findingNo: row.finding_no ?? null,
      category: String(row.category) as ComplianceCategory,
      severity: String(row.severity) as FindingSeverity,
      title: String(row.title),
      description: row.description ?? null,
      affectedCount: Number(row.affected_count ?? 0),
      financialImpact: row.financial_impact === null || row.financial_impact === undefined ? null : num(row.financial_impact),
      ruleCode: row.rule_code ?? null,
      isAutomated: boolOf(row.is_automated),
      status: String(row.status) as FindingStatus,
      identifiedOn: toDateString(row.identified_on),
      dueDate: nullableDate(row.due_date),
      ownerUserId: row.owner_user_id === null || row.owner_user_id === undefined ? null : Number(row.owner_user_id),
      ownerName: row.owner_name ?? null,
      actionCount: Number(row.action_count ?? 0),
      openActionCount: Number(row.open_action_count ?? 0),
      createdAt: isoOf(row.created_at),
    };
  }

  private toAction(row: any): ActionResponse {
    return {
      id: Number(row.id),
      findingId: Number(row.finding_id),
      actionText: String(row.action_text),
      actionType: String(row.action_type) as ActionType,
      ownerUserId: row.owner_user_id === null || row.owner_user_id === undefined ? null : Number(row.owner_user_id),
      ownerName: row.owner_name ?? null,
      dueDate: nullableDate(row.due_date),
      status: String(row.status) as ActionStatus,
      completedOn: nullableDate(row.completed_on),
      evidenceDocumentId: row.evidence_document_id === null || row.evidence_document_id === undefined
        ? null
        : Number(row.evidence_document_id),
      remarks: row.remarks ?? null,
      createdAt: isoOf(row.created_at),
    };
  }

  private toChecklistItem(row: any): ChecklistItemResponse {
    return {
      id: Number(row.id),
      code: String(row.code),
      category: String(row.category) as ComplianceCategory,
      title: String(row.title),
      description: row.description ?? null,
      severity: String(row.severity) as FindingSeverity,
      ruleCode: row.rule_code ?? null,
      isAutomated: boolOf(row.is_automated),
      isActive: boolOf(row.is_active),
      displayOrder: Number(row.display_order ?? 100),
    };
  }

  private toCheckResult(row: any): CheckResultResponse {
    let evidence: unknown[] = [];
    if (row.evidence_json) {
      try {
        const parsed = JSON.parse(String(row.evidence_json));
        if (Array.isArray(parsed)) evidence = parsed;
      } catch {
        evidence = [];
      }
    }
    return {
      id: Number(row.id),
      checklistItemId: Number(row.checklist_item_id),
      code: String(row.code),
      title: String(row.title),
      category: String(row.category) as ComplianceCategory,
      severity: String(row.severity) as FindingSeverity,
      ruleCode: row.rule_code ?? null,
      auditId: row.audit_id === null || row.audit_id === undefined ? null : Number(row.audit_id),
      periodId: row.period_id === null || row.period_id === undefined ? null : Number(row.period_id),
      financialYear: row.financial_year ?? null,
      result: String(row.result) as CheckResultValue,
      affectedCount: Number(row.affected_count ?? 0),
      detail: row.detail ?? null,
      evidence,
      findingId: row.finding_id === null || row.finding_id === undefined ? null : Number(row.finding_id),
      checkedAt: isoOf(row.checked_at),
      checkedBy: row.checked_by === null || row.checked_by === undefined ? null : Number(row.checked_by),
    };
  }

  /**
   * The rule queries share a column shape so one wrapper can count and sample
   * them all. This turns that shape back into honest field names: a challan or
   * a filing is not an employee and must not be labelled with an employee id.
   */
  private toRuleSample(row: any, entity: RuleEntity): RuleSample {
    const sample: RuleSample = {};
    const hasId = row.employee_id !== null && row.employee_id !== undefined;
    const hasCode = row.emp_code !== null && row.emp_code !== undefined;
    if (entity === 'EMPLOYEE') {
      if (hasId) sample.employeeId = Number(row.employee_id);
      if (hasCode) sample.empCode = String(row.emp_code);
    } else {
      if (hasId) sample.recordId = Number(row.employee_id);
      if (hasCode) sample.reference = String(row.emp_code);
    }
    if (row.name !== null && row.name !== undefined) sample.name = String(row.name);
    if (row.detail !== null && row.detail !== undefined) sample.detail = String(row.detail);
    return sample;
  }
}
