import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
// Enums mirrored from migrations 067 / 068
// ---------------------------------------------------------------------------
export type LoanType =
  | 'PERSONAL' | 'MEDICAL' | 'EDUCATION' | 'HOUSING' | 'VEHICLE' | 'EMERGENCY' | 'OTHER';

export type LoanStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ACTIVE'
  | 'CLOSED' | 'FORECLOSED' | 'WRITTEN_OFF';

export type InstallmentStatus = 'PENDING' | 'RECOVERED' | 'SKIPPED' | 'WAIVED';

export type ClaimStatus =
  | 'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID';

export type BenefitType = 'INSURANCE' | 'MEDICAL' | 'RETIREMENT' | 'WELLNESS' | 'FLEXIBLE' | 'PERK';

export type EnrolmentStatus = 'ACTIVE' | 'ENDED' | 'SUSPENDED';

/** Loan states whose installments the payroll engine may recover. */
export const RECOVERABLE_LOAN_STATUSES: LoanStatus[] = ['APPROVED', 'ACTIVE'];

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------
export interface LoanInstallmentResponse {
  id: number;
  loanId: number;
  seq: number;
  dueDate: string;
  principalComponent: number;
  interestComponent: number;
  emiAmount: number;
  outstandingAfter: number;
  status: InstallmentStatus;
  recoveredAmount: number;
  recoveredOn: string | null;
  salaryLineId: number | null;
  periodId: number | null;
}

export interface EmployeeLoanResponse {
  id: number;
  employeeId: number;
  employeeName: string | null;
  empCode: string | null;
  loanType: LoanType;
  principal: number;
  interestRatePct: number;
  tenureMonths: number;
  emiAmount: number;
  currency: string;
  disbursedOn: string | null;
  firstEmiDate: string | null;
  purpose: string | null;
  status: LoanStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  totalRecovered: number;
  outstanding: number;
  installmentsPending: number;
  schedule?: LoanInstallmentResponse[];
}

/** Lean shape the payroll engine consumes when recovering EMIs. */
export interface DueInstallment {
  installmentId: number;
  loanId: number;
  employeeId: number;
  seq: number;
  dueDate: string;
  emiAmount: number;
  principalComponent: number;
  interestComponent: number;
  outstandingAfter: number;
  loanType: LoanType;
}

export interface ReimbursementTypeResponse {
  id: number;
  code: string;
  name: string;
  componentId: number | null;
  componentCode: string | null;
  annualLimit: number | null;
  monthlyLimit: number | null;
  requiresReceipt: boolean;
  isTaxable: boolean;
  isActive: boolean;
}

export interface ReimbursementClaimResponse {
  id: number;
  employeeId: number;
  employeeName: string | null;
  empCode: string | null;
  typeId: number;
  typeCode: string | null;
  typeName: string | null;
  componentId: number | null;
  claimNo: string;
  amount: number;
  approvedAmount: number | null;
  currency: string;
  expenseDate: string;
  description: string | null;
  documentId: number | null;
  status: ClaimStatus;
  payoutPeriodId: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface BenefitPlanResponse {
  id: number;
  code: string;
  name: string;
  benefitType: BenefitType;
  provider: string | null;
  description: string | null;
  employerContribution: number;
  employeeContribution: number;
  coverageAmount: number | null;
  componentId: number | null;
  currency: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  enrolledCount?: number;
}

export interface EmployeeBenefitResponse {
  id: number;
  employeeId: number;
  employeeName: string | null;
  empCode: string | null;
  planId: number;
  planCode: string | null;
  planName: string | null;
  benefitType: BenefitType | null;
  enrolledOn: string;
  endedOn: string | null;
  nomineeName: string | null;
  policyNumber: string | null;
  employeeContribution: number | null;
  employerContribution: number | null;
  status: EnrolmentStatus;
}

// ---------------------------------------------------------------------------
// Write inputs
// ---------------------------------------------------------------------------
export interface CreateLoanInput {
  employeeId: number;
  loanType?: LoanType;
  principal: number;
  interestRatePct?: number;
  tenureMonths: number;
  emiAmount: number;
  currency?: string;
  disbursedOn?: string | null;
  firstEmiDate?: string | null;
  purpose?: string | null;
  status?: LoanStatus;
}

export interface ScheduleRow {
  seq: number;
  dueDate: string;
  principalComponent: number;
  interestComponent: number;
  emiAmount: number;
  outstandingAfter: number;
}

export interface ReimbursementTypeInput {
  code?: string;
  name?: string;
  componentId?: number | null;
  annualLimit?: number | null;
  monthlyLimit?: number | null;
  requiresReceipt?: boolean;
  isTaxable?: boolean;
  isActive?: boolean;
}

export interface CreateClaimInput {
  employeeId: number;
  typeId: number;
  amount: number;
  currency?: string;
  expenseDate: string;
  description?: string | null;
  documentId?: number | null;
  status?: ClaimStatus;
}

export interface BenefitPlanInput {
  code?: string;
  name?: string;
  benefitType?: BenefitType;
  provider?: string | null;
  description?: string | null;
  employerContribution?: number;
  employeeContribution?: number;
  coverageAmount?: number | null;
  componentId?: number | null;
  currency?: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  isActive?: boolean;
}

export interface EnrolBenefitInput {
  enrolledOn?: string;
  nomineeName?: string | null;
  policyNumber?: string | null;
  employeeContribution?: number | null;
  employerContribution?: number | null;
}

export interface LoanFilters {
  employeeId?: number;
  status?: string;
  loanType?: string;
  limit?: number;
}

export interface ClaimFilters {
  employeeId?: number;
  status?: string;
  typeId?: number;
  from?: string;
  to?: string;
  limit?: number;
}

export interface EnrolmentFilters {
  planId?: number;
  status?: string;
  employeeId?: number;
  limit?: number;
}

const REIMB_TYPE_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  componentId: 'component_id',
  annualLimit: 'annual_limit',
  monthlyLimit: 'monthly_limit',
  requiresReceipt: 'requires_receipt',
  isTaxable: 'is_taxable',
  isActive: 'is_active',
};

const BENEFIT_PLAN_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  benefitType: 'benefit_type',
  provider: 'provider',
  description: 'description',
  employerContribution: 'employer_contribution',
  employeeContribution: 'employee_contribution',
  coverageAmount: 'coverage_amount',
  componentId: 'component_id',
  currency: 'currency',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
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

function intList(ids: number[]): number[] {
  return Array.from(
    new Set(ids.map((i) => Math.floor(Number(i))).filter((i) => Number.isFinite(i) && i > 0)),
  );
}

function limitOf(value: number | undefined, fallback: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(1, Math.floor(Number(value ?? fallback) || fallback)));
}

/**
 * Loans and their EMI schedules, reimbursement types and claims, and benefit
 * plans and enrolments.
 *
 * Recovery figures (`totalRecovered`, `outstanding`) are always derived from
 * `loan_installments` rather than stored on the loan, so a manually recorded
 * repayment and a payroll recovery can never disagree.
 */
export class PayrollLoanRepository extends BaseRepository {
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // -------------------------------------------------------------------------
  // Loans
  // -------------------------------------------------------------------------
  private readonly LOAN_SELECT = `
    SELECT l.*, e.full_name AS employee_name, e.emp_code AS emp_code,
           u.name AS approved_by_name,
           COALESCE(agg.recovered, 0) AS total_recovered,
           COALESCE(agg.pending_cnt, 0) AS pending_cnt,
           COALESCE(agg.pending_amount, 0) AS pending_amount
    FROM employee_loans l
    JOIN employees e ON e.id = l.employee_id
    LEFT JOIN users u ON u.id = l.approved_by
    LEFT JOIN (
      SELECT loan_id,
             SUM(recovered_amount) AS recovered,
             SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_cnt,
             SUM(CASE WHEN status = 'PENDING' THEN emi_amount - recovered_amount ELSE 0 END) AS pending_amount
      FROM loan_installments GROUP BY loan_id
    ) agg ON agg.loan_id = l.id
  `;

  async findLoans(filters: LoanFilters = {}): Promise<EmployeeLoanResponse[]> {
    let sql = `${this.LOAN_SELECT} WHERE l.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND l.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND l.status = ?';
      params.push(filters.status);
    }
    if (filters.loanType) {
      sql += ' AND l.loan_type = ?';
      params.push(filters.loanType);
    }

    const limit = limitOf(filters.limit, 300, 2000);
    sql += ` ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.loanToResponse(r));
  }

  async findLoanById(id: number): Promise<EmployeeLoanResponse | null> {
    const rows = await this.query<any[]>(
      `${this.LOAN_SELECT} WHERE l.id = ? AND l.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.loanToResponse(rows[0]) : null;
  }

  async findLoanRowById(id: number, conn?: any): Promise<any | null> {
    const sql = 'SELECT * FROM employee_loans WHERE id = ? AND deleted_at IS NULL';
    if (conn) {
      const [rows] = await conn.query(`${sql} FOR UPDATE`, [id]);
      return (rows as any[])[0] || null;
    }
    const rows = await this.query<any[]>(sql, [id]);
    return rows[0] || null;
  }

  async createLoan(data: CreateLoanInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO employee_loans
         (employee_id, loan_type, principal, interest_rate_pct, tenure_months, emi_amount,
          currency, disbursed_on, first_emi_date, purpose, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId,
        data.loanType ?? 'PERSONAL',
        Number(data.principal),
        Number(data.interestRatePct ?? 0),
        Math.floor(Number(data.tenureMonths)),
        Number(data.emiAmount),
        data.currency ?? 'INR',
        data.disbursedOn ?? null,
        data.firstEmiDate ?? null,
        data.purpose ?? null,
        data.status ?? 'PENDING_APPROVAL',
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async setLoanStatus(
    id: number,
    status: LoanStatus,
    userId: number,
    conn?: any,
    extra?: { emiAmount?: number; firstEmiDate?: string; disbursedOn?: string },
  ): Promise<void> {
    const sets = ['status = ?', 'updated_by = ?'];
    const params: any[] = [status, userId];

    if (status === 'APPROVED' || status === 'ACTIVE') {
      sets.push('approved_by = ?', 'approved_at = NOW()');
      params.push(userId);
    }
    if (status === 'CLOSED' || status === 'FORECLOSED' || status === 'WRITTEN_OFF') {
      sets.push('closed_at = NOW()');
    }
    if (extra?.emiAmount !== undefined) {
      sets.push('emi_amount = ?');
      params.push(extra.emiAmount);
    }
    if (extra?.firstEmiDate !== undefined) {
      sets.push('first_emi_date = ?');
      params.push(extra.firstEmiDate);
    }
    if (extra?.disbursedOn !== undefined) {
      sets.push('disbursed_on = ?');
      params.push(extra.disbursedOn);
    }
    params.push(id);

    const sql = `UPDATE employee_loans SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`;
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  // -------------------------------------------------------------------------
  // Installments
  // -------------------------------------------------------------------------
  async findSchedule(loanId: number, conn?: any): Promise<LoanInstallmentResponse[]> {
    const sql = 'SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY seq ASC';
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [loanId]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [loanId]);
    }
    return rows.map((r) => this.installmentToResponse(r));
  }

  async insertSchedule(loanId: number, rows: ScheduleRow[], conn: any): Promise<void> {
    for (const row of rows) {
      await conn.query(
        `INSERT INTO loan_installments
           (loan_id, seq, due_date, principal_component, interest_component,
            emi_amount, outstanding_after, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
         ON DUPLICATE KEY UPDATE due_date = VALUES(due_date),
           principal_component = VALUES(principal_component),
           interest_component = VALUES(interest_component),
           emi_amount = VALUES(emi_amount),
           outstanding_after = VALUES(outstanding_after)`,
        [
          loanId,
          row.seq,
          row.dueDate,
          row.principalComponent,
          row.interestComponent,
          row.emiAmount,
          row.outstandingAfter,
        ],
      );
    }
  }

  async deleteSchedule(loanId: number, conn: any): Promise<void> {
    await conn.query("DELETE FROM loan_installments WHERE loan_id = ? AND status = 'PENDING'", [loanId]);
  }

  /** Oldest-first pending installments, locked for a repayment allocation. */
  async findPendingInstallments(loanId: number, conn?: any): Promise<any[]> {
    const sql = `SELECT * FROM loan_installments
                 WHERE loan_id = ? AND status = 'PENDING' ORDER BY seq ASC`;
    if (conn) {
      const [rows] = await conn.query(`${sql} FOR UPDATE`, [loanId]);
      return rows as any[];
    }
    return this.query<any[]>(sql, [loanId]);
  }

  async waivePendingInstallments(loanId: number, conn: any): Promise<number> {
    const [result] = await conn.query(
      "UPDATE loan_installments SET status = 'WAIVED' WHERE loan_id = ? AND status = 'PENDING'",
      [loanId],
    );
    return Number((result as any)?.affectedRows ?? 0);
  }

  async applyRepayment(
    installmentId: number,
    amount: number,
    date: string,
    fullyPaid: boolean,
    conn: any,
  ): Promise<void> {
    await conn.query(
      `UPDATE loan_installments
       SET recovered_amount = recovered_amount + ?,
           recovered_on = ?,
           status = ?
       WHERE id = ?`,
      [amount, date, fullyPaid ? 'RECOVERED' : 'PENDING', installmentId],
    );
  }

  /**
   * PENDING installments due on or before `dueBy` for loans the engine may
   * recover from. `periodId` keeps already-tagged rows for that period in scope
   * while excluding rows claimed by a different period.
   */
  async getDueInstallments(periodId: number | null, dueBy: string): Promise<DueInstallment[]> {
    const rows = await this.query<any[]>(
      `SELECT i.id, i.loan_id, i.seq, i.due_date, i.emi_amount, i.principal_component,
              i.interest_component, i.outstanding_after,
              l.employee_id, l.loan_type
       FROM loan_installments i
       JOIN employee_loans l ON l.id = i.loan_id AND l.deleted_at IS NULL
       WHERE i.status = 'PENDING'
         AND i.due_date <= ?
         AND l.status IN ('APPROVED', 'ACTIVE')
         AND (i.period_id IS NULL OR i.period_id = ?)
       ORDER BY l.employee_id ASC, i.loan_id ASC, i.seq ASC`,
      [dueBy, periodId ?? null],
    );
    return rows.map((r) => ({
      installmentId: Number(r.id),
      loanId: Number(r.loan_id),
      employeeId: Number(r.employee_id),
      seq: Number(r.seq),
      dueDate: toDateString(r.due_date),
      emiAmount: Number(r.emi_amount ?? 0),
      principalComponent: Number(r.principal_component ?? 0),
      interestComponent: Number(r.interest_component ?? 0),
      outstandingAfter: Number(r.outstanding_after ?? 0),
      loanType: r.loan_type,
    }));
  }

  /**
   * Marks installments recovered against a payslip line. Accepts an optional
   * connection so the payroll engine can call this inside its own transaction.
   * Loans left with no pending installments are closed in the same statement.
   */
  async markInstallmentsRecovered(
    installmentIds: number[],
    salaryLineId: number | null,
    periodId: number | null,
    conn?: any,
  ): Promise<number> {
    const clean = intList(installmentIds);
    if (clean.length === 0) return 0;
    const idList = clean.join(',');

    const updateSql = `UPDATE loan_installments
       SET status = 'RECOVERED',
           recovered_amount = emi_amount,
           recovered_on = CURDATE(),
           salary_line_id = ?,
           period_id = ?
       WHERE status = 'PENDING' AND id IN (${idList})`;
    const closeSql = `UPDATE employee_loans l
       SET l.status = 'CLOSED', l.closed_at = NOW()
       WHERE l.status IN ('APPROVED', 'ACTIVE')
         AND EXISTS (SELECT 1 FROM loan_installments x WHERE x.loan_id = l.id AND x.id IN (${idList}))
         AND NOT EXISTS (SELECT 1 FROM loan_installments p WHERE p.loan_id = l.id AND p.status = 'PENDING')`;
    const params = [salaryLineId ?? null, periodId ?? null];

    let affected: number;
    if (conn) {
      const [result] = await conn.query(updateSql, params);
      affected = Number((result as any)?.affectedRows ?? 0);
      await conn.query(closeSql);
    } else {
      const result = await this.query<any>(updateSql, params);
      affected = Number(result?.affectedRows ?? 0);
      await this.query(closeSql);
    }
    return affected;
  }

  // -------------------------------------------------------------------------
  // Reimbursement types
  // -------------------------------------------------------------------------
  async findReimbursementTypes(isActive?: boolean): Promise<ReimbursementTypeResponse[]> {
    let sql = `SELECT t.*, c.code AS component_code
               FROM reimbursement_types t
               LEFT JOIN pay_components c ON c.id = t.component_id
               WHERE 1 = 1`;
    const params: any[] = [];
    if (isActive !== undefined) {
      sql += ' AND t.is_active = ?';
      params.push(boolParam(isActive));
    }
    sql += ' ORDER BY t.code ASC LIMIT 200';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.reimbTypeToResponse(r));
  }

  async findReimbursementTypeById(id: number, conn?: any): Promise<any | null> {
    const sql = 'SELECT * FROM reimbursement_types WHERE id = ?';
    if (conn) {
      const [rows] = await conn.query(sql, [id]);
      return (rows as any[])[0] || null;
    }
    const rows = await this.query<any[]>(sql, [id]);
    return rows[0] || null;
  }

  async findReimbursementTypeByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM reimbursement_types WHERE code = ?', [code]);
    return rows[0] || null;
  }

  async createReimbursementType(data: ReimbursementTypeInput): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO reimbursement_types
         (code, name, component_id, annual_limit, monthly_limit, requires_receipt, is_taxable, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code,
        data.name,
        data.componentId ?? null,
        nullableNumber(data.annualLimit),
        nullableNumber(data.monthlyLimit),
        boolParam(data.requiresReceipt ?? true),
        boolParam(data.isTaxable ?? false),
        boolParam(data.isActive ?? true),
      ],
    );
    return Number(result.insertId);
  }

  async updateReimbursementType(id: number, data: ReimbursementTypeInput): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(REIMB_TYPE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (['requiresReceipt', 'isTaxable', 'isActive'].includes(key)) params.push(boolParam(value));
      else if (['annualLimit', 'monthlyLimit'].includes(key)) params.push(nullableNumber(value));
      else params.push(value);
    }
    if (sets.length === 0) return;

    params.push(id);
    await this.query(`UPDATE reimbursement_types SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  // -------------------------------------------------------------------------
  // Reimbursement claims
  // -------------------------------------------------------------------------
  private readonly CLAIM_SELECT = `
    SELECT rc.*, e.full_name AS employee_name, e.emp_code AS emp_code,
           t.code AS type_code, t.name AS type_name, t.component_id AS component_id,
           u.name AS decided_by_name
    FROM reimbursement_claims rc
    JOIN employees e ON e.id = rc.employee_id
    JOIN reimbursement_types t ON t.id = rc.type_id
    LEFT JOIN users u ON u.id = rc.decided_by
  `;

  async findClaims(filters: ClaimFilters = {}): Promise<ReimbursementClaimResponse[]> {
    let sql = `${this.CLAIM_SELECT} WHERE rc.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND rc.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND rc.status = ?';
      params.push(filters.status);
    }
    if (filters.typeId) {
      sql += ' AND rc.type_id = ?';
      params.push(filters.typeId);
    }
    if (filters.from) {
      sql += ' AND rc.expense_date >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      sql += ' AND rc.expense_date <= ?';
      params.push(filters.to);
    }

    const limit = limitOf(filters.limit, 300, 2000);
    sql += ` ORDER BY rc.expense_date DESC, rc.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.claimToResponse(r));
  }

  async findClaimById(id: number): Promise<ReimbursementClaimResponse | null> {
    const rows = await this.query<any[]>(
      `${this.CLAIM_SELECT} WHERE rc.id = ? AND rc.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.claimToResponse(rows[0]) : null;
  }

  async findClaimRowById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM reimbursement_claims WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] || null;
  }

  /** Next sequence for the `RMB-yyyymmdd-nnnn` series on a given day. */
  async nextClaimSequence(datePart: string, conn: any): Promise<number> {
    const [rows] = await conn.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(claim_no, 14) AS UNSIGNED)), 0) AS max_seq
       FROM reimbursement_claims WHERE claim_no LIKE ?`,
      [`RMB-${datePart}-%`],
    );
    return Number((rows as any[])[0]?.max_seq ?? 0) + 1;
  }

  async insertClaim(
    claimNo: string,
    data: CreateClaimInput,
    userId: number,
    conn: any,
  ): Promise<number> {
    const [result] = await conn.query(
      `INSERT INTO reimbursement_claims
         (employee_id, type_id, claim_no, amount, currency, expense_date, description,
          document_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId,
        data.typeId,
        claimNo,
        Number(data.amount),
        data.currency ?? 'INR',
        data.expenseDate,
        data.description ?? null,
        data.documentId ?? null,
        data.status ?? 'SUBMITTED',
        userId,
      ],
    );
    return Number((result as any).insertId);
  }

  /** Claimed total already committed for a type within a date window. */
  async sumClaimedBetween(
    employeeId: number,
    typeId: number,
    from: string,
    to: string,
  ): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(COALESCE(approved_amount, amount)), 0) AS total
       FROM reimbursement_claims
       WHERE employee_id = ? AND type_id = ? AND deleted_at IS NULL
         AND status IN ('APPROVED', 'PAID')
         AND expense_date BETWEEN ? AND ?`,
      [employeeId, typeId, from, to],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async decideClaim(
    id: number,
    status: ClaimStatus,
    userId: number,
    note: string | null,
    approvedAmount: number | null,
  ): Promise<void> {
    await this.query(
      `UPDATE reimbursement_claims
       SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ?,
           approved_amount = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [status, userId, note, approvedAmount, id],
    );
  }

  async markClaimsPaid(ids: number[], periodId: number | null): Promise<number> {
    const clean = intList(ids);
    if (clean.length === 0) return 0;
    const result = await this.query<any>(
      `UPDATE reimbursement_claims
       SET status = 'PAID', payout_period_id = COALESCE(?, payout_period_id)
       WHERE deleted_at IS NULL AND status = 'APPROVED' AND id IN (${clean.join(',')})`,
      [periodId ?? null],
    );
    return Number(result?.affectedRows ?? 0);
  }

  /**
   * Approved claims the payroll engine should pay in a period: those tagged to
   * the period plus any approved claim not yet claimed by another period.
   */
  async getApprovedForPeriod(periodId: number): Promise<ReimbursementClaimResponse[]> {
    const rows = await this.query<any[]>(
      `${this.CLAIM_SELECT}
       WHERE rc.deleted_at IS NULL AND rc.status = 'APPROVED'
         AND (rc.payout_period_id = ? OR rc.payout_period_id IS NULL)
       ORDER BY rc.employee_id ASC, rc.id ASC`,
      [periodId],
    );
    return rows.map((r) => this.claimToResponse(r));
  }

  // -------------------------------------------------------------------------
  // Benefit plans & enrolments
  // -------------------------------------------------------------------------
  async findBenefitPlans(isActive?: boolean): Promise<BenefitPlanResponse[]> {
    let sql = `SELECT p.*,
                      (SELECT COUNT(*) FROM employee_benefits b
                        WHERE b.plan_id = p.id AND b.status = 'ACTIVE') AS enrolled_count
               FROM benefit_plans p
               WHERE p.deleted_at IS NULL`;
    const params: any[] = [];
    if (isActive !== undefined) {
      sql += ' AND p.is_active = ?';
      params.push(boolParam(isActive));
    }
    sql += ' ORDER BY p.code ASC LIMIT 200';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.planToResponse(r));
  }

  async findBenefitPlanById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM benefit_plans WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] || null;
  }

  async findBenefitPlanByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM benefit_plans WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] || null;
  }

  async createBenefitPlan(data: BenefitPlanInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO benefit_plans
         (code, name, benefit_type, provider, description, employer_contribution,
          employee_contribution, coverage_amount, component_id, currency,
          effective_from, effective_to, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code,
        data.name,
        data.benefitType ?? 'INSURANCE',
        data.provider ?? null,
        data.description ?? null,
        Number(data.employerContribution ?? 0),
        Number(data.employeeContribution ?? 0),
        nullableNumber(data.coverageAmount),
        data.componentId ?? null,
        data.currency ?? 'INR',
        data.effectiveFrom ?? null,
        data.effectiveTo ?? null,
        boolParam(data.isActive ?? true),
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateBenefitPlan(id: number, data: BenefitPlanInput): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(BENEFIT_PLAN_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (key === 'isActive') params.push(boolParam(value));
      else if (['employerContribution', 'employeeContribution', 'coverageAmount'].includes(key)) {
        params.push(nullableNumber(value));
      } else params.push(value);
    }
    if (sets.length === 0) return;

    params.push(id);
    await this.query(
      `UPDATE benefit_plans SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  private readonly ENROLMENT_SELECT = `
    SELECT b.*, e.full_name AS employee_name, e.emp_code AS emp_code,
           p.code AS plan_code, p.name AS plan_name, p.benefit_type
    FROM employee_benefits b
    JOIN employees e ON e.id = b.employee_id
    JOIN benefit_plans p ON p.id = b.plan_id
  `;

  async findEnrolments(filters: EnrolmentFilters = {}): Promise<EmployeeBenefitResponse[]> {
    let sql = `${this.ENROLMENT_SELECT} WHERE 1 = 1`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND b.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.planId) {
      sql += ' AND b.plan_id = ?';
      params.push(filters.planId);
    }
    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND b.status = ?';
      params.push(filters.status);
    }

    const limit = limitOf(filters.limit, 500, 2000);
    sql += ` ORDER BY b.enrolled_on DESC, b.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.enrolmentToResponse(r));
  }

  async findEnrolmentById(id: number): Promise<EmployeeBenefitResponse | null> {
    const rows = await this.query<any[]>(`${this.ENROLMENT_SELECT} WHERE b.id = ?`, [id]);
    return rows[0] ? this.enrolmentToResponse(rows[0]) : null;
  }

  async findActiveEnrolment(employeeId: number, planId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_benefits
       WHERE employee_id = ? AND plan_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [employeeId, planId],
    );
    return rows[0] || null;
  }

  async createEnrolment(
    employeeId: number,
    planId: number,
    data: EnrolBenefitInput & { enrolledOn: string },
    userId: number,
  ): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO employee_benefits
         (employee_id, plan_id, enrolled_on, nominee_name, policy_number,
          employee_contribution, employer_contribution, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [
        employeeId,
        planId,
        data.enrolledOn,
        data.nomineeName ?? null,
        data.policyNumber ?? null,
        nullableNumber(data.employeeContribution),
        nullableNumber(data.employerContribution),
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async endEnrolment(id: number, endedOn: string): Promise<void> {
    await this.query(
      "UPDATE employee_benefits SET ended_on = ?, status = 'ENDED' WHERE id = ?",
      [endedOn, id],
    );
  }

  // -------------------------------------------------------------------------
  // Shared lookups
  // -------------------------------------------------------------------------
  async findEmployeeBrief(
    employeeId: number,
  ): Promise<{ id: number; fullName: string; empCode: string; workStatus: string } | null> {
    const rows = await this.query<any[]>(
      'SELECT id, full_name, emp_code, work_status FROM employees WHERE id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      fullName: row.full_name,
      empCode: row.emp_code,
      workStatus: row.work_status,
    };
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------
  private loanToResponse(r: any): EmployeeLoanResponse {
    const principal = Number(r.principal ?? 0);
    const totalRecovered = Number(r.total_recovered ?? 0);
    const pendingAmount = Number(r.pending_amount ?? 0);
    // Outstanding follows the schedule when one exists, and the principal when
    // the loan is still awaiting approval (no installments generated yet).
    const hasSchedule = Number(r.pending_cnt ?? 0) > 0 || totalRecovered > 0;
    const outstanding = hasSchedule
      ? Math.round(pendingAmount * 100) / 100
      : ['APPROVED', 'ACTIVE'].includes(r.status)
        ? principal
        : 0;

    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      loanType: r.loan_type,
      principal,
      interestRatePct: Number(r.interest_rate_pct ?? 0),
      tenureMonths: Number(r.tenure_months ?? 0),
      emiAmount: Number(r.emi_amount ?? 0),
      currency: r.currency,
      disbursedOn: r.disbursed_on ? toDateString(r.disbursed_on) : null,
      firstEmiDate: r.first_emi_date ? toDateString(r.first_emi_date) : null,
      purpose: r.purpose ?? null,
      status: r.status,
      approvedBy: r.approved_by_name ?? null,
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
      closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      totalRecovered: Math.round(totalRecovered * 100) / 100,
      outstanding,
      installmentsPending: Number(r.pending_cnt ?? 0),
    };
  }

  private installmentToResponse(r: any): LoanInstallmentResponse {
    return {
      id: Number(r.id),
      loanId: Number(r.loan_id),
      seq: Number(r.seq),
      dueDate: toDateString(r.due_date),
      principalComponent: Number(r.principal_component ?? 0),
      interestComponent: Number(r.interest_component ?? 0),
      emiAmount: Number(r.emi_amount ?? 0),
      outstandingAfter: Number(r.outstanding_after ?? 0),
      status: r.status,
      recoveredAmount: Number(r.recovered_amount ?? 0),
      recoveredOn: r.recovered_on ? toDateString(r.recovered_on) : null,
      salaryLineId: numOrNull(r.salary_line_id),
      periodId: numOrNull(r.period_id),
    };
  }

  private reimbTypeToResponse(r: any): ReimbursementTypeResponse {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      componentId: numOrNull(r.component_id),
      componentCode: r.component_code ?? null,
      annualLimit: numOrNull(r.annual_limit),
      monthlyLimit: numOrNull(r.monthly_limit),
      requiresReceipt: !!r.requires_receipt,
      isTaxable: !!r.is_taxable,
      isActive: !!r.is_active,
    };
  }

  private claimToResponse(r: any): ReimbursementClaimResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      typeId: Number(r.type_id),
      typeCode: r.type_code ?? null,
      typeName: r.type_name ?? null,
      componentId: numOrNull(r.component_id),
      claimNo: r.claim_no,
      amount: Number(r.amount ?? 0),
      approvedAmount: numOrNull(r.approved_amount),
      currency: r.currency,
      expenseDate: toDateString(r.expense_date),
      description: r.description ?? null,
      documentId: numOrNull(r.document_id),
      status: r.status,
      payoutPeriodId: numOrNull(r.payout_period_id),
      decidedBy: r.decided_by_name ?? null,
      decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
      decisionNote: r.decision_note ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private planToResponse(r: any): BenefitPlanResponse {
    const out: BenefitPlanResponse = {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      benefitType: r.benefit_type,
      provider: r.provider ?? null,
      description: r.description ?? null,
      employerContribution: Number(r.employer_contribution ?? 0),
      employeeContribution: Number(r.employee_contribution ?? 0),
      coverageAmount: numOrNull(r.coverage_amount),
      componentId: numOrNull(r.component_id),
      currency: r.currency,
      effectiveFrom: r.effective_from ? toDateString(r.effective_from) : null,
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      isActive: !!r.is_active,
    };
    if (r.enrolled_count !== undefined) out.enrolledCount = Number(r.enrolled_count);
    return out;
  }

  private enrolmentToResponse(r: any): EmployeeBenefitResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      planId: Number(r.plan_id),
      planCode: r.plan_code ?? null,
      planName: r.plan_name ?? null,
      benefitType: r.benefit_type ?? null,
      enrolledOn: toDateString(r.enrolled_on),
      endedOn: r.ended_on ? toDateString(r.ended_on) : null,
      nomineeName: r.nominee_name ?? null,
      policyNumber: r.policy_number ?? null,
      employeeContribution: numOrNull(r.employee_contribution),
      employerContribution: numOrNull(r.employer_contribution),
      status: r.status,
    };
  }
}
