import { BaseRepository } from './BaseRepository';

/**
 * Data access for full-and-final settlements.
 *
 * The `final_settlements` table was created by the payroll module (migration
 * 068) but no service ever wrote to it; this repository is its first real
 * user. The table is keyed on employee_id (there is no separation_id column),
 * so settlement<->separation linkage always travels through the employee.
 */
export class ExitSettlementRepository extends BaseRepository {
  // ---------------------------------------------------------------------------
  // Separation context
  // ---------------------------------------------------------------------------

  async findSeparation(separationId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT s.*, e.emp_code, e.full_name, e.grade, e.worker_type, e.joined_at,
              e.monthly_salary, e.department AS department_name, e.department_id, e.work_status
         FROM separations s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.id = ? AND s.deleted_at IS NULL`,
      [separationId],
    );
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Settlement rows
  // ---------------------------------------------------------------------------

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT fs.*, e.emp_code, e.full_name, e.worker_type, e.grade
         FROM final_settlements fs
         JOIN employees e ON e.id = fs.employee_id
        WHERE fs.id = ? AND fs.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findMany(filters: { status?: string; employeeId?: number; limit?: number }): Promise<any[]> {
    const where: string[] = ['fs.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.status) {
      where.push('fs.status = ?');
      params.push(filters.status);
    }
    if (filters.employeeId) {
      where.push('fs.employee_id = ?');
      params.push(filters.employeeId);
    }
    // LIMIT cannot be bound in this stack; inline the sanitized number.
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
    return this.query<any[]>(
      `SELECT fs.*, e.emp_code, e.full_name, e.worker_type, e.grade
         FROM final_settlements fs
         JOIN employees e ON e.id = fs.employee_id
        WHERE ${where.join(' AND ')}
        ORDER BY fs.id DESC
        LIMIT ${limit}`,
      params,
    );
  }

  /** The employee's re-computable row, if one exists. */
  async findOpenForEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM final_settlements
        WHERE employee_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'CALCULATED')
        ORDER BY id DESC LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  /** Any row compute must not touch (in approval or already settled). */
  async findLockedForEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM final_settlements
        WHERE employee_id = ? AND deleted_at IS NULL AND status IN ('PENDING_APPROVAL', 'APPROVED', 'PAID')
        ORDER BY id DESC LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  async findForEmployee(employeeId: number, statuses: string[]): Promise<any | null> {
    if (statuses.length === 0) return null;
    const rows = await this.query<any[]>(
      `SELECT fs.*, e.emp_code, e.full_name, e.worker_type, e.grade
         FROM final_settlements fs
         JOIN employees e ON e.id = fs.employee_id
        WHERE fs.employee_id = ? AND fs.deleted_at IS NULL
          AND fs.status IN (${statuses.map(() => '?').join(', ')})
        ORDER BY fs.id DESC LIMIT 1`,
      [employeeId, ...statuses],
    );
    return rows[0] ?? null;
  }

  async insert(data: Record<string, any>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO final_settlements
         (employee_id, settlement_type, last_working_date, notice_period_days, notice_served_days,
          notice_shortfall_days, currency, pending_salary, leave_encashment_days, leave_encashment_amount,
          gratuity_years, gratuity_amount, bonus_payable, other_earnings, notice_recovery, loan_recovery,
          advance_recovery, asset_recovery, tax_deduction, other_deductions, gross_payable, total_recovery,
          net_settlement, status, clearance_json, remarks, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId, data.settlementType, data.lastWorkingDate, data.noticePeriodDays,
        data.noticeServedDays, data.noticeShortfallDays, data.pendingSalary, data.leaveEncashmentDays,
        data.leaveEncashmentAmount, data.gratuityYears, data.gratuityAmount, data.bonusPayable,
        data.otherEarnings, data.noticeRecovery, data.loanRecovery, data.advanceRecovery,
        data.assetRecovery, data.taxDeduction, data.otherDeductions, data.grossPayable,
        data.totalRecovery, data.netSettlement, data.status, data.clearanceJson, data.remarks ?? null,
        userId, userId,
      ],
    );
    return Number(result.insertId);
  }

  /** Recompute in place, preserving the manual adjustment columns. */
  async updateComputed(id: number, data: Record<string, any>, userId: number): Promise<void> {
    await this.query(
      `UPDATE final_settlements SET
         settlement_type = ?, last_working_date = ?, notice_period_days = ?, notice_served_days = ?,
         notice_shortfall_days = ?, pending_salary = ?, leave_encashment_days = ?, leave_encashment_amount = ?,
         gratuity_years = ?, gratuity_amount = ?, notice_recovery = ?, loan_recovery = ?, advance_recovery = ?,
         asset_recovery = ?, tax_deduction = ?, gross_payable = ?, total_recovery = ?, net_settlement = ?,
         status = ?, clearance_json = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.settlementType, data.lastWorkingDate, data.noticePeriodDays, data.noticeServedDays,
        data.noticeShortfallDays, data.pendingSalary, data.leaveEncashmentDays, data.leaveEncashmentAmount,
        data.gratuityYears, data.gratuityAmount, data.noticeRecovery, data.loanRecovery, data.advanceRecovery,
        data.assetRecovery, data.taxDeduction, data.grossPayable, data.totalRecovery, data.netSettlement,
        data.status, data.clearanceJson, userId, id,
      ],
    );
  }

  async updateManual(
    id: number,
    fields: { bonusPayable: number; otherEarnings: number; otherDeductions: number; remarks: string | null },
    totals: { grossPayable: number; totalRecovery: number; netSettlement: number },
    userId: number,
  ): Promise<void> {
    await this.query(
      `UPDATE final_settlements SET
         bonus_payable = ?, other_earnings = ?, other_deductions = ?, remarks = ?,
         gross_payable = ?, total_recovery = ?, net_settlement = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        fields.bonusPayable, fields.otherEarnings, fields.otherDeductions, fields.remarks,
        totals.grossPayable, totals.totalRecovery, totals.netSettlement, userId, id,
      ],
    );
  }

  async updateStatus(
    id: number,
    status: string,
    userId: number,
    extra: { approvedBy?: number | null; approvedAt?: Date | null; paidAt?: Date | string | null; remarks?: string | null } = {},
  ): Promise<void> {
    const sets: string[] = ['status = ?', 'updated_by = ?'];
    const params: any[] = [status, userId];
    if (extra.approvedBy !== undefined) {
      sets.push('approved_by = ?');
      params.push(extra.approvedBy);
    }
    if (extra.approvedAt !== undefined) {
      sets.push('approved_at = ?');
      params.push(extra.approvedAt);
    }
    if (extra.paidAt !== undefined) {
      sets.push('paid_at = ?');
      params.push(extra.paidAt);
    }
    if (extra.remarks !== undefined) {
      sets.push('remarks = ?');
      params.push(extra.remarks);
    }
    params.push(id);
    await this.query(
      `UPDATE final_settlements SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  // ---------------------------------------------------------------------------
  // Component sources (all read-only)
  // ---------------------------------------------------------------------------

  /** Salary lines whose period is not PAID and which are not individually paid. */
  async findUnpaidSalaryLines(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT sl.id, sl.total_amount, sl.paid_at, p.label AS period_label, p.status AS period_status
         FROM salary_lines sl
         JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
        WHERE sl.employee_id = ? AND p.status <> 'PAID' AND sl.paid_at IS NULL
        ORDER BY p.from_date ASC`,
      [employeeId],
    );
  }

  /** Most recent salary lines (piece-rate earning history), newest first. */
  async findRecentSalaryLines(employeeId: number, limit: number): Promise<any[]> {
    const n = Math.min(Math.max(Math.trunc(limit), 1), 12);
    return this.query<any[]>(
      `SELECT sl.total_amount, p.label AS period_label, p.from_date
         FROM salary_lines sl
         JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
        WHERE sl.employee_id = ?
        ORDER BY p.from_date DESC
        LIMIT ${n}`,
      [employeeId],
    );
  }

  /** The compensation revision whose window covers `onDate`. */
  async findSalaryRevision(employeeId: number, onDate: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_salary
        WHERE employee_id = ? AND deleted_at IS NULL
          AND status IN ('ACTIVE', 'APPROVED', 'SUPERSEDED')
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [employeeId, onDate, onDate],
    );
    return rows[0] ?? null;
  }

  async findLeaveBalances(employeeId: number, year: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT lb.allocated, lb.used, lt.code AS leave_code, lt.name AS leave_name, lt.is_paid
         FROM leave_balances lb
         JOIN leave_types lt ON lt.id = lb.leave_type_id AND lt.deleted_at IS NULL
        WHERE lb.employee_id = ? AND lb.year = ?`,
      [employeeId, year],
    );
  }

  async findGratuityConfigs(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT * FROM statutory_config WHERE scheme = 'GRATUITY' AND deleted_at IS NULL
        ORDER BY effective_from DESC`,
    );
  }

  async findOutstandingLoans(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT l.id, l.loan_type, l.principal, l.status,
              COALESCE(SUM(CASE WHEN i.status = 'PENDING' THEN i.principal_component ELSE 0 END), 0) AS outstanding
         FROM employee_loans l
         LEFT JOIN loan_installments i ON i.loan_id = l.id
        WHERE l.employee_id = ? AND l.deleted_at IS NULL AND l.status IN ('ACTIVE', 'APPROVED')
        GROUP BY l.id, l.loan_type, l.principal, l.status`,
      [employeeId],
    );
  }

  async findOutstandingAdvances(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT a.id, a.advance_type, a.amount,
              COALESCE((SELECT SUM(r.amount) FROM advance_recoveries r WHERE r.advance_id = a.id), 0) AS recovered
         FROM advances a
        WHERE a.employee_id = ? AND a.deleted_at IS NULL AND a.status = 'ACTIVE'`,
      [employeeId],
    );
  }

  async findAssetDamage(separationId: number): Promise<{ total: number; chargedRows: number }> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(damage_charge), 0) AS total,
              COALESCE(SUM(CASE WHEN damage_charge IS NOT NULL AND damage_charge > 0 THEN 1 ELSE 0 END), 0) AS charged_rows
         FROM asset_returns
        WHERE separation_id = ?`,
      [separationId],
    );
    return { total: Number(rows[0]?.total ?? 0), chargedRows: Number(rows[0]?.charged_rows ?? 0) };
  }

  async findTaxComputation(employeeId: number, financialYear: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM tax_computations WHERE employee_id = ? AND financial_year = ? LIMIT 1`,
      [employeeId, financialYear],
    );
    return rows[0] ?? null;
  }

  /** Latest separation for an employee (to show the case behind a settlement). */
  async findLatestSeparationForEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM separations WHERE employee_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  async findEmployeeUser(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id, email, name, is_active FROM users
        WHERE employee_id = ? AND deleted_at IS NULL LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }
}
