import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';

export type AwardClass = 'BONUS' | 'INCENTIVE' | 'VARIABLE_PAY';

export type AwardStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED';

export type OvertimeKind = 'REGULAR' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT_SHIFT';

export type OvertimeRateType = 'FLAT_HOURLY' | 'MULTIPLIER';

export const AWARD_CLASSES: AwardClass[] = ['BONUS', 'INCENTIVE', 'VARIABLE_PAY'];

export interface PayAwardResponse {
  id: number;
  employeeId: number;
  employeeName: string | null;
  empCode: string | null;
  awardClass: AwardClass;
  awardType: string;
  componentId: number | null;
  componentCode: string | null;
  title: string;
  amount: number;
  currency: string;
  targetValue: number | null;
  achievedValue: number | null;
  achievementPct: number | null;
  periodId: number | null;
  periodLabel: string | null;
  payoutPeriodId: number | null;
  payoutPeriodLabel: string | null;
  effectiveDate: string;
  status: AwardStatus;
  isTaxable: boolean;
  reason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PayAwardInput {
  employeeId?: number;
  awardClass?: AwardClass;
  awardType?: string;
  componentId?: number | null;
  title?: string;
  amount?: number;
  currency?: string;
  targetValue?: number | null;
  achievedValue?: number | null;
  achievementPct?: number | null;
  periodId?: number | null;
  payoutPeriodId?: number | null;
  effectiveDate?: string;
  status?: AwardStatus;
  isTaxable?: boolean;
  reason?: string | null;
}

export interface PayAwardFilters {
  employeeId?: number;
  awardClass?: string;
  status?: string;
  periodId?: number;
  payoutPeriodId?: number;
  from?: string;
  to?: string;
  limit?: number;
}

export interface OvertimeRuleResponse {
  id: number;
  code: string;
  name: string;
  otKind: OvertimeKind;
  rateType: OvertimeRateType;
  flatRate: number | null;
  multiplier: number | null;
  minMinutes: number;
  maxHoursPerDay: number | null;
  maxHoursPerMonth: number | null;
  requiresApproval: boolean;
  grade: string | null;
  branch: string | null;
  isActive: boolean;
}

export interface OvertimeRuleInput {
  code?: string;
  name?: string;
  otKind?: OvertimeKind;
  rateType?: OvertimeRateType;
  flatRate?: number | null;
  multiplier?: number | null;
  minMinutes?: number;
  maxHoursPerDay?: number | null;
  maxHoursPerMonth?: number | null;
  requiresApproval?: boolean;
  grade?: string | null;
  branch?: string | null;
  isActive?: boolean;
}

const AWARD_COLUMNS: Record<string, string> = {
  awardClass: 'award_class',
  awardType: 'award_type',
  componentId: 'component_id',
  title: 'title',
  amount: 'amount',
  currency: 'currency',
  targetValue: 'target_value',
  achievedValue: 'achieved_value',
  achievementPct: 'achievement_pct',
  periodId: 'period_id',
  payoutPeriodId: 'payout_period_id',
  effectiveDate: 'effective_date',
  isTaxable: 'is_taxable',
  reason: 'reason',
};

const OT_RULE_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  otKind: 'ot_kind',
  rateType: 'rate_type',
  flatRate: 'flat_rate',
  multiplier: 'multiplier',
  minMinutes: 'min_minutes',
  maxHoursPerDay: 'max_hours_per_day',
  maxHoursPerMonth: 'max_hours_per_month',
  requiresApproval: 'requires_approval',
  grade: 'grade',
  branch: 'branch',
  isActive: 'is_active',
};

function boolParam(value: unknown): number {
  return value ? 1 : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Sanitises a caller-supplied id list so it can be inlined into an IN (...). */
function intList(ids: number[]): number[] {
  return Array.from(
    new Set(ids.map((i) => Math.floor(Number(i))).filter((i) => Number.isFinite(i) && i > 0)),
  );
}

/**
 * Bonus, incentives and variable pay (`pay_awards`) plus overtime rules.
 *
 * One table with an `award_class` discriminator keeps approval, payout and
 * reporting identical for all three kinds of variable pay.
 */
export class PayAwardRepository extends BaseRepository {
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  private readonly AWARD_SELECT = `
    SELECT a.*, e.full_name AS employee_name, e.emp_code AS emp_code,
           c.code AS component_code,
           p.label AS period_label, pp.label AS payout_period_label,
           u.name AS approved_by_name
    FROM pay_awards a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN pay_components c ON c.id = a.component_id
    LEFT JOIN salary_periods p ON p.id = a.period_id
    LEFT JOIN salary_periods pp ON pp.id = a.payout_period_id
    LEFT JOIN users u ON u.id = a.approved_by
  `;

  async findAwards(filters: PayAwardFilters = {}): Promise<PayAwardResponse[]> {
    let sql = `${this.AWARD_SELECT} WHERE a.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND a.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.awardClass && filters.awardClass !== 'ALL') {
      sql += ' AND a.award_class = ?';
      params.push(filters.awardClass);
    }
    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND a.status = ?';
      params.push(filters.status);
    }
    if (filters.periodId) {
      sql += ' AND a.period_id = ?';
      params.push(filters.periodId);
    }
    if (filters.payoutPeriodId) {
      sql += ' AND a.payout_period_id = ?';
      params.push(filters.payoutPeriodId);
    }
    if (filters.from) {
      sql += ' AND a.effective_date >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      sql += ' AND a.effective_date <= ?';
      params.push(filters.to);
    }

    // LIMIT cannot be bound in a prepared statement; inline a sanitised int.
    const limit = Math.min(2000, Math.max(1, Math.floor(Number(filters.limit ?? 300) || 300)));
    sql += ` ORDER BY a.effective_date DESC, a.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.awardToResponse(r));
  }

  async findAwardById(id: number): Promise<PayAwardResponse | null> {
    const rows = await this.query<any[]>(
      `${this.AWARD_SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.awardToResponse(rows[0]) : null;
  }

  async findAwardRowById(id: number, conn?: any): Promise<any | null> {
    const sql = 'SELECT * FROM pay_awards WHERE id = ? AND deleted_at IS NULL';
    if (conn) {
      const [rows] = await conn.query(`${sql} FOR UPDATE`, [id]);
      return (rows as any[])[0] || null;
    }
    const rows = await this.query<any[]>(sql, [id]);
    return rows[0] || null;
  }

  async createAward(data: PayAwardInput, userId: number, conn?: any): Promise<number> {
    const sql = `INSERT INTO pay_awards
        (employee_id, award_class, award_type, component_id, title, amount, currency,
         target_value, achieved_value, achievement_pct, period_id, payout_period_id,
         effective_date, status, is_taxable, reason, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      data.employeeId,
      data.awardClass ?? 'BONUS',
      data.awardType ?? 'GENERAL',
      data.componentId ?? null,
      data.title,
      nullableNumber(data.amount) ?? 0,
      data.currency ?? 'INR',
      nullableNumber(data.targetValue),
      nullableNumber(data.achievedValue),
      nullableNumber(data.achievementPct),
      data.periodId ?? null,
      data.payoutPeriodId ?? null,
      data.effectiveDate,
      data.status ?? 'DRAFT',
      boolParam(data.isTaxable ?? true),
      data.reason ?? null,
      userId,
      userId,
    ];
    if (conn) {
      const [result] = await conn.query(sql, params);
      return Number((result as any).insertId);
    }
    const result = await this.query<any>(sql, params);
    return Number(result.insertId);
  }

  async updateAward(id: number, data: PayAwardInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(AWARD_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (key === 'isTaxable') params.push(boolParam(value));
      else if (['amount', 'targetValue', 'achievedValue', 'achievementPct'].includes(key)) {
        params.push(nullableNumber(value));
      } else params.push(value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE pay_awards SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async setAwardStatus(
    id: number,
    status: AwardStatus,
    userId: number,
    note?: string | null,
  ): Promise<void> {
    const sets = ['status = ?', 'updated_by = ?'];
    const params: any[] = [status, userId];

    if (status === 'APPROVED') {
      sets.push('approved_by = ?', 'approved_at = NOW()');
      params.push(userId);
    }
    if (status === 'PAID') sets.push('paid_at = NOW()');
    if (note !== undefined && note !== null && note !== '') {
      sets.push('reason = ?');
      params.push(note);
    }
    params.push(id);
    await this.query(
      `UPDATE pay_awards SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  /** Flags approved awards as PAID and pins them to the payout period. */
  async markPaid(ids: number[], periodId: number | null, userId: number): Promise<number> {
    const clean = intList(ids);
    if (clean.length === 0) return 0;
    const result = await this.query<any>(
      `UPDATE pay_awards
       SET status = 'PAID', paid_at = NOW(), payout_period_id = COALESCE(?, payout_period_id), updated_by = ?
       WHERE deleted_at IS NULL AND status = 'APPROVED' AND id IN (${clean.join(',')})`,
      [periodId ?? null, userId],
    );
    return Number(result?.affectedRows ?? 0);
  }

  /**
   * Approved awards the payroll engine should pay out in a period.
   * Includes awards explicitly tagged to the period.
   */
  async getPendingForPeriod(periodId: number): Promise<PayAwardResponse[]> {
    const rows = await this.query<any[]>(
      `${this.AWARD_SELECT}
       WHERE a.deleted_at IS NULL AND a.status = 'APPROVED' AND a.payout_period_id = ?
       ORDER BY a.employee_id ASC, a.id ASC`,
      [periodId],
    );
    return rows.map((r) => this.awardToResponse(r));
  }

  // -------------------------------------------------------------------------
  // Overtime rules
  // -------------------------------------------------------------------------
  async findOvertimeRules(isActive?: boolean): Promise<OvertimeRuleResponse[]> {
    let sql = 'SELECT * FROM overtime_rules WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(boolParam(isActive));
    }
    sql += ' ORDER BY code ASC LIMIT 200';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.otRuleToResponse(r));
  }

  async findOvertimeRuleById(id: number): Promise<OvertimeRuleResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM overtime_rules WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.otRuleToResponse(rows[0]) : null;
  }

  async findOvertimeRuleByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM overtime_rules WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] || null;
  }

  async createOvertimeRule(data: OvertimeRuleInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO overtime_rules
         (code, name, ot_kind, rate_type, flat_rate, multiplier, min_minutes,
          max_hours_per_day, max_hours_per_month, requires_approval, grade, branch,
          is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code,
        data.name,
        data.otKind ?? 'REGULAR',
        data.rateType ?? 'FLAT_HOURLY',
        nullableNumber(data.flatRate),
        nullableNumber(data.multiplier),
        Math.floor(Number(data.minMinutes ?? 30)),
        nullableNumber(data.maxHoursPerDay),
        nullableNumber(data.maxHoursPerMonth),
        boolParam(data.requiresApproval ?? true),
        data.grade ?? null,
        data.branch ?? null,
        boolParam(data.isActive ?? true),
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateOvertimeRule(id: number, data: OvertimeRuleInput): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(OT_RULE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (['requiresApproval', 'isActive'].includes(key)) params.push(boolParam(value));
      else if (['flatRate', 'multiplier', 'maxHoursPerDay', 'maxHoursPerMonth'].includes(key)) {
        params.push(nullableNumber(value));
      } else params.push(value);
    }
    if (sets.length === 0) return;

    params.push(id);
    await this.query(
      `UPDATE overtime_rules SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteOvertimeRule(id: number): Promise<void> {
    await this.query(
      'UPDATE overtime_rules SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  // -------------------------------------------------------------------------
  // Shared lookups
  // -------------------------------------------------------------------------
  async findEmployeeBrief(
    employeeId: number,
    conn?: any,
  ): Promise<{ id: number; fullName: string; empCode: string; workStatus: string } | null> {
    const sql = `SELECT id, full_name, emp_code, work_status
                 FROM employees WHERE id = ? AND deleted_at IS NULL`;
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [employeeId]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [employeeId]);
    }
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      fullName: row.full_name,
      empCode: row.emp_code,
      workStatus: row.work_status,
    };
  }

  /** Resolves an employee id from an employee code, for bulk imports. */
  async findEmployeeIdByCode(empCode: string, conn?: any): Promise<number | null> {
    const sql = 'SELECT id FROM employees WHERE emp_code = ? AND deleted_at IS NULL';
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [empCode]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [empCode]);
    }
    return rows[0] ? Number(rows[0].id) : null;
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------
  private awardToResponse(r: any): PayAwardResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      awardClass: r.award_class,
      awardType: r.award_type,
      componentId: numOrNull(r.component_id),
      componentCode: r.component_code ?? null,
      title: r.title,
      amount: Number(r.amount ?? 0),
      currency: r.currency,
      targetValue: numOrNull(r.target_value),
      achievedValue: numOrNull(r.achieved_value),
      achievementPct: numOrNull(r.achievement_pct),
      periodId: numOrNull(r.period_id),
      periodLabel: r.period_label ?? null,
      payoutPeriodId: numOrNull(r.payout_period_id),
      payoutPeriodLabel: r.payout_period_label ?? null,
      effectiveDate: toDateString(r.effective_date),
      status: r.status,
      isTaxable: !!r.is_taxable,
      reason: r.reason ?? null,
      approvedBy: r.approved_by_name ?? null,
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
      paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private otRuleToResponse(r: any): OvertimeRuleResponse {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      otKind: r.ot_kind,
      rateType: r.rate_type,
      flatRate: numOrNull(r.flat_rate),
      multiplier: numOrNull(r.multiplier),
      minMinutes: Number(r.min_minutes ?? 0),
      maxHoursPerDay: numOrNull(r.max_hours_per_day),
      maxHoursPerMonth: numOrNull(r.max_hours_per_month),
      requiresApproval: !!r.requires_approval,
      grade: r.grade ?? null,
      branch: r.branch ?? null,
      isActive: !!r.is_active,
    };
  }
}
